# 开源源码学习笔记（Source Notes）

本仓库用于记录对各类优秀开源项目的源码学习与思考，重点关注系统架构、核心设计与实现原理。

作者：Wayde  
目标：通过阅读优秀源码，提升系统设计与工程能力。

**说明**：部分笔记中的「对照源码」路径为本地习惯用法（例如 Claude Code 解包仓库 `E:\claude-code-source-code`）；换机时请按你的实际克隆位置调整。

---

## 📚 已学习项目

| 项目 | 技术栈 | 类型 | 状态 | 学习重点 |
| ---- | ------ | ---- | ---- | -------- |
| nanobot | Python | AI Agent | ✅ 已完成 | 事件驱动、多渠道、工具系统、记忆 |
| [claude-code](./claude-code/README.md) | TypeScript / React(Ink) | CLI Agent（Anthropic 解包源码 v2.1.88） | 🔄 进行中 | 入口与 Bootstrap、QueryEngine/`query`、工具与权限、MCP、压缩、Bridge、遥测与远程策略 |
| [anything-llm](./anything-llm/导读.md) | Node / React / Express | 全栈 RAG 应用 | 🔄 进行中 | 文档解析、分块、Embedding、LanceDB、流式链路、请求校验 |
| [flowise](./flowise/Flowise-源码阅读-Roadmap.md) | TypeScript / React / Node | 可视化 AI Workflow / Agent 平台 | 🔄 进行中 | Monorepo 骨架、Server 主线、Components 节点系统、AgentFlow 画布、UI、企业能力 |
| [learn-claude-code](./learn-claude-code/s01-Agent-Loop.md) | Python / TypeScript | 教程 + 最小实践 | 🔄 进行中 | Agent 循环、子 Agent、Skills、Compact、Task、团队协议（S01–S12）+ `practice/` 可运行示例 |
| [throught-of-claude-cookbooks](./throught-of-claude-cookbooks/capabilities/contextual-embeddings-summary.md) | Claude / RAG / Eval / Agent Patterns | Cookbook 思路笔记 | 🔄 进行中 | Capabilities、Tool Use、Agent Patterns、Claude Agent SDK、Managed Agents、Multimodal、Third-party 集成 |

---

## 🧭 Claude Code 笔记快速导航

与 [claude-code](./claude-code/) 目录对应，建议顺序：

1. [README.md](./claude-code/README.md) — 阅读顺序说明  
2. [01-主体架构.md](./claude-code/01-主体架构.md) — 全局数据流与入口分层  
3. [02-模块设计.md](./claude-code/02-模块设计.md) — `src/` 一级地图  
4. [00-模块分篇索引.md](./claude-code/00-模块分篇索引.md) — 20 篇分模块正文目录  

**编号提示**：`01-主体架构` / `02-模块设计` 为总览；`01-入口Bootstrap与初始化`～`20-其他目录…` 为分模块深读，文件名并列出现属正常，以标题与索引为准。

**配套**：概念串讲与最小实现见 [learn-claude-code](./learn-claude-code/s01-Agent-Loop.md)（S01 起），可与 `claude-code` 分篇交叉对照。

---

## 🗺 当前内容覆盖

- [anything-llm](./anything-llm/导读.md)：已覆盖导读、文档解析流程、`TextSplitter` 分块策略、`stream.js` 聊天流式链路、`helpers` / `validatedRequest`、Native Embedding、LanceDB 检索。
- [flowise](./flowise/Flowise-源码阅读-Roadmap.md)：已按“仓库骨架 → Server 主线 → Components 节点系统 → UI 前端 → AgentFlow 画布 → 数据库与企业能力”六阶段展开。
- [throught-of-claude-cookbooks](./throught-of-claude-cookbooks/capabilities/contextual-embeddings-summary.md)：当前已整理 `capabilities`、`tool_use`、`patterns`、`claude_agent_sdk`、`managed_agents`、`multimodal`、`third_party` 等 Cookbook 主题笔记。

---

## 🎯 学习路线

| 路线 | 目标 | 状态 |
| ---- | ---- | ---- |
| [前端转 AI 全栈](./study-goal/前端转AI全栈学习路线.md) | 补后端短板，从 Agent 原理到 RAG 实战到企业级架构 | 🔄 进行中 |

状态说明：

- ⏳ 计划中
- 🔄 学习中
- ✅ 已完成

---

## 🧠 学习关注点

在阅读源码时，重点关注：

