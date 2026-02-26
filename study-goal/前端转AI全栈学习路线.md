# 前端转 AI 全栈学习路线（补后端短板版）

> 作者：Wayde
> 创建时间：2026-02-26
> 状态：进行中

核心原则：**不是再做一堆新项目，而是用项目倒逼你理解每一层在干什么。**

---

## 学习进度

| 阶段 | 项目 | 周期 | 目标 | 状态 |
|------|------|------|------|------|
| 阶段 1 | learn-claude-code | 1-2 周 | 理解 Agent 原理 + Node.js 事件模型 | 🔄 学习中 |
| 阶段 2 | anything-llm | 2-3 周 | 手撕 RAG + 后端基础件 | ⏳ 计划中 |
| 阶段 3 | Flowise | 2-3 周 | 架构设计 + 数据建模 + 工作流 | ⏳ 计划中 |
| 阶段 4 | CopilotKit | 1-2 周 | 前后端打通 + 作品集 | ⏳ 计划中 |

---

## 阶段 1：拆开 Agent 黑盒（1-2 周）

**项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)** ★18k

从零实现一个类 Claude Code 的 AI Agent，代码量小，核心几百行 TypeScript。

### 学习目标

不是"再做一个 Agent"，而是理解这几个后端核心概念：

- **事件循环**：Agent 的 loop（接收 → 思考 → 工具调用 → 返回）本质就是后端的事件驱动模型，对照 Node.js 的 Event Loop 理解
- **流式响应**：Agent 的 streaming 输出背后是 SSE / WebSocket，手动用原生 `http` 模块实现一遍，不用框架
- **错误处理**：给 Agent loop 加上重试、超时、fallback 逻辑，理解后端的容错思维
- **进程管理**：理解为什么 OpenClaw 需要 pm2 / systemd，学习守护进程、信号处理（SIGTERM/SIGINT）

### 练习清单

- [ ] 通读源码，画出完整的调用链路图
- [ ] 不看源码，自己用原生 Node.js（不用框架）重写核心 Agent loop
- [ ] 加上日志中间件，记录每次 LLM 调用的耗时、token 数、错误信息
- [ ] 实现流式响应（SSE），用原生 `http` 模块，不用框架
- [ ] 加上信号处理（SIGTERM/SIGINT），理解优雅退出

### 源码阅读要点

```
核心 Agent Loop：
用户输入 → 构建 messages → 调用 LLM API → 解析响应
  ↓ 如果是工具调用
  执行工具 → 将结果加入 messages → 再次调用 LLM
  ↓ 如果是文本回复
  输出给用户 → 等待下一轮输入
```

重点关注：
1. messages 数组如何构建和管理
2. tool calling 的请求格式和响应解析
3. 流式输出的实现方式（SSE vs WebSocket）
4. 错误发生时如何重试和降级

---

## 阶段 2：手撕 RAG 管道（2-3 周）

