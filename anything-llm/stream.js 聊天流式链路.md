# AnythingLLM `stream.js`：从用户发送到流式回答

> 版本：1.11.1（与仓库 `anything-llm` 对齐）  
> 核心文件：`server/utils/chats/stream.js`  
> 导出：`streamChatWithWorkspace`、`VALID_CHAT_MODE`（`chat` | `query`）  
> 创建时间：2026-04-01

---

## 一句话结论

**`streamChatWithWorkspace`** 是「工作区聊天 / 查询」的**主编排函数**：先处理**斜杠命令**与 **Agent 早退**，再按顺序拼上下文——**置顶文档 → 解析附件 → 向量检索（可选 rerank）→ 用历史引用回填 `fillSourceWindow`**，然后通过 **`LLMConnector.compressMessages`** 压进模型窗口，最后 **流式或非流式** 调 LLM，**写 SSE 分块**并 **落库 `WorkspaceChats`**。

HTTP 入口通常是 **`POST /api/workspace/:slug/stream-chat`**（在 `server/endpoints` 中组装 `response` 与参数后调用本函数）。

---

## 1. 函数签名与输入

```js
streamChatWithWorkspace(
  response,      // Express res，用于 writeResponseChunk（SSE）
  workspace,     // 当前工作区（含 slug、chatProvider、similarityThreshold、topN 等）
  message,       // 用户原始输入
  chatMode,      // "chat" | "query"，默认 "chat"
  user,          // 多用户时可空
  thread,        // 线程可空
  attachments    // 附件列表
)
```

---

## 2. 总流程（按执行顺序）

```text
uuid = 本次对话事件 id
updatedMessage = grepCommand(message)     // 解析内置命令前缀等

若 updatedMessage 是 VALID_COMMANDS 键
  → 执行对应命令处理器，writeResponseChunk 后 return

若 grepAgents(...) 判定走 Agent 流程
  → Agent 自己写流，return

取 LLMConnector = getLLMProvider({ workspace.chatProvider, chatModel })
取 VectorDb = getVectorDbClass()
统计：hasNamespace(slug)、namespaceCount(slug)

【query 模式且向量空间为空】
  → 拒绝文案（或 workspace.queryRefusalResponse），写 chunk、WorkspaceChats.new(include:false)，return

加载 recentChatHistory（受 messageLimit，默认 20）

DocumentManager.pinnedDocs()
  → contextTexts += 全文；sources += 摘要（前 1000 字 + 省略提示）
  → pinnedDocIdentifiers 供检索过滤

WorkspaceParsedFiles.getContextFiles(...)
  → 当前会话/用户的解析文件注入 contextTexts + sources

若 embeddingsCount > 0
  → VectorDb.performSimilaritySearch({
       namespace: slug,
       input: updatedMessage,
       LLMConnector,
       similarityThreshold, topN,
       filterIdentifiers: pinnedDocIdentifiers,
       rerank: vectorSearchMode === "rerank",
     })
否则 向量结果为空对象

若 similarity 返回 message（错误）
  → writeResponseChunk type abort，return

fillSourceWindow({ nDocs: topN, searchResults, history: rawHistory, filterIdentifiers })
  → 检索结果不足 nDocs 时，从**历史对话**里曾出现过的 sources **回填**（去重、排除 pin）

contextTexts += filledSources.contextTexts
sources += vectorSearchResults.sources   // 注意：与 contextTexts 拼接策略不同，见 §5

【query 模式且 contextTexts 仍为空】
  → 拒绝文案，落库，return

messages = await LLMConnector.compressMessages({
  systemPrompt: chatPrompt(workspace, user),
  userPrompt: updatedMessage,
  contextTexts,
  chatHistory,
  attachments,
}, rawHistory)

若 streamingEnabled() !== true
  → getChatCompletion，单块 textResponseChunk
否则
  → streamGetChatCompletion + handleStream

若 completeText 有内容
  → WorkspaceChats.new（含 sources、metrics、attachments）
  → writeResponseChunk finalizeResponseStream（含 chatId）
否则
  → 仍 finalize（无 chatId）
```

---

## 3. 早退分支

| 条件 | 行为 |
| --- | --- |
| **内置命令**（`VALID_COMMANDS`） | 不经过 RAG/LLM 主流程，直接命令响应。 |
| **Agent 模式**（`grepAgents`） | 由 Agent 插件接管流式输出。 |
| **query 模式 + 无向量数据** | 不调用 LLM，返回「无相关信息」类文案。 |
| **向量检索返回 `message`** | `type: "abort"`，带 `error`。 |
| **query 模式 + 拼完上下文仍为空** | 同上拒绝逻辑，避免模型用通识胡编。 |

**chat 模式**在无向量或检索为空时，仍可能只靠历史/系统提示继续聊（除非被后续压缩或模型拒绝）。

---

## 4. 上下文三块：Pinned / Parsed / Vector

