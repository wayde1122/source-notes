# 第二阶段：打通后端主线（packages/server）

## 阶段目标

理解后端服务的完整启动过程、路由装配方式、Controller 与 Service 的职责边界，以及一次预测请求是如何从 HTTP 入口流转到 `components` 节点运行时的。

---

## 一、目录结构速览

```
packages/server/src/
├── index.ts                 ← App 类，核心启动与配置
├── AppConfig.ts             ← 全局配置（目前仅 showCommunityNodes）
├── DataSource.ts            ← 数据库连接初始化（支持 4 种数据库）
├── NodesPool.ts             ← 节点池（加载所有 components 节点）
├── CachePool.ts             ← 节点实例缓存池
├── AbortControllerPool.ts   ← 请求中止控制器池
├── IdentityManager.ts       ← 身份与许可证管理
├── SSEStreamer.ts（utils/） ← Server-Sent Events 流式输出
├── UsageCacheManager.ts     ← 用量缓存管理
├── commands/
│   ├── base.ts              ← BaseCommand 抽象类
│   └── start.ts             ← 启动命令（入口）
├── routes/
│   └── index.ts             ← 所有路由统一装配
├── controllers/             ← 各业务域 controller
├── services/                ← 各业务域 service
├── database/
│   ├── entities/            ← TypeORM 实体定义
│   └── migrations/          ← 各数据库 migration 脚本
├── enterprise/              ← 企业版扩展能力
├── middlewares/             ← 错误处理等中间件
├── metrics/                 ← Prometheus / OpenTelemetry
├── queue/                   ← BullMQ 任务队列
└── utils/                   ← 工具函数（logger、SSE、限流、XSS 等）
```

---

## 二、App 初始化流程（index.ts）

### 2.1 App 类核心成员

```typescript
class App {
    app: express.Application       // Express 实例
    nodesPool: NodesPool           // 节点池（所有可用节点的注册表）
    abortControllerPool            // 用于中止正在进行的推理请求
    cachePool: CachePool           // 节点实例 LRU 缓存
    telemetry: Telemetry           // 匿名使用统计
    rateLimiterManager             // 速率限制
    AppDataSource: DataSource      // TypeORM 数据源
    sseStreamer: SSEStreamer        // SSE 流式输出管理
    identityManager: IdentityManager // 身份/许可证/平台类型
    metricsProvider               // Prometheus 或 OpenTelemetry
    queueManager: QueueManager     // BullMQ 队列管理（QUEUE 模式）
    redisSubscriber               // Redis 事件订阅（QUEUE 模式）
    usageCacheManager             // 用量缓存
}
```

### 2.2 `initDatabase()` 顺序（按代码执行先后）

```
1. AppDataSource.initialize()        → 数据库连接建立
2. AppDataSource.runMigrations()     → 执行待跑的迁移脚本
3. IdentityManager.getInstance()     → 初始化身份/许可证管理
4. new NodesPool() + .initialize()   → 扫描并注册所有节点
5. new AbortControllerPool()         → 初始化中止控制器池
6. getEncryptionKey()                → 获取/生成加密密钥
7. initAuthSecrets()                 → 初始化认证密钥（环境变量/AWS SM/文件系统）
8. RateLimiterManager.getInstance()  → 初始化速率限制
9. new CachePool()                   → 初始化节点缓存池
10. UsageCacheManager.getInstance()  → 初始化用量缓存
11. new Telemetry()                  → 初始化遥测
12. new SSEStreamer() + 心跳启动     → 初始化 SSE 流
13. [QUEUE 模式] QueueManager 队列装配 + Redis 订阅者连接
```

### 2.3 `config()` 中间件装配顺序

```
1. express.json({ limit: FLOWISE_FILE_SIZE_LIMIT })    → 请求体解析（默认 50mb）
2. express.urlencoded(...)                              → URL 编码解析
3. app.set('trust proxy', ...)                          → 代理信任配置
4. cors(getCorsOptions())                               → CORS 控制
5. cookieParser()                                       → Cookie 解析
6. CSP 头部设置（iframe 嵌入控制）
7. 关闭 X-Powered-By 响应头
8. expressRequestLogger                                 → 请求日志
9. sanitizeMiddleware                                   → XSS 防护
10. initializeJwtCookieMiddleware()                     → JWT Cookie 认证初始化
11. 认证中间件（白名单 / internal 标记 / API Key / JWT 验证）
12. 路由挂载 /api/v1 → flowiseApiV1Router
13. 静态资源服务（UI 前端文件）
14. 错误处理中间件
```

---

## 三、DataSource.ts：数据库支持矩阵

| 数据库类型 | 端口默认 | 备注 |
|-----------|---------|------|
| SQLite | 文件型 | 默认类型，存储在 `~/.flowise/database.sqlite` |
| MySQL | 3306 | charset: utf8mb4，支持 SSL |
| MariaDB | 3306 | charset: utf8mb4，支持 SSL |
| PostgreSQL | 5432 | 高级日志，连接池 idleTimeout=120s |

> `synchronize: false` + `migrationsRun: false`：所有表结构变更通过 Migration 脚本管理，不自动同步。

---

## 四、路由系统（routes/index.ts）

### 4.1 路由总览（核心业务）

| 路由前缀 | 业务域 |
|---------|-------|
| `/chatflows` | ChatFlow CRUD |
| `/chatmessage` | 消息记录 |
| `/predictions` | 公开推理（外部调用） |
| `/internal-prediction` | 内部推理（画布测试） |
| `/nodes` | 节点列表与信息 |
| `/credentials` | 凭证管理 |
| `/document-store` | 文档存储（RAG） |
| `/tools` | 工具定义 |
| `/variables` | 环境变量 |
| `/marketplaces` | 模板市场 |
| `/assistants` | OpenAI Assistant |
| `/vectors` | 向量相关操作 |
| `/evaluations` | 评估（企业特性守门） |
| `/datasets` | 数据集（企业特性守门） |

