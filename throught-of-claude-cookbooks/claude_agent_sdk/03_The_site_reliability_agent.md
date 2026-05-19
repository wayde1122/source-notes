# 《The site reliability agent》学习笔记：运维与事故响应 Agent

> 源 Notebook：`claude_agent_sdk/03_The_site_reliability_agent.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **运维与事故响应 Agent** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

Build an incident response agent with read-write MCP tools for autonomous diagnosis, remediation, and post-mortem documentation.

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- Introduction
- What you'll learn
- Prerequisites
- Step 0: Environment Setup
- Step 1: Generate Infrastructure Files
- Step 1a: Infrastructure Setup
- Step 1b: The MCP Server
- Architecture Overview
- Step 2: Infrastructure Tools — Docker & Config Management
- Infrastructure Tool Handlers

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
import sys
import shlex
import subprocess
import time
from typing import Any
from pathlib import Path

import httpx
from dotenv import load_dotenv

from claude_agent_sdk import (
    ClaudeAgentOptions,
    query,
    AssistantMessage,
    TextBlock,
    ToolUseBlock,
    ResultMessage,
)

load_dotenv()

if not os.environ.get("ANTHROPIC_API_KEY"):
    raise ValueError("ANTHROPIC_API_KEY not set. Add it to a .env file.")

MODEL = "claude-opus-4-6"
```

这段代码对应 notebook 的第 4 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.2 主执行流程与 API 调用

```python
infrastructure_tools = [
    {
        "name": "read_config_file",
        "description": (
            "Read a configuration file from the project. "
            "Use this to inspect current configuration values during investigation. "
            "Common files: "
            "config/api-server.env (DB_POOL_SIZE, timeouts, etc.), "
            "config/docker-compose.yml (service definitions and resource limits)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to config file (must be in config/ directory)",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "edit_config_file",
        "description": (
            "Edit a configuration file to fix misconfigurations. "
            "ONLY use this for remediation after confirming the root cause. "
            "Restricted to files in the config/ directory."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to config file (must be in config/ directory)",
                },
                "old_value": {
                    "type": "string",
                    "description": "The exact text to find and replace",
                },
                "new_value": {
                    "type": "string",
                    "description": "The new text to replace it with",
                },
            },
            "required": ["path", "old_value", "new_value"],
        },
    },
    {
        "name": "run_shell_command",
        "description": (
            "Run a shell command for infrastructure management. "
            "Restricted to docker-compose and docker commands only. "
            "Use for: restarting services, checking container status, rebuilding images."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command (must start with 'docker-compose' or 'docker')",
                },
            },
            "required": ["command"],
        },
    },
    {
        "name": "get_container_logs",
        "description": (
            "Get recent logs from a Docker container. "
            "Use this to look for error messages, stack traces, or unusual patterns. "
            "Valid containers: api-server, postgres, prometheus, traffic-generator."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "container": {"type": "string", "description": "Container name"},
                "lines": {
                    "type": "integer",
                    "description": "Number of log lines (default 50)",
                    "default": 50,
                },
            },
            "required": ["container"],
        },
    },
]
```

这段代码对应 notebook 的第 10 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.3 核心函数 / 类定义：read_config_file、edit_config_file、run_shell_command

