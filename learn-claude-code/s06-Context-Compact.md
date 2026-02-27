# S06 - Context Compact（上下文压缩）

> 源码：`agents/s06_context_compact.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**让 Agent 学会"战略性遗忘"，从而可以无限工作下去。**

消息历史（messages）会随着对话轮次不断增长，最终超过 LLM 的上下文窗口。s06 引入三层压缩管线：每轮静默替换旧工具结果、超过阈值时自动摘要重置、模型主动触发压缩。

**关键洞察：** "The agent can forget strategically and keep working forever."

---

## 架构图

```
Every turn:
+------------------+
| Tool call result |
+------------------+
        |
        v
[Layer 1: micro_compact]        (静默，每轮执行，零成本)
  把最近 3 条之前的 tool_result
  替换为 "[Previous: used {tool_name}]"
        |
        v
[Check: tokens > 50000?]
   |               |
   no              yes
   |               |
   v               v
continue    [Layer 2: auto_compact]
              存档完整对话到 .transcripts/
              调用 LLM 生成摘要
              用 [摘要] 替换全部 messages
                    |
                    v
            [Layer 3: compact tool]
              模型主动调用 compact 工具
              立即触发摘要（同 Layer 2）
```

---

## 代码拆解

### 1. 配置常量（第 56-58 行）

```python
THRESHOLD = 50000    # token 估算超过此值触发 auto_compact
TRANSCRIPT_DIR = WORKDIR / ".transcripts"  # 存档目录
KEEP_RECENT = 3      # micro_compact 保留最近 3 条工具结果
```

### 2. Token 估算（第 61-63 行）

```python
def estimate_tokens(messages: list) -> int:
    return len(str(messages)) // 4
```

粗略估算：约 4 个字符 ≈ 1 个 token。不精确，但足够用于阈值判断，且零成本（不需要调用 tokenizer）。

### 3. Layer 1: micro_compact — 静默替换旧工具结果（第 67-93 行）

```python
def micro_compact(messages: list) -> list:
    tool_results = []
    for msg_idx, msg in enumerate(messages):
        if msg["role"] == "user" and isinstance(msg.get("content"), list):
            for part_idx, part in enumerate(msg["content"]):
                if isinstance(part, dict) and part.get("type") == "tool_result":
                    tool_results.append((msg_idx, part_idx, part))
    if len(tool_results) <= KEEP_RECENT:
        return messages
```

**第一步：收集所有 tool_result。** 遍历 messages 中所有 user 消息，找出 `type: "tool_result"` 的条目，记录其位置和引用。

```python
    tool_name_map = {}
    for msg in messages:
        if msg["role"] == "assistant":
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if hasattr(block, "type") and block.type == "tool_use":
                        tool_name_map[block.id] = block.name
```

**第二步：建立 ID → 工具名映射。** 回溯 assistant 消息中的 `tool_use` block，用 `block.id` 对应到 `block.name`（如 `toolu_abc123 → bash`），这样替换时能保留"用过什么工具"的信息。

```python
    to_clear = tool_results[:-KEEP_RECENT]
    for _, _, result in to_clear:
        if isinstance(result.get("content"), str) and len(result["content"]) > 100:
            tool_id = result.get("tool_use_id", "")
            tool_name = tool_name_map.get(tool_id, "unknown")
            result["content"] = f"[Previous: used {tool_name}]"
```

**第三步：替换旧结果。** 保留最近 `KEEP_RECENT=3` 条，更早的如果超过 100 字符就替换为占位符。

关键设计细节：

| 细节 | 原因 |
| --- | --- |
| `len(...) > 100` 才替换 | 短结果（如 "Wrote 128 bytes"）留着，本身就不占多少空间 |
| 保留最近 3 条 | LLM 对最近几轮的结果可能还有引用需求 |
| 直接修改 `result["content"]`（原地修改） | 不创建新列表，因为 `result` 就是 messages 中的引用 |
| 保留 `[Previous: used bash]` | LLM 仍知道"之前用过什么"，只是细节丢了 |

**特性：** 每轮执行、零 LLM 调用、渐进式压缩。

### 4. Layer 2: auto_compact — 整体摘要重置（第 97-120 行）

当 `estimate_tokens(messages) > 50000` 时触发。

```python
def auto_compact(messages: list) -> list:
    TRANSCRIPT_DIR.mkdir(exist_ok=True)
    transcript_path = TRANSCRIPT_DIR / f"transcript_{int(time.time())}.jsonl"
    with open(transcript_path, "w") as f:
        for msg in messages:
            f.write(json.dumps(msg, default=str) + "\n")
