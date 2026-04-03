# `helpers/index.js` 与 `validatedRequest.js` 详解

对应导读中的第 6、7 步，基于 Anything-LLM 服务端源码（`server/utils/helpers/index.js`、`server/utils/middleware/validatedRequest.js`）。

---

## 一、`server/utils/helpers/index.js`：工厂模式与抽象层

### 1.1 文件角色

该文件是 **「运行时选型 + 类型契约」** 的枢纽：

- 用 **JSDoc `@typedef`** 描述「理想中」LLM、向量库、Embedder 应具备的方法与字段（**抽象接口**，非 TypeScript interface，但作用相同）。
- 用 **`getXxx` 工厂函数** 根据环境变量（或调用方传入参数）**延迟 `require` 并 `new` 出具体实现**，业务侧只依赖「长得像 `BaseXXX`」的对象。

这样 **业务代码不 import 具体厂商**，换向量库或换模型提供商时只改环境变量或在工厂里加 `case`。

### 1.2 三类核心抽象（typedef）

| 抽象名 | 含义 | 典型方法 |
|--------|------|----------|
| `BaseLLMProvider` | 对话/补全提供方 | `getChatCompletion`、`streamGetChatCompletion`、`embedTextInput`、`promptWindowLimit` 等 |
| `BaseVectorDatabaseProvider` | 向量存储 | `connect`、`similarityResponse`、`addDocumentToNamespace`、`namespace` 等 |
| `BaseEmbedderProvider` | 文本转向量 | `embedTextInput`、`embedChunks`、`embeddingMaxChunkLength` 等 |

此外还有 `ChatMessage`、`ChatCompletionResponse` 等 **数据传输形状**，方便在 AI 流水线里保持一致。

### 1.3 工厂函数一览

| 函数 | 输入 | 行为要点 |
|------|------|----------|
| `getVectorDbClass(getExactly?)` | `VECTOR_DB` 或显式字符串 | `switch` → `require('../vectorDbProviders/xxx')` → `new Xxx()`；未知或缺省回退 **LanceDB** |
| `getLLMProvider({ provider, model })` | `LLM_PROVIDER` / 参数 + 内部 `getEmbeddingEngineSelection()` | 每个分支 `new XxxLLM(embedder, model)`，**把 Embedder 注入 LLM**，保证同一条流水线里「聊天模型」和「向量化」可独立配置 |
| `getEmbeddingEngineSelection()` | `EMBEDDING_ENGINE` | 决定用 OpenAI、Ollama、`native` 等；**默认 `NativeEmbedder`** |
| `getLLMProviderClass({ provider })` | provider 字符串 | 返回 **类本身**（未实例化），用于调用 **静态方法**（如 `promptWindowLimit(model)`） |
| `getBaseLLMProviderModel({ provider })` | provider | 从各 `*_MODEL_PREF` 环境变量读取 **默认模型名** |

**延迟加载**：具体 Provider 只在 `switch` 命中时 `require`，避免启动时加载全部厂商 SDK，也减少循环依赖风险。

### 1.4 与「工厂模式」的对应关系

- **产品族**：向量库一族、LLM 一族、Embedder 一族。
- **工厂方法**：`getVectorDbClass`、`getLLMProvider`、`getEmbeddingEngineSelection` 等即 **Simple Factory**。
- **扩展方式**：新增厂商时新增实现类 + 在对应 `switch` 增加分支（导读里写的「新建文件夹 → 实现统一接口 → 注册」即指此）。

### 1.5 辅助工具函数（非工厂）

- `maximumChunkLength()`：嵌入时单块最大字符数，可由 `EMBEDDING_MODEL_MAX_CHUNK_LENGTH` 覆盖，默认 1000。
- `toChunks(arr, size)`：数组按固定大小切片（批处理 embedding 时常用）。
- `humanFileSize(bytes, ...)`：可读文件大小字符串。

### 1.6 阅读时可对照的文件

- 向量库：`server/utils/vectorDbProviders/base.js` + 各子目录（如 `lance/`）。
- LLM：`server/utils/AiProviders/*`。
- 嵌入：`server/utils/EmbeddingEngines/*`。

---

## 二、`server/utils/middleware/validatedRequest.js`：认证机制

### 2.1 职责

