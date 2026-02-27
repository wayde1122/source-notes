# S04 - Subagent（子代理）

> 源码：`agents/s04_subagent.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**用独立的子代理处理子任务，上下文隔离，只回传摘要。**

随着任务复杂度增加，所有操作都塞在同一个消息历史里会导致上下文窗口爆炸。s04 的解决方案是：父 Agent 把子任务"外包"给一个全新的子 Agent，子 Agent 用空白的 `messages=[]` 独立工作，完成后只把摘要文本返回给父 Agent。子 Agent 的完整对话历史随即丢弃。

**关键洞察：** "进程隔离天然带来上下文隔离。"

---

## 架构图

```
Parent agent                     Subagent
+------------------+             +------------------+
| messages=[...]   |             | messages=[]      |  <-- 全新上下文
|                  |  dispatch   |                  |
| tool: task       | ---------->| while tool_use:  |
|   prompt="..."   |            |   call tools     |
|   description="" |            |   append results |
|                  |  summary   |                  |
|   result = "..." | <--------- | return last text |
+------------------+             +------------------+
          |
Parent context stays clean.
Subagent context is discarded.
```

与前几版的核心区别：从"单 Agent 独自干"变成"父子 Agent 协作"。

---

## 代码拆解

### 1. 双 System Prompt（第 41-42 行）

```python
SYSTEM = f"You are a coding agent at {WORKDIR}. Use the task tool to delegate exploration or subtasks."
SUBAGENT_SYSTEM = f"You are a coding subagent at {WORKDIR}. Complete the given task, then summarize your findings."
```

父子 Agent 的角色定位不同：

- **父 Agent** — 指挥官，负责规划和分派（"Use the task tool to delegate"）
- **子 Agent** — 执行者，完成任务后**必须总结**（"then summarize your findings"）

"总结"这个要求很关键——子 Agent 最后一轮的文本输出就是返回给父 Agent 的内容，如果不总结，父 Agent 就看不到有用信息。

### 2. 工具权限分层（第 101-140 行）

```python
CHILD_TOOLS = [bash, read_file, write_file, edit_file]

PARENT_TOOLS = CHILD_TOOLS + [
    {"name": "task", "description": "Spawn a subagent with fresh context..."},
]
```

| 角色 | 可用工具 | 说明 |
| --- | --- | --- |
| 父 Agent | bash + 文件操作 + **task** | 可以派子任务 |
| 子 Agent | bash + 文件操作 | **没有 task**，不能再派子任务 |

子 Agent 没有 `task` 工具，**防止递归派生**——否则子 Agent 可能无限生成孙 Agent，耗尽资源。这是通过工具权限控制实现的简单而有效的防护。

### 3. 子代理执行函数（第 115-133 行）

```python
def run_subagent(prompt: str) -> str:
    sub_messages = [{"role": "user", "content": prompt}]  # fresh context
    for _ in range(30):  # safety limit
        response = client.messages.create(
            model=MODEL, system=SUBAGENT_SYSTEM, messages=sub_messages,
            tools=CHILD_TOOLS, max_tokens=8000,
        )
        sub_messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason != "tool_use":
            break
        results = []
        for block in response.content:
            if block.type == "tool_use":
                handler = TOOL_HANDLERS.get(block.name)
                output = handler(**block.input) if handler else f"Unknown tool: {block.name}"
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": str(output)[:50000]})
        sub_messages.append({"role": "user", "content": results})
    return "".join(b.text for b in response.content if hasattr(b, "text")) or "(no summary)"
```

这本质上就是 s01 的 Agent Loop 重写了一遍，但有三个关键差异：

| 差异 | 说明 |
| --- | --- |
| `sub_messages = [...]` | 全新的空上下文，不共享父 Agent 的消息历史 |
| `for _ in range(30)` | 安全上限，用 `for` 替代 `while True`，防止子 Agent 无限循环 |
| 返回值只取文本 | `"".join(b.text for b in response.content if hasattr(b, "text"))`，只提取最后一轮的纯文本作为摘要 |

**父子之间的通信边界：**

- **共享的：** 文件系统（子 Agent 的写入父 Agent 能看到）、工具函数实例（`TOOL_HANDLERS`）
- **隔离的：** 消息历史（各自维护 `messages`）、上下文窗口（子 Agent 不知道父 Agent 的对话内容）

### 4. 父 Agent Loop 中的 task 分发（第 143-164 行）

```python
for block in response.content:
    if block.type == "tool_use":
        if block.name == "task":
            desc = block.input.get("description", "subtask")
            print(f"> task ({desc}): {block.input['prompt'][:80]}")
            output = run_subagent(block.input["prompt"])
        else:
            handler = TOOL_HANDLERS.get(block.name)
            output = handler(**block.input) if handler else f"Unknown tool: {block.name}"
