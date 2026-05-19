# 《Build a Slack data analyst bot with Claude Managed Agents》学习笔记：Slack 集成与数据分析 Bot

> 源 Notebook：`managed_agents/slack_data_bot.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Slack 集成与数据分析 Bot** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

Mention the bot with a CSV to get an analysis report in-thread, with multi-turn follow-ups on the same session.

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- Introduction
- What you'll learn
- Prerequisites
- 1. Start a session when the bot is mentioned
- 2. Relay progress and results to the thread
- 3. Handle follow-ups in the same session
- 4. Run the bot
- Next steps

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
import io
import os
import threading
from getpass import getpass

import requests
from anthropic import Anthropic
from dotenv import load_dotenv, set_key
from markdown_to_mrkdwn import SlackMarkdownConverter
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

load_dotenv(override=True)

# Prompt for Slack tokens on first run and save them to .env.
for key in ("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"):
    if not os.environ.get(key):
        os.environ[key] = getpass(f"{key}: ")
        set_key(".env", key, os.environ[key])

client = Anthropic()
app = App(token=os.environ["SLACK_BOT_TOKEN"])

for key in ("ANALYST_ENV_ID", "ANALYST_AGENT_ID", "ANALYST_AGENT_VERSION"):
    if not os.environ.get(key):
        raise RuntimeError(f"{key} not set. Run data_analyst_agent.ipynb first.")

# Set these from the IDs saved by the data analyst notebook. Reusing
# the agent and environment avoids re-provisioning on every bot restart.
ANALYST_AGENT = {
    "id": os.environ["ANALYST_AGENT_ID"],
    "version": int(os.environ["ANALYST_AGENT_VERSION"]),
}
ANALYST_ENV_ID = os.environ["ANALYST_ENV_ID"]

# thread_ts -> session_id, so follow-ups land in the same session.
# Sessions stay open for replies. In production, persist this and
# archive sessions when threads go stale.
thread_sessions: dict[str, str] = {}

mrkdwn = SlackMarkdownConverter()
```

这段代码对应 notebook 的第 3 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.2 核心函数 / 类定义：on_mention、start_analysis

```python
@app.event("app_mention")
def on_mention(event, say, ack):
    ack()
    channel = event["channel"]
    thread_ts = event.get("thread_ts") or event["ts"]
    # Mention text arrives as "<@BOTID> question"; drop the mention prefix.
    question = event["text"].split(">", 1)[-1].strip()
    slack_file = (event.get("files") or [None])[0]

    say(text="On it. Analyzing now.", thread_ts=thread_ts)
    # Run the slow work in a background thread so this handler
    # returns within Slack's 3s limit.
    threading.Thread(target=start_analysis, args=(channel, thread_ts, question, slack_file)).start()


def start_analysis(channel: str, thread_ts: str, question: str, slack_file: dict | None) -> None:
    try:
        # If the mention had a file attached, pull it from Slack and
        # re-upload to the Anthropic Files API so the session can mount it.
        resources = []
        if slack_file:
            resp = requests.get(
                slack_file["url_private"],
                headers={"Authorization": f"Bearer {app.client.token}"},
                timeout=30,
            )
            resp.raise_for_status()
            mime = slack_file.get("mimetype", "text/csv")
            uploaded = client.beta.files.upload(
                file=(slack_file["name"], io.BytesIO(resp.content), mime)
            )
            mount = "/mnt/session/uploads/data.csv"
            resources.append({"type": "file", "file_id": uploaded.id, "mount_path": mount})
            question += f"\n\nThe data is mounted at {mount}."

        # One session per Slack thread. Store the thread coordinates in
        # metadata so anyone reading the event stream knows where to reply.
        session = client.beta.sessions.create(
            environment_id=ANALYST_ENV_ID,
            agent={"type": "agent", **ANALYST_AGENT},
            resources=resources,
            # Titles are capped at 80 chars and can't contain Unicode
            # control/format characters (Slack sometimes inserts them).
            title="".join(c for c in question if c.isprintable())[:80],
            metadata={"slack_channel": channel, "slack_thread_ts": thread_ts},
        )
        thread_sessions[thread_ts] = session.id

        # Send the question as a user.message event. The agent starts
        # working immediately; relay_stream posts its progress to the thread.
        client.beta.sessions.events.send(
            session.id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": question}]}],
        )
        relay_stream(session.id, channel, thread_ts)
    except Exception as e:
        app.client.chat_postMessage(
            channel=channel, thread_ts=thread_ts, text=f"Analysis failed: {type(e).__name__}: {e}"
        )
```

这段代码对应 notebook 的第 5 个代码单元，核心关注点是 `on_mention、start_analysis`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.3 核心函数 / 类定义：relay_stream

```python
def relay_stream(session_id: str, channel: str, thread_ts: str) -> None:
    summary = ""
    posted_progress = False
    for ev in client.beta.sessions.events.stream(session_id):
        t = ev.type
        if t == "agent.message":
            # Keep the latest text block; it becomes the final summary.
            for b in ev.content:
                if b.type == "text" and b.text.strip():
                    summary = b.text
        elif t == "agent.tool_use" and not posted_progress:
            # Post a one-time progress update when the agent starts
            # running commands.
            app.client.chat_postMessage(
                channel=channel, thread_ts=thread_ts, text="Running analysis..."
            )
            posted_progress = True
        elif t == "session.status_idle":
            break
        elif t == "session.status_terminated":
            trace = f"https://platform.claude.com/sessions/{session_id}"
            app.client.chat_postMessage(
                channel=channel,
                thread_ts=thread_ts,
                text=f"Session terminated unexpectedly. Trace: {trace}",
            )
            return

    # Turn is done. Post the summary, then upload any generated files.
    if summary:
        text = mrkdwn.convert(summary)
        if len(text) > 3900:  # Slack text limit ~4000 chars
            text = text[:3900] + "\n_(truncated)_"
        app.client.chat_postMessage(channel=channel, thread_ts=thread_ts, text=text)
    outputs = client.beta.files.list(scope_id=session_id, betas=["managed-agents-2026-04-01"])
    for f in outputs.data:
        if not f.downloadable:
            continue
        content = client.beta.files.download(f.id).read()
        app.client.files_upload_v2(
            channel=channel, thread_ts=thread_ts, filename=f.filename, content=content
        )
```

这段代码对应 notebook 的第 7 个代码单元，核心关注点是 `relay_stream`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.4 核心函数 / 类定义：continue_session、on_thread_reply

```python
def continue_session(session_id: str, channel: str, thread_ts: str, text: str) -> None:
    try:
        client.beta.sessions.events.send(
            session_id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": text}]}],
        )
        relay_stream(session_id, channel, thread_ts)
    except Exception as e:
        app.client.chat_postMessage(
            channel=channel, thread_ts=thread_ts, text=f"Analysis failed: {type(e).__name__}: {e}"
        )


@app.event("message")
def on_thread_reply(event, ack):
    ack()
    thread_ts = event.get("thread_ts")
    # Only handle human replies in a thread where we already started
    # a session. Skip edits/deletes and other message subtypes.
    if event.get("subtype"):
        return
    if not thread_ts or event.get("bot_id") or thread_ts not in thread_sessions:
        return
    threading.Thread(
        target=continue_session,
        args=(thread_sessions[thread_ts], event["channel"], thread_ts, event["text"]),
    ).start()
```

这段代码对应 notebook 的第 9 个代码单元，核心关注点是 `continue_session、on_thread_reply`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Slack 集成与数据分析 Bot** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
