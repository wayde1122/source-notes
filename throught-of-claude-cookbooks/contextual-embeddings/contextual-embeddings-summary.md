# Contextual Embeddings 要点总结

本文总结 `claude-cookbooks/capabilities/contextual-embeddings` 中 contextual retrieval / contextual embeddings 示例的核心思路、流程和工程要点。

## 1. 这个示例解决什么问题

传统 RAG 会把文档切成多个 chunk，然后分别做 embedding。问题是：单个 chunk 脱离原文后，可能缺少足够上下文。

例如某个 chunk 只包含一段函数实现，但没有说明这个函数属于哪个模块、解决什么问题、上下游逻辑是什么。这样做向量检索时，embedding 表达的信息不完整，容易导致召回不准。

Contextual Embeddings 的核心思想是：

> 在给每个 chunk 做 embedding 之前，先让 Claude 根据完整文档为这个 chunk 生成一段简短上下文说明，然后把“上下文说明 + 原始 chunk”一起做 embedding。

这样每个 chunk 的向量表示会包含更多文档级语境，检索效果更好。

## 2. 基础 RAG 流程

基础 RAG 通常包括：

1. 文档切分成 chunk
2. 对每个 chunk 生成 embedding
3. 用户提问时，对 query 生成 embedding
4. 用向量相似度检索 top-k chunk
5. 把检索到的 chunk 交给大模型生成答案

示例中的基础 RAG 使用：

- Voyage AI 生成 embeddings
- 简单内存向量库保存 embeddings 和 metadata
- 余弦相似度 / 点积做检索
- Pass@k 评估召回效果

## 3. Contextual Embeddings 流程

Contextual Embeddings 在入库阶段增加一个步骤：为每个 chunk 生成上下文。

流程如下：

```text
原始文档
  ↓
切分成多个 chunk
  ↓
对每个 chunk：把完整文档 + 当前 chunk 发给 Claude
  ↓
Claude 生成简短上下文说明
  ↓
拼接：上下文说明 + 原始 chunk
  ↓
生成 embedding
  ↓
写入向量库
```

查询阶段基本不变：

```text
用户问题
  ↓
query embedding
  ↓
向量搜索
  ↓
召回相关 chunk
  ↓
交给大模型回答
```

重要点：上下文化发生在 **入库阶段**，不是每次查询时，所以不会增加查询时延。

## 4. Prompt Caching 的作用

为每个 chunk 生成上下文时，需要把完整文档发给 Claude。如果每个 chunk 都重复发送完整文档，成本会很高。

Prompt caching 用来降低这个成本。

处理同一个文档的多个 chunk 时：

1. 第一个 chunk：把完整文档写入缓存
2. 后续 chunk：从缓存读取完整文档
3. 缓存读取 token 有大幅折扣

因此应该按文档顺序处理 chunk，而不是把不同文档的 chunk 随机打散。

示例中的收益：

- 处理 9 个代码库文件
- 共 737 个 chunk
- 大量输入 token 来自缓存读取
- 入库成本明显降低

## 5. 利用缓存时的 chunk 分割建议

Prompt caching 的命中依赖 **稳定前缀**。所以在分割 chunk 和生成 contextual description 时，最好按下面方式组织：

```text
文档 A 完整内容 / 稳定文档上下文  ← 放在前面，并加 cache_control
当前 chunk                         ← 放在后面，每次变化，不进入缓存
```

也就是说，chunk 分割应该先完成，然后按同一篇文档的 chunk 顺序连续处理：

```text
文档 A：chunk 1 → chunk 2 → chunk 3 → ...
文档 B：chunk 1 → chunk 2 → chunk 3 → ...
```

不要把不同文档的 chunk 随机打散处理，否则 prompt cache 的复用效果会变差。

分割 chunk 时还要注意：

- **尽量按语义边界切分**：例如标题、段落、函数、类、章节，而不是机械按固定字符数截断。
- **chunk 不宜太小**：太小会缺少有效信息，即使加了 contextual description，也可能召回噪声较多。
- **chunk 不宜太大**：太大会降低检索粒度，召回后塞给模型的上下文也更占 token。
- **保留顺序 metadata**：例如 `doc_id`、`chunk_id`、`original_index`，方便删除、更新和重建。
- **当前 chunk 不要放进缓存前缀**：否则每个请求的前缀都会变化，缓存难以命中。

