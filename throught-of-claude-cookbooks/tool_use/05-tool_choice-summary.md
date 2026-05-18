# 05 Tool Choice

github - claude-cookbooks\tool_use\tool_choice.ipynb

## 1. 讲的是什么

这篇讲的是 `tool_choice`。  
也就是：当你已经把工具给了 Claude，你要不要让它自由决定是否调用、强制调用某一个工具，还是要求它必须调用某个工具集合中的任意一个。

notebook 主要演示了三种模式：

- `auto`
- `tool`
- `any`

## 2. 为什么要这么做

很多 tool use 系统的问题，不是工具定义错了，而是调用策略错了。

比如：

- 有些问题 Claude 其实可以直接答，不必每次都查工具
- 有些场景你只想要结构化结果，不能让 Claude 自由回答
- 有些产品要求它每次都必须触发系统动作，而不是输出自然语言

这时，单靠工具定义还不够，你需要明确控制 Claude 的调用策略。

## 3. 这样做的好处是什么

### 3.1 可以控制成本和延迟

在 `auto` 模式下，Claude 只在必要时才调用工具。对于搜索、数据库查询、外部 API，这能节省很多额外调用。

### 3.2 可以强制结构化路径

在 `tool` 模式下，你可以明确告诉 Claude：“这次必须走这个工具。”  
当你需要稳定 JSON 或固定工作流时，这非常有用。

### 3.3 可以构造纯动作型系统

在 `any` 模式下，Claude 必须调用某个工具，但可以自己选择哪一个。  
这适合那种“不允许直接输出普通文本，只允许系统动作”的产品。

## 4. 如何使用

这篇的使用方式不是换工具，而是换 `tool_choice` 配置。

最小代码示例如下：

```python
response = client.messages.create(
    model=MODEL_NAME,
    max_tokens=1024,
    tools=tools,
    tool_choice={"type": "auto"},
    messages=[{"role": "user", "content": user_query}],
)
```

三种典型写法分别是：

```python
tool_choice={"type": "auto"}
tool_choice={"type": "tool", "name": "print_sentiment_scores"}
tool_choice={"type": "any"}
```

完整使用示例可以这样理解：

1. `auto`  
   给 Claude 一个 `web_search` 工具。  
   问“天空是什么颜色”，Claude 可能直接回答。  
   问“谁赢了 2024 Miami Grand Prix”，Claude 才去调搜索。

2. `tool`  
   同时给 `print_sentiment_scores` 和 `calculator`。  
   如果你强制：

   ```python
   tool_choice={"type": "tool", "name": "print_sentiment_scores"}
   ```

   那 Claude 无论如何都会走情感分析工具，而不是自己选计算器。

3. `any`  
   给 `send_text_to_user` 和 `get_customer_info` 两个工具。  
   这时 Claude 不能直接说话，必须调用其中一个工具来回应。

这篇真正要带走的东西是：tool use 不只是工具设计问题，也是调用策略设计问题。
