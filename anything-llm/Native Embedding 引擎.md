# AnythingLLM Native Embedding 引擎

> 版本：1.11.1（与仓库 `anything-llm` 对齐）  
> 核心文件：`server/utils/EmbeddingEngines/native/index.js`  
> 模型清单：`server/utils/EmbeddingEngines/native/constants.js`  
> 创建时间：2026-04-01

---

## 一句话结论

**Native** 引擎在进程内用 **`@xenova/transformers`** 跑 Hugging Face 式模型的 **feature-extraction** 流水线，不调用外部 Embedding API。AnythingLLM 在此基础上做了：模型选择与环境变量、CDN 下载兜底、按模型限制批大小与单条最大字符数、以及 **文档侧 `chunkPrefix` / 查询侧 `queryPrefix`**（与 `TextSplitter` 的 `chunkPrefix` 配置对接）。

---

## 1. 在整体流水线中的位置

```text
TextSplitter.splitText(pageContent)
  → 每个 chunk 可能已带 chunkHeaderMeta + EmbedderEngine.embeddingPrefix（即 constants 里的 chunkPrefix）
  → NativeEmbedder.embedChunks(textChunks)
  → 向量写入向量库

用户提问做相似度检索时：
  → LLMConnector.embedTextInput(用户问题)  → 内部仍调同一套 Embedder
  → NativeEmbedder.embedTextInput 会为文本加上 queryPrefix（若模型需要）
```

要点：

- **入库**：`embedChunks` **不会**在 Native 里加 `queryPrefix`；文档前缀由向量库写入路径里传入 `TextSplitter` 的 `chunkPrefix: EmbedderEngine?.embeddingPrefix` 完成（见各 `vectorDbProviders/*/index.js`）。
- **检索**：`embedTextInput` 会走 `#applyQueryPrefix`，保证与 nomic / e5 等「查询与文档不同前缀」的模型一致。

---

## 2. 如何被选中

`server/utils/helpers/index.js` 中 `getEmbeddingEngineSelection()`：

- `process.env.EMBEDDING_ENGINE === "native"` 时返回 `new NativeEmbedder()`。
- **`switch` 的 `default` 分支也是 `NativeEmbedder()`**，即未设置或未知值时默认本地嵌入。

---

## 3. 模型从哪里来、存到哪里

| 项 | 说明 |
| --- | --- |
| 环境变量 **`EMBEDDING_MODEL_PREF`** | 指定模型 id；若不在支持列表中则回退默认模型。 |
| 默认模型 | `Xenova/all-MiniLM-L6-v2`（`NativeEmbedder.defaultModel`） |
| 缓存目录 | `STORAGE_DIR/models`；未设置 `STORAGE_DIR` 时为 `server/storage/models`，路径中包含 `model` 的 `org/name` 分段。 |
| 首次下载 | 动态 `import("@xenova/transformers")`，`pipeline("feature-extraction", model, { cache_dir, progress_callback? })`。 |
| 主源失败时 | **单次**回退到 Mintplex 托管的 CDN：`https://cdn.anythingllm.com/support/models/`（注释中说明不保证长期可用）。 |

`embedderClient()` 负责懒加载 pipeline；成功后会将 `modelDownloaded` 置为 true，后续启动不再重复下载。

---

## 4. 对外接口与行为

### 4.1 实例上的关键属性

- **`embeddingPrefix`**（getter）：`supportedModels[model].chunkPrefix ?? ""` → 供 `TextSplitter` 作为 `chunkPrefix` 使用。
- **`queryPrefix`**（getter）：`supportedModels[model].queryPrefix ?? ""`。
- **`embeddingMaxChunkLength`**：来自当前模型配置，用于与系统 `text_splitter_chunk_size` 一起算实际分块上限（见 `TextSplitter.determineMaxChunkSize` 等）。
- **`maxConcurrentChunks`**：嵌入时 **每批送入 pipeline 的字符串条数**（不是 token 数），与内存占用强相关。

### 4.2 `embedTextInput(textInput)`

1. 调用 `#applyQueryPrefix`（单条或数组逐条加前缀）。
2. 归一成数组后调用 `embedChunks`，返回 **`result[0]`** 或 `[]`。

### 4.3 `embedChunks(textChunks)`

实现上有大量注释说明曾在 **t3.small（2GB）** 上压测：为避免 OOM，**不把整批向量长时间堆在内存里**。

流程概要：

1. 生成临时文件路径（`STORAGE_DIR/tmp` 或 `server/storage/tmp`）。
2. `toChunks(textChunks, this.maxConcurrentChunks)` 将字符串数组切成多组（`helpers/index.js` 的数组分块）。
3. 对每一组：取 `embedderClient()` → `pipeline(chunk, { pooling: "mean", normalize: true })` → `output.tolist()` → `JSON.stringify` 后 **追加写入** 临时文件，组与组之间写 `,`，整体包成 `[ ... ]` JSON 数组。
4. 最后 `JSON.parse` 读回，`flat()` 后返回；删除临时文件。

空输出时会 `continue`，对应位置不产生数据；若全程无有效结果可能得到 `null`。

---

## 5. `constants.js` 中的支持模型（摘要）

| 模型 id | `maxConcurrentChunks` | `embeddingMaxChunkLength`（字符） | `chunkPrefix` | `queryPrefix` |
| --- | ---: | ---: | --- | --- |
| `Xenova/all-MiniLM-L6-v2` | 25 | 1000 | `""` | `""` |
| `Xenova/nomic-embed-text-v1` | 5 | 16000 | `search_document: ` | `search_query: ` |
| `MintplexLabs/multilingual-e5-small` | 5 | 1000 | `passage: ` | `query: ` |

注释中强调：`embeddingMaxChunkLength` 在代码语义里是 **单次处理的字符数上限的保守取值**（按约 2 字符/token 低估），**不是**模型卡上的精确 token 上限。

---

## 6. 静态方法

- **`NativeEmbedder.availableModels()`**：把 `SUPPORTED_NATIVE_EMBEDDING_MODELS` 转成前端下拉可用的 `apiInfo` 列表。
- **`_getEmbeddingModel()`** / 实例的 **`getEmbeddingModel()`**：解析 `EMBEDDING_MODEL_PREF` 与 supported 表，逻辑与构造时一致。

---

## 7. 与其它 Embedding 引擎的对比（概念）

| 维度 | Native | 例如 OpenAI / Ollama |
| --- | --- | --- |
| 执行位置 | 本机 Node 进程 + transformers.js | HTTP API 或另一服务 |
| 费用 | 无 API 费用 | 可能有 |
| 内存与 CPU | 模型与批大小敏感，大文档需注意 | 通常由服务端承担 |
| 前缀约定 | 由 `constants` 固定，与 TextSplitter 联动 | 依各提供商文档 |

---

## 8. 相关源码索引

- `server/utils/EmbeddingEngines/native/index.js`
- `server/utils/EmbeddingEngines/native/constants.js`
- `server/utils/helpers/index.js`（`getEmbeddingEngineSelection`、`toChunks`）
- `server/utils/TextSplitter/index.js`（`chunkPrefix` / `embeddingMaxChunkLength`）
- `server/utils/vectorDbProviders/*/index.js`（`chunkPrefix: EmbedderEngine?.embeddingPrefix`、`embedChunks` / `embedTextInput`）

---

## 9. 阅读时可对照的笔记

- [`TextSplitter 分块策略.md`](./TextSplitter%20分块策略.md) — 分块大小如何受 `embeddingMaxChunkLength` 约束、`chunkPrefix` 如何拼接。
- [`导读.md`](./导读.md) — RAG 全链路索引。