如果原始文档特别长，超过适合直接放入 prompt 的范围，可以先按章节或模块切成较大的 parent section，再在每个 parent section 内切小 chunk：

```text
完整文档
  ↓
按章节 / 模块切成 parent section
  ↓
每个 parent section 内再切 retrieval chunk
  ↓
用 parent section 或文档摘要作为稳定上下文缓存
  ↓
为每个 retrieval chunk 生成 contextual description
```

这种方式可以在成本、上下文完整性和缓存命中率之间取得更好的平衡。

### 代码示例：先切 chunk，再按文档顺序利用缓存

下面是一个简化版 Python 示例，重点展示：

1. 先把文档切成多个 chunk。
2. 同一篇文档的 chunk 连续处理。
3. 完整文档放在前面并加 `cache_control`，当前 chunk 放在后面。

```python
import os
from anthropic import Anthropic

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MODEL_NAME = "claude-opus-4-6"

DOCUMENT_CONTEXT_PROMPT = """<document>
{doc_content}
</document>"""

CHUNK_CONTEXT_PROMPT = """Here is the chunk we want to situate within the whole document:

<chunk>
{chunk_content}
</chunk>

Please give a short succinct context to situate this chunk within the overall document
for the purposes of improving search retrieval of the chunk.
Answer only with the succinct context and nothing else."""


def split_into_chunks(text: str, max_chars: int = 2_000, overlap: int = 200) -> list[str]:
    """简单示例：按字符长度切 chunk；生产中更推荐按标题、段落、函数等语义边界切。"""
    chunks = []
    start = 0

    while start < len(text):
        end = min(start + max_chars, len(text))
        chunks.append(text[start:end])

        if end == len(text):
            break

        start = max(0, end - overlap)

    return chunks


def generate_chunk_context(doc_content: str, chunk_content: str) -> tuple[str, object]:
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": DOCUMENT_CONTEXT_PROMPT.format(doc_content=doc_content),
                        "cache_control": {"type": "ephemeral"},
                    },
                    {
                        "type": "text",
                        "text": CHUNK_CONTEXT_PROMPT.format(chunk_content=chunk_content),
                    },
                ],
            }
        ],
    )

    return response.content[0].text, response.usage


def process_document(doc_id: str, doc_content: str) -> list[dict]:
    chunks = split_into_chunks(doc_content)
    records = []

    # 关键：同一篇文档的 chunk 连续处理，这样完整文档前缀更容易命中缓存。
    for index, chunk in enumerate(chunks):
        context, usage = generate_chunk_context(doc_content, chunk)

        print(
            f"chunk={index}",
            f"cache_creation={usage.cache_creation_input_tokens}",
            f"cache_read={usage.cache_read_input_tokens}",
        )

        records.append(
            {
                "doc_id": doc_id,
                "chunk_id": f"{doc_id}-{index:04d}",
                "original_index": index,
                "context": context,
                "original_text": chunk,
                "text_for_embedding": f"{context}\n\n{chunk}",
            }
        )

    return records
```

代码里的关键结构是：

```python
"content": [
    {
        "type": "text",
        "text": DOCUMENT_CONTEXT_PROMPT.format(doc_content=doc_content),
        "cache_control": {"type": "ephemeral"},
    },
    {
        "type": "text",
        "text": CHUNK_CONTEXT_PROMPT.format(chunk_content=chunk_content),
    },
]
```

含义是：

```text
缓存前缀：完整文档 / 稳定上下文
非缓存部分：当前 chunk 和生成说明的指令
```

判断是否命中缓存，可以看返回的 `usage`：

```python
print(response.usage.input_tokens)
print(response.usage.cache_creation_input_tokens)
print(response.usage.cache_read_input_tokens)
```

通常第一次处理某篇文档时：

```text
cache_creation_input_tokens > 0
cache_read_input_tokens = 0
```

处理同一篇文档的后续 chunk 时，如果缓存命中，通常会看到：

```text
cache_read_input_tokens > 0
```

### 代码示例：超长文档先切 parent section，再切 retrieval chunk

