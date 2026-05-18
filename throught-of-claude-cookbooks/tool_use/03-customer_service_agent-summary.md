# 03 Customer Service Agent

github - claude-cookbooks\tool_use\customer_service_agent.ipynb

## 1. 讲的是什么

这篇讲的是一个最小的多工具客服 agent。Claude 不只调用一个工具，而是会在多个客服动作之间做判断：

- `get_customer_info`
- `get_order_details`
- `cancel_order`

它已经不只是“工具调用 demo”，而是一个最小可运行的 agent loop。

## 2. 为什么要这么做

真实业务通常不是一个工具就结束，而是：

1. 先识别用户意图
2. 再决定该查哪个系统
3. 查完结果后，决定是否继续下一步动作

如果还停留在单工具示例，你很难理解多步业务流程怎么接入 Claude。这个 notebook 用客服场景把“多工具 + 连续调用”压成一个最小模板。

## 3. 这样做的好处是什么

### 3.1 它把业务动作显式建模成工具

查客户、查订单、取消订单不再藏在 prompt 里，而是被明确定义成系统能力。这样 Claude 做的是“选择动作”，不是“幻想后端”。

### 3.2 它展示了最小 agent loop

这篇最重要的点是：

```python
while response.stop_reason == "tool_use":
    ...
```

也就是说，只要 Claude 还想继续调工具，客户端就继续执行。这是后面很多 agent 设计的基础。

### 3.3 它说明了 tool use 不只是读系统，也可以动系统

`get_customer_info` 和 `get_order_details` 是查询型工具，`cancel_order` 是执行型工具。Claude 不只是获取信息，也能驱动业务动作。

## 4. 如何使用

真正的使用动作是：

1. 先定义多个客服工具
2. 把用户请求发给 Claude
3. 如果 Claude 请求工具，就执行该工具
4. 把执行结果回传给 Claude
5. 如果 Claude 还要继续调工具，就继续循环
6. 直到 `stop_reason == "end_turn"`，再把最终回答给用户

最小代码示例如下：

```python
response = client.messages.create(
    model=MODEL_NAME,
    max_tokens=4096,
    tools=tools,
    messages=messages,
)

while response.stop_reason == "tool_use":
    tool_use = next(block for block in response.content if block.type == "tool_use")
    result = process_tool_call(tool_use.name, tool_use.input)
    messages.append({"role": "assistant", "content": response.content})
    messages.append(
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result,
                }
            ],
        }
    )
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=4096,
        tools=tools,
        messages=messages,
    )
```

完整使用示例可以这样理解：

输入：

```text
Can you check order O1002 and cancel it for customer C1?
```

Claude 可能会先调用 `get_order_details` 看订单状态，拿到结果后再决定是否调用 `cancel_order`。  
也就是说，第二步动作不一定在一开始就确定，而是根据前一步工具结果继续推出来的。

这个例子真正教会你的是：一旦系统进入多工具流程，客户端要准备好和 Claude 来回多轮，而不是假设“一次请求只会调一个工具”。
