# 06 Parallel Tools

github - claude-cookbooks\tool_use\parallel_tools.ipynb

## 1. 讲的是什么

这篇讲的是：当一个问题需要多个彼此独立的工具时，怎么减少不必要的来回调用。

notebook 用两个简单工具做例子：

- `get_weather`
- `get_time`

然后再加了一个元工具：

- `batch_tool`

## 2. 为什么要这么做

理论上，Claude 可以在一个回合里请求多个工具。但实际运行时，它有时会先调用一个工具，等客户端把结果回回来后，再调用第二个工具。

这会导致：

- 多一轮 API 往返
- 更高延迟
- 客户端多一次处理

如果两个工具彼此独立，这种串行调用就显得有点浪费。

## 3. 这样做的好处是什么

### 3.1 降低端到端延迟

把独立工具打包到一个 `batch_tool` 里，可以让多个调用一次完成，而不是让 Claude 一次只提出一个请求。

### 3.2 把并行能力显式暴露给 Claude

notebook 的重点不是“Claude 自己学会并行”，而是你在工具层明确给它一个并行入口。这样更可控。

### 3.3 更适合独立查询类任务

如果几个查询彼此没有依赖关系，这种模式通常能比串行调用更干净。

## 4. 如何使用

使用方式是：

1. 先定义普通工具，比如 `get_weather` 和 `get_time`
2. 再定义一个 `batch_tool`
3. 如果 Claude 调了 `batch_tool`，客户端就一次性处理它打包的多个子调用

最小代码示例如下：

```python
def process_tool_with_maybe_batch(tool_name, tool_input):
    if tool_name == "batch_tool":
        results = []
        for call in tool_input["calls"]:
            results.append(process_tool_call(call["name"], call["input"]))
        return results
    return process_tool_call(tool_name, tool_input)
```

完整使用示例可以这样理解：

输入：

```text
What is the weather and local time in Tokyo?
```

没有 `batch_tool` 时，Claude 可能先调 `get_weather("Tokyo")`，等结果回来后再调 `get_time("Tokyo")`。  
有了 `batch_tool` 后，它可以一次性把这两个请求打包，客户端再统一处理。

这篇最重要的点是：支持并行不等于模型一定会并行，必要时你要把并行能力设计成显式工具。