### 4.2 企业版路由

```
/auth          → 登录/注册/登出
/users         → 用户管理
/organization  → 组织管理
/roles         → 角色与权限
/workspace     → 工作区管理
/audit         → 操作审计
/account       → 账号管理
/login-method  → SSO 配置
```

### 4.3 特性守门模式

部分路由使用 `IdentityManager.checkFeatureByPlan()` 中间件做企业版功能门控：

```javascript
router.use('/datasets',    IdentityManager.checkFeatureByPlan('feat:datasets'), datasetRouter)
router.use('/evaluations', IdentityManager.checkFeatureByPlan('feat:evaluations'), evaluationsRouter)
```

---

## 五、Controller 与 Service 的职责边界

```
HTTP 请求
    │
    ▼
Router（挂载路由、可选中间件）
    │
    ▼
Controller（接收 req/res，提取参数，调用 Service，返回响应）
    │
    ▼
Service（业务逻辑，调用 DataSource / NodesPool / components / 外部 API）
    │
    ├─→ 数据库操作（TypeORM Repository）
    ├─→ NodesPool（获取节点实现类）
    └─→ components 包（执行节点逻辑）
```

**Controller 职责**：
- 提取路径参数、查询参数、请求体
- 调用对应 Service 方法
- 将结果写入 `res.json()` 或 `res.status().json()`
- 异常转换（try/catch → 标准错误响应）

**Service 职责**：
- 业务规则与编排逻辑
- 数据库 CRUD
- 调用其他 Service 或外部 SDK
- 最终通过 handler.ts（components 包）触发节点运行时

---

## 六、核心业务路径：预测请求（predictions）

### 6.1 请求链路

```
POST /api/v1/predictions/:id
    │
    ▼
routes/predictions.ts
    │
    ▼
controllers/predictions/index.ts
    └─> 调用 services/predictions/index.ts
            │
            ├─> 从数据库加载 ChatFlow 定义
            ├─> 从 NodesPool 获取节点实现
            ├─> 调用 components/src/handler.ts → buildFlow()
            │       └─> 按节点图拓扑顺序初始化各节点
            │       └─> 执行推理（调用 LLM / 向量检索 / 工具等）
            └─> 将结果写入 ChatMessage 表
```

### 6.2 NodesPool 的作用

`NodesPool` 在启动时扫描 `packages/components/nodes/` 目录，把所有节点实现类加载到内存中，形成一个以节点名称为 key 的注册表。

当 Service 需要执行某个节点时，通过 `nodesPool.componentNodes[nodeType]` 获取节点类的实例，再调用其 `init()` 和 `run()` 方法。

---

## 七、运行模式

| 环境变量 `MODE` | 模式 | 说明 |
|----------------|------|-----|
| 未设置（默认） | 直接执行 | 请求到来时同步在 Server 进程内执行节点逻辑 |
| `QUEUE` | 队列模式 | 请求写入 BullMQ 队列，由独立 Worker 进程消费执行 |

**QUEUE 模式额外初始化**：
- `QueueManager` 管理 PredictionQueue 和 UpsertQueue
- `RedisEventSubscriber` 监听 Redis 事件，将执行结果通过 SSE 推送回客户端
- BullMQ 控制台挂载到 `/admin/queues`

---

## 八、本阶段关键类/文件一览

| 文件 | 核心作用 |
|------|---------|
| `index.ts` | App 类，整个服务的生命周期入口 |
| `commands/start.ts` | CLI 启动命令，调用 init + start |
| `DataSource.ts` | 数据库连接工厂，支持 4 种数据库 |
| `NodesPool.ts` | 节点注册表，启动时扫描加载所有节点 |
| `CachePool.ts` | 已初始化节点实例的 LRU 缓存 |
| `routes/index.ts` | 路由统一装配，包含企业特性门控 |
| `IdentityManager.ts` | 平台类型判断、许可证验证、Feature Flag |
| `queue/QueueManager.ts` | BullMQ 队列管理（QUEUE 模式） |
| `utils/SSEStreamer.ts` | SSE 流式响应管理 |

---

## 九、本阶段回答的三个问题

**Q1：路由是如何挂载的？**

全部路由在 `routes/index.ts` 中统一注册，挂载到 `express.Router()`，再由 `index.ts` 的 `config()` 方法通过 `app.use('/api/v1', flowiseApiV1Router)` 统一注册到根路由。

**Q2：Controller 和 Service 的职责边界是什么？**

Controller 只做"接收参数 → 调用 Service → 返回响应"，不含业务逻辑；Service 负责业务编排、数据库操作和节点运行时调用。

**Q3：运行一次聊天/预测请求时，后端最终如何调到 components 包？**

通过 `NodesPool`（节点注册表）获取节点实现类，再调用 `components/src/handler.ts` 中的 `buildFlow()` 函数，按 DAG 拓扑顺序初始化并执行各节点，最终得到 LLM 输出。

---

## 十、下一阶段预告

进入 **第三阶段** → 读 `packages/components`，理解节点是如何被定义、注册和执行的。重点文件：
- `src/Interface.ts`（节点抽象接口）
- `src/handler.ts`（节点执行引擎）
- `src/validator.ts`（参数校验）
- 样本节点：`nodes/chatmodels/`、`nodes/chains/`、`nodes/vectorstores/`
