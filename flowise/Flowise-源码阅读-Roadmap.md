# Flowise 源码阅读 Roadmap

## 1. 先建立全局地图

先不要一上来扎进某个业务文件，先把仓库当成一个 monorepo 看清楚。当前主干可以按下面理解：

- `packages/server`：后端入口、路由、控制器、服务编排、数据库、企业能力。
- `packages/components`：Flowise 的节点生态与运行时抽象，模型、向量库、工具、链路、Agent 能力大多从这里展开。
- `packages/ui`：管理后台与可视化工作台，包含路由、布局、状态管理、各业务页面。
- `packages/agentflow`：相对独立的 AgentFlow 画布/编辑器能力，偏前端基础设施与交互内核。
- `packages/api-documentation`：接口文档相关包，可放到靠后阅读。
- `docker`、`metrics`、`assets`：部署、监控、静态资源与辅助配置。

建议先建立一条总链路：

`UI 页面操作 -> Server routes -> controllers -> services -> components 节点运行时 -> 数据库 / 外部模型与工具 -> 返回 UI`

只要这条主链路看顺，后面读任何模块都不容易迷路。

## 2. 推荐阅读顺序

### 第一阶段：读仓库骨架与启动方式

先看这些文件，目的是知道项目如何被组织，而不是抠实现细节：

