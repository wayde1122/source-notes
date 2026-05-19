# 《Gate: human-in-the-loop with custom tools》学习笔记：人在环审批

> 源 Notebook：`managed_agents/CMA_gate_human_in_the_loop.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **人在环审批** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

# Gate: human-in-the-loop with custom tools

Many workflows sit in the gap between "fully automate" and "always ask a human." Expense approval is a classic example: the agent can handle the clear cases on its own, but it should know when to escalate ambiguous ones for human review. Calibration matters here, an agent that escalates everything is exhausting to work with, and an agent that escalates nothing is dangerous.

This notebook builds an expense approver around two **custom tools**: `decide()` for clear-cut cases and `escalate()` for ambiguous ones. Both round-trip through your application, which is where you either log the outcome (decide) or put it in front of a reviewer (escalate).

## What custom tools are

Up until now the cookbook has used the built-in `agent_toolset` (bash, read, write, etc.), all of which run inside the sandbox container. **Custom tools** are different:……

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- What custom tools are
- 1. Upload policy and receipts
- 2. Define the agent with two custom tools
- Part A: streaming locally during development
- Part B: webhooks for production

## 3. 核心概念

### Managed Agent

Managed Agent 是托管平台中的执行者配置，负责保存模型、指令、工具和运行策略。

### Environment

Environment 是 Agent 执行任务的隔离运行环境，文件挂载、代码执行和资源访问通常都依赖它。

### Session

Session 是一次具体任务执行。它承载用户输入、事件流、Agent 中间动作和最终结果。

### File Mounts

文件挂载用于把本地或远端文件放进 Agent 可访问环境，是代码修复、数据分析、报告生成类任务的基础。

### Streaming Events

事件流用于观察 Agent 的工作过程，包括消息、工具调用、状态变化和人工介入点。

### Human-in-the-loop

人在环机制用于在高风险动作前暂停，让用户审批、修正或拒绝 Agent 的下一步动作。

### 1. Set up the client

这是 notebook 中显式出现的主题，代表该示例的一个关键学习节点。阅读时应结合对应代码单元理解它如何参与 `Claude Managed Agents 托管式 Agent 实践`。

## 4. 整体流程图

```text
用户目标 / 示例任务
  ↓
准备输入数据、文件、环境变量或外部服务凭证
  ↓
创建核心对象：Agent / Client / Environment / Session / Skill / Tool
  ↓
配置 prompt、工具权限、文件挂载或运行上下文
  ↓
触发 Claude / Agent 执行任务
  ↓
读取事件流、工具结果、生成文件或模型输出
  ↓
展示最终结果，并分析可迁移模式与生产化限制
```

这张流程图是阅读这类 notebook 的主线：不要只看最终回答，而要看每一步如何把上下文传递给 Claude，以及 Claude 的输出如何被程序继续使用。

## 5. 核心代码精读

### 5.1 环境、依赖与客户端准备

```python
import json
import os
from collections import Counter
from pathlib import Path

from anthropic import Anthropic
from utilities import wait_for_idle_status

MODEL = os.environ.get("COOKBOOK_MODEL", "claude-sonnet-4-6")

client = Anthropic()
FIXTURE = Path("example_data") / "gate"
```

这段代码对应 notebook 的第 2 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.2 示例输入与运行入口

```python
policy = client.beta.files.upload(
    file=("policy.yaml", (FIXTURE / "policy.yaml").read_bytes(), "text/yaml")
)
receipts = client.beta.files.upload(
    file=(
        "receipts.jsonl",
        (FIXTURE / "inbox" / "receipts.jsonl").read_bytes(),
        "application/jsonl",
    )
)
```

这段代码对应 notebook 的第 4 个代码单元，核心关注点是 `示例输入与运行入口`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.3 主执行流程与 API 调用

```python
agent = client.beta.agents.create(
    name="cookbook-gate",
    model=MODEL,
    system=(
        "You are an expense approver. Read each receipt in "
        "receipts.jsonl against the policy in policy.yaml and make "
        "exactly ONE tool call per receipt. Call decide(receipt_id, "
        "action, reason) for clear cases, or escalate(receipt_id, "
        "question) for ambiguous ones (near thresholds, unclear "
        "categories, suspicious notes). Once you've called decide "
        "or escalate for a given receipt, that receipt is finalized "
        "— do not call either tool for it again. After processing "
        "all receipts exactly once, stop."
    ),
    tools=[
        {
            "type": "agent_toolset_20260401",
            "default_config": {
                "enabled": True,
                "permission_policy": {"type": "always_allow"},
            },
        },
        {
            "type": "custom",
            "name": "decide",
            "description": "Record a final approve/reject for a clear-cut receipt.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "receipt_id": {"type": "string"},
                    "action": {"type": "string", "enum": ["approve", "reject"]},
                    "reason": {"type": "string"},
                },
                "required": ["receipt_id", "action", "reason"],
            },
        },
        {
            "type": "custom",
            "name": "escalate",
            "description": "Surface an ambiguous receipt for human review.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "receipt_id": {"type": "string"},
                    "question": {"type": "string"},
                },
                "required": ["receipt_id", "question"],
            },
        },
    ],
)