- 整体架构设计
- 核心模块划分
- 主执行流程
- 关键数据结构
- 设计模式与思想
- 性能优化与取舍

---

## 📂 仓库结构

```
source-notes/
├── nanobot/
│   ├── 01-项目概览.md        # 基本信息、技术栈、目录结构
│   ├── 02-架构设计.md        # 整体架构、设计模式、数据流
│   ├── 03-核心引擎.md        # AgentLoop、ReAct 循环、记忆压缩
│   ├── 04-上下文与记忆.md    # ContextBuilder、MemoryStore、SkillsLoader
│   ├── 05-工具系统.md        # Tool 基类、注册表、9 个内置工具
│   ├── 06-渠道层.md          # BaseChannel、ChannelManager、9 个渠道
│   ├── 07-LLM提供商.md      # ProviderSpec、注册表、LiteLLM
│   └── 08-总结与思考.md      # 设计亮点、取舍、可借鉴模式
│
├── claude-code/              # @anthropic-ai/claude-code 解包源码（v2.1.88）阅读笔记
│   ├── README.md
│   ├── 00-模块分篇索引.md
│   ├── 01-主体架构.md、02-模块设计.md
│   └── 分模块 01～20（入口/QueryEngine/工具/MCP/…，见索引）
│
├── anything-llm/
│   ├── 导读.md                         # 总览与目录地图
│   ├── 文档解析流程.md
│   ├── TextSplitter 分块策略.md
│   ├── stream.js 聊天流式链路.md
│   ├── helpers与validatedRequest详解.md
│   ├── Native Embedding 引擎.md
│   └── LanceDB 向量存储与检索.md
│
├── flowise/
│   ├── Flowise-源码阅读-Roadmap.md     # 总体阅读路线
│   ├── 阶段一-仓库骨架与启动方式.md
│   ├── 阶段二-后端主线-Server包.md
│   ├── 阶段三-Components节点系统.md
│   ├── 阶段四-UI前端视角.md
│   ├── 阶段五-AgentFlow画布体系.md
│   └── 阶段六-数据库企业能力与运维.md
│
├── learn-claude-code/
│   ├── s01-Agent-Loop.md … s12-Worktree-Task-Isolation.md  # 与 Claude Code 能力点对应的概念串讲
│   └── practice/             # TypeScript 最小 Agent / SSE 等练习工程（见 package.json）
│
├── throught-of-claude-cookbooks/
│   ├── capabilities/                     # Classification、Contextual Embeddings、RAG、摘要、知识图谱、Text-to-SQL
│   ├── tool_use/                         # 结构化 JSON、工具选择、并行工具、记忆、威胁情报等 Tool Use 笔记
│   ├── patterns/                         # Basic Workflows、Evaluator-Optimizer、Orchestrator-Workers
│   ├── claude_agent_sdk/                 # Claude Agent SDK 示例与迁移笔记
│   ├── managed_agents/                   # Claude Managed Agents 任务编排与生产实践
│   ├── multimodal/                       # Vision、多模态、图表/PPT 读取与子 Agent
│   ├── third_party/                      # LlamaIndex、Pinecone、MongoDB、Deepgram、ElevenLabs 等集成
│   ├── misc/                             # Batch、Evals、JSON mode、Prompt caching、Citations 等杂项
│   ├── coding/                           # 前端审美提示词
│   ├── extended_thinking/                # Extended thinking 与工具调用
│   ├── finetuning/                       # Bedrock finetuning
│   ├── observability/                    # Usage cost API
│   ├── skills/                           # Skills notebook 笔记
│   └── tool_evaluation/                  # Tool evaluation
│
├── sigma/                    # 预留目录（当前为空，可放 Sigma/其他主题笔记）
│
├── study-goal/
│   └── 前端转AI全栈学习路线.md  # 4 阶段学习路线：Agent → RAG → 工作流 → 全栈作品
│
└── README.md
```

每个项目包含：

- 项目解决什么问题
- 架构与模块关系
- 核心流程分析
- 关键实现细节
- 个人理解与总结

---

## 📈 学习方法

1. 阅读官方文档，了解整体设计
2. 找到核心模块入口
3. 跟踪主流程执行路径
4. 绘制架构或流程图
5. 输出总结与设计思考

---

## 🎯 建立本仓库的目的

- 学习优秀开源项目的设计思想
- 提升系统架构能力
- 构建长期可复用的技术知识库
- 记录个人技术成长路径

---
