# 《Extended thinking》学习笔记：Extended Thinking 复杂推理

> 源 Notebook：`extended_thinking/extended_thinking.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Extended Thinking 复杂推理** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Use Claude's extended thinking for transparent step-by-step reasoning with budget management.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### Extended Thinking

Extended thinking 让模型在复杂任务中分配显式思考预算，适合推理、规划和多步骤问题。

### Thinking Budget

思考预算决定模型能在内部推理上花多少 token，需要在质量、成本和延迟之间权衡。

### Tool Use

与工具结合时，模型可以先推理再调用工具，并根据工具结果继续推进。

### 复杂任务分解

这类 notebook 的重点是如何把复杂问题拆成可执行、可检查的步骤。

### Notebook 阅读线索

- Table of contents
- Setup
- Basic example
- Streaming with extended thinking
- Token counting and context window management
- Understanding redacted thinking blocks
- Handling error cases

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
import os

# Set your API key as an environment variable or directly
# os.environ["ANTHROPIC_API_KEY"] = "your-api-key-here"

# Initialize the client
client = anthropic.Anthropic()

# Helper functions
def print_thinking_response(response):
    """Pretty print a message response with thinking blocks."""
    print("\n==== FULL RESPONSE ====")
    for block in response.content:
        if block.type == "thinking":
            print("\n🧠 THINKING BLOCK:")
            # Show truncated thinking for readability
            print(block.thinking[:500] + "..." if len(block.thinking) > 500 else block.thinking)
            print(f"\n[Signature available: {bool(getattr(block, 'signature', None))}]")
            if hasattr(block, 'signature') and block.signature:
                print(f"[Signature (first 50 chars): {block.signature[:50]}...]")
        elif block.type == "redacted_thinking":
            print("\n🔒 REDACTED THINKING BLOCK:")
            print(f"[Data length: {len(block.data) if hasattr(block, 'data') else 'N/A'}]")
        elif block.type == "text":
            print("\n✓ FINAL ANSWER:")
            print(block.text)
    
    print("\n==== END RESPONSE ====")

def count_tokens(messages):
    """Count tokens for a given message list."""
    result = client.messages.count_tokens(
        model="claude-sonnet-4-6",
        messages=messages
    )
    return result.input_tokens
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `print_thinking_response、count_tokens`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：basic_thinking_example

```python
def basic_thinking_example():
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        thinking= {
            "type": "enabled",
            "budget_tokens": 2000
        },
        messages=[{
            "role": "user",
            "content": "Solve this puzzle: Three people check into a hotel. They pay $30 to the manager. The manager finds out that the room only costs $25 so he gives $5 to the bellboy to return to the three people. The bellboy, however, decides to keep $2 and gives $1 back to each person. Now, each person paid $10 and got back $1, so they paid $9 each, totaling $27. The bellboy kept $2, which makes $29. Where is the missing $1?"
        }]
    )
    
    print_thinking_response(response)

basic_thinking_example()
```

这段代码对应源 notebook 的第 6 个代码单元，重点关注 `basic_thinking_example`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
==== FULL RESPONSE ====

🧠 THINKING BLOCK:
Let's work through this problem step by step:

Initial situation:
- Three people each pay $10, for a total of $30 given to the manager.
- The room actually costs $25.
- Manager gives $5 to the bellboy to return to the customers.
- Bellboy keeps $2 and gives $1 back to each person ($3 total).

After these transactions:
- Each person has effectively paid $9 (they paid $10 and got $1 back).
- So the three people together paid $27.
- The hotel kept $25 for the room.
- The bellboy kept $2.

So the mo...

[Signature available: True]
[Signature (first 50 chars): EuYBCkQYAiJAGF6X7aWRuRByTdymAUdNOMC++3ZqSJv7jcY5Ly...]

✓ FINAL ANSWER:
# Hotel Bill Puzzle Solution

This is a classic misdirection puzzle that confuses us by mixing up two different accounting approaches.

## The actual flow of money

1. Three people each pay $10, totaling $30
...
```
### 5.3 核心函数 / 类定义：token_counting_example、create_sample_messages