Express 风格中间件：**在进入受保护路由前**，根据 **是否多用户模式** 走两条完全不同的校验路径，并把结果写入 `response.locals`，供后续 handler 使用。

入口：`validatedRequest(request, response, next)`。

### 2.2 第一步：多用户开关

```text
multiUserMode = await SystemSettings.isMultiUserMode()
response.locals.multiUserMode = multiUserMode
```

- 若为 **多用户**：转 `validateMultiUserRequest`（JWT + 数据库用户）。
- 若为 **单用户**：走下面的单用户逻辑。

### 2.3 单用户模式下的三条分支

**A. 开发放行 / 未配置密钥**

当满足任一条件时 **直接 `next()`，不做校验**：

- `NODE_ENV === "development"`
- 未设置 `AUTH_TOKEN`
- 未设置 `JWT_SECRET`

便于本地开发；生产环境应配置完整认证。

**B. 显式要求 AUTH_TOKEN**

若走到后续逻辑却仍无 `AUTH_TOKEN`，返回 **401**（与上面 A 的「缺 JWT_SECRET 也放行」组合需注意：缺 `AUTH_TOKEN` 但设了 `JWT_SECRET` 时行为以代码顺序为准）。

**C. 标准 Bearer 校验**

1. 从 `Authorization` 取 `Bearer <token>`。
2. `decodeJWT(token)`（定义在 `server/utils/http/index.js`）：用 **`JWT.verify(jwtToken, process.env.JWT_SECRET)`** 验签；失败则返回 `{ p: null, id: null, username: null }`。
3. 从 payload 取 **`p`**，要求匹配正则 **`\w{32}:\w{32}`**（注释说明：新版本里 `p` 经 **EncryptionManager** 加密存储，避免 JWT 里明文存敏感信息；旧 token 不符合格式会被判无效，迫使用户重新登录）。
4. 使用 **bcrypt** 与 **`EncryptionMgr.decrypt(p)`** 和 **`process.env.AUTH_TOKEN`** 做一致性校验；不通过则 **401 Invalid auth credentials**。
5. 通过则 `next()`。

单用户本质：**共享一个「API 口令」场景**，凭证放在 JWT payload 的加密字段 `p` 中，服务端用 `JWT_SECRET` 验 JWT，再解密 `p` 与配置的 `AUTH_TOKEN` 比对。

### 2.4 多用户模式：`validateMultiUserRequest`

1. 同样要求 `Authorization: Bearer <token>`。
2. `decodeJWT(token)` 必须成功且 payload 含 **`id`**（用户主键）。
3. `User.get({ id: valid.id })` 查库；不存在 → 401。
4. `user.suspended` → 401（账号停用）。
5. **`response.locals.user = user`**，供后续路由使用当前登录用户；`next()`。

多用户本质：**JWT 即会话**，`id` 关联 Prisma `User`，与单用户的「全局 AUTH_TOKEN」模型分离。

### 2.5 与 `decodeJWT` 的关系

- 实现：`server/utils/http/index.js` 中 `JWT.verify(..., JWT_SECRET)`。
- 单用户分支主要用 payload 的 **`p`**；多用户分支主要用 **`id`**（及整份合法 payload）。

### 2.6 安全与运维提示（阅读源码时心里要有数）

- **切勿在生产长期依赖**「development 或未配 AUTH_TOKEN/JWT_SECRET 即放行」。
- 单用户模式下 JWT 与 `AUTH_TOKEN`、`JWT_SECRET`、加密 PEM 需 **一致备份**；轮换密钥会导致已签发 token 失效。
- 新增 API 路由时，在 Express 链上 **挂上 `validatedRequest`** 才会进入上述逻辑（具体挂载位置见 `server/index.js` 或各路由文件）。

---

## 三、和导读主线的关系

| 导读步骤 | 关联 |
|----------|------|
| 向量 / Embedding / 聊天流 | 都会间接通过 `getVectorDbClass`、`getLLMProvider`、`getEmbeddingEngineSelection` 拿到 **同一套抽象实现** |
| 安全 | 浏览器或外部客户端调 API 时，经 `validatedRequest` 区分单用户口令 JWT 与多用户账号 JWT |

读完这两处后，再回头看 `stream.js`、文档入库流程，可以更清楚 **「谁创建了 LLM/向量库实例」** 以及 **「谁在进业务前拦请求」**。
