# 07 Programmatic Tool Calling

github - claude-cookbooks\tool_use\programmatic_tool_calling_ptc.ipynb

## 1. 讲的是什么

这篇讲的是 Programmatic Tool Calling，简称 PTC。  
核心不是让 Claude “多调几个工具”，而是让 Claude 在 code execution 环境里先写程序，再由程序去循环调用工具、过滤大结果、完成中间计算。

notebook 的例子是团队报销分析，用到 3 个工具：

- `get_team_members`
- `get_expenses`
- `get_custom_budget`

## 2. 为什么要这么做

普通 tool use 在下面这种场景里会很重：

1. 要对很多对象重复调工具
2. 工具返回结果很大
3. 任务有顺序依赖

比如这个例子里，Claude 先要查团队成员，再对每个人拉费用明细，再判断谁需要继续查特殊预算。  
如果每一步都把完整原始结果喂回 Claude，上下文会很快膨胀。

## 3. 这样做的好处是什么

### 3.1 中间处理可以下沉到代码层

循环、筛选、求和、判断这些步骤，程序比模型更适合做。  
PTC 让这些动作在 code execution 环境里完成，而不是每一步都让模型重新看大批数据。

### 3.2 可以显著减少上下文污染

Claude 不必阅读所有原始费用明细，只需要阅读被程序过滤后的关键结果。

### 3.3 更适合多实体、多轮、顺序依赖任务

只要任务是“对一组对象重复做同样的事”，PTC 往往比普通 tool use 更自然。

### 3.4 更适合作为平台内增强，而不是通用 agent 的默认基座

`code_execution`、`allowed_callers`、`container` 这些能力都带有明显的 Anthropic / Claude 平台特征。  
所以 PTC 很适合在 Claude 体系里做性能和上下文优化，但如果你要设计跨模型、跨平台的通用 agent，就不应该把它当成唯一依赖。

更稳的做法通常是：

- 通用层保留普通 tool use、消息循环、状态管理
- 平台增强层再按需接入 PTC

这样没有 `code_execution` 的平台也能跑，只是中间处理没那么高效。

## 4. 如何使用

这篇真正的使用动作是：

1. 把工具定义开放给 code execution
2. 使用 beta messages API
3. 同时把 `code_execution` 工具也交给 Claude
4. 让 Claude 在代码执行环境里编排工具调用
5. 区分普通 `tool_use` 和 `code_execution` 发起的工具调用结果

下面这段是可以直接照着 notebook 跑的完整示例。它省掉了可视化和统计代码，只保留 PTC 主链路：

```python
import copy
import json

import anthropic
from anthropic.types.beta import BetaTextBlock, BetaToolUseBlock

from utils.team_expense_api import (
    get_custom_budget,
    get_expenses,
    get_team_members,
)

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic()

tools = [
    {
        "name": "get_team_members",
        "description": "Returns all team members in a department.",
        "input_schema": {
            "type": "object",
            "properties": {
                "department": {"type": "string"},
            },
            "required": ["department"],
        },
    },
    {
        "name": "get_expenses",
        "description": "Returns all expense line items for an employee in a quarter.",
        "input_schema": {
            "type": "object",
            "properties": {
                "employee_id": {"type": "string"},
                "quarter": {"type": "string"},
            },
            "required": ["employee_id", "quarter"],
        },
    },
    {
        "name": "get_custom_budget",
        "description": "Returns custom quarterly budget information for an employee.",
        "input_schema": {
            "type": "object",
            "properties": {
                "user_id": {"type": "string"},
            },
            "required": ["user_id"],
        },
    },
]

tool_functions = {
    "get_team_members": get_team_members,
    "get_expenses": get_expenses,
    "get_custom_budget": get_custom_budget,
}

ptc_tools = copy.deepcopy(tools)
for tool in ptc_tools:
    tool["allowed_callers"] = ["code_execution_20250825"]

ptc_tools.append(
    {
        "type": "code_execution_20250825",
        "name": "code_execution",
    }
)


def run_agent_with_ptc(user_message: str) -> str:
    messages = [{"role": "user", "content": user_message}]
    container_id = None

    while True:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            tools=ptc_tools,
            messages=messages,
            betas=["advanced-tool-use-2025-11-20"],
            extra_body={"container": container_id} if container_id else None,
        )

        if getattr(response, "container", None):
            container_id = response.container.id

        if response.stop_reason == "end_turn":
            return next(
                (
                    block.text
                    for block in response.content
                    if isinstance(block, BetaTextBlock)
                ),
                "",
            )

        if response.stop_reason != "tool_use":
            raise RuntimeError(f"Unexpected stop_reason: {response.stop_reason}")

        messages.append({"role": "assistant", "content": response.content})
        tool_results = []

        for block in response.content:
            if not isinstance(block, BetaToolUseBlock):
                continue

            tool_name = block.name
            tool_input = block.input
            result = tool_functions[tool_name](**tool_input)

            if isinstance(result, (dict, list)):
                content = json.dumps(result)
            else:
                content = str(result)

            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": content,
                }
            )

        messages.append({"role": "user", "content": tool_results})


answer = run_agent_with_ptc(
    "Which engineering team members exceeded their quarterly expense budget in Q3?"
)
print(answer)
```

