# 08 Tool Search With Embeddings

github - claude-cookbooks\tool_use\tool_search_with_embeddings.ipynb

## 1. 讲的是什么

这篇讲的是：当工具库变大时，不要一开始把所有工具定义都塞给 Claude，而是先给 Claude 一个“找工具”的工具，让它按需搜索真正相关的工具。

notebook 里的核心工具叫：

- `tool_search`

它不是业务工具，而是一个“元工具”：负责从工具库里找出可能有用的工具，再通过 `tool_reference` 把这些工具暴露给 Claude。

## 2. 为什么要这么做

普通 tool use 的默认思路是：请求开始时，把所有工具都放进 `tools`。工具少的时候没问题，但工具一多就会出问题。

主要问题有三个：

1. 工具定义本身会占很多上下文
2. Claude 要在大量无关工具里找目标工具
3. 工具库持续增长后，每次请求都会变重

所以这篇的思路是把“工具发现”也做成一层检索系统。它和 RAG 很像，只是检索对象不是文档 chunk，而是工具定义。

## 3. 这样做的好处是什么

### 3.1 初始上下文更小

Claude 一开始只需要看到 `tool_search`，不需要看到几百个工具的完整 schema。

### 3.2 工具库可以扩展

如果以后有天气、金融、CRM、工单、数据库、监控等大量工具，你不必每次都全量传给模型。

### 3.3 工具发现更贴近自然语言

用户不一定知道工具名。  
比如用户说“查一下投资回报”，embedding 搜索可以把它匹配到 `calculate_compound_interest` 这类工具，而不是要求用户或模型准确猜工具名。

### 3.4 但它不是免费能力

这套方案需要你维护工具索引、embedding、相似度搜索和缓存。  
如果工具库只有十几个，直接传工具可能更简单。

## 4. 如何使用

这篇的真实流程是：

1. 准备一个完整工具库 `TOOL_LIBRARY`
2. 把每个工具定义转成可搜索文本
3. 对工具文本生成 embedding
4. 请求时给 API 提供工具库和 `tool_search`
5. Claude 调用 `tool_search`，用自然语言描述需要什么工具
6. 客户端返回匹配工具的 `tool_reference`
7. Claude 再继续调用这些被发现的工具

这里有个容易误解的点：`tool_reference` 不是凭空创造工具。  
在 notebook 的写法里，完整工具定义仍然会放进请求的 `tools` 列表里，`tool_search` 的作用是让 Claude 先走“搜索/发现”这一步，再通过 `tool_reference` 指向应该使用的工具。也就是说，工具库是系统提供的，搜索结果是模型当前任务真正要关注的子集。

下面是一段贴近 notebook 主链路的完整示例：

```python
import json
from typing import Any

import anthropic
import numpy as np
from sentence_transformers import SentenceTransformer

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic()
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

TOOL_LIBRARY = [
    {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    },
    {
        "name": "get_air_quality",
        "description": "Get air quality index for a city",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    },
    {
        "name": "get_stock_price",
        "description": "Get current stock price for a ticker symbol",
        "input_schema": {
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    },
]

TOOL_SEARCH_DEFINITION = {
    "name": "tool_search",
    "description": "Search for available tools that can help with a task.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "top_k": {"type": "number"},
        },
        "required": ["query"],
    },
}


def tool_to_text(tool: dict[str, Any]) -> str:
    properties = tool.get("input_schema", {}).get("properties", {})
    params = ", ".join(properties.keys())
    return f"Tool: {tool['name']}\nDescription: {tool['description']}\nParameters: {params}"


tool_texts = [tool_to_text(tool) for tool in TOOL_LIBRARY]
tool_embeddings = embedding_model.encode(tool_texts, convert_to_numpy=True)


def search_tools(query: str, top_k: int = 3) -> list[dict[str, Any]]:
    query_embedding = embedding_model.encode(query, convert_to_numpy=True)
    similarities = np.dot(tool_embeddings, query_embedding)
    top_indices = np.argsort(similarities)[-top_k:][::-1]
    return [
        {"tool": TOOL_LIBRARY[idx], "similarity_score": float(similarities[idx])}
        for idx in top_indices
    ]


def handle_tool_search(query: str, top_k: int = 3) -> list[dict[str, Any]]:
    results = search_tools(query, top_k)
    return [
        {"type": "tool_reference", "tool_name": result["tool"]["name"]}
        for result in results
    ]


def mock_tool_execution(tool_name: str, tool_input: dict[str, Any]) -> str:
    if tool_name == "get_weather":
        return f"Weather in {tool_input['location']}: 22C, sunny"
    if tool_name == "get_air_quality":
        return f"Air quality in {tool_input['location']}: AQI 42"
    if tool_name == "get_stock_price":
        return f"{tool_input['ticker']}: $123.45"
    return f"Unknown tool: {tool_name}"


def run_tool_search_conversation(user_message: str, max_turns: int = 5) -> None:
    messages = [{"role": "user", "content": user_message}]

    for _ in range(max_turns):
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            tools=TOOL_LIBRARY + [TOOL_SEARCH_DEFINITION],
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

            if block.name == "tool_search":
                refs = handle_tool_search(
                    block.input["query"],
                    block.input.get("top_k", 3),
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": refs,
                    }
                )
            else:
                result = mock_tool_execution(block.name, block.input)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    }
                )

        messages.append({"role": "user", "content": tool_results})


run_tool_search_conversation(
    "What's the weather and air quality in Berlin?"
)
```

完整使用示例可以这样理解：

输入：

```text
What's the weather and air quality in Berlin?
```

这篇的做法是让 Claude 先调用 `tool_search`，搜索“weather and air quality tools”。客户端检索后返回两个 `tool_reference`：

- `get_weather`
- `get_air_quality`

然后 Claude 再继续调用这两个真正的业务工具。

这里最重要的区别是：`tool_search` 返回的不是最终业务结果，而是工具引用。真正的工具执行发生在后面的回合。
