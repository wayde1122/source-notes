# 《The chief of staff agent》学习笔记：Claude Agent SDK 工程实践

> 源 Notebook：`claude_agent_sdk/01_The_chief_of_staff_agent.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Claude Agent SDK 工程实践** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

Build multi-agent systems with subagents, hooks, output styles, and plan mode features.

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- Introduction
- Scenario
- Basic Features
- Feature 0: Memory with [CLAUDE.md](https://www.anthropic.com/engineering/claude-code-best-practices)
- Understanding Agent Data Source Preferences
- Feature 1: The Bash tool for Python Script Execution
- Feature 2: Output Styles
- Feature 3: Plan Mode - Strategic Planning Without Execution
- Executing the Saved Plan
- How Plan Persistence Works

## 3. 核心概念

### Claude Agent SDK

用于把 Claude 封装成可编程 Agent 的 SDK。阅读时重点看它如何组织工具、会话、系统提示、事件流和外部资源。

### Agent

Agent 是带有目标、指令和工具边界的执行单元。notebook 通常通过一个具体任务展示 Agent 如何接收任务并持续工作。

### Tools / MCP

工具和 MCP 负责把 Agent 连接到外部世界，例如 WebSearch、文件系统、GitHub、监控系统或自定义服务。

### Session

Session 表示一次可追踪的任务上下文。它让 Agent 的过程、状态和输出可以被记录、恢复或查看。

### Hooks / Subagents

部分示例会展示 hooks、子 Agent 或多 Agent 分工，用来把复杂流程拆成更可控的执行单元。

### By the end of this cookbook, you'll be able to:

这是 notebook 中显式出现的主题，代表该示例的一个关键学习节点。阅读时应结合对应代码单元理解它如何参与 `Claude Agent SDK 工程实践`。

### Building Your First Research Agent

这是 notebook 中显式出现的主题，代表该示例的一个关键学习节点。阅读时应结合对应代码单元理解它如何参与 `Claude Agent SDK 工程实践`。

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
from dotenv import load_dotenv
from utils.agent_visualizer import (
    display_agent_response,
    print_activity,
    reset_activity_context,
    visualize_conversation,
)

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

load_dotenv()

# Define the model to use throughout this notebook
# Using Opus 4.6 for its superior planning and reasoning capabilities
MODEL = "claude-opus-4-6"
print(f"📋 Notebook configured to use: {MODEL}")
```

这段代码对应 notebook 的第 1 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
📋 Notebook configured to use: claude-opus-4-6
```
### 5.2 主执行流程与 API 调用

```python
messages = []
async with ClaudeSDKClient(
    options=ClaudeAgentOptions(
        model=MODEL,
        allowed_tools=["Bash", "Read"],
        cwd="chief_of_staff_agent",  # Points to subdirectory where our agent is defined
    )
) as agent:
    await agent.query(
        "Use your simple calculation script with a total runway of 2904829 and a monthly burn of 121938."
    )
    async for msg in agent.receive_response():
        print_activity(msg)
        messages.append(msg)

# Display the response with HTML rendering
display_agent_response(messages)
```

这段代码对应 notebook 的第 8 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
🤖 Using: Glob()
🤖 Using: Glob()
🤖 Using: Glob()
✓ Tool completed
✓ Tool completed
✓ Tool completed
🤖 Thinking...
🤖 Using: Read()
✓ Tool completed
🤖 Thinking...
🤖 Using: Bash()
✓ Tool completed
🤖 Thinking...

<IPython.core.display.HTML object>
```
### 5.3 核心函数 / 类定义：extract_plan_from_xml、extract_plan_from_messages、extract_plan_from_write_tool

