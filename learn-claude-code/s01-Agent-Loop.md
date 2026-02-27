# S01 - Agent Loop（核心循环）

> 源码：`agents/s01_agent_loop.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**整个 AI Agent 的秘密就一个模式：**

```
while stop_reason == "tool_use":
    response = LLM(messages, tools)
    execute tools
    append results
```

模型不断调用工具、收集结果、再次思考，直到它认为任务完成（不再调用工具），循环结束。

---

## 架构图

```
+----------+      +-------+      +---------+
|   User   | ---> |  LLM  | ---> |  Tool   |
|  prompt  |      |       |      | execute |
+----------+      +---+---+      +----+----+
                      ^               |
                      |   tool_result |
                      +---------------+
                      (loop continues)
```

---

## 代码拆解

### 1. 初始化（第 26-38 行）

```python
client = Anthropic(base_url=os.getenv("ANTHROPIC_BASE_URL"))
MODEL = os.environ["MODEL_ID"]
```

- 用 `Anthropic` SDK 创建客户端，支持自定义 `base_url`（可接入任何 OpenAI 兼容的 API）
- 模型 ID 从环境变量读取，不硬编码

**后端知识点：** 环境变量配置管理，避免硬编码敏感信息。

### 2. System Prompt（第 40 行）

```python
SYSTEM = f"You are a coding agent at {os.getcwd()}. Use bash to solve tasks. Act, don't explain."
```

- 系统提示词告诉模型：你是一个编程 Agent，用 bash 解决问题，直接执行不要解释
- `os.getcwd()` 注入当前工作目录，给模型提供上下文

**后端知识点：** 进程工作目录（cwd）的概念，`os.getcwd()` 返回当前进程的工作目录。

### 3. 工具定义（第 42-50 行）

```python
TOOLS = [{
    "name": "bash",
    "description": "Run a shell command.",
    "input_schema": {
        "type": "object",
        "properties": {"command": {"type": "string"}},
        "required": ["command"],
    },
}]
```

- 只定义了一个工具：`bash`，接受一个 `command` 字符串参数
- 工具定义遵循 JSON Schema 格式，这是 OpenAI/Anthropic 的 tool calling 协议标准

**后端知识点：** JSON Schema 用于描述数据结构，是 API 参数校验的标准方式。tool calling 本质就是让模型输出一段符合 schema 的 JSON。

### 4. 工具执行（第 53-63 行）

```python
def run_bash(command: str) -> str:
    dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]
    if any(d in command for d in dangerous):
        return "Error: Dangerous command blocked"
    try:
        r = subprocess.run(command, shell=True, cwd=os.getcwd(),
                           capture_output=True, text=True, timeout=120)
        out = (r.stdout + r.stderr).strip()
        return out[:50000] if out else "(no output)"
    except subprocess.TimeoutExpired:
        return "Error: Timeout (120s)"
```

三层防护：

1. **危险命令黑名单** — 简单字符串匹配过滤 `rm -rf /`、`sudo` 等
2. **超时控制** — 120 秒超时，防止命令挂起
3. **输出截断** — 最多 50000 字符，防止超大输出撑爆上下文

**后端知识点：**

- `subprocess.run` 是 Python 中执行子进程的标准方式，等价于 Node.js 的 `child_process.execSync`
- `capture_output=True` 捕获 stdout 和 stderr
- `shell=True` 允许使用 shell 语法（管道、重定向等），但有安全风险
- 超时处理是后端必备的防御性编程思维

### 5. 核心 Agent Loop（第 67-87 行）

```python
def agent_loop(messages: list):
    while True:
        # 1. 调用 LLM
        response = client.messages.create(
            model=MODEL, system=SYSTEM, messages=messages,
            tools=TOOLS, max_tokens=8000,
        )
        # 2. 将助手回复加入消息历史
        messages.append({"role": "assistant", "content": response.content})

        # 3. 如果模型没有调用工具，循环结束
        if response.stop_reason != "tool_use":
            return

        # 4. 执行所有工具调用，收集结果
        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = run_bash(block.input["command"])
                results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": output
                })
        # 5. 将工具结果作为 user 消息加入历史
        messages.append({"role": "user", "content": results})
```

**这就是整个 Agent 的核心，只有 20 行代码。** 流程如下：

1. **调用 LLM** — 传入完整的消息历史 + 可用工具列表
2. **追加助手回复** — 将模型的响应加入 `messages` 数组
3. **判断停止条件** — `stop_reason != "tool_use"` 意味着模型认为任务完成
4. **执行工具** — 遍历响应中的 `tool_use` block，逐个执行
5. **追加工具结果** — 以 `user` 角色将结果送回，触发下一轮循环

**关键洞察：**

- `messages` 是一个不断增长的数组，包含完整的对话历史
- 工具结果以 `role: "user"` 的身份加入，因为从模型视角看，工具结果是"外部世界的反馈"
- `tool_use_id` 将工具结果和对应的工具调用关联起来

### 6. 主入口（第 90-106 行）

```python
if __name__ == "__main__":
    history = []
    while True:
        query = input("\033[36ms01 >> \033[0m")
        if query.strip().lower() in ("q", "exit", ""):
            break
        history.append({"role": "user", "content": query})
        agent_loop(history)
```

- 外层是一个 REPL（Read-Eval-Print Loop）
- `history` 在整个会话中持续累积，实现多轮对话
- `\033[36m` 是 ANSI 转义码，给终端文字上色

---

## 数据流

```
用户输入 "列出当前目录文件"
    ↓
messages = [{ role: "user", content: "列出当前目录文件" }]
    ↓
LLM 返回: tool_use { name: "bash", input: { command: "ls -la" } }
    ↓
messages += [{ role: "assistant", content: [tool_use block] }]
    ↓
执行 run_bash("ls -la") → 得到文件列表输出
    ↓
messages += [{ role: "user", content: [{ type: "tool_result", content: "..." }] }]
    ↓
LLM 返回: text "当前目录有以下文件: ..."  (stop_reason: "end_turn")
    ↓
messages += [{ role: "assistant", content: [text block] }]
    ↓
循环结束，输出文本给用户
```

---

## 用 Node.js 重写时的对应关系

| Python（源码）   | Node.js（练习）                     |
| ---------------- | ----------------------------------- |
| `Anthropic` SDK  | 原生 `fetch` 调用 OpenAI 兼容 API   |
| `subprocess.run` | `child_process.execSync` 或 `spawn` |
| `os.getcwd()`    | `process.cwd()`                     |
| `os.environ`     | `process.env`                       |
| `input()` REPL   | `readline` 模块                     |
| `messages` 列表  | JavaScript 数组                     |

---

## 思考与总结

1. **Agent 的本质极其简单** — 就是一个 while 循环 + 工具执行 + 结果回传。所有复杂的 Agent 框架（LangChain、AutoGPT 等）都是在这个基础上叠加的
2. **消息历史就是 Agent 的"记忆"** — `messages` 数组持续增长，模型每次都能看到之前的所有交互
3. **stop_reason 是唯一的退出条件** — 模型自己决定什么时候停止，不是代码控制的
4. **安全防护是最小化的** — 生产环境需要更完善的沙箱（Docker、权限隔离等），字符串匹配黑名单远远不够
5. **没有错误重试** — 如果 LLM API 调用失败，整个循环直接崩溃。生产环境必须加重试和 fallback
