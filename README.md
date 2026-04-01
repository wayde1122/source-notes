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
| [anything-llm](./anything-llm/导读.md) | Node / React / Express | 全栈 RAG 应用 | 🔄 进行中 | 文档解析与分块、向量与检索、前后端与 collector 分工 |
| [learn-claude-code](./learn-claude-code/s01-Agent-Loop.md) | Python / TypeScript | 教程 + 最小实践 | 🔄 进行中 | Agent 循环、子 Agent、Skills、Compact、Task、团队协议（S01–S12）+ `practice/` 可运行示例 |

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
│   ├── 导读.md               # 总览与目录地图
│   ├── 文档解析流程.md
│   └── TextSplitter 分块策略.md
│
├── learn-claude-code/
│   ├── s01-Agent-Loop.md … s12-Worktree-Task-Isolation.md  # 与 Claude Code 能力点对应的概念串讲
│   └── practice/             # TypeScript 最小 Agent / SSE 等练习工程（见 package.json）
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
