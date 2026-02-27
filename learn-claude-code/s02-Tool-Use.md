# S02 - Tool Use（工具扩展）

> 源码：`agents/s02_tool_use.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**Agent Loop 一行没变，只是往工具列表里加了东西。**

```
s01: tools = [bash]
s02: tools = [bash, read_file, write_file, edit_file]
```

这揭示了 Agent 架构的一个关键特性：**循环是稳定的骨架，工具是可插拔的能力。** 扩展 Agent 不需要改循环逻辑，只需要注册新工具。

---

## 架构图

```
+----------+      +-------+      +------------------+
|   User   | ---> |  LLM  | ---> | Tool Dispatch    |
|  prompt  |      |       |      | {                |
+----------+      +---+---+      |   bash: run_bash |
                      ^          |   read: run_read |
                      |          |   write: run_wr  |
                      +----------+   edit: run_edit |
                      tool_result| }                |
                                 +------------------+
```

与 s01 的区别：工具执行层从"直接调用 `run_bash`"变成了**分发表查找**。

---

## 代码拆解

### 1. 路径安全校验（第 40-44 行）

```python
def safe_path(p: str) -> Path:
    path = (WORKDIR / p).resolve()
    if not path.is_relative_to(WORKDIR):
        raise ValueError(f"Path escapes workspace: {p}")
    return path
```

s02 新增了文件操作工具，因此必须引入路径安全机制：

- `resolve()` 展开 `..`、`.` 等相对路径为绝对路径
- `is_relative_to(WORKDIR)` 确认解析后的路径仍在工作目录内
- 防止 LLM 生成 `../../etc/passwd` 之类的路径遍历攻击

**后端知识点：** 路径遍历（Path Traversal）是 Web 安全中的经典漏洞（CWE-22）。任何接收外部路径输入的系统都必须做沙箱校验。

### 2. 四个工具函数（第 47-90 行）

| 工具 | 函数 | 功能 | 安全措施 |
| --- | --- | --- | --- |
| `bash` | `run_bash` | 执行 shell 命令 | 危险命令黑名单 + 120s 超时 + 输出截断 50000 字符 |
| `read_file` | `run_read` | 读取文件内容 | `safe_path` 路径校验 + 行数限制 + 输出截断 |
| `write_file` | `run_write` | 写入文件 | `safe_path` 路径校验 + 自动创建父目录 |
| `edit_file` | `run_edit` | 替换文件中的文本 | `safe_path` 路径校验 + 精确匹配检查 |

`run_bash` 与 s01 完全相同。新增的三个文件工具都经过 `safe_path` 保护。

**`run_read` 的设计细节：**

```python
def run_read(path: str, limit: int = None) -> str:
    text = safe_path(path).read_text()
    lines = text.splitlines()
    if limit and limit < len(lines):
        lines = lines[:limit] + [f"... ({len(lines) - limit} more lines)"]
    return "\n".join(lines)[:50000]
```

- `limit` 参数控制只读前 N 行，避免大文件一次性读入撑爆上下文
- 最终仍有 50000 字符硬截断兜底

**`run_edit` 的设计细节：**

```python
fp.write_text(content.replace(old_text, new_text, 1))
```

- `replace(..., 1)` 只替换第一个匹配项，避免误改
- 先检查 `old_text in content`，找不到就返回错误而不是静默失败

### 3. 分发表模式（第 93-99 行）

```python
TOOL_HANDLERS = {
    "bash":       lambda **kw: run_bash(kw["command"]),
    "read_file":  lambda **kw: run_read(kw["path"], kw.get("limit")),
    "write_file": lambda **kw: run_write(kw["path"], kw["content"]),
    "edit_file":  lambda **kw: run_edit(kw["path"], kw["old_text"], kw["new_text"]),
}
```

用字典将工具名映射到处理函数，代替 `if/elif` 链。

**为什么用 `lambda **kw` 包一层？** 因为 LLM 返回的 `block.input` 是一个字典（如 `{"path": "foo.py", "content": "..."}`），lambda 负责从字典中提取参数并传给对应函数，起到**参数适配器**的作用。

调用时只需一行：

```python
handler = TOOL_HANDLERS.get(block.name)
output = handler(**block.input)
```

**后端知识点：** Dispatch Map 是命令模式（Command Pattern）的简化实现，在插件系统、路由分发、事件处理中广泛使用。Node.js 等价写法：

```javascript
const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => runRead(path, limit),
}
```

### 4. 工具 Schema 定义（第 101-110 行）

```python
TOOLS = [
    {"name": "bash", "description": "Run a shell command.",
     "input_schema": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}},
    # ... 其余工具类似
]
```

每个工具定义包含三个部分：

- **name** — 工具名称，LLM 调用时的标识
- **description** — 工具描述，帮助 LLM 理解何时使用该工具
- **input_schema** — JSON Schema 格式的参数定义，约束 LLM 输出的参数结构

### 5. Agent Loop 的变化（第 113-129 行）

```python
for block in response.content:
    if block.type == "tool_use":
        handler = TOOL_HANDLERS.get(block.name)
        output = handler(**block.input) if handler else f"Unknown tool: {block.name}"
        results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
