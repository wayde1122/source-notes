# 《Building a session browser》学习笔记：会话管理与浏览

> 源 Notebook：`claude_agent_sdk/05_Building_a_session_browser.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **会话管理与浏览** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

List, read, rename, tag, and fork Agent SDK sessions on disk to build a conversation history sidebar without writing a transcript parser.

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- Prerequisites
- Setup
- Build the session list
- Read a session's messages
- Rename a session
- Tag and filter
- Branch from an existing conversation
- Resume the fork into a live query
- Where to go next

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
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

MODEL = "claude-haiku-4-5"

# All demo sessions live under this project directory. Using a dedicated
# cwd keeps the demo isolated from your real Claude Code sessions.
# Note: this path resolves relative to the kernel's working directory
# (claude_agent_sdk/ when launched per the README).
DEMO_DIR = str(Path("session_browser_demo").resolve())
os.makedirs(DEMO_DIR, exist_ok=True)
print(f"Demo project dir: {DEMO_DIR}")
```

这段代码对应 notebook 的第 5 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.2 核心函数 / 类定义：run_one_turn

```python
from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query


async def run_one_turn(prompt: str) -> str:
    """Run a single-turn conversation and return its session_id."""
    opts = ClaudeAgentOptions(
        model=MODEL,
        cwd=DEMO_DIR,
        max_turns=1,
        allowed_tools=[],  # text-only, no tool loop
    )
    session_id = None
    async for msg in query(prompt=prompt, options=opts):
        if isinstance(msg, ResultMessage):
            session_id = msg.session_id
            preview = (msg.result or "")[:80]
            print(f"[{session_id[:8]}] {preview}...")
    if session_id is None:
        raise RuntimeError("No ResultMessage received; check API key and SDK version.")
    return session_id
```

这段代码对应 notebook 的第 7 个代码单元，核心关注点是 `run_one_turn`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.3 主执行流程与 API 调用

```python
prompts = [
    "Give me three name ideas for a CLI tool that manages git worktrees.",
    "Explain the difference between a mutex and a semaphore in one paragraph.",
    "Write a haiku about merge conflicts.",
]

demo_session_ids = []
for p in prompts:
    sid = await run_one_turn(p)
    demo_session_ids.append(sid)

print(f"\nCreated {len(demo_session_ids)} sessions.")
```

这段代码对应 notebook 的第 9 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.4 主执行流程与 API 调用

```python
resume_opts = ClaudeAgentOptions(
    model=MODEL,
    cwd=DEMO_DIR,
    max_turns=1,
    allowed_tools=[],
    resume=fork.session_id,
)

async for msg in query(
    prompt="Those were okay. Give me three more names, but punnier.",
    options=resume_opts,
):
    if isinstance(msg, ResultMessage):
        print(f"[fork {fork.session_id[:8]} resumed]")
        print(msg.result)
```

这段代码对应 notebook 的第 25 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **会话管理与浏览** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