- `README.md`
- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`

这一阶段要回答的问题：

- 这是怎样的多包结构？
- 哪些包是运行时主角，哪些包是支撑层？
- 前后端与节点系统是如何拆开的？

### 第二阶段：先打通后端主线

优先读 `packages/server/src`，建议顺序如下：

1. `index.ts`
2. `commands/start.ts`
3. `AppConfig.ts`
4. `DataSource.ts`
5. `routes/index.ts`
6. `controllers/*`
7. `services/*`

这里不要平均用力，先抓主业务：

- `chatflows`
- `predictions`
- `nodes`
- `credentials`
- `chat-messages`
- `documentstore`
- `marketplaces`
- `tools`
- `variables`

这一层建议重点理解三件事：

- 路由是如何挂载的。
- controller 和 service 的职责边界是什么。
- 运行一次聊天/预测请求时，后端最终如何调到 `components` 包。

### 第三阶段：读 `components`，理解 Flowise 真正的能力来源

`packages/components` 是源码阅读最核心的一层。建议先读公共抽象，再读具体节点。

先读公共层：

- `src/index.ts`
- `src/Interface.ts`
- `src/handler.ts`
- `src/validator.ts`
- `src/modelLoader.ts`
- `src/storageUtils.ts`
- `src/httpSecurity.ts`
- `src/agentflowv2Generator.ts`

然后按节点家族读 `nodes/*`：

- `chatmodels` / `llms`：模型接入层。
- `embeddings` / `vectorstores` / `documentloaders` / `textsplitters`：RAG 主链路。
- `tools` / `utilities`：工具调用与系统集成。
- `chains` / `agents` / `multiagents` / `sequentialagents` / `agentflow`：编排能力与执行逻辑。
- `memory` / `cache` / `moderation` / `outputparsers`：运行时增强能力。

这一阶段的阅读目标不是把所有节点读完，而是先搞清楚“一个节点是怎么被定义、注册、配置、执行”的。

建议挑 3 条样本链路精读：

- 最简单对话链路：`chatmodels`
- 最常见 RAG 链路：`documentloaders -> textsplitters -> embeddings -> vectorstores -> chains`
- 最像产品能力编排的链路：`tools / agents / sequentialagents / agentflow`

### 第四阶段：回头读 UI，建立产品视角

`packages/ui/src` 建议这样读：

1. `index.jsx`
2. `App.jsx`
3. `layout/*`
4. `store/*`
5. `routes/*`
6. `views/*`

`views` 可以按业务重要度分批处理：

- 第一批：`chatflows`、`canvas`、`chatmessage`
- 第二批：`agentflows`、`agentflowsv2`、`assistants`
- 第三批：`credentials`、`docstore`、`datasets`、`tools`、`vectorstore`
- 第四批：`settings`、`apikey`、`users`、`roles`、`organization`、`workspace`
- 最后再看：`marketplaces`、`serverlogs`、`evaluations`、`evaluators`

UI 阅读时重点不是组件细节，而是：

- 页面如何向后端发请求。
- 画布类页面如何组织状态。
- 菜单、布局、权限、工作区这些横切能力如何接入。

### 第五阶段：单独攻克 `agentflow`

`packages/agentflow` 适合放在已有全局认识之后再读。推荐顺序：

1. `index.ts`
2. `Agentflow.tsx`
3. `AgentflowProvider.tsx`
4. `useAgentflow.ts`
5. `core/*`
6. `infrastructure/*`
7. `features/*`
8. `atoms/*`

其中要重点关注：

- `core/node-catalog`
- `core/node-config`
- `core/primitives`
- `infrastructure/api`
- `infrastructure/store`
- `features/canvas`
- `features/node-editor`
- `features/node-palette`
- `features/generator`

这个包本质上是在回答几个问题：

- 节点画布的状态模型是什么？
- 节点配置如何驱动表单与编辑器？
- 画布、节点面板、节点编辑器三者如何协作？

### 第六阶段：补数据库、企业能力与运维面

当主链路已经顺了，再补这些“侧面但很重要”的模块：

- `packages/server/src/database/entities`
- `packages/server/src/database/migrations/*`
- `packages/server/src/enterprise/*`
- `packages/server/src/metrics/*`
- `packages/server/src/queue/*`
- `docker/*`

这里主要看：

- 数据是如何落库的。
- 企业版能力是如何叠加在开源主链路之上的。
- 监控、队列、Worker、部署配置如何支撑生产运行。

## 3. 模块化阅读重点

### A. Server 模块

阅读重点：

- 启动流程
- 路由装配
- 控制器分发
- 服务编排
- 数据访问
- 企业扩展

适合重点跟踪的目录：

- `src/commands`
- `src/routes`
- `src/controllers`
- `src/services`
- `src/database`
- `src/enterprise`

### B. Components 模块

阅读重点：

- 节点抽象接口
- 节点执行入口
- 节点参数校验
- 模型/工具/向量库接入模式
- 多种节点家族之间的共性

适合重点跟踪的目录：

- `src`
- `nodes/chatmodels`
- `nodes/llms`
- `nodes/embeddings`
- `nodes/vectorstores`
- `nodes/documentloaders`
- `nodes/tools`
- `nodes/chains`
- `nodes/agents`
- `nodes/sequentialagents`
- `nodes/agentflow`

### C. UI 模块

阅读重点：

- 路由与布局
- 全局状态
- 业务页面
- 画布交互
- 配置表单

适合重点跟踪的目录：

- `src/layout`
- `src/store`
- `src/routes`
- `src/views`
- `src/ui-component`

### D. AgentFlow 模块

阅读重点：

- 画布核心模型
- 节点目录与过滤
- 节点配置系统
- API 适配层
- 编辑器与面板交互

适合重点跟踪的目录：

- `src/core`
- `src/infrastructure`
- `src/features`
- `src/atoms`

## 4. 三条实用阅读路线

### 路线一：想尽快看懂“用户一次提问是怎么跑起来的”

按这个顺序读：

1. `packages/ui/src/views/chatmessage`
2. `packages/ui/src/views/canvas` / `chatflows`
3. `packages/server/src/routes/predictions`
4. `packages/server/src/controllers/predictions`
5. `packages/server/src/services/predictions`
6. `packages/components/src/handler.ts`
7. 相关节点实现

### 路线二：想做新节点/新工具接入

按这个顺序读：

1. `packages/components/src/Interface.ts`
2. `packages/components/src/validator.ts`
3. `packages/server/src/services/nodes`
4. `packages/server/src/controllers/nodes`
5. `packages/components/nodes/*` 中找一个最相似的样例
6. UI 里对应的节点配置展示与表单页面

### 路线三：想看懂 AgentFlow 新画布体系

按这个顺序读：

1. `packages/agentflow/src/Agentflow.tsx`
2. `packages/agentflow/src/AgentflowProvider.tsx`
3. `packages/agentflow/src/useAgentflow.ts`
4. `packages/agentflow/src/core/*`
5. `packages/agentflow/src/features/canvas/*`
6. `packages/agentflow/src/features/node-editor/*`
7. `packages/agentflow/src/features/node-palette/*`

## 5. 阅读时建议同步产出的笔记

为了避免“读过但没沉淀”，建议每读完一层就补一份自己的图和表：

- 一张系统总链路图
- 一张 server 请求流转图
- 一张 components 节点抽象图
- 一张 UI 页面到 API 的映射表
- 一张 agentflow 画布状态图

每个模块至少回答 3 个问题：

- 它的输入是什么？
- 它的核心职责是什么？
- 它和上游/下游模块如何连接？

## 6. 最后给你的建议

Flowise 这种仓库不适合“从头到尾线性通读”。更高效的办法是：

1. 先建全局地图。
2. 再打通一条主业务链路。
3. 然后按模块深入。
4. 最后才补边角和企业能力。

如果按这个顺序读，整体会从“看目录”很快进入“看机制”，理解速度会快很多。
