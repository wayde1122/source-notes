# 《Extended thinking with tool use》学习笔记：Extended Thinking 复杂推理

> 源 Notebook：`extended_thinking/extended_thinking_with_tool_use.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Extended Thinking 复杂推理** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Combine extended thinking with tools for transparent reasoning during multi-step workflows.

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
- Single tool calls with thinking
- Multiple tool calls with thinking
- Preserving thinking blocks
- Conclusion

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
import json

# Global variables for model and token budgets
MODEL_NAME = "claude-sonnet-4-6"
MAX_TOKENS = 4000
THINKING_BUDGET_TOKENS = 2000

# Set your API key as an environment variable or directly
# os.environ["ANTHROPIC_API_KEY"] = "your_api_key_here"

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

def count_tokens(messages, tools=None):
    """Count tokens for a given message list with optional tools."""
    if tools:
        response = client.messages.count_tokens(
            model=MODEL_NAME,
            messages=messages,
            tools=tools
        )
    else:
        response = client.messages.count_tokens(
            model=MODEL_NAME,
            messages=messages
        )
    return response.input_tokens
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `print_thinking_response、count_tokens`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：tool_use_with_thinking、weather

```python
def tool_use_with_thinking():
    # Define a weather tool
    tools = [
        {
            "name": "weather",
            "description": "Get current weather information for a location.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The location to get weather for."
                    }
                },
                "required": ["location"]
            }
        }
    ]
    
    def weather(location):
        # Mock weather data
        weather_data = {
            "New York": {"temperature": 72, "condition": "Sunny"},
            "London": {"temperature": 62, "condition": "Cloudy"},
            "Tokyo": {"temperature": 80, "condition": "Partly cloudy"},
            "Paris": {"temperature": 65, "condition": "Rainy"},
            "Sydney": {"temperature": 85, "condition": "Clear"},
            "Berlin": {"temperature": 60, "condition": "Foggy"},
        }
        
        return weather_data.get(location, {"error": f"No weather data available for {location}"})
    
    # Initial request with tool use and thinking
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=MAX_TOKENS,
        thinking={
            "type": "enabled",
            "budget_tokens": THINKING_BUDGET_TOKENS
        },
        tools=tools,
        messages=[{
            "role": "user",
            "content": "What's the weather like in Paris today?"
        }]
    )
    
    # Detailed diagnostic output of initial response
    print("\n=== INITIAL RESPONSE ===")
    print(f"Response ID: {response.id}")
    print(f"Stop reason: {response.stop_reason}")
    print(f"Model: {response.model}")
    print(f"Content blocks: {len(response.content)} blocks")
    
    for i, block in enumerate(response.content):
        print(f"\nBlock {i+1}: Type = {block.type}")
        if block.type == "thinking":
            print(f"Thinking content: {block.thinking[:150]}...")
            print(f"Signature available: {bool(getattr(block, 'signature', None))}")
        elif block.type == "text":
            print(f"Text content: {block.text}")
        elif block.type == "tool_use":
            print(f"Tool: {block.name}")
            print(f"Tool input: {block.input}")
            print(f"Tool ID: {block.id}")
    print("=== END INITIAL RESPONSE ===\n")
    
    # Extract thinking blocks to include in the conversation history
    assistant_blocks = []
    for block in response.content:
        if block.type in ["thinking", "redacted_thinking", "tool_use"]:
            assistant_blocks.append(block)
            
    # Handle tool use if required
    full_conversation = [{
        "role": "user",
        "content": "What's the weather like in Paris today?"
    }]
    
    if response.stop_reason == "tool_use":
        # Add entire assistant response with thinking blocks and tool use
        full_conversation.append({
            "role": "assistant",
            "content": assistant_blocks
        })
        
        # Find the tool_use block
        tool_use_block = next((block for block in response.content if block.type == "tool_use"), None)
        if tool_use_block:
            # Execute the tool
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应源 notebook 的第 6 个代码单元，重点关注 `tool_use_with_thinking、weather`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
=== INITIAL RESPONSE ===
Response ID: msg_01NhR4vE9nVh2sHs5fXbzji8
Stop reason: tool_use
Model: claude-sonnet-4-6
Content blocks: 3 blocks

