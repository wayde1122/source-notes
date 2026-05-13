# Knowledge Graph Construction with Claude 技术要点总结

来源：`D:\claude-cookbooks\capabilities\knowledge_graph\guide.ipynb`

## 1. 核心目标

这篇 notebook 演示如何用 Claude 从非结构化文本中构建知识图谱。它解决的问题是：普通 RAG 能检索相关文本片段，但当问题需要跨多篇文档串联实体和关系时，单纯检索不容易表达“谁和谁有什么关系”“某个事件连接了哪些组织、人物和地点”这类多跳事实链。

知识图谱把文本中的信息转成：

- **节点**：实体，例如人、组织、地点、事件、物品；
- **边**：实体之间的关系，例如 `commanded`、`launched from`、`part of`。

Notebook 的核心思路是：用 Claude 的结构化输出代替传统 NER、关系抽取和实体消歧模型，快速搭建一条从文本到图谱、再到图谱问答的 pipeline。

---

## 2. 技术架构

整体架构可以概括为：

```text
原始文档
  ↓
Claude + Pydantic Schema 抽取实体和关系
  ↓
Raw Entities + Raw Relations
  ↓
Claude Entity Resolution 合并别名
  ↓
Canonical Entities + Relations
  ↓
NetworkX 构建 MultiDiGraph
  ↓
Hub Entity Profile 生成
  ↓
序列化相关子图
  ↓
Claude 基于图上下文回答多跳问题
  ↓
Gold Set 评估 Precision / Recall / F1
```

各组件职责：

| 组件 | 职责 |
|---|---|
| Structured Extraction | 从文本中抽取实体和 subject-predicate-object 关系 |
| Entity Resolution | 合并同一实体的不同名称、别名和简称 |
| Graph Builder | 用 canonical entities 和 relations 构建有向多重图 |
| Entity Profiling | 为关键节点生成结构化实体说明 |
| Graph-grounded QA | 序列化子图，让 Claude 基于图中边回答问题 |
| Evaluation | 用人工 gold set 评估抽取质量 |

示例语料使用 Apollo 相关 Wikipedia 摘要，包括 Apollo program、Apollo 11、Neil Armstrong、Saturn V、Buzz Aldrin、Kennedy Space Center。这些文档共享大量实体，适合演示实体合并和多跳推理。

---

## 3. 核心流程

### 3.1 结构化实体与关系抽取

Notebook 先定义 Pydantic schema：

- `Entity`：包含 `name`、`type`、`description`；
- `Relation`：包含 `source`、`predicate`、`target`；
- `ExtractedGraph`：包含 `entities` 和 `relations`。

然后使用 Claude structured output，让模型直接返回符合 schema 的 Python 对象，而不是一段需要手动解析的 JSON 字符串。

抽取阶段的关键要求是：

- 只抽取文档核心实体，跳过偶然提及；
- 每个实体都生成一句 description，用于后续实体消歧；
- predicate 使用短动词短语；
- 每条关系必须连接已经抽取出的实体。

示例运行结果：6 篇文章共抽取 **36 个 raw entities** 和 **34 条 raw relations**。

### 3.2 实体解析

直接用 raw entities 建图会产生碎片化问题，例如：

- `Neil Armstrong` 与 `Neil Alden Armstrong`；
- `Buzz Aldrin` 与 `Edwin Aldrin`；
- `Moon` 与 `the Moon`。

Notebook 的做法是：按实体类型分组，把实体名和 description 交给 Claude，让 Claude 输出 canonical name 和 aliases。

这里的关键是 description。字符串相似度很难识别 `Edwin Aldrin` 和 `Buzz Aldrin` 是同一个人，但如果描述都指向 Apollo 11 宇航员，Claude 就能更可靠地合并。

示例中，24 个唯一 raw names 被合并为 22 个 canonical entities。

### 3.3 图构建

实体解析后，Notebook 用 NetworkX 构建 `MultiDiGraph`。

选择有向多重图的原因是：

- 关系有方向，例如 `Armstrong commanded Apollo 11` 不能反过来理解；
- 两个实体之间可能存在多种关系，所以需要 multi graph。

节点属性包括：

- entity type；
- description；
- source docs；
- mentions。

边属性包括：

- predicate；
- source doc。

示例图结果：**22 个节点、34 条边、1 个弱连通分量**。

### 3.4 实体 Profile 生成

图中的节点不应该只是一个名称。Notebook 对 hub 节点进一步生成结构化实体 profile：

- 收集所有提到该实体的文档摘要；
- 收集该节点的入边和出边；
- 用 Claude 生成 summary、key facts、time range。

这一步把图中的核心节点从“标签”升级成可读、可检索、可用于后续问答的知识对象。

### 3.5 图上下文问答

Notebook 的关键 payoff 是 graph-grounded QA。