```

**第一步：存档。** 把完整对话写入 `.transcripts/transcript_1740000000.jsonl`。用 JSONL 格式（每行一个 JSON），方便后续按行读取。`default=str` 处理 Anthropic SDK 对象的序列化。

```python
    conversation_text = json.dumps(messages, default=str)[:80000]
    response = client.messages.create(
        model=MODEL,
        messages=[{"role": "user", "content":
            "Summarize this conversation for continuity. Include: "
            "1) What was accomplished, 2) Current state, 3) Key decisions made. "
            "Be concise but preserve critical details.\n\n" + conversation_text}],
        max_tokens=2000,
    )
    summary = response.content[0].text
```

**第二步：摘要。** 把对话序列化后截断到 80000 字符，让 LLM 总结三件事：

1. 完成了什么
2. 当前状态
3. 做过的关键决策

`max_tokens=2000` 限制摘要长度，确保压缩后足够短。

```python
    return [
        {"role": "user", "content": f"[Conversation compressed. Transcript: {transcript_path}]\n\n{summary}"},
        {"role": "assistant", "content": "Understood. I have the context from the summary. Continuing."},
    ]
```

**第三步：替换。** 整个 messages 数组被替换为 2 条消息。摘要中附带了存档路径，理论上 LLM 后续可以通过 `read_file` 回溯完整对话。assistant 的确认消息让对话格式保持合法（user → assistant 交替）。

**特性：** 需要一次额外 LLM 调用、激进压缩、不可逆（但有存档兜底）。

### 5. Layer 3: compact 工具 — 模型主动触发（第 177 行 + 第 210-228 行）

```python
"compact": lambda **kw: "Manual compression requested.",
```

在 agent_loop 中特殊处理：

```python
manual_compact = False
for block in response.content:
    if block.type == "tool_use":
        if block.name == "compact":
            manual_compact = True
            output = "Compressing..."
        else:
            # ... 正常工具执行
results.append(...)
messages.append({"role": "user", "content": results})
if manual_compact:
    messages[:] = auto_compact(messages)
```

设计细节：

- **先追加 tool_result 再压缩** — `compact` 的 result 也要先加进 messages，保证 Anthropic API 的消息格式合法（每个 tool_use 必须有对应的 tool_result），然后再整体压缩
- **`messages[:] = ...`** — 切片赋值原地替换列表内容，而不是 `messages = ...`（后者只改局部变量，不影响外部传入的列表引用）
- compact 工具的 Schema 有可选的 `focus` 参数，让模型可以指定摘要的重点方向

### 6. Agent Loop 中的压缩管线（第 194-228 行）

```python
def agent_loop(messages: list):
    while True:
        micro_compact(messages)                        # Layer 1: 每轮静默瘦身
        if estimate_tokens(messages) > THRESHOLD:      # Layer 2: 超阈值自动摘要
            messages[:] = auto_compact(messages)
        response = client.messages.create(...)
        # ... 工具执行 ...
        if manual_compact:                             # Layer 3: 模型主动触发
            messages[:] = auto_compact(messages)
```

三层按顺序执行：Layer 1 每轮都跑，持续削减；Layer 2 在 Layer 1 不够时兜底；Layer 3 让模型自己判断何时需要。

---

## 三层压缩策略对比

| 层 | 触发条件 | 成本 | 压缩方式 | 信息损失 |
| --- | --- | --- | --- | --- |
| Layer 1: micro_compact | 每轮自动 | 零（字符串替换） | 旧 tool_result → 占位符 | 低（只丢旧工具输出细节） |
| Layer 2: auto_compact | `tokens > 50000` | 1 次 LLM 调用 | 全部 messages → 2 条摘要 | 高（只保留摘要 + 存档） |
| Layer 3: compact tool | LLM 主动调用 | 1 次 LLM 调用 | 同 Layer 2 | 高（同上） |

---

## 数据流

```
第 1 轮: bash("ls") → 返回文件列表 (2000 chars)
第 2 轮: read_file("main.py") → 返回文件内容 (5000 chars)
第 3 轮: edit_file("main.py", ...) → "Edited main.py"
第 4 轮: bash("python main.py") → 返回运行输出 (3000 chars)
         ↓