1. **Pinned（`DocumentManager`）**  
   - 把置顶文档 **全文**推进 **`contextTexts`**，让模型「看得见」。  
   - **`sources` 里只放截断预览**（约 1000 字 + `...continued...`），避免引用区过长。  
   - 生成 **`pinnedDocIdentifiers`**，向量检索时 **过滤**已置顶父文档，减少重复片段。

2. **Parsed files（`WorkspaceParsedFiles.getContextFiles`）**  
   - 会话里「已解析未嵌入」或上下文文件类数据，同样 **全文进 context**、摘要进 sources 展示逻辑与 pin 类似。

3. **Vector（`performSimilaritySearch`）**  
   - 用 **`updatedMessage`** 做查询（经 `LLMConnector.embedTextInput` 转向量，见各向量库实现）。  
   - **`similarityThreshold`、`topN`** 来自 workspace 配置。  
   - **`rerank`**：`vectorSearchMode === "rerank"` 时走宽召回 + 本地 reranker（Lance 等实现见 [`LanceDB 向量存储与检索.md`](./LanceDB%20向量存储与检索.md)）。

---

## 5. 为何 `contextTexts` 与 `sources` 拼接不一致？（源码注释要点）

检索之后：

- **`contextTexts`** 追加 **`fillSourceWindow` 返回的 `contextTexts`**（含 **回填**的历史引用文本），供模型理解多轮语境。  
- **`sources`** 只追加 **`vectorSearchResults.sources`**（**当前这次**向量检索结果），**不把历史回填的条目合并进展示用 sources**。

设计意图（源码原意概括）：  
模型需要「历史里用过的材料」保持连贯；但界面 **引用列表** 若带上用户认为与本次问题无关的旧文档，容易引发「乱引用」的反馈。因此 **回填只进 context，不进本次 citations 列表**。

---

## 6. `fillSourceWindow`（`server/utils/helpers/chat/index.js`）

- **输入**：本次 **`searchResults`**、`nDocs`（通常 `topN`）、**`rawHistory`**、**`filterIdentifiers`**。  
- 若 **`searchResults.length >= nDocs`** 或 **无历史**：直接 `contextTexts = sources.map(s => s.text)`。  
- 否则从 **最近历史往前**扫，解析每条 assistant 的 **`response.sources`**，挑选带 **`score`、`text`、`id`** 且不在 pin、未重复的 source，**凑满 nDocs**。  
- 历史长度已由 **`recentChatHistory` 的 messageLimit** 限制，避免无限扫描。

---

## 7. `compressMessages` 与超长提示

- **`LLMConnector.compressMessages(..., rawHistory)`** 内部会走 **`messageArrayCompressor`**（同目录 `helpers/chat/index.js` 顶部长注释）：在超窗口时对 **system / history / user** 做 **「cannonball」**（从中间向两侧删 token），并约定大致比例（如 user 可占大头、history 较易被裁）。  
- 保证在 **`promptWindowLimit()`** 内留出回复空间（如约 600 token buffer）。

---

## 8. 流式 vs 非流式

- **`LLMConnector.streamingEnabled() === true`**：`streamGetChatCompletion` + **`handleStream`**，边生成边 **`writeResponseChunk`**。  
- 否则：**`getChatCompletion`** 一次取全文，再 **`textResponseChunk`** 单块结束。

最终都会尝试 **`finalizeResponseStream`**；成功生成正文时会 **`WorkspaceChats.new`** 并带上 **`chatId`**。

---

## 9. 与周边文件的关系

| 文件 | 作用 |
| --- | --- |
| `server/utils/helpers/chat/responses.js` | `writeResponseChunk`、历史格式转换等 |
| `server/utils/chats/index.js` | `grepCommand`、`VALID_COMMANDS`、`chatPrompt`、`recentChatHistory`、`sourceIdentifier` |
| `server/utils/chats/agents.js` | `grepAgents` |
| `server/utils/DocumentManager/index.js` | `pinnedDocs` |
| `server/models/workspaceParsedFiles.js` | `getContextFiles` |
| `server/models/workspaceChats.js` | 对话持久化 |
| 各 `vectorDbProviders/*/index.js` | `performSimilaritySearch` |

---

## 10. 阅读建议

1. 先通读本文件的 **早退条件** 与 **`contextTexts` / `sources` 注释块**（约 L188–194）。  
2. 对照 **`fillSourceWindow`** 理解「检索条数不足时如何用历史补窗」。  
3. 结合 **`LanceDB 向量存储与检索.md`** 看检索参数如何传入。  
4. 若要改 **query 拒绝文案**，改 **`workspace.queryRefusalResponse`** 与 **`stream.js`** 中两处默认字符串。

---

## 11. 相关导读链接

- [`导读.md`](./导读.md) — 全链路索引  
- [`LanceDB 向量存储与检索.md`](./LanceDB%20向量存储与检索.md)  
- [`Native Embedding 引擎.md`](./Native%20Embedding%20引擎.md)
