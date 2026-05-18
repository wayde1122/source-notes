# 11 Automatic Context Compaction

github - claude-cookbooks\tool_use\automatic-context-compaction.ipynb

## 1. 讲的是什么

这篇讲的是长流程 agent 的上下文压缩。  
当 agent 连续处理很多任务、工具结果不断累积时，可以让 SDK 自动触发 compaction，把旧历史总结成摘要，再继续后面的任务。

notebook 用的是客服工单队列：

- 获取下一张工单
- 分类
- 查知识库
- 设置优先级
- 路由
- 起草回复
- 标记完成

每张工单都会产生不少工具结果，所以很容易把上下文越滚越大。

## 2. 为什么要这么做

如果不做 compaction，工具型 agent 会出现很典型的问题：

1. 每一轮都带着全部旧工具结果
2. 输入 token 线性增长
3. 已完成工单的细节污染后续任务
4. 成本和延迟越来越高
5. 最后可能撞上下文窗口

而客服工单这种任务有天然压缩点：处理完一批工单后，后续其实只需要知道“处理过哪些、状态是什么、有没有未完成事项”，不需要保留每一步完整工具输出。

## 3. 这样做的好处是什么

### 3.1 长流程可以继续跑

compaction 会把详细历史替换成摘要，任务不用因为上下文太长而停掉。

### 3.2 token 成本更可控

旧的工具结果被压缩后，后续请求不再反复携带大量无用细节。

### 3.3 更适合阶段性工作流

工单、文档批处理、批量审查、批量分析都很适合。  
共同点是：完成一个阶段后，详细过程可以被摘要替代。

### 3.4 但它会带来信息损失

compaction 是压缩，不是无损存储。  
如果任务后续需要引用原始证据、完整工具输出或精确审计链，就不能随便压。

## 4. 如何使用

notebook 用的是 beta `tool_runner`，它会在内部持续驱动工具调用。  
核心是给 runner 传入 `compaction_control`。

下面是贴近 notebook 的完整主链路：

```python
import anthropic
from dotenv import load_dotenv

from utils.customer_service_tools import (
    classify_ticket,
    draft_response,
    get_next_ticket,
    initialize_ticket_queue,
    lookup_knowledge_base,
    mark_ticket_complete,
    route_ticket,
    set_priority,
)

load_dotenv()

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic()

tools = [
    get_next_ticket,
    classify_ticket,
    lookup_knowledge_base,
    set_priority,
    route_ticket,
    draft_response,
    mark_ticket_complete,
]

initialize_ticket_queue(num_tickets=5)

messages = [
    {
        "role": "user",
        "content": (
            "Process all customer support tickets in the queue. "
            "For each ticket, classify it, look up relevant knowledge, "
            "set priority, route it, draft a response, and mark it complete."
        ),
    }
]

runner = client.beta.messages.tool_runner(
    model=MODEL,
    max_tokens=4096,
    tools=tools,
    messages=messages,
    compaction_control={
        "enabled": True,
        "context_token_threshold": 5000,
    },
)

previous_message_count = 0

for message in runner:
    messages_list = list(runner._params["messages"])
    current_message_count = len(messages_list)

    if current_message_count < previous_message_count:
        print("Compaction occurred")
        print(messages_list[-1]["content"][-1].text)

    previous_message_count = current_message_count
    print(
        "Turn:",
        "input_tokens=", message.usage.input_tokens,
        "output_tokens=", message.usage.output_tokens,
        "messages=", current_message_count,
    )
```

完整使用示例可以这样理解：

系统连续处理 5 张客服工单。  
如果没有 compaction，第 5 张工单处理时，前 4 张工单的分类、知识库搜索、回复草稿等内容仍然在上下文里。  
开启 compaction 后，当 token 超过阈值，SDK 会让 Claude 生成一段摘要，记录已经完成的工单状态，然后用摘要替换旧历史。

这里最容易误解的是：compaction 不是“删除记忆”，而是“把详细历史换成摘要”。  
它适合保留任务进度，不适合保留完整证据。