env = client.beta.environments.create(
    name="cookbook-gate-env",
    config={"type": "cloud", "networking": {"type": "limited"}},
)

session = client.beta.sessions.create(
    environment_id=env.id,
    agent={"type": "agent", "id": agent.id, "version": agent.version},
    resources=[
        {"type": "file", "file_id": policy.id, "mount_path": "policy.yaml"},
        {"type": "file", "file_id": receipts.id, "mount_path": "receipts.jsonl"},
    ],
    title="Expense gate",
)
print(f"session: {session.id}")
```

这段代码对应 notebook 的第 6 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.4 核心函数 / 类定义：simulate_human_review

```python
def simulate_human_review(receipt_id: str, question: str) -> str:
    # Real implementation would show this in a UI and await input.
    # Here: reject anything the agent flags as suspicious.
    return "reject" if "suspicious" in question.lower() else "approve"


# The iterate notebook factored its streaming loop out into
# `stream_until_end_turn`, and most other notebooks just import it.
# This one doesn't, because every decision the agent makes is a
# custom tool call, which means the session keeps going idle with
# `stop_reason.type == "requires_action"` and
# `stop_reason.event_ids` pointing at the `agent.custom_tool_use`
# events waiting for a response. We POST a `user.custom_tool_result`
# for each, let the session resume, and eventually break on a
# `session.status_idle` that arrives with `end_turn`. The helper
# only knows how to exit on `end_turn`, so we need the full loop
# here.
decisions = {}  # receipt_id -> final decision record
tool_use_events = {}
responded_to = set()  # event_ids we've already replied to
print("=== Part A: streaming ===")
with client.beta.sessions.events.stream(session.id) as stream:
    client.beta.sessions.events.send(
        session_id=session.id,
        events=[
            {
                "type": "user.message",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Read /mnt/session/uploads/policy.yaml and "
                            "/mnt/session/uploads/receipts.jsonl. Process "
                            "all 12 receipts. For each receipt, make "
                            "exactly one decide() or escalate() call and "
                            "then move on to the next. When every receipt "
                            "has been processed once, stop."
                        ),
                    }
                ],
            }
        ],
    )
    # Note on the responded_to set: when an agent emits more than 5
    # parallel custom tool calls, the server returns
    # `stop_reason.event_ids` as a sliding window of the next 5
    # pending. Each status_idle we observe in the stream has that
    # window pinned at the moment the event was emitted, but by the
    # time we iterate to the next status_idle event, the server has
    # already advanced past the events we just responded to. So we
    # need to dedupe across status_idle events to avoid double-
    # responding to the same custom tool call (which 400s).
    for ev in stream:
        if ev.type == "agent.custom_tool_use":
            tool_use_events[ev.id] = ev
        elif ev.type == "session.status_idle" and ev.stop_reason:
            if ev.stop_reason.type == "requires_action":
                for event_id in ev.stop_reason.event_ids:
                    if event_id in responded_to:
                        continue
                    tool_ev = tool_use_events[event_id]
                    name, args = tool_ev.name, tool_ev.input
                    receipt_id = args["receipt_id"]
                    if name == "decide":
                        decisions[receipt_id] = {"lane": args["action"], **args}
                        result = {"recorded": True}
                    elif name == "escalate":
                        human = simulate_human_review(receipt_id, args["question"])
                        decisions[receipt_id] = {
                            "lane": "escalated",
                            "human_decision": human,
                            **args,
                        }
                        result = {"human_decision": human}
                    else:
                        result = {"error": f"unknown tool {name}"}
                    client.beta.sessions.events.send(
                        session_id=session.id,
                        events=[
                            {
                                "type": "user.custom_tool_result",
                                "custom_tool_use_id": event_id,
                                "content": [{"type": "text", "text": json.dumps(result)}],
                            }
                        ],
                    )
                    responded_to.add(event_id)
            elif ev.stop_reason.type == "end_turn":
                break
        elif ev.type == "session.status_terminated":
            break

