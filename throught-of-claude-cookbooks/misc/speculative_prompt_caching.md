# 《Speculative prompt caching》学习笔记：Prompt Caching 与成本优化

> 源 Notebook：`misc/speculative_prompt_caching.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Prompt Caching 与成本优化** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Reduce time-to-first-token by warming cache speculatively while users formulate their queries.

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
- Helper Functions
- Example 1: Standard Prompt Caching (Without Speculative Caching)
- Example 2: Speculative Prompt Caching
- Performance Comparison
- Key Takeaways
- Best Practices

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
import asyncio
import copy
import datetime
import time

import httpx
from anthropic import AsyncAnthropic

# Configuration constants
MODEL = "claude-sonnet-4-6"
SQLITE_SOURCES = {
    "btree.h": "https://sqlite.org/src/raw/18e5e7b2124c23426a283523e5f31a4bff029131b795bb82391f9d2f3136fc50?at=btree.h",
    "btree.c": "https://sqlite.org/src/raw/63ca6b647342e8cef643863cd0962a542f133e1069460725ba4461dcda92b03c?at=btree.c",
}
DEFAULT_CLIENT_ARGS = {
    "system": "You are an expert systems programmer helping analyze database internals.",
    "max_tokens": 4096,
    "temperature": 0,
}
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：get_sqlite_sources、download_file、create_initial_message

```python
async def get_sqlite_sources() -> dict[str, str]:
    print("Downloading SQLite source files...")

    source_files = {}
    start_time = time.time()

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = []

        async def download_file(filename: str, url: str) -> tuple[str, str]:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            print(f"Successfully downloaded {filename}")
            return filename, response.text

        for filename, url in SQLITE_SOURCES.items():
            tasks.append(download_file(filename, url))

        results = await asyncio.gather(*tasks)
        source_files = dict(results)

    duration = time.time() - start_time
    print(f"Downloaded {len(source_files)} files in {duration:.2f} seconds")
    return source_files


async def create_initial_message():
    sources = await get_sqlite_sources()
    # Prepare the initial message with the source code as context.
    # A Timestamp is included to prevent cache sharing across different runs.
    initial_message = {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": f"""
Current time: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

Source to Analyze:

btree.h:
```c
{sources["btree.h"]}
```

btree.c:
```c
{sources["btree.c"]}
```""",
                "cache_control": {"type": "ephemeral"},
            }
        ],
    }
    return initial_message


async def sample_one_token(client: AsyncAnthropic, messages: list):
    """Send a single-token request to warm up the cache"""
    args = copy.deepcopy(DEFAULT_CLIENT_ARGS)
    args["max_tokens"] = 1
    await client.messages.create(
        messages=messages,
        model=MODEL,
        **args,
    )


def print_query_statistics(response, query_type: str) -> None:
    print(f"\n{query_type} query statistics:")
    print(f"\tInput tokens: {response.usage.input_tokens}")
    print(f"\tOutput tokens: {response.usage.output_tokens}")
    print(f"\tCache read input tokens: {getattr(response.usage, 'cache_read_input_tokens', '---')}")
    print(
        f"\tCache creation input tokens: {getattr(response.usage, 'cache_creation_input_tokens', '---')}"
    )
```

这段代码对应源 notebook 的第 6 个代码单元，重点关注 `get_sqlite_sources、download_file、create_initial_message、sample_one_token`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：standard_prompt_caching_demo

```python
async def standard_prompt_caching_demo():
    client = AsyncAnthropic()

    # Prepare the large context
    initial_message = await create_initial_message()

    # Simulate user typing time (in real app, this would be actual user input)
    print("User is typing their question...")
    await asyncio.sleep(3)  # Simulate 3 seconds of typing
    user_question = "What is the purpose of the BtShared structure?"
    print(f"User submitted: {user_question}")

    # Now send the full request (context + question)
    full_message = copy.deepcopy(initial_message)
    full_message["content"].append(
        {"type": "text", "text": f"Answer the user's question: {user_question}"}
    )

    print("\nSending request to API...")
    start_time = time.time()

    # Measure time to first token
    first_token_time = None
    async with client.messages.stream(
        messages=[full_message],
        model=MODEL,
        **DEFAULT_CLIENT_ARGS,
    ) as stream:
        async for text in stream.text_stream:
            if first_token_time is None and text.strip():
                first_token_time = time.time() - start_time
                print(f"\n🕐 Time to first token: {first_token_time:.2f} seconds")
                break

        # Get the full response
        response = await stream.get_final_message()

    total_time = time.time() - start_time
    print(f"Total response time: {total_time:.2f} seconds")
    print_query_statistics(response, "Standard Caching")

    return first_token_time, total_time
```

这段代码对应源 notebook 的第 8 个代码单元，重点关注 `standard_prompt_caching_demo`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.4 核心函数 / 类定义：speculative_prompt_caching_demo

```python
async def speculative_prompt_caching_demo():
    client = AsyncAnthropic()

    # The user has a large amount of context they want to interact with,
    # in this case it's the sqlite b-tree implementation (~150k tokens).
    initial_message = await create_initial_message()

    # Start speculative caching while user is typing
    print("User is typing their question...")
    print("🔥 Starting cache warming in background...")

    # While the user is typing out their question, we sample a single token
    # from the context the user is going to be interacting with with explicit
    # prompt caching turned on to warm up the cache.
    cache_task = asyncio.create_task(sample_one_token(client, [initial_message]))

    # Simulate user typing time
    await asyncio.sleep(3)  # Simulate 3 seconds of typing
    user_question = "What is the purpose of the BtShared structure?"
    print(f"User submitted: {user_question}")

    # Ensure cache warming is complete
    await cache_task
    print("✅ Cache warming completed!")

    # Prepare messages for cached query. We make sure we
    # reuse the same initial message as was cached to ensure we have a cache hit.
    cached_message = copy.deepcopy(initial_message)
    cached_message["content"].append(
        {"type": "text", "text": f"Answer the user's question: {user_question}"}
    )

    print("\nSending request to API (with warm cache)...")
    start_time = time.time()

    # Measure time to first token
    first_token_time = None
    async with client.messages.stream(
        messages=[cached_message],
        model=MODEL,
        **DEFAULT_CLIENT_ARGS,
    ) as stream:
        async for text in stream.text_stream:
            if first_token_time is None and text.strip():
                first_token_time = time.time() - start_time
                print(f"\n🚀 Time to first token: {first_token_time:.2f} seconds")
                break

        # Get the full response
        response = await stream.get_final_message()

    total_time = time.time() - start_time
    print(f"Total response time: {total_time:.2f} seconds")
    print_query_statistics(response, "Speculative Caching")

    return first_token_time, total_time
```

这段代码对应源 notebook 的第 11 个代码单元，重点关注 `speculative_prompt_caching_demo`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

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
