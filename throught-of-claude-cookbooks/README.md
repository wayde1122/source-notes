# Claude Cookbooks 中文学习笔记

目录：`github - claude-cookbooks`

这里不是对原 cookbook 的逐字翻译，而是面向中文开发者整理的学习笔记。  
每篇笔记尽量围绕四个问题展开：

1. 讲的是什么
2. 为什么要这么做
3. 这样做的好处是什么
4. 如何使用

笔记会保留关键代码示例，但重点不是把 notebook 全部搬过来，而是把技术方案、适用边界和容易误解的地方讲清楚。

## 目录结构

```text
capabilities/
  classification/
  contextual-embeddings/
  knowledge_graph/
  retrieval_augmented_generation/
  summarization/
  text_to_sql/

tool_use/
  01-extracting_structured_json-summary.md
  02-calculator_tool-summary.md
  ...
  13-threat_intel_enrichment_agent-summary.md
```

## 推荐阅读顺序

建议先看 `tool_use/`，再看 `capabilities/`。

`tool_use/` 解决的是 agent 怎么调用外部能力：

- 如何让模型输出稳定 JSON
- 如何设计工具调用闭环
- 如何处理多工具、多轮工具、并行工具
- 工具很多时如何检索和按需加载
- 长任务里如何压缩上下文
- 跨会话经验如何写入和取回

入口文档：[tool_use/README.md](tool_use/README.md)

`capabilities/` 更偏具体能力 cookbook：

- 分类
- 摘要
- RAG
- Text-to-SQL
- Knowledge Graph
- Contextual Embeddings

这些内容适合在你已经理解基本 tool use 和 agent 控制流之后，再按业务方向挑着看。

## 如果只想先抓主线

可以按这个顺序读：

1. [tool_use/01-extracting_structured_json-summary.md](tool_use/01-extracting_structured_json-summary.md)
2. [tool_use/02-calculator_tool-summary.md](tool_use/02-calculator_tool-summary.md)
3. [tool_use/03-customer_service_agent-summary.md](tool_use/03-customer_service_agent-summary.md)
4. [tool_use/05-tool_choice-summary.md](tool_use/05-tool_choice-summary.md)
5. [tool_use/07-programmatic_tool_calling_ptc-summary.md](tool_use/07-programmatic_tool_calling_ptc-summary.md)
6. [tool_use/08-tool_search_with_embeddings-summary.md](tool_use/08-tool_search_with_embeddings-summary.md)
7. [tool_use/11-automatic-context-compaction-summary.md](tool_use/11-automatic-context-compaction-summary.md)
8. [tool_use/12-memory_cookbook-summary.md](tool_use/12-memory_cookbook-summary.md)

这条线读完后，基本能看懂 cookbook 里 agent 工程的核心问题：工具怎么接、上下文怎么控、长期知识怎么保存，以及哪些能力是平台专有能力。

## 阅读方式

读每篇时不要只记 API 名字，最好追问：

- 这篇到底在解决哪个工程问题？
- 如果不用这个方案，会卡在哪里？
- 方案的控制流是什么？
- 哪些代码能直接迁移，哪些只是 demo？
- 这个方案什么时候不该用？

这些问题答得出来，才算真正读懂。
