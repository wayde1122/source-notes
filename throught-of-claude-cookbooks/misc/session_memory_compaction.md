# 《Session memory compaction》学习笔记：Claude API 工程技巧

> 源 Notebook：`misc/session_memory_compaction.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Claude API 工程技巧** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Manage long-running Claude conversations with instant session memory compaction using background threading and prompt caching.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### Messages API

多数 misc 示例都围绕 Claude API 的某个工程能力展开，例如批处理、缓存、JSON 输出、引用、评估或长输出控制。

### Prompt / Request 结构

这些 notebook 往往通过请求参数、system prompt、messages 或特殊字段来控制 Claude 行为。

### 成本与延迟

prompt caching、batch processing、speculative caching 等主题都直接服务于成本和延迟优化。

### 评估与可靠性

building_evals、generate_test_cases、moderation 等示例强调如何判断输出是否可靠。

### 结构化输出

JSON、citations、schema 或固定格式输出让模型结果更容易进入后续系统。

### Notebook 阅读线索

- Learning Objectives
- Prerequisites and Setup
- Installation
- Code example using traditional compacting
- Instant Compaction
- Example use of Instant Compaction
- Advanced: Understanding Prompt Caching
- Why this matters for compaction

## 4. 整体流程图

```text
示例输入 / 业务数据
  ↓
准备依赖、API key、文件或外部服务连接
  ↓
构造 prompt、请求参数、工具、索引或评估标准
  ↓
调用 Claude / 第三方服务 / 本地处理代码
  ↓
解析返回结果、指标、引用、文件或结构化输出
  ↓
展示结果，并总结迁移方式与生产化注意事项
```

阅读这类 notebook 时，最重要的是分清：Claude 负责语言理解、生成和推理；代码和第三方服务负责确定性处理、存储、检索、语音、图像、成本统计或评估执行。

## 5. 核心代码精读

### 5.1 环境、依赖与数据准备

```python
import anthropic
from anthropic.types import MessageParam, TextBlockParam
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic()
MODEL = "claude-sonnet-4-6"
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：truncate_response、remove_thinking_blocks、add_cache_control

```python
# Helper functions
def truncate_response(text: str, max_lines: int = 15) -> str:
    """Truncate long responses for cleaner output display."""
    lines = text.strip().split("\n")
    if len(lines) <= max_lines:
        return text
    return "\n".join(lines[:max_lines]) + f"\n... ({len(lines) - max_lines} more lines)"


def remove_thinking_blocks(text: str) -> tuple[str, str]:
    """Remove <think>...</think> blocks from the text."""
    import re

    matches = re.findall(r"<think>.*?</think>", text, flags=re.DOTALL)
    cleaned = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL).strip()
    return cleaned, "".join(matches)


def add_cache_control(messages: list[dict]) -> list[MessageParam]:
    """Add cache_control to the last user message for prompt caching.

    For prompt caching to work, the message prefix structure must be identical between requests.
    All messages are converted to list format for consistency, and cache_control is placed on
    the last user message to match the standard API call pattern.
    """
    cached_messages: list[MessageParam] = []
    last_user_idx = None

    # Find last user message index
    for i, msg in enumerate(messages):
        if msg["role"] == "user":
            last_user_idx = i

    for i, msg in enumerate(messages):
        content = msg["content"]
        text = content if isinstance(content, str) else content[0]["text"]

        content_block: TextBlockParam = {"type": "text", "text": text}
        if i == last_user_idx:
            content_block["cache_control"] = {"type": "ephemeral"}

        cached_messages.append({"role": msg["role"], "content": [content_block]})

    return cached_messages


def estimate_tokens(text: str) -> int:
    """Rudimentary token estimation: 1 token per 4 characters."""
    return len(text) // 4
```

这段代码对应源 notebook 的第 5 个代码单元，重点关注 `truncate_response、remove_thinking_blocks、add_cache_control、estimate_tokens`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
/root/.pyenv/versions/3.13.11/lib/python3.13/site-packages/coconut/compiler/util.py:676: FutureWarning: functools.partial will be a method descriptor in future Python versions; wrap it in staticmethod() if you want to preserve the old behavior
  return Regex(regex, options)
/root/.pyenv/versions/3.13.11/lib/python3.13/site-packages/coconut/compiler/util.py:457: FutureWarning: functools.partial will be a method descriptor in future Python versions; wrap it in staticmethod() if you want to preserve the old behavior
  result = add_action(grammar, unpack).parseWithTabs().transformString(text)
```
### 5.3 核心函数 / 类定义：TraditionalCompactingChatSession、__init__、chat

```python
import time


