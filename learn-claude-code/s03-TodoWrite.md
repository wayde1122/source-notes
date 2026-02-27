# S03 - TodoWrite（任务自管理）

> 源码：`agents/s03_todo_write.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**让 Agent 自己管理任务清单，并在它"偷懒"时催促它更新。**

s02 的 Agent 已经能读写文件了，但面对多步骤任务时，它没有"计划"的概念——做到哪一步了？还剩几步？用户看不到，模型自己也容易忘。s03 引入了 `TodoManager`，给 LLM 一块"白板"来写计划、标进度。

---

## 架构图

```
+----------+      +-------+      +---------+
|   User   | ---> |  LLM  | ---> | Tools   |
|  prompt  |      |       |      | + todo  |
+----------+      +---+---+      +----+----+
                      ^               |
                      |   tool_result |
                      +---------------+
                            |
                +-----------+-----------+
                | TodoManager state     |
                | [ ] task A            |
                | [>] task B <- doing   |
                | [x] task C            |
                +-----------------------+
                            |
                if rounds_since_todo >= 3:
                  inject <reminder>
```

与 s02 的区别：新增 `TodoManager` 状态 + nag reminder 催促机制。

---

## 代码拆解

### 1. System Prompt 的变化（第 45-47 行）

```python
SYSTEM = f"""You are a coding agent at {WORKDIR}.
Use the todo tool to plan multi-step tasks. Mark in_progress before starting, completed when done.
Prefer tools over prose."""
```

对比 s02 的 `"Act, don't explain."`，s03 增加了对 todo 工具的使用指导：

- 多步骤任务要用 todo 工具做计划
- 开始做之前标 `in_progress`，做完标 `completed`
- 工具优先，不要只说不做

这是用 System Prompt **引导模型行为**的典型模式。

### 2. TodoManager 类（第 51-85 行）

一个纯内存的任务状态管理器，两个核心方法：

#### `update()` — 写入待办列表

```python
def update(self, items: list) -> str:
    if len(items) > 20:
        raise ValueError("Max 20 todos allowed")
    # ... 逐项校验 ...
    if in_progress_count > 1:
        raise ValueError("Only one task can be in_progress at a time")
    self.items = validated
    return self.render()
```

三层校验规则：

| 规则 | 目的 |
| --- | --- |
| `len(items) > 20` | 防止 LLM 生成无限多待办项，浪费上下文 |
| `status` 必须是 `pending/in_progress/completed` | 约束状态机，不允许乱写状态 |
| `in_progress_count > 1` 报错 | **强制单任务执行**，防止 LLM 同时标多个为进行中 |

"只允许一个 in_progress"是最关键的约束——它迫使 LLM **顺序推进**任务，而不是标一堆"进行中"然后乱跳。

注意 `self.items = validated` 是**整体替换**，不是增量更新。每次调用 todo 工具都是传入完整的任务列表，这样设计更简单，避免了增量更新的各种边界问题。

#### `render()` — 渲染可读文本

```python
def render(self) -> str:
    marker = {"pending": "[ ]", "in_progress": "[>]", "completed": "[x]"}[item["status"]]
    lines.append(f"{marker} #{item['id']}: {item['text']}")
    done = sum(1 for t in self.items if t["status"] == "completed")
    lines.append(f"\n({done}/{len(self.items)} completed)")
```

输出示例：

```
[ ] #1: 搭建项目结构
[>] #2: 实现用户认证
[x] #3: 编写数据库模型

(1/3 completed)
```

这段文本会作为 `tool_result` 返回给 LLM——模型在下一轮对话中看到自己的任务进度，从而决定接下来做什么。用户在终端也能看到同样的输出，了解 Agent 的工作计划。

### 3. todo 工具注册（第 145 行 + 第 157-158 行）

分发表新增一行：

```python
"todo": lambda **kw: TODO.update(kw["items"]),
```

工具 Schema 定义 `items` 为对象数组，每个对象包含 `id`、`text`、`status` 三个字段：

```python
{"name": "todo", "description": "Update task list. Track progress on multi-step tasks.",
 "input_schema": {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object",
   "properties": {"id": {"type": "string"}, "text": {"type": "string"},
     "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]}},
   "required": ["id", "text", "status"]}}}, "required": ["items"]}}
```

Schema 里的 `enum` 约束 status 只能是三个值，这在模型生成参数时就进行了一层约束。`TodoManager.update()` 再做运行时校验，是**双重保护**。

### 4. Nag Reminder 催促机制（第 163-191 行）

这是 s03 的核心新增逻辑：

```python
def agent_loop(messages: list):
    rounds_since_todo = 0
    while True:
        if rounds_since_todo >= 3 and messages:
            last = messages[-1]
            if last["role"] == "user" and isinstance(last.get("content"), list):
                last["content"].insert(0, {"type": "text", "text": "<reminder>Update your todos.</reminder>"})
        # ... LLM 调用 + 工具执行 ...
        used_todo = False
        for block in response.content:
            if block.type == "tool_use":
                # ...
                if block.name == "todo":
                    used_todo = True
        rounds_since_todo = 0 if used_todo else rounds_since_todo + 1
