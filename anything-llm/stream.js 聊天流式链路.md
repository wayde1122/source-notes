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

这三块在 **`stream.js`** 里按 **固定顺序** 叠加到 **`contextTexts` / `sources`**：先 Pin，再 Parsed，再向量检索；之后才调用 **`fillSourceWindow`** 用历史补「文档条数窗口」（详见 §6）。向量检索仅在 **`embeddingsCount !== 0`** 时执行，否则得到空结果对象。

### 4.1 Pinned（`DocumentManager`）

- **调用方式**：`new DocumentManager({ workspace, maxTokens: LLMConnector.promptWindowLimit() }).pinnedDocs()`。  
  **`maxTokens`** 用当前连接器的 **提示窗口上限**，与后续 **`compressMessages` / cannonball** 一致；源码注释说明：置顶会显著撑大上下文，但理论上超过模型承载时会被压缩——置顶更适合 **高上下文窗口** 的模型。
- **写入 `contextTexts`**：每条置顶文档取 **`doc.pageContent` 全文** 压入数组，保证模型读到完整正文。
- **写入 `sources`（展示用）**：对同一条文档构造对象 **`{ text: pageContent.slice(0, 1000) + "...continued on in source document...", ...metadata }`**，即 **约 1000 字符截断 + 固定续文提示**，避免 UI 引用区被长文淹没；**`metadata`** 为除 **`pageContent`** 外的字段展开。
- **`pinnedDocIdentifiers`**：对每条 pin 文档执行 **`sourceIdentifier(doc)`**（与 `chats/index.js` 一致），收集后作为 **`performSimilaritySearch` 的 `filterIdentifiers`**。向量侧对每条命中用 **`sourceIdentifier(rest)`** 判断是否在集合中，**命中则跳过**，避免「同一段父文档」既全文置顶又在检索里重复出现一堆 chunk。

### 4.2 Parsed files（`WorkspaceParsedFiles.getContextFiles`）

- **作用**：把当前 **workspace / thread / user** 下、已解析进会话但未走向量库（或作为会话上下文文件）的材料注入本轮。
- **拼装规则与 Pin 平行**：**`pageContent` 全文 → `contextTexts`**；**`sources` 里同样前 1000 字 + `...continued on in source document...`**。  
  注意：**Parsed 不会像 Pin 那样**单独维护一组 id 传给向量 **`filterIdentifiers`**；若需避免与向量重复，取决于解析文件是否也进入向量库及 metadata 设计。

### 4.3 Vector（`VectorDb.performSimilaritySearch`）

- **查询文本**：**`input: updatedMessage`**（已过 **`grepCommand`** 的用户消息），嵌入由 **`LLMConnector.embedTextInput`** 完成；不同向量库 / 嵌入引擎实现路径不同，Lance 侧要点见 [`LanceDB 向量存储与检索.md`](./LanceDB%20向量存储与检索.md)。
- **Workspace 参数**：**`similarityThreshold`**、**`topN`** 来自工作区配置；**`namespace`** 为 **`workspace.slug`**。
- **过滤**：**`filterIdentifiers: pinnedDocIdentifiers`**，与 §4.1 呼应。
- **Rerank**：**`rerank: workspace?.vectorSearchMode === "rerank"`**。为 `true` 时典型实现为 **放宽召回上限**（如按表规模算 `searchLimit`）再 **本地 cross-encoder 重排**，最终仍取 **`topN`**；失败时可能降级或打日志，以具体 provider 为准。
- **失败**：若返回对象带 **`message`**（错误文案），**`stream.js`** 直接 **`writeResponseChunk` type `abort`** 并 **return**，本轮不再拼 LLM。

---

## 5. 为何 `contextTexts` 与 `sources` 拼接不一致？（源码注释要点）

向量检索与 **`fillSourceWindow`** 之后，**`stream.js`** 两行赋值拆开处理（与 `fillSourceWindow` 返回值用法强相关）：

```js
contextTexts = [...contextTexts, ...filledSources.contextTexts];
sources = [...sources, ...vectorSearchResults.sources];
```

要点：

1. **`contextTexts`**  
   - 在 Pin、Parsed 之后，再 **整体追加** **`filledSources.contextTexts`**。  
   - **`fillSourceWindow`** 内部会把 **本轮向量检索得到的 `sources`** 与 **必要时从历史回填的条目** 合并成一条「窗口内文档列表」，再 **`map(src => src.text)`** 得到 **给模型用的纯文本数组**。因此 **历史回填片段会进入模型上下文**，多轮追问时即使本轮向量命中很少，仍可能借上一轮引用 **补足语义连贯性**。

