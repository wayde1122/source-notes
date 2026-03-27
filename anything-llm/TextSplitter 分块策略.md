# AnythingLLM TextSplitter 分块策略

> 版本：1.11.1
> 项目：AnythingLLM
> 创建时间：2026-03-27
> 核心文件：`server/utils/TextSplitter/index.js`

---

## 一句话结论

AnythingLLM 的 `TextSplitter` 本质上不是一套自研分块算法，而是对 LangChain `RecursiveCharacterTextSplitter` 的轻量包装。它真正增加的能力只有三层：

1. 在进入 LangChain 之前，决定实际 `chunkSize`
2. 在每个 chunk 前面拼接可选的文档头信息
3. 按 embedding 模型要求给 chunk 再加前缀

也就是说，**基础切分动作由 LangChain 完成，AnythingLLM 负责“切多大、前面加什么、最终送去 embed 什么文本”**。

---

## 1. 分块发生在什么位置

分块不在 collector 服务里做，而是在 Server 端、文档即将写入向量库时执行。

典型调用链如下：

```text
documentData.pageContent
  -> VectorDbProvider.addDocumentToNamespace()
  -> new TextSplitter({...})
  -> textSplitter.splitText(pageContent)
  -> EmbedderEngine.embedChunks(textChunks)
  -> 向量库 metadata.text = textChunks[i]
```

以 Pinecone 为例，`addDocumentToNamespace()` 会先创建 `TextSplitter`，再对 `pageContent` 分块，然后把每个 chunk 送去 embedding，最后把 chunk 原文写进向量记录的 `metadata.text` 字段。

关键位置：

- `server/utils/vectorDbProviders/pinecone/index.js:156-171`
- `server/utils/vectorDbProviders/pinecone/index.js:176-190`

这说明一个很重要的事实：

**最终被向量化的文本，不只是原始正文片段，还可能包含 `chunkHeaderMeta` 和 `chunkPrefix`。**

---

## 2. TextSplitter 自身做了什么

`TextSplitter` 构造时会把配置转成一个 `RecursiveSplitter` 实例：

```js
this.#splitter = new RecursiveSplitter({
  chunkSize: isNaN(config?.chunkSize) ? 1_000 : Number(config?.chunkSize),
  chunkOverlap: isNaN(config?.chunkOverlap) ? 20 : Number(config?.chunkOverlap),
  chunkHeader: this.stringifyHeader(),
});
```

对应源码：

- `server/utils/TextSplitter/index.js:156-164`

而 `RecursiveSplitter` 内部只是直接 new 了 LangChain 的 `RecursiveCharacterTextSplitter`：

```js
this.engine = new RecursiveCharacterTextSplitter({
  chunkSize,
  chunkOverlap,
});
```

对应源码：

- `server/utils/TextSplitter/index.js:173-187`

这里有两个直接结论：

1. AnythingLLM 没有在这个文件里自定义 separators
2. 实际如何递归切分，继承自安装时的 `@langchain/textsplitters` 默认行为

所以如果你要问“它具体按 `\n\n -> \n -> 空格 -> 字符` 吗”，在当前仓库源码里**看不到显式覆写**。能确认的是：**它走的是 LangChain 默认递归字符切分，不是 AnythingLLM 自己手写的规则表。**

---

## 3. `chunkSize` 是怎么决定的

### 3.1 直接使用 `TextSplitter` 时的默认值

如果有人直接 `new TextSplitter()`，且没有传合法 `chunkSize`，默认值是 `1000`：

- `server/utils/TextSplitter/index.js:159`

但这只是类本身的缺省值，不是 AnythingLLM 整体运行时唯一的默认策略。

### 3.2 真正运行时的取值来源

在实际 embedding 流程里，各个向量库 provider 通常这样构造：

```js
chunkSize: TextSplitter.determineMaxChunkSize(
  await SystemSettings.getValueOrFallback({ label: "text_splitter_chunk_size" }),
  EmbedderEngine?.embeddingMaxChunkLength
)
```

对应源码：

- `server/utils/vectorDbProviders/pinecone/index.js:157-163`

`determineMaxChunkSize()` 的逻辑很直接：

```js
const prefValue = isNullOrNaN(preferred)
  ? Number(embedderLimit)
  : Number(preferred);
return prefValue > limit ? limit : prefValue;
```

对应源码：

- `server/utils/TextSplitter/index.js:47-57`

这意味着运行时实际规则是：

```text
实际 chunkSize = min(用户配置值, embedding 引擎上限)
如果用户没配，就直接用 embedding 引擎上限
```

所以要特别注意：

- 直接 new `TextSplitter()` 的默认值是 `1000`
- 但 AnythingLLM 正常文档入库链路里，经常不是 `1000`
- 如果当前 embedder 上限更大，实际 `chunkSize` 会跟着变大

### 3.3 AstraDB 是一个例外

Astra provider 在此基础上又多加了一层硬上限：