wait_for_idle_status(client, session.id)

lanes = Counter(d["lane"] for d in decisions.values())
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应 notebook 的第 8 个代码单元，核心关注点是 `simulate_human_review`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

## 6. 示例运行过程拆解

可以把这个 notebook 的运行过程拆成五步：

1. **准备任务和上下文**：包括用户问题、示例文件、CSV、代码库、Slack 消息、测试目录或配置文件。
2. **创建执行对象**：根据主题创建 client、agent、environment、session、skill 或工具集合。
3. **绑定能力边界**：配置 prompt、工具权限、MCP、文件挂载、系统指令或 schema。
4. **执行并观察过程**：通过普通响应、事件流、文件输出或工具调用结果观察 Claude 的执行过程。
5. **读取结果并复盘**：查看最终文本、报告、代码修改、图表、文件或评估结果，并理解它为什么能解决原始任务。

如果 notebook 中包含输出示例，建议重点比较“输入任务”和“最终输出”之间经过了哪些中间状态；这些中间状态通常就是迁移到你自己项目时最值得复用的部分。

## 7. 关键设计思路

### 7.1 把 Claude 放进明确的工程边界

这类示例的重点不是让 Claude 自由发挥，而是通过 Agent、Session、Tool、Skill 或 Environment 给它设定边界：它能看什么、能调用什么、最终要产出什么。

### 7.2 把不确定推理和确定性代码分开

Claude 适合理解任务、规划步骤、生成解释和处理非结构化信息；确定性的文件处理、API 调用、计算、格式转换应尽量放在代码或工具中。

### 7.3 保留可观察的中间过程

事件流、日志、打印输出、生成文件和结构化返回值都很重要。它们让你能调试 Agent 为什么这么做，而不是只看到最终答案。

### 7.4 示例代码要看“可迁移骨架”

每篇 notebook 都有演示数据，但真正值得带走的是骨架：初始化、配置、执行、解析、验证。这些部分通常可以直接迁移到自己的业务场景。

## 8. 如何迁移到自己的项目

迁移时建议按下面步骤做：

- 先把业务任务拆成 Agent、Environment、Session 三层：谁执行、在哪里执行、执行哪次任务。
- 把示例文件挂载替换成你的项目文件、CSV、日志、测试目录或 runbook。
- 为高风险动作加入人工审批，例如发 PR、修改生产配置、合并代码或发送外部消息。
- 保留 streaming event loop，用它做可观测性、调试和任务审计。

更具体地说，你需要替换：

- 示例中的输入数据或任务描述；
- API key、外部服务凭证或 MCP 配置；
- prompt、系统指令和输出格式；
- 文件路径、挂载目录或运行环境；
- 最终结果的验收标准，例如测试、人工审核或自动评估。

## 9. 局限与注意事项

这个 notebook 是教学示例，不应直接视为生产方案。需要特别注意：

- 环境资源未清理
- 文件挂载路径错误
- 长连接事件流中断
- 人工审批边界不清
- 生产凭证管理不当

此外还要补充：

- 错误处理和重试机制；
- 成本、延迟和速率限制监控；
- 敏感数据脱敏和权限审计；
- 对最终结果的自动化评估或人工复核；
- 对长任务的状态保存、恢复和超时处理。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例中的核心对象是什么？Agent、Session、Environment、Skill、Tool 分别承担什么职责？
- Claude 在流程中负责哪一部分？哪些部分由普通 Python 代码或外部服务完成？
- 示例输入是什么？最终输出是什么？中间经过了哪些可观察步骤？
- 如果迁移到自己的项目，最先要替换哪些路径、prompt、工具或凭证？
- 这个示例如果进入生产环境，最需要补哪些安全、评估和监控能力？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **人在环审批** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
