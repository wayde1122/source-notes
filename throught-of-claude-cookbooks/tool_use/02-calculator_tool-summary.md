# 02 Calculator Tool

github - claude-cookbooks\tool_use\calculator_tool.ipynb

## 1. 讲的是什么

这篇讲的是最小版本的 tool use 闭环：Claude 先返回一个工具调用请求，客户端执行本地工具，再把结果回传给 Claude，最后由 Claude 生成面向用户的最终回复。

它用计算器做例子，不是因为计算器本身重要，而是因为这个例子最容易把工具调用的协议看清楚。

## 2. 为什么要这么做

如果直接让模型“自己算”，有两个问题：

1. 结果不一定可靠，尤其是复杂表达式
2. 你看不清楚 Claude 和外部工具之间是怎么协作的

这个 notebook 的思路是把“计算”从模型里拿出来，明确交给一个本地函数。这样做的目的不是优化计算器，而是把 tool use 的最小控制流讲明白。

## 3. 这样做的好处是什么

### 3.1 你能看清 tool use 的基本协议

这篇最值得学的不是算数，而是这条链路：

- 用户提问
- Claude 返回 `tool_use`
- 客户端执行工具
- 客户端回传 `tool_result`
- Claude 输出最终答案

后面所有更复杂的 agent，本质上都是从这个闭环长出来的。

### 3.2 计算逻辑和语言逻辑分开了

模型负责决定“什么时候该调工具”和“怎么基于结果回答”；本地函数负责真正做计算。职责一分开，行为就更稳定。

### 3.3 本地工具可以自己做安全处理

notebook 里的 `calculate(expression)` 会先清洗表达式，只保留数字和运算符。即使只是 demo，这也说明：工具真正执行前，客户端仍然要掌控输入。

## 4. 如何使用

真正的使用动作是下面这条链路：

1. 定义一个工具 `calculator`
2. Claude 收到用户问题后判断要不要调这个工具
3. 如果 `stop_reason == "tool_use"`，客户端取出工具名和参数
4. 本地执行 `calculate()`
5. 把结果作为 `tool_result` 回传
6. Claude 基于计算结果生成最终回答

最小代码示例如下：

```python
def calculate(expression):
    expression = re.sub(r"[^0-9+\-*/().]", "", expression)
    return eval(expression)

message = client.messages.create(
    model=MODEL_NAME,
    max_tokens=1024,
    tools=tools,
    messages=[{"role": "user", "content": user_message}],
)

if message.stop_reason == "tool_use":
    tool_use = next(block for block in message.content if block.type == "tool_use")
    result = calculate(tool_use.input["expression"])
```

完整使用示例可以这样理解：

输入：

```text
What is (25 * 4) + 18 / 3 ?
```

Claude 不直接回答，而是先返回一个 `tool_use` block，请求调用：

- 工具名：`calculator`
- 参数：`{"expression": "(25 * 4) + 18 / 3"}`

客户端执行后得到结果，再把结果回传给 Claude。最后 Claude 再生成用户看到的那句答案。

这个例子最关键的点是：程序真正要处理的是工具请求和工具结果，不是模型的一段自由文本。
