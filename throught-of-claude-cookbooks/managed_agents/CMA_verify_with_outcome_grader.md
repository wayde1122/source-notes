# 《Outcomes: agents that verify their own work》学习笔记：Claude Managed Agents 托管式 Agent 实践

> 源 Notebook：`managed_agents/CMA_verify_with_outcome_grader.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Claude Managed Agents 托管式 Agent 实践** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

Build a grade-and-revise loop with Outcomes: a writer drafts a cited research brief, a stateless grader fetches every URL and checks every quote against a rubric, and feedback drives revisions until the brief passes. Covers user.define_outcome, the span.outcome_evaluation_* events, and how to write a rubric the grader can act on.

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- What you'll learn
- 1. Set up the environment
- 2. Create the writer and start a session
- 3. Write a rubric the grader can act on
- 4. Watch the review loop
- What just happened
- 5. Read the final brief
- What you learned

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
import os
import re
import time

import anthropic
from dotenv import load_dotenv

load_dotenv()

BETAS = ["managed-agents-2026-04-01"]
MODEL = os.environ.get("COOKBOOK_MODEL", "claude-sonnet-4-6")
client = anthropic.Anthropic()
```

这段代码对应 notebook 的第 4 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.2 主执行流程与 API 调用

```python
env = client.beta.environments.create(
    name="research-brief",
    config={"type": "anthropic_cloud", "networking": {"type": "unrestricted"}},
)

writer = client.beta.agents.create(
    name="Research Analyst",
    model=MODEL,
    system="""You are a research analyst. You write one-page business briefs.

Cite every factual claim with an inline footnote [n]. End the brief with a Sources section in this exact format, one entry per line:

[n] "verbatim quote from the page, 25 words or fewer" - Title - URL

Only cite pages you actually fetched and read. The quote must be copied character-for-character from the page. Cite no more than 6 sources total. Pick the strongest; do not pad. Save the brief to /mnt/session/outputs/brief.md.""",
    tools=[
        {
            "type": "agent_toolset_20260401",
            "configs": [
                {"name": "web_search"},
                {"name": "web_fetch"},
                {"name": "read"},
                {"name": "write"},
            ],
        }
    ],
    betas=BETAS,
)

session = client.beta.sessions.create(
    agent={"type": "agent", "id": writer.id, "version": writer.version},
    environment_id=env.id,
    title="Brief: EV fast-charging unit economics",
    betas=BETAS,
)
print(f"Session {session.id}")
```

这段代码对应 notebook 的第 6 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
Session sesn_011CakRYQjc4NMXdRy4qKZy5
```
### 5.3 主执行流程与 API 调用

```python
TERMINAL = {"satisfied", "max_iterations_reached", "failed", "interrupted"}
t0, res, iters = time.time(), None, 0
n_search, last_len = 0, 0

with client.beta.sessions.events.stream(session.id, betas=BETAS) as stream:
    for ev in stream:
        if ev.type == "agent.tool_use":
            if ev.name in ("web_search", "web_fetch"):
                n_search += 1
            if ev.name == "write" and ev.input["file_path"].endswith("brief.md"):
                last_len = len(ev.input["content"])
        elif ev.type == "span.outcome_evaluation_start":
            banner("writer · " + ("draft" if iters == 0 else f"revision {iters}"))
            print(f"searched/fetched {n_search}× · wrote brief.md ({last_len:,} chars)")
            n_search = 0
        elif ev.type == "span.outcome_evaluation_end":
            res = ev.result
            banner(
                f"grader · pass {iters}",
                "✓ satisfied" if res == "satisfied" else "⟳ needs_revision",
            )
            render_feedback(ev.explanation)
            iters += 1
            if res in TERMINAL:
                break

m, s = divmod(int(time.time() - t0), 60)
print(f"\ndone: {res} after {iters} pass{'es' if iters != 1 else ''} · {m}m {s:02d}s")
```

这段代码对应 notebook 的第 13 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
writer · draft
searched/fetched 18× · wrote brief.md (7,607 chars)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
grader · pass 0  ⟳ needs_revision
The brief covers 5 of 7 required topics adequately. Item 2 (Demand charges) fails the quantification bar: the brief describes demand charges qualitatively as the 'single largest operational wildcard' but never states a $/kW figure (McKinsey's footnote of $20/kW is never quoted in the text) or a % of operating cost. Item 5 (Named operator) fails the citation requirement: EVgo's Q1 2024 net loss of $28.2M is cited to evchargingstations.com [6], a third-party news article, not an SEC filing from sec.gov as the rubric explicitly requires. All 6 citations are LIVE, and all 6 quoted strings match the fetched pages and support the claims they are attached to — but [6] is the wrong source type for the Named Operator criterion.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
writer · revision 1
searched/fetched 6× · wrote brief.md (7,989 chars)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
grader · pass 1  ⟳ needs_revision
...
```
### 5.4 主执行流程与 API 调用

```python
# Reconstruct the final brief from the event log: full content on `write`,
# then apply each `edit` (old_string -> new_string) in order.
content = ""
for ev in client.beta.sessions.events.list(session.id, limit=1000, betas=BETAS):
    if ev.type != "agent.tool_use" or "brief.md" not in str(ev.input.get("file_path", "")):
        continue
    if ev.name == "write":
        content = ev.input["content"]
    elif ev.name == "edit":
        content = content.replace(ev.input["old_string"], ev.input["new_string"], 1)

# Show the structure and sources rather than the full prose.
for line in content.splitlines():
    if line.startswith(("#", "[")):
        print(line)
```

这段代码对应 notebook 的第 16 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
# Unit Economics of Public DC Fast Charging in the United States
## 1. Capex Range
## 2. Demand Charges
## 3. Utilization Breakeven
## 4. Subsidy Programs
## 5. Named-Operator Economics
## 6. Contrarian / Skeptical View
## 7. Hardware vs. Installation Cost Split
## Sources
[1] "A 150 to 350kW DCFC charging unit can cost anywhere from $45,000 to over $100,000, and installation costs can range from $40,000 to over $150,000." - Can public EV fast-charging stations be profitable in the United States? - https://www.mckinsey.com/features/mckinsey-center-for-future-mobility/our-insights/can-public-ev-fast-charging-stations-be-profitable-in-the-united-states
[2] "Waiving demand charges for fast chargers will shift costs to all ratepayers, including non-EV drivers." - Fast charging, high costs: Eliminating demand charges won't solve the problem - https://www.utilitydive.com/news/eliminating-demand-charges-wont-solve-EV-station-problems/689395/
...
```

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Claude Managed Agents 托管式 Agent 实践** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
