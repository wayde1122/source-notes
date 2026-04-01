# AnythingLLM LanceDB 向量存储与检索

> 版本：1.11.1（与仓库 `anything-llm` 对齐）  
> 核心文件：`server/utils/vectorDbProviders/lance/index.js`  
> 基类：`server/utils/vectorDbProviders/base.js`  
> 创建时间：2026-04-01

---

## 一句话结论

**LanceDb** 是默认向量后端（`VECTOR_DB` 未改时），在本地目录用 **`@lancedb/lancedb`** 维护「**一张表 = 一个 workspace 命名空间**」的向量数据。写入路径是：**TextSplitter 分块 → Embedder 批量嵌入 → 行记录含 `id` / `vector` / 扁平 metadata（含 `text`）→ `DocumentVectors` 映射 docId**；检索路径是：**查询句 embed → `vectorSearch` 余弦距离 → 阈值与 pinned 过滤 → 可选本地 cross-encoder 重排**。

---

## 1. 数据落在哪里

| 项           | 说明                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **连接 URI** | `path.resolve(STORAGE_DIR ?? server/storage, "lancedb")`，即默认 **`server/storage/lancedb`**（或自定义存储根下的 `lancedb` 子目录）。 |
| **命名空间** | Lance 的 **表名（table name）** = AnythingLLM 的 **namespace**（通常对应 workspace 的向量命名空间）。                                  |
| **连接方式** | `lancedb.connect(this.uri)`，无独立向量服务进程，嵌入式库直接读写本地数据集。                                                          |

---

## 2. 类职责与继承关系

`LanceDb extends VectorDatabase`，实现基类要求的连接、心跳、统计、增删文档、相似度搜索等。未实现的方法在 `base.js` 里会 `throw`，Lance 侧全部有具体实现。

日志前缀：`[VectorDB::LanceDb]`（基类 `logger`）。

---

## 3. 写入：`addDocumentToNamespace`

### 3.1 入口参数

- **`namespace`**：目标表名。
- **`documentData`**：至少包含 **`pageContent`**、**`docId`**，其余字段进入 metadata。
- **`fullFilePath`**：用于 **向量结果磁盘缓存**（见下文）；可为 null。
- **`skipCache`**：为 true 时跳过「读缓存直灌库」分支。

### 3.2 分支 A：向量缓存命中（`skipCache === false`）

1. 调用 **`cachedVectorInformation(fullFilePath)`**（`server/utils/files/index.js`）：用 **`uuidv5(fullFilePath)`** 在 `vector-cache` 目录找同名 JSON。
2. 若存在：解析出的 **`chunks`** 为多段结构；对每段内每条记录生成新 **`uuid`** 作为行 `id`，组装 **`submissions`**（`id`、`vector`、metadata），并 **`DocumentVectors.bulkInsert({ docId, vectorId })`**。
3. **`updateOrCreateCollection`**：表已存在则 **`table.add(data)`**，否则 **`client.createTable(namespace, data)`**。
4. **不再重新 embed**，直接返回 `{ vectorized: true }`。

适用场景：同一文件路径曾被嵌入过，避免重复消耗 Embedding。

### 3.3 分支 B：完整「解析 → 分块 → 嵌入」

1. **`getEmbeddingEngineSelection()`** 得到 **`EmbedderEngine`**。
2. **`new TextSplitter({...})`**：
   - `chunkSize`：`TextSplitter.determineMaxChunkSize(系统 text_splitter_chunk_size, EmbedderEngine.embeddingMaxChunkLength)`
   - `chunkOverlap`：系统设置，缺省 **20**
   - `chunkHeaderMeta`：`TextSplitter.buildHeaderMeta(metadata)`
   - **`chunkPrefix: EmbedderEngine?.embeddingPrefix`**（与 Native nomic/e5 等文档前缀对齐）
3. **`textSplitter.splitText(pageContent)`** → **`textChunks`**。
4. **`EmbedderEngine.embedChunks(textChunks)`** → 与 chunk 一一对齐的向量数组。
5. 为每个 chunk 构造：
   - 行 **`id`**：`uuidv4()`
   - **`vector`**：嵌入结果
   - **metadata**：`{ ...metadata, text: textChunks[i] }` — 注释强调 **`text` 键** 与 LangChain/生态习惯一致，便于后续按文本回填 context。