```

完整机制拆解：

1. **计数器 `rounds_since_todo`** — 记录连续多少轮没用 todo 工具
2. **每轮检测** — 遍历工具调用，发现 `todo` 就标记 `used_todo = True`
3. **计数器更新** — 用了 todo 归零，没用就 +1
4. **催促注入** — 连续 3 轮没更新，就往最后一条 user 消息头部插入 `<reminder>Update your todos.</reminder>`

注入方式是 `insert(0, ...)`，把提醒放在 tool_result 列表**最前面**，确保模型优先看到。

**后端知识点：** 这是一种**运行时消息注入**技术。用户和 LLM 都不知道这条消息的存在，它是代码在对话流中悄悄插入的"系统级指令"。类似的模式在生产 Agent 中很常见，比如注入上下文信息、安全警告等。

### 5. 错误处理的改进（第 183-186 行）

```python
try:
    output = handler(**block.input) if handler else f"Unknown tool: {block.name}"
except Exception as e:
    output = f"Error: {e}"
```

对比 s02 没有 try/except，s03 加了异常捕获。因为 `TodoManager.update()` 会主动抛出 `ValueError`（比如 in_progress 超过 1 个），这些错误需要被优雅地捕获并作为 `tool_result` 返回给 LLM，让模型自行修正，而不是让整个程序崩溃。

---

## s02 → s03 的演进对比

| 维度 | s02 | s03 |
| --- | --- | --- |
| 工具数量 | 4 个 | 5 个（+todo） |
| 状态管理 | 无状态 | `TodoManager` 维护任务列表 |
| System Prompt | "Act, don't explain" | 增加 todo 使用指导 |
| 错误处理 | 无 try/except | 工具执行包裹在 try/except 中 |
| 消息注入 | 无 | nag reminder 催促机制 |
| 循环结构 | 标准 while 循环 | while 循环 + 计数器 + 条件注入 |

---

## 数据流

```
用户输入 "创建一个 Express 项目，包含用户注册和登录 API"
    ↓
LLM 返回: tool_use { name: "todo", input: { items: [
    { id: "1", text: "初始化 Express 项目", status: "in_progress" },
    { id: "2", text: "实现用户注册 API", status: "pending" },
    { id: "3", text: "实现用户登录 API", status: "pending" }
]}}
    ↓
TodoManager.update() 校验通过，返回：
    [>] #1: 初始化 Express 项目
    [ ] #2: 实现用户注册 API
    [ ] #3: 实现用户登录 API
    (0/3 completed)
    ↓
同一轮还有: tool_use { name: "bash", input: { command: "mkdir myapp && cd myapp && npm init -y" } }
    ↓ (rounds_since_todo = 0)

下一轮 LLM 返回: tool_use { name: "write_file", ... }  (没用 todo)
    ↓ (rounds_since_todo = 1)

又一轮: tool_use { name: "bash", ... }  (还是没用 todo)
    ↓ (rounds_since_todo = 2)

又一轮: tool_use { name: "edit_file", ... }  (第 3 轮没用 todo)
    ↓ (rounds_since_todo = 3, 触发催促!)

注入: <reminder>Update your todos.</reminder>
    ↓
LLM 看到提醒，返回: tool_use { name: "todo", input: { items: [
    { id: "1", text: "初始化 Express 项目", status: "completed" },
    { id: "2", text: "实现用户注册 API", status: "in_progress" },
    { id: "3", text: "实现用户登录 API", status: "pending" }
]}}
    ↓ (rounds_since_todo 归零)
```

---

## 用 Node.js 重写时的对应关系

| Python（源码） | Node.js（练习） |
| --- | --- |
| `class TodoManager` | 用 `class` 或闭包实现 |
| `self.items = validated` | 整体替换 `this.items = validated` |
| `list.insert(0, ...)` | `array.unshift(...)` |
| `sum(1 for t in ... if ...)` | `items.filter(t => t.status === 'completed').length` |
| `raise ValueError` | `throw new Error(...)` |
| `try/except` | `try/catch` |
| `isinstance(x, list)` | `Array.isArray(x)` |

---

## 思考与总结

1. **TodoManager 是 Agent 的"工作记忆"** — 消息历史（messages）是长期记忆，TodoManager 是当前任务的短期规划。两者配合让 Agent 既记得做了什么，也知道还剩什么
2. **约束即引导** — "只允许一个 in_progress"不是技术限制，而是行为约束。通过规则强制 LLM 按顺序工作，避免发散
3. **Nag Reminder 是低成本的可靠性提升** — 模型会"忘记"更新进度，计数器 + 消息注入是最简单的修复方式，不需要改模型、不需要改 prompt，几行代码就能显著改善行为
4. **消息注入是 Agent 工程的核心技术** — 在用户和模型之间的消息流中插入系统级指令，是控制 Agent 行为的最有力手段。生产级 Agent 大量使用这种模式
5. **Schema + 运行时校验 = 双重保护** — JSON Schema 约束模型的输出格式，`TodoManager.update()` 做运行时校验。防御要分层，不能只依赖单一机制
6. **整体替换 vs 增量更新** — `self.items = validated` 选择了整体替换，虽然每次要传完整列表，但避免了增量操作的复杂边界问题（如 ID 冲突、部分更新失败等）。这是简单性优先的设计选择