如果完整文档太长，不适合每次都整体放入 prompt，可以先切成较大的章节或模块，然后在章节内继续切小 chunk：

```python
def split_by_markdown_heading(text: str) -> list[str]:
    """简化示例：按 Markdown 二级标题切 parent section。"""
    sections = []
    current = []

    for line in text.splitlines(keepends=True):
        if line.startswith("## ") and current:
            sections.append("".join(current))
            current = []
        current.append(line)

    if current:
        sections.append("".join(current))

    return sections


def process_long_document(doc_id: str, doc_content: str) -> list[dict]:
    records = []
    parent_sections = split_by_markdown_heading(doc_content)

    for section_index, parent_section in enumerate(parent_sections):
        chunks = split_into_chunks(parent_section)

        # 对同一个 parent section 内的 chunk 连续调用。
        # 此时被缓存的是 parent_section，而不是整篇超长文档。
        for chunk_index, chunk in enumerate(chunks):
            context, usage = generate_chunk_context(parent_section, chunk)

            records.append(
                {
                    "doc_id": doc_id,
                    "parent_section_index": section_index,
                    "chunk_id": f"{doc_id}-{section_index:03d}-{chunk_index:04d}",
                    "original_index": chunk_index,
                    "context": context,
                    "original_text": chunk,
                    "text_for_embedding": f"{context}\n\n{chunk}",
                }
            )

    return records
```

这个版本的思想是：

```text
缓存前缀：parent section
当前变化：parent section 里的某个 retrieval chunk
```

适合文档非常长、章节结构明显，或者整篇文档超过模型上下文/成本预算的场景。

## 6. BM25 搜索是什么

BM25 是传统关键词搜索算法，常用于 Elasticsearch / OpenSearch / Lucene。

它擅长匹配：

- 函数名
- 类名
- 变量名
- 错误码
- 精确术语
- 产品名

BM25 不太擅长语义理解，但对精确关键词非常敏感。

向量搜索擅长语义相似，BM25 擅长关键词精确匹配，所以二者互补。

## 6. Contextual BM25

普通 BM25 只搜索原始 chunk 文本。

Contextual BM25 会搜索：

```text
原始 chunk 内容
+
Claude 生成的上下文说明
```

好处是：即使原始 chunk 里没有出现某些解释性词语，Claude 生成的上下文说明里可能包含这些词，从而让 BM25 更容易命中。

例如原始代码 chunk 只包含函数实现，但上下文说明可能写明：

```text
这个 chunk 定义了 differential fuzzing executor，并比较 primary 和 secondary executor。
```

这样用户搜索 “compare two executors” 时，BM25 也更容易找到它。

## 7. 混合搜索策略

实际生产中常用 hybrid search：

```text
用户问题
  ↓
向量搜索 top N
BM25 搜索 top N
  ↓
合并去重
  ↓
融合排序
  ↓
取 top-k
  ↓
交给大模型
```

融合排序可以用加权分数或 RRF。

RRF，即 Reciprocal Rank Fusion，大致思想是：

> 某个 chunk 在多个检索器中排名都靠前，就应该获得更高最终排名。

示例中语义搜索权重更高，BM25 权重较低，例如：

```text
semantic_weight = 0.8
bm25_weight = 0.2
```

这表示主要依赖语义搜索，同时保留关键词搜索的补充能力。

## 8. Rerank 策略

Rerank 是二阶段检索策略：

```text
第一阶段：快速召回较多候选 chunk
第二阶段：用更强的模型重新排序候选 chunk
```

常见流程：

```text
BM25 / 向量搜索召回 top 50 或 top 100
  ↓
reranker 判断 query 与每个 chunk 的相关性
  ↓
重新排序
  ↓
只保留 top 5 / top 10
  ↓
交给大模型回答
```

Reranker 可以是：

- Cohere Rerank
- Voyage Rerank
- bge-reranker
- Jina reranker
- Claude / 其他 LLM 做 rerank

示例中使用 Cohere rerank：

```text
Contextual Embeddings 先召回 k * 10 条
再用 Cohere rerank
最后保留 top-k
```

Rerank 的优点是排序质量高，缺点是增加延迟和成本。

## 9. 删除文档时如何清理 chunk