```js
chunkSize: Math.min(
  7500,
  TextSplitter.determineMaxChunkSize(...)
)
```

对应源码：

- `server/utils/vectorDbProviders/astra/index.js:209-218`

所以 Astra 路径下：

```text
实际 chunkSize = min(7500, 用户配置值, embedder 上限)
```

---

## 4. `chunkSize` 的单位是什么

这里的分块器是 `RecursiveCharacterTextSplitter`，默认长度语义是**字符数**，不是 AnythingLLM 自己实现的 token splitter。

AnythingLLM 自己的辅助函数里也把这个语义写得比较清楚：

```js
// Some models have lower restrictions on chars that can be encoded in a single pass
function maximumChunkLength() {
  ...
  return 1_000;
}
```

对应源码：

- `server/utils/helpers/index.js:517-529`

Native embedding 常量里也明确写了注释，说明这里实际按字符长度保守处理：

- `server/utils/EmbeddingEngines/native/constants.js:4-8`
- `server/utils/EmbeddingEngines/native/constants.js:23-27`
- `server/utils/EmbeddingEngines/native/constants.js:42-46`

所以更准确的说法是：

**AnythingLLM 的文本切分本身按字符数控制；embedding provider 给出的 `embeddingMaxChunkLength` 也被当作“单段可安全编码的最大长度”来使用。**

它不是 token-aware splitter。

---

## 5. `chunkOverlap` 的策略

`chunkOverlap` 的处理比 `chunkSize` 简单：

- 直接 `TextSplitter` 默认值是 `20`
- 系统设置校验要求它必须是数字且 `>= 0`
- 如果直接构造时不给合法值，也会回退到 `20`

对应源码：

- `server/utils/TextSplitter/index.js:160-162`
- `server/models/systemSettings.js:94-107`

测试还验证了两件事：

1. 未传 `chunkOverlap` 时，默认按 `20` 工作
2. `chunkOverlap > chunkSize` 会抛错

对应测试：

- `server/__tests__/utils/TextSplitter/index.test.js:15-21`
- `server/__tests__/utils/TextSplitter/index.test.js:24-30`

这里要注意一个实现细节：

`TextSplitter` 自己没有显式写“如果 overlap 大于 size 就报错”的判断，这个报错实际上来自底层 LangChain splitter 构造过程，而不是 AnythingLLM 自己手工校验。

---

## 6. `chunkHeaderMeta` 是怎么工作的

AnythingLLM 会从文档元数据里挑出一小部分字段，拼成 chunk 头：

```js
const PLUCK_MAP = {
  title: { as: "sourceDocument", ... },
  published: { as: "published", ... },
  chunkSource: { as: "source", ... },
};
```

对应源码：

- `server/utils/TextSplitter/index.js:64-118`

### 6.1 它只保留哪些字段

最终只会保留：

- `title -> sourceDocument`
- `published -> published`
- `chunkSource -> source`

而且 `chunkSource` 不是原样保留，只有以下前缀才会被接受：

- `link://`
- `youtube://`

然后把前缀剥掉，只留下真正的 URL 或资源标识。

例如：

```text
chunkSource = "link://https://example.com"
=> source = "https://example.com"
```

### 6.2 头信息长什么样

`stringifyHeader()` 会把这些信息变成：

```xml
<document_metadata>
sourceDocument: Example
published: 2021-01-01
source: https://example.com
</document_metadata>

```

对应源码：

- `server/utils/TextSplitter/index.js:135-146`

这不是挂在额外 metadata 字段上的“结构化头”，而是**直接拼进 chunk 文本前面**。

### 6.3 什么时候真正拼进去

`splitText()` 内部在有 `chunkHeader` 时不是直接返回 `splitText()` 结果，而是：

```js
const strings = await this.engine.splitText(documentText);
const documents = await this.engine.createDocuments(strings, [], {
  chunkHeader: this.chunkHeader,
});
return documents.map((doc) => doc.pageContent);
```

对应源码：

- `server/utils/TextSplitter/index.js:194-202`

所以 header 不是在切分前混进原文，而是：

```text
先切正文
再给每个切好的 chunk prepend header
最后返回 pageContent
```

这个顺序很重要，因为它说明：

- chunk 边界主要还是按正文决定
- header 的存在主要影响 embedding 内容和检索展示
- header 本身不会参与“如何切段”的递归判断

---

## 7. `chunkPrefix` 是怎么工作的

`chunkPrefix` 会在 header 之前先被加上：

```js
return `${this.config.chunkPrefix}${text}`;
```

对应源码：

- `server/utils/TextSplitter/index.js:125-128`

`stringifyHeader()` 的返回顺序是：

```text
chunkPrefix + <document_metadata>...</document_metadata> + 正文 chunk
```

从测试也能看出来，带 `chunkPrefix` 和 `chunkHeaderMeta` 时，每个 chunk 都以：

```text
testing3: <document_metadata>
```

开头。

对应测试：

- `server/__tests__/utils/TextSplitter/index.test.js:89-102`