6. **`updateOrCreateCollection(client, submissions, namespace)`** 一次性写入 **全部** `submissions`（Lance 侧单次 `add` / 建表，**未**按 500 条拆分插入）。
7. 将 **`vectors`** 用 **`toChunks(vectors, 500)`** 切成多段，仅用于 **`storeVectorResult(chunks, fullFilePath)`** 写入磁盘缓存（大文档时避免单个 JSON 过大或便于流式处理的历史设计，与 Lance 写入批大小无关）。
8. **`DocumentVectors.bulkInsert(documentVectors)`**。

失败时 catch 后返回 `{ vectorized: false, error: e.message }`；嵌入结果为空会 **throw**「Could not embed document chunks!」。

### 3.4 辅助：`updateOrCreateCollection`

```text
hasNamespace(namespace) === true  → openTable → add(data)
否则                              → createTable(namespace, data)
```

**`hasNamespace`** 内部会 **`connect()`** 并检查 `tableNames()` 是否包含该 namespace。

---

## 4. 检索：`performSimilaritySearch`

### 4.1 前置校验

- 要求 **`namespace`、`input`、`LLMConnector`** 均有效，否则抛错。
- **`connect()`** 后若 **`namespaceExists`** 为 false，返回空结果与提示文案：`Invalid query - no documents found for workspace!`。

### 4.2 查询向量

- **`queryVector = await LLMConnector.embedTextInput(input)`**  
  对 Native 等引擎会走 **query 侧前缀**（如 `search_query:`），与入库时的文档前缀成对，见 [`Native Embedding 引擎.md`](./Native%20Embedding%20引擎.md)。

### 4.3 两种模式

| `rerank`            | 行为                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| **`false`（默认）** | **`similarityResponse`**：单次向量检索，**`limit(topN)`**。                       |
| **`true`**          | **`rerankedSimilarityResponse`**：先扩召回再 **`NativeEmbeddingReranker`** 重排。 |

业务层（如 `stream.js`）根据 **`vectorSearchMode === "rerank"`** 等传入 `rerank`，与导读中「可选 rerank」一致。

### 4.4 `similarityResponse`（纯向量）

1. **`openTable(namespace)`**。
2. **`collection.vectorSearch(queryVector).distanceType("cosine").limit(topN).toArray()`**。
3. 对每条结果：
   - **`distanceToSimilarity(item._distance)`** 若 **&lt; similarityThreshold**（默认 **0.25**）则丢弃。
   - 去掉 **`vector`** 字段得到 `rest`。
   - 若 **`filterIdentifiers` 包含 `sourceIdentifier(rest)`**（pinned 父文档过滤），跳过。
   - 填充 **`contextTexts` / `sourceDocuments` / `scores`**。

### 4.5 `rerankedSimilarityResponse`（向量 + 重排）

1. **`searchLimit = clamp(ceil(totalEmbeddings * 0.1), 10, 50)`**：至少 10、至多 50，与全表规模挂钩；注释说明在万级向量与普通硬件上控制重排耗时。
2. 用 **`searchLimit`** 做 **`vectorSearch` + cosine**，得到候选列表。
3. **`NativeEmbeddingReranker`**（`Xenova/ms-marco-MiniLM-L-6-v2`）对 **`query` + 候选文档** 重排，取 **`topK: topN`**。
4. 阈值与 pinned 过滤逻辑与上类似；分数优先取 **`item.rerank_score`**，否则回退 **`distanceToSimilarity`**。

重排失败时 catch 打日志，可能返回空或部分结果（取决于 then/catch 行为）。

### 4.6 距离 → 「相似度」：`distanceToSimilarity`

用于与 **`similarityThreshold`** 比较的是 **0～1 越大越相似** 的标量：

- `distance` 为 null 或非 number → **0**
- `distance >= 1` → **1**
- `distance < 0` → **`1 - |distance|`**
- 否则 → **`1 - distance`**