删除文档时，不应该只删除原始文件，还要删除该文档对应的所有 chunk。

关键是每个 chunk 入库时都要保留 metadata，例如：

```json
{
  "doc_id": "document-123",
  "source_uri": "s3://bucket/path/file.pdf",
  "chunk_id": "document-123-0004",
  "original_index": 4
}
```

删除时按 `doc_id` 或 `source_uri` 批量删除。

如果使用自建向量库：

```text
删除 metadata.doc_id == 目标文档 ID 的所有向量和 chunk
```

如果使用 Elasticsearch / BM25：

```text
delete_by_query doc_id == 目标文档 ID
```

如果使用 AWS Bedrock Knowledge Base：

```text
从 S3 删除源文件
重新运行 Knowledge Base sync / ingestion job
Bedrock 根据数据源变化清理相关 chunk
```

## 10. 更新文档时如何处理 chunk

更新文档时，推荐文档级重建，而不是局部更新某个 chunk。

原因：

- 文档内容变了，chunk 边界可能变化
- chunk 数量可能变化
- contextual description 可能变化
- embedding 必须重新生成
- BM25 索引也要更新

推荐流程：

```text
删除旧文档所有 chunk
  ↓
使用新文档重新切分 chunk
  ↓
重新生成 contextual description
  ↓
重新 embedding
  ↓
重新写入向量库和 BM25 索引
```

更稳妥的做法是加版本字段：

```json
{
  "doc_id": "policy-123",
  "source_uri": "s3://bucket/docs/policy.pdf",
  "version": "2026-05-11T10:30:00Z",
  "chunk_id": "policy-123-v2-0004"
}
```

可以先写入新版本，确认成功后再删除或停用旧版本。

## 11. Lambda 函数在这里的作用

AWS Lambda 是一种无服务器函数：

> 有事件发生时，AWS 自动运行一段函数代码，运行完即结束，不需要自己维护服务器。

在这个 contextual retrieval 场景中，Lambda 可以作为 Bedrock Knowledge Base 的自定义处理步骤：

```text
文档进入 S3 / Knowledge Base
  ↓
触发 Lambda
  ↓
Lambda 读取文档和 chunk
  ↓
调用 Claude 生成 chunk 上下文说明
  ↓
输出增强后的 chunk
  ↓
Knowledge Base 做 embedding 和索引
```

注意：Lambda 主要负责入库前加工，不负责最终问答，也通常不直接负责删除 chunk。删除和更新一般交给 Knowledge Base 同步机制或向量库管理逻辑。

## 12. 整体推荐架构

一个比较完整的生产 RAG 检索架构可以是：

```text
入库阶段：
文档上传
  ↓
切分 chunk
  ↓
Claude 生成 contextual description
  ↓
保存 metadata：doc_id / source_uri / version / chunk_id
  ↓
生成 embedding
  ↓
写入向量库
  ↓
写入 BM25 索引

查询阶段：
用户问题
  ↓
向量搜索 top 50
BM25 搜索 top 50
  ↓
合并去重
  ↓
RRF / 加权融合
  ↓
rerank top 20-30
  ↓
取 top 5-10
  ↓
交给大模型生成答案
```

## 13. 关键取舍

| 技术                  | 优点                               | 代价                           |
| --------------------- | ---------------------------------- | ------------------------------ |
| Contextual Embeddings | 显著提升检索质量；查询时无额外延迟 | 入库阶段多一次 Claude 调用成本 |
| Prompt Caching        | 降低上下文化成本                   | 需要按文档顺序处理 chunk       |
| BM25                  | 精确关键词、函数名、错误码检索强   | 不理解语义                     |
| Hybrid Search         | 兼顾语义和关键词                   | 需要维护两个检索系统           |
| Rerank                | 最终排序更准                       | 增加查询延迟和成本             |

## 14. 一句话总结

Contextual Embeddings 的本质是：

> 先用 Claude 给每个 chunk 补充文档级上下文，再把补充后的 chunk 做 embedding，从而提升 RAG 检索质量。

最推荐的生产做法是：

> Contextual Embeddings 作为基础能力，结合 BM25 混合搜索和 rerank，在召回率、准确率、成本和延迟之间取得平衡。