### 7.1 这个前缀从哪来

向量库 provider 会把当前 embedding engine 的 `embeddingPrefix` 传进来：

- `server/utils/vectorDbProviders/pinecone/index.js:168-169`

在当前仓库里，显式定义 `embeddingPrefix` 的只有 native embedder：

- `server/utils/EmbeddingEngines/native/index.js:68-70`

不同 native 模型的前缀如下：

- `Xenova/all-MiniLM-L6-v2` -> `""`
- `Xenova/nomic-embed-text-v1` -> `"search_document: "`
- `MintplexLabs/multilingual-e5-small` -> `"passage: "`

对应源码：

- `server/utils/EmbeddingEngines/native/constants.js:2-10`
- `server/utils/EmbeddingEngines/native/constants.js:21-29`
- `server/utils/EmbeddingEngines/native/constants.js:40-48`

这说明 `chunkPrefix` 不是 UI 文案装饰，而是**某些 embedding 模型的输入协议要求**。

---

## 8. 系统设置如何影响分块

AnythingLLM 暴露了两个后台系统设置：

- `text_splitter_chunk_size`
- `text_splitter_chunk_overlap`

对应源码：

- `server/models/systemSettings.js:26-31`
- `server/models/systemSettings.js:42-50`

它们的校验逻辑是：

- `chunk_size` 必须是数字且 `> 0`
- `chunk_overlap` 必须是数字且 `>= 0`
- 设置变更后会调用 `purgeEntireVectorCache()`

对应源码：

- `server/models/systemSettings.js:79-107`

这意味着分块参数一旦变化，AnythingLLM 认为旧缓存 embedding 结果已经不可靠，需要清空 vector cache。

这很合理，因为同一篇文档只要 chunk 边界变了，后续 embedding 结果、向量数量、召回内容都会一起变化。

---

## 9. 这套策略对检索结果有什么实际影响

因为 provider 最后写入向量库的是：

```js
metadata: { ...metadata, text: textChunks[i] }
```

对应源码：

- `server/utils/vectorDbProviders/pinecone/index.js:179-187`

所以每个 chunk 的最终文本实际上是：

```text
[可选 chunkPrefix]
[可选 <document_metadata> ...]
[正文片段]
```

这会带来三个后果：

### 9.1 元数据会参与 embedding

也就是说，文档标题、发布日期、来源链接这些信息，不只是检索后的展示字段，它们本身被编码进向量了。

### 9.2 检索返回的文本也带着这些前缀

后续相似度查询时，Pinecone 直接取的是 `match.metadata.text`：

- `server/utils/vectorDbProviders/pinecone/index.js:71-85`

因此返回给上层 RAG 上下文的文本，通常还是带着 header/prefix 的。

### 9.3 它更偏向“可解释召回”而不是“最纯净正文”

好处是模型更容易知道：

- 这段内容来自哪个文档
- 这段内容有没有发布日期
- 这段内容原始来源是什么

代价是 chunk 中有一部分字符预算被 metadata/header 占用。

---

## 10. 用伪代码总结整套策略

```js
metadata = buildHeaderMeta(documentMetadata)

actualChunkSize = min(
  userConfiguredChunkSize ?? embedderLimit,
  embedderLimit
)

// Astra 额外再做一次 min(7500, ...)

splitter = new RecursiveCharacterTextSplitter({
  chunkSize: actualChunkSize,
  chunkOverlap: userConfiguredOverlap ?? 20,
})

bodyChunks = splitter.splitText(pageContent)

finalChunks = bodyChunks.map((chunk) => {
  return (
    embedderPrefix +
    "<document_metadata>...</document_metadata>\n\n" +
    chunk
  )
})

embed(finalChunks)
store(metadata.text = finalChunks[i])
```

---

## 11. 最值得记住的 7 个点

1. AnythingLLM 不自己定义核心切分算法，底层切分是 LangChain `RecursiveCharacterTextSplitter`
2. 它主要负责三件事：确定 `chunkSize`、注入 `chunkHeaderMeta`、注入 `chunkPrefix`
3. 正常运行时的 `chunkSize` 通常不是固定 `1000`，而是 `min(用户配置, embedder 上限)`
4. `chunkOverlap` 默认是 `20`
5. `chunkHeaderMeta` 只会抽取 `title/published/chunkSource`
6. `chunkPrefix` 主要服务于特定 embedding 模型的输入规范
7. 最终被 embed 和写入向量库的文本，是“前缀 + 头信息 + 正文 chunk”的组合

---

## 12. 相关源码索引

- `server/utils/TextSplitter/index.js`
- `server/__tests__/utils/TextSplitter/index.test.js`
- `server/models/systemSettings.js`
- `server/utils/helpers/index.js`
- `server/utils/EmbeddingEngines/native/index.js`
- `server/utils/EmbeddingEngines/native/constants.js`
- `server/utils/vectorDbProviders/pinecone/index.js`
- `server/utils/vectorDbProviders/astra/index.js`