2. **`sources`（最终随响应、落库、流式 chunk 带给前端的引用列表）**  
   - 只 **`[...]` 追加 `vectorSearchResults.sources`**，**不**把 **`fillSourceWindow` 里因历史而多出来的那些条目**并入。  
   - 换言之：**UI 上的 citations 只反映「这一次相似度检索」的结果**（外加前面已写入的 Pin / Parsed 摘要条目），**不**把「为补窗而从历史抄来的」旧引用再展示一遍。

**设计意图**（与 **`stream.js` 内英文注释**一致，此处意译）：  
模型需要能理解「之前回合用过的材料」，否则追问容易断档；但若把历史回填文档全部标成 **本次** 的引用，用户会感到 **「明明没在问这个文档，为什么下面又 cite 它」**，从而报 issue。折中方案是：**回填只增厚 `contextTexts`，不增厚本次展示的 `sources`**。若用户真要查旧引用，对话历史里上一轮 assistant 的引用仍可见。

**实现细节提醒**：**`fillSourceWindow` 的返回值里其实也有一个合并后的 `sources` 数组**（含回填），**`stream.js` 刻意不用它更新对外 `sources`**，只用其派生的 **`contextTexts`**。

---

## 6. `fillSourceWindow`（`server/utils/helpers/chat/index.js`）

函数意图（文件头注释概括）：在 **Pin 已在外部处理** 的前提下，优先保证上下文里 **大约有 `nDocs` 条「文档级」材料**——顺序为 **向量检索结果 → 必要时从聊天记录往回抄曾经的 `sources`**，让 **query 模式**下「第二轮几乎搜不到 chunk」时仍有机会用上一轮材料回答，**chat / RAG** 下也能减少 **「检索条数不足 → 上下文漂」** 而不必次次开 rerank。

### 6.1 入参（与 `stream.js` 的对应关系）

| 参数 | 含义 | `stream.js` 传入 |
| --- | --- | --- |
| **`nDocs`** | 希望凑满的条数 | 取 `workspace?.topN`，未配置则 `4` |
| **`searchResults`** | 本轮向量检索的 **`sources`** | **`vectorSearchResults.sources`** |
| **`history`** | 原始聊天记录 | **`rawHistory`**（与 `recentChatHistory` 同源） |
| **`filterIdentifiers`** | 需排除的文档标识（当前 pin） | **`pinnedDocIdentifiers`** |

### 6.2 快速路径

- 若 **`searchResults.length >= nDocs`**：**不需要回填**。内部 **`sources = [...searchResults]`**，返回 **`contextTexts: sources.map(src => src.text)`**。  
- 若 **`history.length === 0`**：同样不扫历史，逻辑同上。

### 6.3 回填路径（条数不足且有历史）

1. 打日志：需要回填 **`nDocs - searchResults.length`** 条。  
2. **`seenChunks`**：用 **`Set`** 记录已选用的 **`source.id`**，初值包含本轮 **`searchResults`** 里所有 **`id`**，避免重复。  
3. **遍历顺序**：**`for (const chat of history.reverse())`** —— **`rawHistory` 通常旧→新**，**`reverse()` 后从新到旧**，优先用 **最近几轮** assistant 用过的引用。  
4. 每条 **`chat`**：用 **`safeJsonParse(chat.response, { sources: [] })?.sources`** 取 **`response.sources`**；若无或非数组则跳过。  
5. **可接受的历史 source** 必须同时满足：  
   - **`filterIdentifiers.includes(sourceIdentifier(source)) === false`**（不是当前置顶那批）；  
   - **`source` 自身带有 `score` 属性**（注释写「不能来自以前 pin 的那类」——实现上是用 **`hasOwnProperty("score")`** 过滤，**无 `score` 的 source 不会参与回填**，例如部分非向量来源）；  
   - **`hasOwnProperty("text")`**；  
   - **`seenChunks.has(source.id) === false`**（按 **id** 去重）。  
6. 将 **`validSources`** 依次 **`push`** 到内部的 **`sources`**，直到 **`sources.length >= nDocs`** 或历史扫完。  
7. 返回 **`{ sources, contextTexts: sources.map(src => src.text) }`**。

### 6.4 与 `stream.js` 的组合方式

- **`stream.js` 只把 `filledSources.contextTexts` 拼进 `contextTexts`**，**不把 `filledSources.sources` 拼进对外 `sources`**（见 §5）。  
- **历史扫描规模**：注释写明 **`history` 来自 `recentChatHistory`，受 `messageLimit`（默认 20）约束**，因此不是全库扫聊天记录。

### 6.5 文件内注释的利弊说明（可选读）

同一文件承认：若用户 **完全换话题**，历史回填可能让 **上下文里** 出现与当前问题弱相关的旧 chunk；但优先保证 **回答正确** 与 **query 追问可用**，且 **新检索命中仍优先**（先放 **`searchResults`**，回填只补缺）。展示层通过 §5 的策略减轻 **「乱引用」** 的观感。

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