与 Lance 返回的 **`_distance`**（余弦相关度量）配合使用；具体语义以 Lance 文档为准，AnythingLLM 在此做统一阈值门控。

### 4.7 返回给上层前：`curateSources`

将 **`sourceDocuments`** 与 **`contextTexts`** 对齐后映射成 **`sources`**，再 **`curateSources`**：去掉 **`vector`、`_distance`** 等，整理成以 **metadata + text** 为主的结构供聊天窗口展示与上下文拼装。

---

## 5. 删除与维护

| 方法                                                | 行为                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **`deleteDocumentFromNamespace(namespace, docId)`** | 查 **`DocumentVectors`** 得该 doc 的 **`vectorId`** 列表，**`table.delete(\`id IN ('...')\`)`**。ID 来自 UUID，正常无 SQL 注入问题。 |
| **`deleteVectorsInNamespace`**                      | **`client.dropTable(namespace)`**，整表删除。                                                                                        |
| **`"delete-namespace"`**                            | 管理用：校验存在后 **`dropTable`**。                                                                                                 |
| **`reset()`**                                       | **`fs.rm(client.uri, { recursive: true })`**，删除整个 Lance 数据目录（危险操作）。                                                  |

---

## 6. 其它 API

- **`tables()`**：`client.tableNames()`。
- **`totalVectors()`**：遍历所有表 **`countRows()`** 求和。
- **`namespaceCount`**：单表行数。
- **`heartbeat`**：`connect()` 成功即返回时间戳。
- **`"namespace-stats"`**：打开 namespace 对应表对象（或占位消息）。

---

## 7. 与其它模块的衔接（读源码时对照）

```text
documentData.pageContent
  → addDocumentToNamespace
  → TextSplitter + EmbedderEngine
  → Lance table rows（id, vector, metadata.text, ...）
  → DocumentVectors

用户提问
  → performSimilaritySearch({ LLMConnector, input, ... })
  → embedTextInput(input)
  → Lance vectorSearch
  → [可选] NativeEmbeddingReranker
  → contextTexts + sources
```

---

## 8. 相关源码索引

| 路径                                              | 说明                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| `server/utils/vectorDbProviders/lance/index.js`   | Lance 实现全文                                 |
| `server/utils/vectorDbProviders/base.js`          | 抽象接口与默认 `logger`                        |
| `server/utils/helpers/index.js`                   | `getEmbeddingEngineSelection`、`toChunks`      |
| `server/utils/TextSplitter/index.js`              | 分块与 `chunkPrefix`                           |
| `server/utils/files/index.js`                     | `cachedVectorInformation`、`storeVectorResult` |
| `server/models/vectors.js`                        | `DocumentVectors`                              |
| `server/utils/chats/index.js`（或同目录）         | `sourceIdentifier`（pinned 过滤）              |
| `server/utils/EmbeddingRerankers/native/index.js` | 重排模型与 transformers 加载                   |

---

## 9. 延伸阅读

- [`导读.md`](./导读.md) — RAG 全链路与其它向量库对比表
- [`TextSplitter 分块策略.md`](./TextSplitter%20分块策略.md) — `chunkSize` / 前缀与 Lance 写入文本一致
- [`Native Embedding 引擎.md`](./Native%20Embedding%20引擎.md) — 默认 embedder 与 `embeddingPrefix` / `queryPrefix`

---

## 10. 备忘（实现细节）

- **默认向量库**：环境变量 **`VECTOR_DB`** 未指向其它 provider 时，工厂返回 **`LanceDb`**（见 `getVectorDbClass`）。
- **缓存与一致性**：向量缓存键为 **文件路径的 UUID**；若文件内容变更但路径不变，可能误用旧向量，需结合产品侧「换文件/清缓存」策略理解。
- **大批量插入**：当前实现将 **`submissions` 一次 `add`**；极大 chunk 数量时若遇 Lance/内存限制，需从运维或上游分块策略上控制，而非本文件内的 500 分批（500 仅用于 **storeVectorResult**）。