class TraditionalCompactingChatSession:
    """Traditional chat session with compaction after the fact."""

    def __init__(self, system_message="You are a helpful assistant", context_limit: int = 10000):
        self.system_message = system_message
        self.context_limit = context_limit  # the point at which the conversation is compacted so it does not exceed model limits.
        self.messages = []
        self.current_context_window_tokens = 0
        self.summary = None

    def chat(self, user_message: str) -> tuple[str, anthropic.types.Usage]:
        # In traditional compaction, we check if we need to compact when the user sends a message. NOT IDEAL!
        if self.current_context_window_tokens >= self.context_limit:
            print(
                f"\n🧹 Context window at {self.current_context_window_tokens} tokens. Limit exceeded, compacting session memory..."
            )
            self.compact()  # compacts everything before the new user message

        self.messages.append({"role": "user", "content": user_message})
        print(f"\nUser: {user_message}")

        response = client.messages.create(
            model=MODEL,
            max_tokens=3500,
            system=self.system_message,
            messages=add_cache_control(self.messages),
        )
        assistant_message = response.content[0].text
        self.messages.append({"role": "assistant", "content": assistant_message})

        print(f"\nAssistant: \n{truncate_response(assistant_message, max_lines=15)}")

        # approximate current token count in the conversation before the next user message
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        total_input = response.usage.input_tokens + cache_read
        self.current_context_window_tokens = total_input + response.usage.output_tokens

        print(
            f"Input={total_input:,}, Prompt cached used= {cache_read > 0} | "
            f"Output={response.usage.output_tokens:,} | "
            f"Messages={len(self.messages)}"
        )
        return assistant_message, response.usage

    def compact(self) -> None:
        start_time = time.perf_counter()

        response = client.messages.create(
            model=MODEL,
            max_tokens=5000,
            system=self.system_message,  # Same as main chat for cache sharing
            messages=add_cache_control(self.messages)
            + [{"role": "user", "content": SESSION_MEMORY_PROMPT}],
        )
        elapsed = time.perf_counter() - start_time

        # Generate new summary message
        self.summary, removed_text = remove_thinking_blocks(
            response.content[0].text
        )  # clean up any <think> blocks because they are not needed in the session memory
        approximate_summary_tokens = response.usage.output_tokens - round(
            len(removed_text) / 4
        )  # rough estimate of tokens removed from summary

        # Replace prior messages with new summary message
        self.messages = [
            {
                "role": "user",
                "content": f"""This session is being continued from a previous conversation. Here is the session memory: {self.summary}.Continue from where we left off.""",
            }
        ]

        # Show token reduction if we just compacted
        reduction = self.current_context_window_tokens - approximate_summary_tokens
        pct = (reduction / self.current_context_window_tokens) * 100

        print(f"\n{'-' * 60}")
        print("📝 New session memory created.")
        print(
            f"✅ Tokens reduced: {self.current_context_window_tokens:,} → {approximate_summary_tokens:.0f} ({reduction:,} tokens saved, {pct:.0f}% reduction)"
        )
        print(f"⏱️ Compaction time: {elapsed:.2f}s (user waiting...)")
        print(f" Cache used: {getattr(response.usage, 'cache_read_input_tokens', 0) > 0}")
        print(f"{'-' * 60}")

        # Update token count to reflect compacted state
        self.current_context_window_tokens = approximate_summary_tokens
```

这段代码对应源 notebook 的第 9 个代码单元，重点关注 `TraditionalCompactingChatSession、__init__、chat、compact`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
/root/.pyenv/versions/3.13.11/lib/python3.13/site-packages/coconut/compiler/util.py:403: FutureWarning: functools.partial will be a method descriptor in future Python versions; wrap it in staticmethod() if you want to preserve the old behavior
  grammar.streamline()
/root/.pyenv/versions/3.13.11/lib/python3.13/site-packages/coconut/compiler/util.py:457: FutureWarning: functools.partial will be a method descriptor in future Python versions; wrap it in staticmethod() if you want to preserve the old behavior
  result = add_action(grammar, unpack).parseWithTabs().transformString(text)
```
### 5.4 核心函数 / 类定义：InstantCompactingChatSession、__init__、chat