这里要特别注意一件事：`code_execution` 不是你自己实现的 Python 函数工具，它是 Claude API 提供的内建工具类型。  
所以它会出现在 `ptc_tools` 里，但不会出现在：

```python
tool_functions = {
    "get_team_members": get_team_members,
    "get_expenses": get_expenses,
    "get_custom_budget": get_custom_budget,
}
```

`tool_functions` 里放的是**需要由你本地代码执行的业务工具**。  
`code_execution` 则是**由 Anthropic 提供的代码执行环境**，Claude 会在这个环境里写代码、运行代码，并在需要时从那个环境里发起对你业务工具的调用。

完整使用示例可以这样理解：

输入：

```text
Which engineering team members exceeded their quarterly expense budget?
```

这个问题背后需要完成 3 件事：

1. 找到 engineering 部门所有成员
2. 统计每个人本季度的支出总额
3. 只对超出默认预算的人，再检查是否有自定义预算例外

### 4.1 普通 tool use 会怎么走

如果不用 PTC，Claude 往往要一轮一轮地请求工具：

1. 先调用 `get_team_members("engineering")`
2. 客户端把整份成员列表回给 Claude
3. Claude 再决定对第一个人调用 `get_expenses(...)`
4. 客户端把这个人的大批 expense records 回给 Claude
5. Claude 再决定查第二个人、第三个人
6. 等它看完所有人后，再决定对哪些人调用 `get_custom_budget(...)`
7. 最后自己汇总出超预算名单

问题就在这里：

- Claude 会反复看到大量原始费用明细
- 每个人的 expense records 都可能很长
- 循环、求和、筛选这些本来更适合代码做的事，被迫塞回模型上下文里完成

### 4.2 PTC 会怎么走

用了 PTC 之后，流程会变成另一种形态：

1. Claude 先判断这个任务适合在 code execution 里写程序
2. 它生成一段执行逻辑，大意是：
   - 先取 engineering 成员列表
   - 遍历每个成员，调用 `get_expenses`
   - 在代码里把费用按人求和
   - 只对总额超过默认预算的人，再调用 `get_custom_budget`
   - 在代码里比较实际支出和预算
   - 生成最终超预算名单
3. 这些工具调用是在 code execution 环境里发生的，不需要每次都把原始明细交回 Claude解释
4. Claude 最后只需要基于已经整理好的结果输出结论

换句话说，普通 tool use 是“Claude 一步一步喊你查”；PTC 更像“Claude 先写好一个小脚本，让脚本把脏活干完，再回来交结果”。

### 4.3 这段完整代码里最关键的 3 个点

1. `allowed_callers`

```python
tool["allowed_callers"] = ["code_execution_20250825"]
```

这表示这些业务工具不只允许 Claude 直接调用，也允许 code execution 容器中的程序去调用。

2. `code_execution` 工具

```python
ptc_tools.append(
    {
        "type": "code_execution_20250825",
        "name": "code_execution",
    }
)
```

这给了 Claude 一个真正可以写程序和执行程序的环境。这个环境不是你在本地手写的函数，而是 API 背后的容器能力。

3. `container_id`

```python
extra_body={"container": container_id} if container_id else None
```

这一步让 code execution 环境保持状态，Claude 不用每轮都从零开始。

### 4.4 代码里为什么要加 `allowed_callers`

这一步的作用是告诉系统：

- 这个工具不只允许 Claude 直接调用
- 也允许 code execution 容器里的程序调用

如果不加：

```python
tool["allowed_callers"] = ["code_execution_20250825"]
```

那 Claude 就算进入了 code execution，也没法在程序里直接调这些工具。

### 4.5 代码里为什么要加 `code_execution`

因为 PTC 不是普通的工具链路，它需要一个能运行代码的执行环境。  
所以除了原来的业务工具，你还要把：

```python
{
    "type": "code_execution_20250825",
    "name": "code_execution",
}
```

一起交给 Claude。这样它才能选择“写程序来调工具”，而不是只能继续走普通的 tool use。

### 4.6 实际上程序最后拿到的是什么

在这个例子里，最理想的最终结果不是几百条原始报销记录，而是一个已经整理过的名单，例如：

- 哪些员工超预算
- 每个人实际花了多少
- 默认预算是多少
- 是否存在自定义预算例外

也就是说，PTC 真正节省的不是“某一个 API 调用”，而是减少了模型反复阅读和解释大批原始中间数据的成本。

这篇最该带走的一句话是：能在程序里完成的循环、聚合和过滤，就不要把原始大结果整包送回模型。
