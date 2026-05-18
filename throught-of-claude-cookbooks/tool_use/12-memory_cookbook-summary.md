# 12 Memory Cookbook

github - claude-cookbooks\tool_use\memory_cookbook.ipynb

## 1. 讲的是什么

这篇讲的是长生命周期 agent 的两类上下文问题：

1. 当前会话太长，如何清理上下文
2. 新会话开始后，如何保留之前学到的经验

notebook 用两套能力解决：

- `memory_20250818`：长期记忆工具
- `context_management`：当前会话上下文编辑

这两者不是一回事。memory 是跨会话复用，context management 是当前会话瘦身。

## 2. 为什么要这么做

如果 agent 只靠当前 messages，它会遇到两个问题：

1. 当前会话越来越长，工具结果和中间推理会撑爆上下文
2. 新开会话后，之前发现过的代码模式、用户偏好、项目约定都会丢失

这篇用代码审查助手做例子。第一次审查时，Claude 发现并发问题模式，可以把这个模式写进 memory。之后换一个新文件甚至新会话，它可以先查 memory，再应用之前学到的模式。

## 3. 这样做的好处是什么

### 3.1 会话内不会无限膨胀

`clear_tool_uses_20250919` 可以清掉旧工具结果，`clear_thinking_20251015` 可以清理旧 thinking。  
这让长会话保持在可控范围内。

### 3.2 跨会话能保留可复用经验

memory 存的不是聊天流水账，而是可以复用的模式，例如：

- 代码库偏好
- 常见 bug 模式
- 用户偏好
- 项目约定

### 3.3 两种机制分工清楚

memory 解决“别失忆”，context management 解决“别撑爆”。  
如果把这两个混在一起，系统会很难设计。

### 3.4 但 memory 需要安全边界

memory 会被重新读回模型上下文，所以不能把不可信内容随便写进去。  
notebook 也强调了 path traversal、memory poisoning、scope isolation 这些问题。

## 4. 如何使用

notebook 里封装了辅助函数，例如 `run_conversation_loop`、`run_conversation_turn` 和 `MemoryToolHandler`。核心使用方式是：

1. 初始化 memory handler
2. 请求时启用 memory tool
3. 长会话时配置 context management
4. Claude 通过 memory tool 写入或读取长期记忆
5. 当前会话过长时，context editing 清理旧内容

下面是这篇的关键配置和调用形态：

```python
from anthropic import Anthropic

from memory_tool import MemoryToolHandler
from memory_demo.demo_helpers import run_conversation_turn

client = Anthropic()
MODEL = "claude-sonnet-4-6"

memory = MemoryToolHandler(base_path="./memory_storage")

CONTEXT_MANAGEMENT = {
    "edits": [
        {
            "type": "clear_thinking_20251015",
            "keep": {"type": "thinking_turns", "value": 1},
        },
        {
            "type": "clear_tool_uses_20250919",
            "trigger": {"type": "input_tokens", "value": 5000},
            "keep": {"type": "tool_uses", "value": 2},
            "clear_at_least": {"type": "input_tokens", "value": 2000},
        },
    ]
}

THINKING = {
    "type": "enabled",
    "budget_tokens": 1024,
}

messages = [
    {
        "role": "user",
        "content": "Review this code and remember reusable bug patterns you find.",
    }
]

response = run_conversation_turn(
    client=client,
    model=MODEL,
    messages=messages,
    memory_handler=memory,
    system="You are a code reviewer.",
    context_management=CONTEXT_MANAGEMENT,
    thinking=THINKING,
    max_tokens=4096,
    verbose=True,
)
```

完整使用示例可以这样理解：

第一轮会话里，Claude 审查一个 `web_scraper_v1.py`，发现共享列表被多个线程同时写入，容易产生并发问题。  
它通过 memory tool 把“线程安全 / 共享状态修改风险”这类模式记下来。

第二轮新会话里，Claude 审查另一个 `api_client_v1.py`。  
它先查 memory，发现之前记录过类似并发模式，于是能更快定位同类问题。

第三轮长会话里，继续审查多个文件。  
这时 context management 会清理旧 thinking 和旧 tool result，但 memory 里的长期模式仍然存在。

这里最关键的理解是：memory 不是普通摘要，context management 也不是长期记忆。一个负责长期经验，一个负责当前会话体积。