```

与 s01 的唯一区别：从硬编码的 `run_bash(block.input["command"])` 变成了通过分发表动态查找。循环结构完全没变。

---

## s01 → s02 的演进对比

| 维度 | s01 | s02 |
| --- | --- | --- |
| 工具数量 | 1 个（bash） | 4 个（bash + 文件操作三件套） |
| 工具分发 | 硬编码 `run_bash` | 分发表 `TOOL_HANDLERS` 字典查找 |
| 路径处理 | `os.getcwd()` | `pathlib.Path` + `safe_path` 安全校验 |
| 安全机制 | 危险命令黑名单 | 黑名单 + 路径沙箱 |
| 循环逻辑 | while + stop_reason | **完全相同** |

---

## 数据流

```
用户输入 "把 README.md 中的 v1 改成 v2"
    ↓
LLM 返回: tool_use { name: "read_file", input: { path: "README.md" } }
    ↓
TOOL_HANDLERS["read_file"](**{ path: "README.md" })
    → run_read("README.md") → 返回文件内容
    ↓
LLM 看到内容后返回: tool_use { name: "edit_file", input: { path: "README.md", old_text: "v1", new_text: "v2" } }
    ↓
TOOL_HANDLERS["edit_file"](**{ path: "README.md", old_text: "v1", new_text: "v2" })
    → run_edit("README.md", "v1", "v2") → "Edited README.md"
    ↓
LLM 返回: text "已将 README.md 中的 v1 改为 v2"  (stop_reason: "end_turn")
    ↓
循环结束
```

注意 LLM **自主决定**了先读再改的两步策略，代码没有编排这个流程。

---

## 用 Node.js 重写时的对应关系

| Python（源码） | Node.js（练习） |
| --- | --- |
| `pathlib.Path` | `path.resolve()` + `path.relative()` |
| `path.is_relative_to()` | 手动检查 `!resolved.startsWith(workdir)` |
| `path.read_text()` | `fs.readFileSync(path, 'utf-8')` |
| `path.write_text()` | `fs.writeFileSync(path, content)` |
| `fp.parent.mkdir(parents=True)` | `fs.mkdirSync(dir, { recursive: true })` |
| `content.replace(old, new, 1)` | `content.replace(old, new)`（JS 默认只替换第一个） |
| `dict` 分发表 | `Map` 或普通对象分发表 |

---

## 思考与总结

1. **工具是 Agent 的"手脚"** — s01 的 Agent 只能说，s02 的 Agent 能读写文件了。工具越多，Agent 能力越强，但同时安全风险也越大
2. **循环不变，工具可插拔** — 这是最重要的架构洞察。好的 Agent 框架应该让新增工具的成本趋近于零
3. **分发表优于条件分支** — 字典查找是 O(1)，可读性好，扩展只需加一行。当工具数量增长到几十个时，if/elif 会变得不可维护
4. **安全是分层的** — 命令黑名单、路径沙箱、输出截断，每一层防御不同类型的风险。生产环境还需要加上 Docker 容器隔离、文件系统权限控制等
5. **LLM 的自主编排能力** — 先 read 再 edit 的流程不是代码写死的，是模型自己推理出来的。这就是 Agent 与传统脚本的本质区别