```

`task` 工具没有放入 `TOOL_HANDLERS` 分发表，而是在循环中**单独判断**。这是因为 `task` 的处理逻辑（启动子 Agent）与普通工具（执行单一操作）本质不同，硬塞进分发表反而不清晰。

---

## 数据流

```
用户输入 "分析这个项目的代码结构，然后写一个 README"
    ↓
父 Agent 决定先委派分析任务:
  tool_use { name: "task", input: {
    prompt: "分析当前项目的目录结构和主要文件，总结技术栈和模块组成",
    description: "分析项目结构"
  }}
    ↓
run_subagent() 启动子 Agent:
  sub_messages = [{ role: "user", content: "分析当前项目..." }]
    ↓
  子 Agent 第 1 轮: bash("ls -la") → 看到文件列表
  子 Agent 第 2 轮: read_file("package.json") → 看到依赖
  子 Agent 第 3 轮: bash("find . -name '*.py'") → 找到所有 Python 文件
  子 Agent 第 4 轮: stop_reason = "end_turn"
    返回摘要: "项目使用 Python + Anthropic SDK，包含 4 个递进式 Agent 实现..."
    ↓
摘要作为 tool_result 返回给父 Agent
父 Agent 的消息历史只增加了一条简短的摘要，而不是子 Agent 的全部对话
    ↓
父 Agent 根据摘要继续: write_file("README.md", ...)
    ↓
stop_reason = "end_turn"，循环结束
```

---

## s03 → s04 的演进对比

| 维度 | s03 | s04 |
| --- | --- | --- |
| Agent 数量 | 1 个 | 父 + 子 |
| 上下文管理 | 单一 messages 不断增长 | 子 Agent 独立上下文，完成后丢弃 |
| 工具权限 | 所有工具平等 | 分层：父有 task，子没有 |
| 循环安全 | while True（依赖 stop_reason） | 子 Agent 加了 `for _ in range(30)` 硬上限 |
| 信息回传 | 所有工具结果都在 messages 中 | 子 Agent 只回传最终摘要 |
| TodoManager | 有 | 移除（简化示例聚焦子代理） |

---

## 用 Node.js 重写时的对应关系

| Python（源码） | Node.js（练习） |
| --- | --- |
| `run_subagent(prompt)` | 异步函数 `async function runSubagent(prompt)` |
| `for _ in range(30)` | `for (let i = 0; i < 30; i++)` |
| `"".join(b.text for b in ...)` | `response.content.filter(b => b.type === 'text').map(b => b.text).join('')` |
| `hasattr(b, "text")` | `'text' in b` 或 `b.type === 'text'` |
| `PARENT_TOOLS = CHILD_TOOLS + [...]` | `[...CHILD_TOOLS, { name: 'task', ... }]` 展开运算符 |
| `block.input.get("description", "subtask")` | `block.input.description ?? 'subtask'` |

---

## 思考与总结

1. **上下文窗口是 Agent 最稀缺的资源** — 所有对话都挤在一个 messages 里，窗口很快就满。子 Agent 的"用完即弃"模式是最直接的解法
2. **摘要是信息压缩** — 子 Agent 可能执行了 10 轮工具调用，但父 Agent 只看到一段摘要文本。信息压缩比可能是 10:1 甚至更高，代价是丢失了细节
3. **文件系统是共享状态** — 父子之间不共享消息历史，但共享文件系统。子 Agent 写的文件，父 Agent 可以直接读。这是一种隐式的通信通道
4. **权限分层防止递归** — 子 Agent 没有 `task` 工具，从根源上杜绝了无限递归。生产系统中可能允许有限深度的递归（如最多 3 层），但需要更复杂的深度追踪机制
5. **30 轮硬上限是粗暴但有效的安全阀** — `for _ in range(30)` 不优雅，但能防止子 Agent 陷入死循环。比 `while True` 安全得多
6. **这个模式就是 Cursor 的 Task 功能** — Cursor IDE 中的 "Task" 工具（派子 Agent 去探索代码库）与此完全同构：独立上下文、共享文件系统、只回传摘要