它先从某个中心节点取 2-hop 子图，再把子图序列化成三元组文本，交给 Claude 回答问题。

例如问题：

> Which locations are connected to people who were part of Apollo 11, and how?

没有图上下文时，Claude 可能依赖预训练知识回答很多真实但不可追溯的信息；有图上下文时，Claude 只能基于图中存在的边回答，并指出哪些关系有证据、哪些图中没有支持。

这说明知识图谱可以作为 grounding layer，让答案基于可追溯的实体和边，而不是模型记忆。

---

## 4. 关键实现点

### 4.1 LLM + Schema 作为稳定抽取接口

这篇 notebook 最可复用的模式是：

```text
Prompt 表达抽取任务
+ Pydantic Schema 固定输出结构
+ Claude structured output 返回可验证对象
```

这样下游代码可以直接处理 `entities` 和 `relations`，而不是解析自由格式文本。schema 也成为 pipeline 的接口边界：prompt、模型、文档来源可以变化，但下游图构建逻辑保持稳定。

### 4.2 先抽取 description，再做实体消歧

实体 description 不是展示字段，而是 entity resolution 的关键上下文。它能帮助模型判断两个名称是否指向同一实体，也能降低同名不同实体被误合并的风险。

### 4.3 模型分工

Notebook 使用了不同模型承担不同任务：

| 模型 | 用途 |
|---|---|
| `claude-haiku-4-5` | 高频、低成本的结构化实体和关系抽取 |
| `claude-sonnet-4-6` | 实体解析、实体总结、图谱问答等需要综合判断的任务 |

这个分工体现了常见工程权衡：批量任务用便宜模型，复杂综合任务用更强模型。

### 4.4 图作为可追溯上下文

与普通 RAG 直接拼接原文不同，知识图谱把上下文变成结构化边：

```text
source --predicate--> target
```

这样回答时可以引用具体边，说明答案由哪些关系支持，也能明确指出图中没有证据的部分。

---

## 5. 指标与结果

Notebook 用人工标注的 gold set 评估抽取质量，核心指标是：

| 指标 | 含义 |
|---|---|
| Precision | 抽取出的实体 / 关系中有多少是正确的 |
| Recall | gold set 中应该抽取的内容有多少被抽到 |
| F1 | Precision 和 Recall 的综合 |

关键结果和现象：

| 项目 | 结果 |
|---|---|
| Raw entities | 36 |
| Raw relations | 34 |
| Unique raw names | 24 |
| Canonical entities | 22 |
| Graph nodes | 22 |
| Graph edges | 34 |
| Weakly connected components | 1 |

评估时需要注意：实体解析可能提升 recall，因为别名被合并到 gold 能识别的名称；也可能降低指标，因为 resolver 选择了 gold alias map 中没有覆盖的 canonical name。这种情况不一定说明模型错，也可能说明评估 alias map 不完整。

---

## 6. 技术亮点

1. **LLM + Schema 替代传统 NLP 抽取链路**  
   不需要单独训练 NER 和关系分类模型，直接用 Claude 生成符合 schema 的结构化结果。

2. **实体描述驱动 Entity Resolution**  
   不只靠字符串相似度，而是用实体描述帮助判断别名、简称、全称是否指向同一对象。

3. **图谱作为 grounding layer**  
   多跳问答基于图中节点和边，答案更可追溯，也更适合私有语料。

4. **批量抽取和综合推理分模型处理**  
   Haiku 用于低成本高吞吐抽取，Sonnet 用于更复杂的解析、总结和问答。

5. **评估闭环驱动 prompt 和解析策略优化**  
   用 gold set 计算 Precision / Recall / F1，可以系统性判断 prompt 修改是否真的改进了抽取质量。

---

## 7. 局限与注意点

- NetworkX 适合 demo 和中等规模图，生产环境需要 Neo4j、Neptune、Postgres adjacency table 等持久化方案；
- 大规模实体解析不能一次把所有实体交给 Claude，需要先用 blocking 缩小候选集合；
- Entity resolution 存在漏收 alias 和过度合并风险；
- 图质量高度依赖抽取 prompt、schema 设计和评估集质量；
- 如果 gold alias map 不完整，评估结果可能低估实际抽取质量；
- 生产中需要增量更新机制，而不是每次重建整张图。

---

## 8. 工程启发

1. 知识图谱适合跨文档、多跳事实链问题；RAG 更适合直接检索原文，两者可以互补。
2. 对 LLM 抽取任务，应优先设计稳定 schema，而不是依赖自然语言格式输出。
3. Entity resolution 是图谱质量的核心，实体 description 应作为消歧输入保留下来。
4. 图谱问答应基于序列化子图和边级证据，避免直接依赖模型预训练知识。
5. 生产化时要重点处理成本、blocking、增量更新、图存储和评估闭环。
