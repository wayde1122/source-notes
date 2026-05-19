# 《Prompt caching through the Claude API》学习笔记：Prompt Caching 与成本优化

> 源 Notebook：`misc/prompt_caching.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Prompt Caching 与成本优化** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Cache and reuse prompt context for cost savings and faster responses with detailed instructions.

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

- Setup
- Example 1: Automatic caching (single turn)
- Baseline: no caching
- First call with automatic caching (cache write)
- Second call with automatic caching (cache hit)
- Example 2: Automatic caching in a multi-turn conversation
- Example 3: Explicit cache breakpoints
- Choosing an approach

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
import time

import anthropic
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
client = anthropic.Anthropic()
MODEL_NAME = "claude-sonnet-4-6"

# Unique prefix to ensure we don't hit a stale cache from a previous run
TIMESTAMP = int(time.time())
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 主执行流程与 API 调用

```python
start = time.time()
write_response = client.messages.create(
    model=MODEL_NAME,
    max_tokens=300,
    cache_control={"type": "ephemeral"},  # <-- one-line change
    messages=[
        {
            "role": "user",
            "content": str(TIMESTAMP)
            + "<book>"
            + book_content
            + "</book>"
            + "\n\nWhat is the title of this book? Only output the title.",
        }
    ],
)
write_time = time.time() - start

print(f"Response: {write_response.content[0].text}")
print_usage(write_response, write_time)
```

这段代码对应源 notebook 的第 13 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Response: Pride and Prejudice
  Time:                4.28s
  Input tokens:        3
  Output tokens:       8
  Cache write tokens:  187361
```
### 5.3 主执行流程与 API 调用

```python
start = time.time()
hit_response = client.messages.create(
    model=MODEL_NAME,
    max_tokens=300,
    cache_control={"type": "ephemeral"},
    messages=[
        {
            "role": "user",
            "content": str(TIMESTAMP)
            + "<book>"
            + book_content
            + "</book>"
            + "\n\nWhat is the title of this book? Only output the title.",
        }
    ],
)
hit_time = time.time() - start

print(f"Response: {hit_response.content[0].text}")
print_usage(hit_response, hit_time)

print("\n" + "=" * 50)
print("COMPARISON")
print("=" * 50)
print(f"No caching:     {baseline_time:.2f}s")
print(f"Cache write:    {write_time:.2f}s")
print(f"Cache hit:      {hit_time:.2f}s")
print(f"Speedup:        {baseline_time / hit_time:.1f}x")
```

这段代码对应源 notebook 的第 15 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Response: Pride and Prejudice
  Time:                1.48s
  Input tokens:        3
  Output tokens:       8
  Cache read tokens:   187361

==================================================
COMPARISON
==================================================
No caching:     4.89s
Cache write:    4.28s
Cache hit:      1.48s
Speedup:        3.3x
```
### 5.4 核心函数 / 类定义：ConversationWithExplicitCaching、__init__、add_user

```python
class ConversationWithExplicitCaching:
    """Multi-turn conversation that manually places cache_control on the last user message."""

    def __init__(self):
        self.turns = []

    def add_user(self, content):
        self.turns.append({"role": "user", "content": [{"type": "text", "text": content}]})

    def add_assistant(self, content):
        self.turns.append({"role": "assistant", "content": [{"type": "text", "text": content}]})

    def get_messages(self):
        """Return messages with cache_control on the last user message."""
        result = []
        last_user_idx = max(i for i, t in enumerate(self.turns) if t["role"] == "user")

        for i, turn in enumerate(self.turns):
            if i == last_user_idx:
                result.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": turn["content"][0]["text"],
                                "cache_control": {"type": "ephemeral"},
                            }
                        ],
                    }
                )
            else:
                result.append(turn)

        return result


conv = ConversationWithExplicitCaching()

for i, question in enumerate(questions, 1):
    print(f"\n{'=' * 50}")
    print(f"Turn {i}: {question}")
    print("=" * 50)

    conv.add_user(question)

    start = time.time()
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=300,
        system=[
            {
                "type": "text",
                "text": system_message,
                "cache_control": {"type": "ephemeral"},  # explicit breakpoint on system
            },
        ],
        messages=conv.get_messages(),
    )
    elapsed = time.time() - start

    assistant_reply = response.content[0].text
    conv.add_assistant(assistant_reply)

    print(f"\nAssistant: {assistant_reply[:200]}{'...' if len(assistant_reply) > 200 else ''}")
    print()
    print_usage(response, elapsed)
```

这段代码对应源 notebook 的第 20 个代码单元，重点关注 `ConversationWithExplicitCaching、__init__、add_user、add_assistant`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
==================================================
Turn 1: What is the title of this novel?
==================================================

Assistant: The title of this novel is **Pride and Prejudice**, written by **Jane Austen**.

  Time:                4.53s
  Input tokens:        3
  Output tokens:       24
  Cache read tokens:   187361

==================================================
Turn 2: Who are Mr. and Mrs. Bennet?
==================================================

Assistant: Mr. and Mrs. Bennet are a married couple who are central characters in the novel. They live at **Longbourn** and are the parents of **five daughters**: Jane, Elizabeth (Lizzy), Mary, Catherine (Kitty)...

  Time:                7.57s
  Input tokens:        3
  Output tokens:       283
  Cache read tokens:   187399

==================================================
Turn 3: What is Netherfield Park?
...
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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Prompt Caching 与成本优化** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