```python
def token_counting_example():
    # Define a function to create a sample prompt
    def create_sample_messages():
        messages = [{
            "role": "user",
            "content": "Solve this puzzle: Three people check into a hotel. They pay $30 to the manager. The manager finds out that the room only costs $25 so he gives $5 to the bellboy to return to the three people. The bellboy, however, decides to keep $2 and gives $1 back to each person. Now, each person paid $10 and got back $1, so they paid $9 each, totaling $27. The bellboy kept $2, which makes $29. Where is the missing $1?"
        }]
        return messages
    
    # Count tokens without thinking
    base_messages = create_sample_messages()
    base_token_count = count_tokens(base_messages)
    print(f"Base token count (input only): {base_token_count}")
    
    # Make a request with thinking and check actual usage
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8000,
        thinking = {
            "type": "enabled",
            "budget_tokens": 2000
        },
        messages=base_messages
    )
    
    # Calculate and print token usage stats
    thinking_tokens = sum(
        len(block.thinking.split()) * 1.3  # Rough estimate
        for block in response.content 
        if block.type == "thinking"
    )
    
    final_answer_tokens = sum(
        len(block.text.split()) * 1.3  # Rough estimate
        for block in response.content 
        if block.type == "text"
    )
    
    print(f"\nEstimated thinking tokens used: ~{int(thinking_tokens)}")
    print(f"Estimated final answer tokens: ~{int(final_answer_tokens)}")
    print(f"Total estimated output tokens: ~{int(thinking_tokens + final_answer_tokens)}")
    print(f"Input tokens + max_tokens = {base_token_count + 8000}")
    print(f"Available for final answer after thinking: ~{8000 - int(thinking_tokens)}")
    
    # Demo with escalating thinking budgets
    thinking_budgets = [1024, 2000, 4000, 8000, 16000, 32000]
    context_window = 200000
    for budget in thinking_budgets:
        print(f"\nWith thinking budget of {budget} tokens:")
        print(f"Input tokens: {base_token_count}")
        print(f"Max tokens needed: {base_token_count + budget + 1000}")  # Add 1000 for final answer
        print(f"Remaining context window: {context_window - (base_token_count + budget + 1000)}")
        
        if base_token_count + budget + 1000 > context_window:
            print("WARNING: This would exceed the context window of 200k tokens!")

# Uncomment to run the example
token_counting_example()
```

这段代码对应源 notebook 的第 10 个代码单元，重点关注 `token_counting_example、create_sample_messages`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Base token count (input only): 125

Estimated thinking tokens used: ~377
Estimated final answer tokens: ~237
Total estimated output tokens: ~614
Input tokens + max_tokens = 8125
Available for final answer after thinking: ~7623

With thinking budget of 1024 tokens:
Input tokens: 125
Max tokens needed: 2149
Remaining context window: 197851

With thinking budget of 2000 tokens:
Input tokens: 125
Max tokens needed: 3125
Remaining context window: 196875

With thinking budget of 4000 tokens:
Input tokens: 125
Max tokens needed: 5125
Remaining context window: 194875

With thinking budget of 8000 tokens:
Input tokens: 125
Max tokens needed: 9125
Remaining context window: 190875

With thinking budget of 16000 tokens:
Input tokens: 125
Max tokens needed: 17125
Remaining context window: 182875

With thinking budget of 32000 tokens:
Input tokens: 125
Max tokens needed: 33125
...
```
### 5.4 核心函数 / 类定义：demonstrate_common_errors

```python
def demonstrate_common_errors():
    # 1. Error from setting thinking budget too small
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4000,
            thinking={
                "type": "enabled",
                "budget_tokens": 500  # Too small, minimum is 1024
            },
            messages=[{
                "role": "user",
                "content": "Explain quantum computing."
            }]
        )
    except Exception as e:
        print(f"\nError with too small thinking budget: {e}")
    
    # 2. Error from using temperature with thinking
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4000,
            temperature=0.7,  # Not compatible with thinking
            thinking={
                "type": "enabled",
                "budget_tokens": 2000
            },
            messages=[{
                "role": "user",
                "content": "Write a creative story."
            }]
        )
    except Exception as e:
        print(f"\nError with temperature and thinking: {e}")
    
    # 3. Error from exceeding context window
    try:
        # Create a very large prompt
        long_content = "Please analyze this text. " + "This is sample text. " * 150000
        
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=20000,  # This plus the long prompt will exceed context window
            thinking={
                "type": "enabled",
                "budget_tokens": 10000
            },
            messages=[{
                "role": "user",
                "content": long_content
            }]
        )
    except Exception as e:
        print(f"\nError from exceeding context window: {e}")

# Run the common error examples
demonstrate_common_errors()
```

这段代码对应源 notebook 的第 14 个代码单元，重点关注 `demonstrate_common_errors`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Error with too small thinking budget: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'thinking.enabled.budget_tokens: Input should be greater than or equal to 1024'}}

Error with temperature and thinking: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': '`temperature` may only be set to 1 when thinking is enabled. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking'}}

Error from exceeding context window: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'prompt is too long: 214315 tokens > 204798 maximum'}}
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

- 只在复杂推理任务中启用 extended thinking，不要为简单问答增加额外成本。
- 根据任务难度设置 thinking budget，并记录质量和延迟变化。
- 如果结合工具调用，要明确哪些步骤由模型推理，哪些步骤由工具验证。
- 为高风险推理任务加入评估集或人工复核。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- 成本和延迟增加
- 思考预算设置不当
- 工具结果未验证
- 复杂推理仍可能出错

生产环境中还应补充：错误处理、重试、日志、权限控制、成本监控、数据脱敏、回归测试和人工抽检。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例的输入、核心处理过程和输出分别是什么？
- Claude 在流程中承担什么职责？第三方服务或本地代码承担什么职责？
- 哪些代码片段是迁移时必须保留的骨架？
- 如果换成你的业务数据，需要替换哪些 prompt、路径、API key 或配置？
- 这个示例要进入生产环境，还缺哪些评估、监控、安全和异常处理？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Extended Thinking 复杂推理** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
