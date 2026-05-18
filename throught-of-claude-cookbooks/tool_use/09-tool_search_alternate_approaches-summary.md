# 09 Tool Search Alternate Approaches

github - claude-cookbooks\tool_use\tool_search_alternate_approaches.ipynb

## 1. 讲的是什么

这篇讲的是另一种工具搜索方案：不用 embedding，也能按需加载工具。

它的核心思路是：

- 一开始只给 Claude 一个 `describe_tool`
- system prompt 里列出所有可用工具名
- Claude 需要某个工具时，先调用 `describe_tool`
- 客户端再把这个工具动态加入 `tools`
- 用 `tool_reference` 告诉 Claude 这个工具现在可以用了

这篇围绕三个关键词：

- `describe_tool`
- `tool_reference`
- `defer_loading=True`

## 2. 为什么要这么做

并不是所有大工具库都需要 embedding。

如果工具名很清晰，比如：

- `get_weather`
- `convert_currency`
- `calculate_tip`
- `send_email`

Claude 只要看到名字，大概就能判断该加载哪个工具。  
这时上 embedding 搜索反而可能太重。

这篇的目标是：在不建向量索引的情况下，仍然避免一开始加载全部工具定义。

## 3. 这样做的好处是什么

### 3.1 方案轻

没有 embedding、没有向量库、没有相似度计算，客户端只维护一个工具字典。

### 3.2 仍然能按需加载工具

请求开始时只有 `describe_tool`，真正工具只有在 Claude 请求时才加入。

### 3.3 更利于 prompt cache

`defer_loading=True` 是这篇的关键。  
它避免新工具定义被塞到上下文最前面，减少破坏 prompt cache 的概率。

### 3.4 适合工具名清晰的系统

如果工具名像 API 一样直观，这种方案很自然。  
如果工具名抽象、数量巨大、语义相近，embedding 方案会更稳。

## 4. 如何使用

真实使用流程是：

1. 准备 `TOOL_LIBRARY`
2. 定义一个 `describe_tool`
3. system prompt 里列出工具名
4. 初始请求只传 `describe_tool`
5. Claude 调 `describe_tool("某个工具名")`
6. 客户端把目标工具加入 `active_tools`，并设置 `defer_loading=True`
7. 客户端返回 `tool_reference`
8. Claude 再正式调用这个工具

下面是贴近 notebook 的完整主链路：

```python
import json

import anthropic

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic()

TOOL_LIBRARY = {
    "get_weather": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
    "convert_currency": {
        "name": "convert_currency",
        "description": "Convert an amount from one currency to another",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount": {"type": "number"},
                "from_currency": {"type": "string"},
                "to_currency": {"type": "string"},
            },
            "required": ["amount", "from_currency", "to_currency"],
        },
    },
}

DESCRIBE_TOOL = {
    "name": "describe_tool",
    "description": "Load a tool's full definition into context.",
    "input_schema": {
        "type": "object",
        "properties": {"tool_name": {"type": "string"}},
        "required": ["tool_name"],
    },
}

SYSTEM_PROMPT = (
    "Available tools are: "
    + ", ".join(TOOL_LIBRARY.keys())
    + ". Use describe_tool before using a tool for the first time."
)


def execute_tool(name: str, inputs: dict) -> str:
    if name == "get_weather":
        return f"Weather in {inputs['city']}: 22C, sunny"
    if name == "convert_currency":
        return f"{inputs['amount']} {inputs['from_currency']} = 92 EUR"
    return f"Unknown tool: {name}"


def run_conversation(user_message: str, max_turns: int = 10):
    messages = [{"role": "user", "content": user_message}]
    active_tools = [DESCRIBE_TOOL]
    loaded_tools = set()

    for _ in range(max_turns):
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=active_tools,
            messages=messages,
            extra_headers={"anthropic-beta": "advanced-tool-use-2025-11-20"},
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            print(response.content[0].text)
            return

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            if block.name == "describe_tool":
                requested_tool = block.input["tool_name"]

                if requested_tool in TOOL_LIBRARY:
                    if requested_tool not in loaded_tools:
                        active_tools.append(
                            {
                                **TOOL_LIBRARY[requested_tool],
                                "defer_loading": True,
                            }
                        )
                        loaded_tools.add(requested_tool)

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": [
                                {
                                    "type": "tool_reference",
                                    "tool_name": requested_tool,
                                }
                            ],
                        }
                    )
                else:
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": f"Tool '{requested_tool}' not found.",
                        }
                    )
            else:
                result = execute_tool(block.name, block.input)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    }
                )

        messages.append({"role": "user", "content": tool_results})


run_conversation("What's the weather in Tokyo?")
```

完整使用示例可以这样理解：

输入：

```text
What's the weather in Tokyo?
```

Claude 一开始只有 `describe_tool`。它从 system prompt 看到工具名里有 `get_weather`，于是先调用：

```text
describe_tool("get_weather")
```

客户端这时才把 `get_weather` 加进 `active_tools`，并返回：

```json
[{"type": "tool_reference", "tool_name": "get_weather"}]
```

然后 Claude 才能正式调用 `get_weather`。

这篇和 `08` 最大的区别是：`08` 靠语义检索找工具，这篇靠明确工具名和延迟加载找工具。