Block 1: Type = thinking
Thinking content: The user is asking about the current weather in Paris. I can use the `weather` function to get this information.

The `weather` function requires a "l...
Signature available: True

Block 2: Type = text
Text content: I'll check the current weather in Paris for you.

Block 3: Type = tool_use
Tool: weather
Tool input: {'location': 'Paris'}
Tool ID: toolu_01WaeSyitUGJFaaPe68cJuEv
=== END INITIAL RESPONSE ===


=== EXECUTING TOOL ===
Tool name: weather
Location to check: Paris
Result: {'temperature': 65, 'condition': 'Rainy'}
=== TOOL EXECUTION COMPLETE ===


=== SENDING FOLLOW-UP REQUEST WITH TOOL RESULT ===
Follow-up response received. Stop reason: end_turn

==== FULL RESPONSE ====

✓ FINAL ANSWER:
...
```
### 5.3 核心函数 / 类定义：multiple_tool_calls_with_thinking、weather、news

```python
def multiple_tool_calls_with_thinking():
    # Define tools
    tools = [
        {
            "name": "weather",
            "description": "Get current weather information for a location.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The location to get weather for."
                    }
                },
                "required": ["location"]
            }
        },
        {
            "name": "news",
            "description": "Get latest news headlines for a topic.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The topic to get news about."
                    }
                },
                "required": ["topic"]
            }
        }
    ]
    
    def weather(location):
        # Mock weather data
        weather_data = {
            "New York": {"temperature": 72, "condition": "Sunny"},
            "London": {"temperature": 62, "condition": "Cloudy"},
            "Tokyo": {"temperature": 80, "condition": "Partly cloudy"},
            "Paris": {"temperature": 65, "condition": "Rainy"},
            "Sydney": {"temperature": 85, "condition": "Clear"},
            "Berlin": {"temperature": 60, "condition": "Foggy"},
        }
        
        return weather_data.get(location, {"error": f"No weather data available for {location}"})
    
    def news(topic):
        # Mock news data
        news_data = {
            "technology": [
                "New AI breakthrough announced by research lab",
                "Tech company releases latest smartphone model",
                "Quantum computing reaches milestone achievement"
            ],
            "sports": [
                "Local team wins championship game",
                "Star player signs record-breaking contract",
                "Olympic committee announces host city for 2036"
            ],
            "weather": [
                "Storm system developing in the Atlantic",
                "Record temperatures recorded across Europe",
                "Climate scientists release new research findings"
            ]
        }
        
        return {"headlines": news_data.get(topic.lower(), ["No news available for this topic"])}
    
    # Initial request
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=MAX_TOKENS,
        thinking={
                "type": "enabled",
                "budget_tokens": THINKING_BUDGET_TOKENS
        },
        tools=tools,
        messages=[{
            "role": "user",
            "content": "What's the weather in London, and can you also tell me the latest news about technology?"
        }]
    )
    
    # Print detailed information about initial response
    print("\n=== INITIAL RESPONSE ===")
    print(f"Response ID: {response.id}")
    print(f"Stop reason: {response.stop_reason}")
    print(f"Model: {response.model}")
    print(f"Content blocks: {len(response.content)} blocks")
    
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应源 notebook 的第 8 个代码单元，重点关注 `multiple_tool_calls_with_thinking、weather、news`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
=== INITIAL RESPONSE ===
Response ID: msg_01VwqpBMARVoTP1H8Ytvmvsb
Stop reason: tool_use
Model: claude-sonnet-4-6
Content blocks: 3 blocks

Block 1: Type = thinking
Thinking content: The user is asking for two pieces of information:
1. The weather in London
2. The latest news about technology

Let me check what tools I have availab...
Signature available: True