**项目：[anything-llm](https://github.com/Mintplex-Labs/anything-llm)** ★55k

不是用它，而是参考它的架构，**手动实现一个最小 RAG**。

### 学习目标

理解 RAG 管道每一步的后端实现，不依赖 LangChain 等框架。

### RAG 管道全流程

```
文档上传 → 文本提取 → 分块 → Embedding → 存入向量库 → 查询 → 拼 Prompt → LLM 回答
```

### 每一步的实现要求

| 步骤 | 不用库手写 | 要理解的后端知识 |
|------|-----------|----------------|
| 文档上传 | `multer` 或原生 `multipart` 解析 | 文件流、Buffer、磁盘 IO |
| 文本分块 | 手写 `splitByTokens` | 编码、tokenizer 原理 |
| Embedding | 直接调 OpenAI API，不用 LangChain | HTTP 客户端、请求重试、速率限制 |
| 向量存储 | 先用 SQLite + 余弦相似度，再换 pgvector | SQL、索引、连接池 |
| API 层 | 原生 Express/Koa | 中间件模式、路由设计、认证 |

### 练习清单

- [ ] 对照 anything-llm 源码看它每一步怎么做的
- [ ] 自己从零实现最小 RAG，遇到问题再去看它的实现
- [ ] 实现 JWT 认证中间件（不用 passport 等库）
- [ ] 实现请求限流中间件（令牌桶或滑动窗口算法）
- [ ] 实现统一错误处理中间件
- [ ] 实现请求日志中间件（记录耗时、状态码、参数）
- [ ] 手写 SQL 完成向量存储的 CRUD（不用 ORM）
- [ ] 实现余弦相似度计算函数

### 源码阅读要点

anything-llm 的关键目录：
- `server/` — Node.js 后端，重点看 API 路由和中间件
- `server/utils/vectorDbProviders/` — 向量数据库抽象层
- `server/utils/EmbeddingEngines/` — Embedding 提供商抽象
- `collector/` — 文档收集和处理管道

---

## 阶段 3：理解工作流编排（2-3 周）

**项目：[Flowise](https://github.com/FlowiseAI/Flowise)** ★49k

纯 TypeScript/Node.js 全栈项目，重点不是拖拽 UI，而是学后端架构。

### 学习目标

- **数据建模**：看 Flowise 的数据库 schema 设计（TypeORM entities），理解关系型数据模型
- **队列与任务调度**：AI 请求是耗时操作，学习 Flowise 如何处理并发、队列、超时
- **抽象与接口**：看 Flowise 如何用统一接口对接几十种 LLM/向量库/工具，理解面向接口编程
- **配置驱动**：整个工作流是 JSON 描述的，理解"配置即代码"的后端思维

### 练习清单

- [ ] 本地部署 Flowise，用数据库工具直接看表结构
- [ ] 画出 Flowise 的数据库 ER 图
- [ ] 给 Flowise 写一个自定义 Node（自定义工具），走一遍插件开发流程
- [ ] 阅读 API 路由层，理解 RESTful 设计
- [ ] 分析 Flowise 的中间件链和错误处理流程
- [ ] 理解 TypeORM 的 Entity/Repository 模式，然后用原生 SQL 重写一个查询

### 源码阅读要点

Flowise 的关键目录：
- `packages/server/` — 后端核心，Express + TypeORM
- `packages/server/src/entity/` — 数据库模型定义
- `packages/server/src/routes/` — API 路由
- `packages/components/` — 所有可拖拽的 Node 组件（LLM、向量库、工具等）
- `packages/components/nodes/` — 每个 Node 如何实现统一接口

---

## 阶段 4：前端 AI 集成（1-2 周）

**项目：[CopilotKit](https://github.com/CopilotKit/CopilotKit)** ★29k

把前面学的后端知识和前端能力合起来，做一个完整作品。

### 学习目标

- 用 CopilotKit 给一个 React 项目加 AI 能力
- 但后端不用它的默认方案，而是**接你自己在阶段 2 写的 RAG 服务**
- 实现完整的前后端联调：前端组件 → API → 你的 RAG 后端 → LLM → 流式返回

### 练习清单

- [ ] 用 CopilotKit 的 React 组件搭建前端 AI 交互界面
- [ ] 将后端替换为自己在阶段 2 写的 RAG 服务
- [ ] 实现完整的流式响应（前端 SSE 消费 + 后端 SSE 推送）
- [ ] 加上用户认证和多会话管理
- [ ] 部署上线，作为作品集项目

### 最终交付物

一个完整的 AI 问答应用，包含：
- React 前端（CopilotKit 组件）
- Node.js 后端（自写 RAG 管道）
- 文档上传和管理
- 流式对话
- JWT 认证
- 请求日志和监控

---

## 贯穿所有阶段的后端基础

每个阶段都要刻意练习这些，不是"知道"，而是"手写过"：

| 技能 | 刻意练习方式 |
|------|------------|
| SQL | 不用 ORM，手写 JOIN、事务、索引优化 |
| HTTP | 不用 axios，用原生 `fetch` / `http` 模块，理解请求生命周期 |
| LLM API | 不用 LangChain，直接对接 OpenAI 兼容 API，理解 messages 格式、tool calling 协议 |
| 配置管理 | 不用 dotenv，理解环境变量、进程、12-Factor App |
| 错误处理 | 不依赖框架默认行为，手写全局错误中间件和重试逻辑 |
| 并发控制 | 理解连接池、队列、限流，手写简单实现 |

---

## 检验标准

学完后能回答这些问题：

1. **Agent 的 ReAct 循环是怎么工作的？** 不是"调 API"，而是能画出完整的消息流转图
2. **RAG 的向量检索为什么用余弦相似度？** 和欧氏距离有什么区别？什么场景用哪个？
3. **Express 中间件的执行顺序是什么？** 错误中间件为什么要四个参数？
4. **JWT 认证的完整流程？** token 存哪里？过期怎么处理？refresh token 怎么用？
5. **数据库连接池解决什么问题？** 连接数设多少合适？
6. **流式响应（SSE）和 WebSocket 有什么区别？** 什么场景用哪个？
7. **为什么需要进程管理器（pm2）？** 直接 `node app.js` 有什么问题？

能说清楚以上问题，面试时就能证明：**我不只是用 AI 工具搭过项目，我理解每一层在干什么、为什么这么设计、换一种方案有什么 tradeoff。**

---

## 推荐资料

- [Node.js 设计模式（第三版）](https://www.nodejsdesignpatterns.com/) — 系统理解 Node.js 后端开发
- [系统设计面试](https://book.douban.com/subject/35246417/) — 培养系统思维
- [OpenAI API 文档](https://platform.openai.com/docs/api-reference) — 理解 LLM API 协议
- [LangChain.js 文档](https://js.langchain.com/docs/) — 了解后再手写替代，理解更深