```python
# =============================================================================
# Plan Mode Helper Functions
# =============================================================================
# These utilities handle the various ways an agent might output its plan.
# Since agents can output plans via direct text, Write tool, or Claude's
# internal plan directory, we need robust extraction from multiple sources.

import glob as glob_module
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any


def extract_plan_from_xml(text: str | None, min_length: int = 200) -> str | None:
    """
    Extract content between <plan> tags from text.

    Args:
        text: The text to search for plan content
        min_length: Minimum character count for valid plan (prevents empty matches)

    Returns:
        Extracted plan content, or None if not found/too short
    """
    if not text:
        return None
    match = re.search(r"<plan>(.*?)</plan>", text, re.DOTALL)
    if match:
        extracted = match.group(1).strip()
        if len(extracted) > min_length:
            return extracted
    return None


def extract_plan_from_messages(
    plan_content: list[str], min_fallback_length: int = 500
) -> tuple[str | None, str | None]:
    """
    Try to extract plan from captured message stream content.

    Args:
        plan_content: List of text blocks captured during streaming
        min_fallback_length: Minimum length for fallback (no XML tags)

    Returns:
        Tuple of (plan_text, source_description)
    """
    combined_text = "\n\n".join(plan_content)

    # First try: XML tags
    plan = extract_plan_from_xml(combined_text)
    if plan:
        return plan, "message stream"

    # Fallback: Use raw content if substantial
    if len(combined_text.strip()) > min_fallback_length:
        return combined_text.strip(), "full message content (fallback)"

    return None, None


def extract_plan_from_write_tool(
    write_contents: list[str], min_fallback_length: int = 500
) -> tuple[str | None, str | None]:
    """
    Try to extract plan from captured Write tool calls.

    Args:
        write_contents: List of content strings from Write tool calls
        min_fallback_length: Minimum length for fallback (no XML tags)

    Returns:
        Tuple of (plan_text, source_description)
    """
    for content in write_contents:
        # Try XML extraction first
        plan = extract_plan_from_xml(content)
        if plan:
            return plan, "Write tool capture"

        # Fallback: substantial content without tags
        if content and len(content.strip()) > min_fallback_length:
            return content.strip(), "Write tool capture (no XML tags)"

    return None, None


def extract_plan_from_claude_dir(
    max_age_seconds: int = 300, min_fallback_length: int = 500
) -> tuple[str | None, str | None]:
    """
    Check Claude's internal plan directory for recently created plans.

# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应 notebook 的第 14 个代码单元，核心关注点是 `extract_plan_from_xml、extract_plan_from_messages、extract_plan_from_write_tool、extract_plan_from_claude_dir`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
✅ Plan Mode helper functions loaded
```
### 5.4 主执行流程与 API 调用

```python
# =============================================================================
# Execute Plan Mode Agent
# =============================================================================
# Run the agent with plan mode enabled. The agent will create a detailed plan
# but won't execute any actions. We capture content from multiple sources
# to handle different agent behaviors.

# Initialize capture lists
messages = []
plan_content = []  # Text from message stream
write_tool_content = []  # Content from Write tool calls
write_tool_paths = []  # Paths from Write tool calls

# Run the agent in plan mode
async with ClaudeSDKClient(
    options=ClaudeAgentOptions(
        model=MODEL,
        permission_mode="plan",
        cwd="chief_of_staff_agent",
    )
) as agent:
    await agent.query(PLAN_PROMPT)
    async for msg in agent.receive_response():
        print_activity(msg)
        messages.append(msg)

        # Capture content from this message
        capture_message_content(msg, plan_content, write_tool_content, write_tool_paths)

print(f"\n✅ Agent completed. Captured {len(plan_content)} content blocks.")
```

这段代码对应 notebook 的第 16 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

这段代码在 notebook 中产生了示例输出，关键输出片段可以概括为：

```text
🤖 Thinking...
🤖 Using: ExitPlanMode()
✓ Tool completed
🤖 Thinking...

✅ Agent completed. Captured 3 content blocks.
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

- 把 notebook 中的任务描述替换为你的真实业务任务，例如研究、排障、代码审查或安全分析。
- 保留 Agent 初始化、工具配置和主执行循环，替换工具权限与 MCP 服务。
- 如果涉及外部系统，先明确 Agent 只读/读写边界，避免默认给过高权限。
- 将示例输出改为你项目需要的结构化结果，例如报告、Issue、PR、告警摘要或审计记录。

更具体地说，你需要替换：

- 示例中的输入数据或任务描述；
- API key、外部服务凭证或 MCP 配置；
- prompt、系统指令和输出格式；
- 文件路径、挂载目录或运行环境；
- 最终结果的验收标准，例如测试、人工审核或自动评估。

## 9. 局限与注意事项

这个 notebook 是教学示例，不应直接视为生产方案。需要特别注意：

- 工具权限过大
- 外部系统认证失败
- 长任务上下文膨胀
- Agent 行为不可观测
- 缺少任务完成标准

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Claude Agent SDK 工程实践** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