Block 2: Type = text
Text content: I'll get that information for you right away.

Block 3: Type = tool_use
Tool: weather
Tool input: {'location': 'London'}
Tool ID: toolu_016xHQWMR4JsKtWvH9nbsZyA
=== END INITIAL RESPONSE ===


=== TOOL USE ITERATION 1 ===

=== EXECUTING TOOL ===
Tool name: weather
Location to check: London
Result: {'temperature': 62, 'condition': 'Cloudy'}
=== TOOL EXECUTION COMPLETE ===


=== SENDING FOLLOW-UP REQUEST WITH TOOL RESULT ===

=== FOLLOW-UP RESPONSE (ITERATION 1) ===
...
```
### 5.4 核心函数 / 类定义：thinking_block_preservation_example、weather

```python
def thinking_block_preservation_example():
    # Define a simple weather tool
    tools = [
        {
            "name": "weather",
            "description": "Get current weather information for a location.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The location to get weather for."
                    }
                },
                "required": ["location"]
            }
        }
    ]
    
    def weather(location):
        # Mock weather data
        weather_data = {
            "New York": {"temperature": 72, "condition": "Sunny"},
            "London": {"temperature": 62, "condition": "Cloudy"},
            "Tokyo": {"temperature": 80, "condition": "Partly cloudy"},
            "Paris": {"temperature": 65, "condition": "Rainy"},
            "Sydney": {"temperature": 85, "condition": "Clear"},
            "Berlin": {"temperature": 60, "condition": "Foggy"},
        }
        
        return weather_data.get(location, {"error": f"No weather data available for {location}"})
    
    # Initial request with tool use and thinking
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=MAX_TOKENS,
        thinking={
            "type": "enabled",
            "budget_tokens": THINKING_BUDGET_TOKENS
        },
        tools=tools,
        messages=[{
            "role": "user",
            "content": "What's the weather like in Berlin right now?"
        }]
    )
    
    # Extract blocks from response
    thinking_blocks = [b for b in response.content if b.type == "thinking"]
    tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
    
    print("\n=== INITIAL RESPONSE ===")
    print(f"Response contains:")
    print(f"- {len(thinking_blocks)} thinking blocks")
    print(f"- {len(tool_use_blocks)} tool use blocks")
    
    # Check if tool use was triggered
    if tool_use_blocks:
        tool_block = tool_use_blocks[0]
        print(f"\nTool called: {tool_block.name}")
        print(f"Location to check: {tool_block.input['location']}")
        
        # Execute the tool
        tool_result = weather(tool_block.input["location"])
        print(f"Tool result: {tool_result}")
        
        # First, let's try WITHOUT including the thinking block
        print("\n=== TEST 1: WITHOUT thinking block ===")
        try:
            # Notice we're only including the tool_use block, not the thinking block
            partial_blocks = tool_use_blocks
            
            incomplete_response = client.messages.create(
                model=MODEL_NAME,
                max_tokens=MAX_TOKENS,
                thinking={
                        "type": "enabled",
                        "budget_tokens": THINKING_BUDGET_TOKENS
                },
                tools=tools,
                messages=[
                    {"role": "user", "content": "What's the weather like in Berlin right now?"},
                    {"role": "assistant", "content": partial_blocks},
                    {"role": "user", "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_block.id,
                        "content": json.dumps(tool_result)
                    }]}
                ]
            )
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应源 notebook 的第 10 个代码单元，重点关注 `thinking_block_preservation_example、weather`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
=== INITIAL RESPONSE ===
Response contains:
- 1 thinking blocks
- 1 tool use blocks

Tool called: weather
Location to check: Berlin
Tool result: {'temperature': 60, 'condition': 'Foggy'}

=== TEST 1: WITHOUT thinking block ===
ERROR: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block (preceeding the lastmost set of `tool_use` and `tool_result` blocks). We recommend you include thinking blocks from previous turns. To avoid this requirement, disable `thinking`. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking'}}
This demonstrates that thinking blocks must be preserved

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