```python
import threading
import time


class InstantCompactingChatSession:
    """
    Maintains session memory via incremental background updates.

    Key insight: By updating memory in the background after each turn,
    the summary is already ready when compaction is needed - instant swap!
    """

    def __init__(
        self,
        system_message="You are a helpful assistant",
        context_limit: int = 12000,
        min_tokens_to_init: int = 7500,
        min_tokens_between_updates: int = 2000,
    ):
        # Thresholds
        self.context_limit = context_limit  # the point at which the conversation is compacted so it does not exceed model limits
        self.min_tokens_to_init = min_tokens_to_init  # tokens needed to trigger initial memory creation; note this happens PROACTIVELY in background unlike traditional compaction
        self.min_tokens_between_updates = min_tokens_between_updates  # tokens needed to trigger memory update. only comes into play after initial memory is created and additional compaction (memory update) is needed after that

        # Conversation state
        self.system_message = system_message
        self.messages = []
        self.current_context_window_tokens = 0

        # Session memory state
        self.session_memory = None  # this is the compacted conversation in session memory; for the demo we are storing this in memory, but in production you would write to session_memory.md file
        self.last_summarized_index = (
            0  # The index of the last message included in the session memory
        )
        self.tokens_at_last_update = 0  # To track tokens at last memory update and see if enough new tokens have been added to trigger another update

        # Background update tracking
        self._update_thread: threading.Thread | None = None
        self.last_update_time = None
        self._lock = threading.Lock()

    def chat(self, user_message: str) -> tuple[str, anthropic.types.Usage, str | None]:
        """Process a chat turn with background session memory updates."""

        if self.current_context_window_tokens + estimate_tokens(user_message) >= self.context_limit:
            self.compact()  # note that when this is triggered, the compaction has already been created and is just swapped in instantly

        self.messages.append({"role": "user", "content": user_message})

        response = client.messages.create(
            model=MODEL,
            max_tokens=3500,
            system=self.system_message,
            messages=add_cache_control(self.messages),
        )

        assistant_message = response.content[0].text
        self.messages.append({"role": "assistant", "content": assistant_message})

        # Calculate token usage including cache
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        total_input = response.usage.input_tokens + cache_read

        # Update context window tokens (includes cached tokens since they still count toward context)
        self.current_context_window_tokens = total_input + response.usage.output_tokens

        # KEY DIFFERENCE: Trigger background memory update if needed proactively, before compaction is needed
        background_status = None
        if self._should_init_memory() or self._should_update_memory():
            self._trigger_background_update()
            background_status = "initializing" if self.session_memory is None else "updating"

        # Return usage info with cache stats
        return assistant_message, response.usage, background_status

    # Helper methods to determine when to init session memory
    def _should_init_memory(self) -> bool:
        return (
            self.session_memory is None
            and self.current_context_window_tokens >= self.min_tokens_to_init
        )

    # Helper method to determine if memory should be updated
    def _should_update_memory(self) -> bool:
        if self.session_memory is None:
            return False
        tokens_since = self.current_context_window_tokens - self.tokens_at_last_update
        return tokens_since >= self.min_tokens_between_updates

    # Methods to create initial session memory
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应源 notebook 的第 21 个代码单元，重点关注 `InstantCompactingChatSession、__init__、chat、_should_init_memory`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
/root/.pyenv/versions/3.13.11/lib/python3.13/site-packages/coconut/compiler/util.py:403: FutureWarning: functools.partial will be a method descriptor in future Python versions; wrap it in staticmethod() if you want to preserve the old behavior
  grammar.streamline()
/root/.pyenv/versions/3.13.11/lib/python3.13/site-packages/coconut/compiler/util.py:457: FutureWarning: functools.partial will be a method descriptor in future Python versions; wrap it in staticmethod() if you want to preserve the old behavior
  result = add_action(grammar, unpack).parseWithTabs().transformString(text)
```

## 6. 示例运行过程拆解

这个 notebook 的运行过程通常可以拆成五步：

1. **准备输入**：例如文本、PDF、网页、图片、CSV、音频、向量库数据或评估样本。
2. **配置依赖**：包括 Claude SDK、第三方 SDK、API key、模型名称、缓存参数或索引配置。
3. **执行核心调用**：调用 Claude、批处理接口、视觉能力、检索框架、语音服务或评估逻辑。
4. **解析结果**：把返回文本、JSON、引用、指标、文件或工具结果转换成可读输出。
5. **复盘效果**：检查输出是否满足目标，并识别成本、延迟、准确性或可靠性上的限制。

## 7. 关键设计思路

### 7.1 明确 Claude 与外部逻辑的边界

Claude 适合理解上下文、生成解释、做推理和整合信息；确定性的检索、批处理、音频转写、图像编码、成本统计和规则校验应交给代码或外部系统。

### 7.2 用结构化流程降低不确定性

无论是 JSON、citations、eval rubric、batch request、RAG pipeline 还是视觉 prompt，本质都是把模型输出约束成系统可以继续处理的形式。

### 7.3 把示例改造成可验证流程

学习时不要只看输出是否漂亮，还要看是否能验证：有没有指标、测试集、引用、日志、成本统计或人工复核点。

## 8. 如何迁移到自己的项目

迁移时建议：

- 把示例 prompt 和输入替换为你的业务数据，例如文档、网页、测试用例或用户请求。
- 保留关键 API 参数和响应解析逻辑，替换模型、缓存断点、批处理规模或评估指标。
- 为生产环境加入日志、成本统计、失败重试和回归测试。
- 如果示例涉及 JSON、引用或评估，优先把输出结构和验收标准固定下来。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- API 参数变化
- 成本估算不足
- 缓存命中率低
- 输出格式漂移
- 缺少真实评估集

生产环境中还应补充：错误处理、重试、日志、权限控制、成本监控、数据脱敏、回归测试和人工抽检。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例的输入、核心处理过程和输出分别是什么？
- Claude 在流程中承担什么职责？第三方服务或本地代码承担什么职责？
- 哪些代码片段是迁移时必须保留的骨架？
- 如果换成你的业务数据，需要替换哪些 prompt、路径、API key 或配置？
- 这个示例要进入生产环境，还缺哪些评估、监控、安全和异常处理？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Claude API 工程技巧** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
