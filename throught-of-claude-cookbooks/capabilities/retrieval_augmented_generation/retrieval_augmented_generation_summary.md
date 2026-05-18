# Retrieval Augmented Generation 技术要点总结

github - claude-cookbooks\capabilities\retrieval_augmented_generation\guide.ipynb

## 1. 核心目标

这篇 notebook 演示如何用 Claude Documentation 构建一个可评估、可优化的 RAG 系统。它不是只展示“把文档塞进 prompt”这种基础做法，而是完整走了一遍：

- 用文档切块和 embedding 搭建 Basic RAG；
- 用 Summary Indexing 改善 chunk 的语义表示；
- 用 Claude Re-Ranker 提升检索结果排序质量；
- 用检索指标和端到端准确率分别评估系统效果。

它的核心问题是：当用户问题依赖私有文档、内部知识库或最新技术文档时，Claude 需要先检索相关证据，再基于证据回答。

---

## 2. 技术架构

最终方案可以概括为一个两阶段检索 + 生成架构：

```text
用户问题
  ↓
Query Embedding
  ↓
Summary-Indexed Vector DB 初始召回 top 20
  ↓
Claude Re-Ranker 精排 top 3
  ↓
拼接 top 3 的原文 Context
  ↓
Claude Answer Generator
  ↓
最终答案
  ↓
Retrieval Metrics + LLM-as-Judge 评估
```

各组件职责：

| 组件 | 职责 |
|---|---|
| 文档切块 | 将 Claude 文档按 heading 拆成可检索 chunks |
| Voyage Embedding | 将 chunk 和 query 转成向量 |
| Vector DB | 存储 chunk embedding、原文、标题、链接等 metadata |
| Summary Indexing | 为 chunk 生成摘要，并把 summary 加入索引文本 |
| Claude Re-Ranker | 根据 query 和候选 summary 重新排序候选文档 |
| Answer Generator | 使用最终 top 3 的 full text 生成答案 |
| Evaluation | 分开评估检索质量和最终答案质量 |

这里最重要的设计是：**summary 用于检索和排序，full text 用于最终回答**。摘要降低 reranking 成本并突出 chunk 主旨，原文保留完整细节，避免回答阶段丢信息。

---

## 3. 核心流程

Notebook 展示了三个版本的演进：

| Level | 方法 | 解决的问题 |
|---|---|---|
| Level 1 Basic RAG | 原文 chunk embedding，直接检索 top 3 | 建立最小可用 RAG |
| Level 2 Summary Indexing | 对每个 chunk 生成 summary，embedding 时使用 heading + text + summary | 改善 chunk 语义表示，提高召回质量 |
| Level 3 Summary + Re-Ranking | 先召回 top 20，再让 Claude 精排 top 3 | 改善排序，把关键证据排到前面 |

### Level 1：Basic RAG

Basic RAG 的流程是：文档切块 → 生成 embedding → 用户 query 生成 embedding → 向量相似度检索 top 3 → 把 chunk text 拼入 prompt → Claude 回答。

这个版本简单可用，但完全依赖向量相似度排序。如果正确文档没有进入 top 3，后续生成阶段就无法使用它。

### Level 2：Summary Indexing

Level 2 先用 Claude 为每个 chunk 生成 2–3 句 summary，然后把 `heading + original text + summary` 一起用于 embedding。

这样做的意义是让 chunk 的向量表示更聚焦：原文可能很长、信息分散，而 summary 能压缩出这段内容的主旨，使 query 更容易匹配到正确 chunk。

### Level 3：Summary Indexing + Re-Ranking

Level 3 是最关键的架构优化，可以概括为：

```text
retrieve wide, rerank narrow
先广泛召回，再精确筛选
```

具体流程：

1. 使用 summary-indexed vector DB 先召回更多候选，例如 top 20；
2. 把用户 query 和 20 个候选文档的 summary 交给 Claude；
3. Claude 判断哪些候选最能回答问题，并输出最相关的 top 3；
4. 系统用这 top 3 的 full text 构造最终上下文；
5. Claude 基于精选上下文生成答案。

这个设计解决了 Basic RAG 的排序问题：如果正确文档排在第 5、第 8 或第 15 位，直接 top 3 会丢掉它；但先召回 top 20，再由 Claude 精排，就有机会把真正有用的证据提到前面。

---

## 4. 关键实现点

### 4.1 向量库实现

Notebook 使用内存版 VectorDB，保存：