micro_compact 触发:
  第 1 轮的 bash 结果 → "[Previous: used bash]"     (2000 → 22 chars)
  最近 3 条(第 2/3/4 轮)保留原样
         ↓
第 5-20 轮: 持续工作... micro_compact 持续瘦身
         ↓
estimate_tokens() 返回 55000 > 50000
         ↓
auto_compact 触发:
  1. 存档到 .transcripts/transcript_1740000000.jsonl
  2. LLM 摘要: "完成了 main.py 的重构，添加了错误处理，所有测试通过..."
  3. messages 重置为 2 条
         ↓
第 21 轮: Agent 从摘要继续工作，上下文清爽
```

---

## `messages[:] = ...` vs `messages = ...`

这是 s06 中一个重要的 Python 细节：

```python
messages[:] = auto_compact(messages)  # 原地替换列表内容
messages = auto_compact(messages)     # 只改局部变量
```

`agent_loop` 接收的 `messages` 是外部传入的列表引用。`messages[:] = ...` 修改了列表本身的内容，外部（`__main__` 中的 `history`）也能看到变化。如果用 `messages = ...`，只是让局部变量指向新列表，外部的 `history` 不受影响，压缩就失效了。

---

## s05 → s06 的演进对比

| 维度 | s05 | s06 |
| --- | --- | --- |
| 核心问题 | System Prompt 太长 | messages 历史太长 |
| 解决方案 | 技能两层延迟加载 | 三层上下文压缩管线 |
| 优化目标 | 减少每轮固定开销 | 减少累积的历史开销 |
| 新增工具 | load_skill | compact |
| 持久化 | 无 | `.transcripts/` 存档 |
| LLM 额外调用 | 无 | auto_compact 需要 1 次 |
| 循环结构 | 标准 while | while + 每轮压缩管线 |

---

## 用 Node.js 重写时的对应关系

| Python（源码） | Node.js（练习） |
| --- | --- |
| `len(str(messages)) // 4` | `JSON.stringify(messages).length / 4` |
| `messages[:] = ...` | 无直接等价，需 `messages.splice(0, messages.length, ...newMsgs)` |
| `json.dumps(msg, default=str)` | `JSON.stringify(msg)` |
| `open(path, "w")` + 逐行写 | `fs.writeFileSync(path, msgs.map(m => JSON.stringify(m)).join('\n'))` |
| `int(time.time())` | `Date.now()` |
| `hasattr(block, "text")` | `'text' in block` 或 `block.type === 'text'` |
| `isinstance(content, list)` | `Array.isArray(content)` |

---

## 思考与总结

1. **上下文窗口是有限资源，压缩是必然选择** — 不管窗口多大（128K、200K），只要 Agent 持续工作，messages 终会溢出。压缩不是优化，是必需品
2. **分层压缩优于单一策略** — Layer 1 低成本高频执行延缓增长，Layer 2 在临界点时激进重置。两层配合比单一策略更平滑
3. **存档是压缩的安全网** — auto_compact 把完整对话存到磁盘再压缩，信息不是真正丢失，只是从"在线"（messages）移到了"离线"（文件）。类似数据库的冷热分离
4. **摘要的信息损失是不可避免的代价** — 用信息精度换取持续工作的能力。多次压缩后（摘要的摘要...），信息衰减会越来越严重，这是当前方案的固有局限
5. **`messages[:] = ...` 是 Python 的常见陷阱** — 在函数内修改传入的可变对象，必须用切片赋值而非直接赋值，否则只改了局部变量。Node.js 中用 `splice` 实现同样效果
6. **这就是 Cursor 的 Compact 功能** — Cursor IDE 中当对话过长时会自动压缩上下文，原理与此完全一致：存档 → 摘要 → 重置 messages