```python
SRE_PROJECT_ROOT = os.getcwd()


async def read_config_file(path: str) -> dict[str, Any]:
    """Read a config file, restricted to the config/ directory."""
    full_path = Path(os.path.join(SRE_PROJECT_ROOT, path)).resolve()
    allowed_root = Path(SRE_PROJECT_ROOT, "config").resolve()
    if not full_path.is_relative_to(allowed_root):
        return {
            "content": [
                {"type": "text", "text": "Error: Can only read from config/ directory"}
            ],
            "isError": True,
        }
    with open(full_path, "r") as f:
        content = f.read()
    return {"content": [{"type": "text", "text": content}], "isError": False}


async def edit_config_file(path: str, old_value: str, new_value: str) -> dict[str, Any]:
    """Edit a config file by replacing old_value with new_value. Restricted to config/ directory."""
    full_path = Path(os.path.join(SRE_PROJECT_ROOT, path)).resolve()
    allowed_root = Path(SRE_PROJECT_ROOT, "config").resolve()
    if not full_path.is_relative_to(allowed_root):
        return {
            "content": [
                {
                    "type": "text",
                    "text": "Error: Can only edit files in config/ directory",
                }
            ],
            "isError": True,
        }
    with open(full_path, "r") as f:
        content = f.read()
    if old_value not in content:
        return {
            "content": [
                {"type": "text", "text": f"Error: '{old_value}' not found in {path}"}
            ],
            "isError": True,
        }
    new_content = content.replace(old_value, new_value, 1)
    with open(full_path, "w") as f:
        f.write(new_content)
    return {
        "content": [
            {
                "type": "text",
                "text": f"Updated {path}: replaced '{old_value}' with '{new_value}'",
            }
        ],
        "isError": False,
    }


async def run_shell_command(command: str) -> dict[str, Any]:
    """Run a shell command. Restricted to docker/docker-compose commands."""
    args = shlex.split(command)
    if not args or args[0] not in ("docker-compose", "docker"):
        return {
            "content": [
                {
                    "type": "text",
                    "text": "Error: Only docker and docker-compose commands are allowed",
                }
            ],
            "isError": True,
        }
    result = subprocess.run(
        args, capture_output=True, text=True, cwd=SRE_PROJECT_ROOT, timeout=60
    )
    output = result.stdout + result.stderr
    return {
        "content": [{"type": "text", "text": output or "(no output)"}],
        "isError": result.returncode != 0,
    }


async def get_container_logs(container: str, lines: int = 50) -> dict[str, Any]:
    """Get container logs. Validates container name against whitelist."""
    allowed = {"api-server", "postgres", "prometheus", "traffic-generator"}
    if container not in allowed:
        return {
            "content": [
                {"type": "text", "text": f"Error: Container must be one of {allowed}"}
            ],
            "isError": True,
        }
    result = subprocess.run(
        [
            "docker-compose",
            "-f",
            "config/docker-compose.yml",
            "logs",
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应 notebook 的第 12 个代码单元，核心关注点是 `read_config_file、edit_config_file、run_shell_command、get_container_logs`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.4 示例输入与运行入口

```python
MCP_SERVER_PATH = Path(SRE_PROJECT_ROOT) / "sre_mcp_server.py"
assert MCP_SERVER_PATH.exists(), f"MCP server not found at {MCP_SERVER_PATH}"

HOOKS_DIR = os.path.join(SRE_PROJECT_ROOT, "hooks")

options = ClaudeAgentOptions(
    system_prompt=SYSTEM_PROMPT,
    mcp_servers={
        "sre": {
            "command": sys.executable,
            "args": [str(MCP_SERVER_PATH)],
        }
    },
    allowed_tools=[
        # Investigation tools
        "mcp__sre__query_metrics",
        "mcp__sre__list_metrics",
        "mcp__sre__get_service_health",
        "mcp__sre__get_logs",
        "mcp__sre__get_alerts",
        "mcp__sre__get_recent_deployments",
        "mcp__sre__execute_runbook",
        # Remediation tools
        "mcp__sre__read_config_file",
        "mcp__sre__edit_config_file",
        "mcp__sre__run_shell_command",
        "mcp__sre__get_container_logs",
        # Documentation tools
        "mcp__sre__write_postmortem",
    ],
    hooks={
        "PreToolUse": [
            {
                "matcher": "mcp__sre__edit_config_file",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"bash {HOOKS_DIR}/validate_pool_size.sh",
                    }
                ],
            },
            {
                "matcher": "mcp__sre__run_shell_command",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"bash {HOOKS_DIR}/validate_config_before_deploy.sh",
                    }
                ],
            },
        ],
    },
    permission_mode="acceptEdits",
    model=MODEL,
)
```

这段代码对应 notebook 的第 25 个代码单元，核心关注点是 `示例输入与运行入口`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **运维与事故响应 Agent** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