- chunk embeddings；
- chunk metadata；
- query embedding cache；
- pickle 本地持久化文件。

Embedding 使用 Voyage `voyage-2`，检索时用点积相似度排序，并设置相似度阈值。

### 4.2 Summary Indexing

Summary 不是给用户看的展示字段，而是参与检索索引的语义增强字段。它让每个 chunk 除了原始内容外，还拥有一个更短、更聚焦的语义描述。

### 4.3 Re-Ranking

Reranker 阶段只传候选 summary，而不是全文，原因是：

- token 成本更低；
- 排序速度更快；
- summary 更适合判断相关性；
- 避免全文细节干扰 reranking。

但最终回答阶段仍然使用 full text，因为回答需要完整事实、步骤和边界条件。

### 4.4 评估拆分

Notebook 明确把评估拆成两层：

- Retrieval evaluation：看检索器是否找回正确 chunks；
- End-to-end evaluation：看最终生成答案是否正确。

这很重要，因为 RAG 答错可能是检索错，也可能是生成错。只有拆开评估，才能定位瓶颈。

---

## 5. 指标与结果

Notebook 使用 100 条评估样本，每条包含 question、correct chunks 和 correct answer。

核心指标：

| 指标 | 中文 | 含义 |
|---|---|---|
| Precision | 查准率 | 检索回来的 chunks 中有多少是真的相关 |
| Recall | 查全率 | 应该找回的正确 chunks 中有多少被找回 |
| F1 | F1 分数 | 查准率和查全率的综合 |
| MRR | 平均倒数排名 | 第一个正确结果排得多靠前 |
| End-to-End Accuracy | 端到端准确率 | 最终答案是否正确 |

三种方案结果：

| 方案 | Precision | Recall | F1 | MRR | Accuracy |
|---|---:|---:|---:|---:|---:|
| Basic RAG | 0.4283 | 0.6592 | 0.5193 | 0.7367 | 0.7100 |
| Summary Indexing | 0.4533 | 0.7142 | 0.5546 | 0.7733 | 0.7900 |
| Summary + Re-Ranking | 0.4367 | 0.6933 | 0.5359 | 0.8650 | 0.8100 |

结果解读：

- Summary Indexing 对检索质量提升最全面，Precision、Recall、F1、MRR 和 Accuracy 都上升；
- Re-Ranking 最大的收益体现在 MRR，从 0.7733 提升到 0.8650；
- Level 3 的 Precision / Recall / F1 略低于 Level 2，但 Accuracy 更高，说明最终答案质量不仅取决于是否命中正确文档，也取决于正确文档是否排在更靠前的位置；
- 从 Basic RAG 到最终方案，端到端准确率从 71% 提升到 81%。

---

## 6. 技术亮点

1. **分阶段 RAG pipeline**  
   先做基础向量检索，再加入 summary indexing，最后加入 reranking，优化路径清晰。

2. **Summary 作为索引增强层**  
   摘要不是最终答案来源，而是帮助 embedding 更好表达 chunk 语义。

3. **Retrieve wide, rerank narrow**  
   先扩大候选范围，再用 Claude 做语义精排，兼顾召回和上下文质量。

4. **Summary 排序，Full Text 回答**  
   reranker 看摘要以降低成本，answer generator 看原文以保证答案完整。

5. **检索与生成分开评估**  
   使用 Precision、Recall、F1、MRR 评估检索，用 LLM-as-Judge 评估最终答案。

---

## 7. 局限与注意点

- Notebook 使用的是内存向量库和 pickle 持久化，适合 demo，不适合大规模生产；
- Claude Re-Ranking 会增加额外 token 成本和延迟；
- Level 2 的回答函数实现中可能没有充分使用 summary context，复用代码时需要检查；
- LLM-as-Judge 本身也可能有判断误差，重要场景应结合人工抽检；
- 生产系统还需要权限过滤、文档版本管理、来源引用、失败降级和监控。

---

## 8. 工程启发

1. RAG 优化不能只看最终答案，要同时观察检索指标和端到端指标。
2. Summary Indexing 是一种低复杂度、高收益的检索增强方法。
3. 当 top-k 排序影响答案质量时，MRR 往往比单纯 F1 更能解释用户体验。
4. Claude 适合做语义 reranking，把“相似文档”进一步筛成“真正能回答问题的文档”。
5. 生产级 RAG 应该有稳定评估集，每次改 chunk、embedding、prompt、模型或 reranker 都要跑回归评估。
