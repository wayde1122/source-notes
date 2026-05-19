# Text-to-SQL 技术要点总结

github - claude-cookbooks\capabilities\text_to_sql\guide_zh.ipynb

## 1. 核心目标

这个 cookbook 演示如何用 Claude 把自然语言问题转换为 SQL 查询，并逐步增强系统的准确性、可解释性和鲁棒性。它面向的典型用户包括数据分析师、业务人员、BI 产品开发者，以及希望在聊天机器人或内部工具中加入数据库查询能力的工程团队。

输入是用户的自然语言问题，例如“Engineering 部门员工的平均薪资是多少”；输出是可以在 SQLite 数据库中执行的 SQL。Notebook 使用一个包含 `employees` 和 `departments` 两张表的示例数据库，展示从基础 prompt 到 few-shot、思维链、RAG schema 检索、自我改进循环和 Promptfoo 评估的完整演进。

核心问题是：LLM 不仅要“写出像 SQL 的文本”，还要理解数据库 schema、选择正确表和列、构造 join、处理聚合/排序/窗口函数，并最终生成可执行且语义正确的查询。

---

## 2. 技术架构

整体架构可以概括为：

```text
用户自然语言问题
  ↓
Schema 获取 / Schema 检索
  ↓
Prompt 构造
  ├─ Basic schema prompt
  ├─ Few-shot examples
  ├─ Chain-of-thought reasoning
  └─ RAG relevant schema prompt
  ↓
Claude 生成 <sql>...</sql>
  ↓
SQL 解析
  ↓
SQLite 执行
  ↓
成功返回结果 / 失败反馈给 Claude 修正
  ↓
Promptfoo 自动评估
```

各组件职责：

| 组件                  | 职责                                               |
| --------------------- | -------------------------------------------------- |
| SQLite 数据库         | 提供员工和部门样例数据                             |
| Schema introspection  | 自动读取表名、列名和字段类型                       |
| Prompt generator      | 根据不同策略构造 Claude 输入                       |
| Claude SQL generator  | 生成带 `<sql>` 标签的 SQL 查询                     |
| SQL executor          | 执行 SQL 并返回 DataFrame 或错误                   |
| VectorDB              | 用 Voyage embedding 检索与问题最相关的 schema 字段 |
| Self-improvement loop | 根据执行错误让 Claude 重新生成 SQL                 |
| Promptfoo tests       | 从语法、语义和结果正确性评估输出                   |

这个架构的关键不是单次生成，而是把 Text-to-SQL 拆成“理解 schema → 生成 SQL → 执行验证 → 失败修复 → 自动评估”的闭环。

---

## 3. 核心流程

Notebook 展示了五个逐步增强的版本：

| 阶段                 | 方法                                | 解决的问题                                |
| -------------------- | ----------------------------------- | ----------------------------------------- |
| Basic Prompt         | 提供完整 schema 和用户问题          | 最小可用 Text-to-SQL                      |
| Few-shot             | 加入自然语言问题与 SQL 示例         | 提高输出格式和常见 join/聚合模式稳定性    |
| Chain-of-Thought     | 要求输出思考过程和 SQL              | 帮助复杂查询拆解步骤                      |
| RAG Schema Retrieval | 用 embedding 检索相关列             | 处理更大、更复杂 schema，减少 prompt 体积 |
| Self-improvement     | 执行 SQL，失败后把错误反馈给 Claude | 提升可执行性和容错能力                    |

基础版本已经能处理简单 join 查询：读取 schema 后，把用户问题和表结构放入 prompt，要求只返回 `<sql>` 标签内的 SQL。Few-shot 版本通过示例让模型学习字段选择、表连接和聚合写法。CoT 版本显式输出 `<thought_process>`，适合更复杂的多步查询。RAG 版本则面向大规模数据库，只把与问题最相关的 schema 片段放进 prompt。最后，自我改进循环把 SQL 执行结果作为反馈，使系统有机会从语法错误或 schema 错误中恢复。

---

## 4. 关键实现点

### 4.1 自动获取数据库 Schema

`get_schema_info` 使用 SQLite 元数据：

- `SELECT name FROM sqlite_master WHERE type='table'` 获取表名；
- `PRAGMA table_info(table_name)` 获取列名和类型；
- 将结果格式化为模型可读的 schema 文本。

示例 schema：

```text
Table: departments
  - id (INTEGER)
  - name (TEXT)
  - location (TEXT)

Table: employees
  - id (INTEGER)
  - name (TEXT)
  - age (INTEGER)
  - department_id (INTEGER)
  - salary (REAL)
  - hire_date (DATE)
```

自动 schema introspection 的价值是避免手写 schema 过期，也为生产系统接入真实数据库打基础。

### 4.2 用 XML 标签约束输出

所有 prompt 都要求 Claude 把 SQL 放在 `<sql>` 标签中。评估和执行时通过正则或字符串 split 提取标签内容。

这种设计让模型输出更容易被程序消费，但也有一个注意点：如果模型漏掉标签，下游解析会失败。因此生产系统应增加格式校验、重试、或更严格的结构化输出策略。

### 4.3 Few-shot 示例

Few-shot prompt 提供了典型样例：

- 按部门筛选员工；
- 计算某部门平均工资；
- 查询年龄最大的员工。

示例的作用不是覆盖所有问题，而是给模型建立“自然语言 → SQL 模式”的局部语法，包括 join、where、order by、aggregation 等。

### 4.4 Chain-of-Thought 拆解复杂查询

CoT prompt 要求模型先输出 `<thought_process>`，说明：

1. 需要哪些表；
2. join 条件是什么；
3. 过滤条件是什么；
4. 是否需要聚合、排序或分组；
5. 最后如何构造 SQL。

这种方式对复杂查询有帮助，尤其是涉及多表连接、group by、having、窗口函数时。Notebook 中的评估也显示，CoT + Few-shot 相比基础 prompt 往往有更高通过率，但代价是 token、延迟和成本上升。

### 4.5 RAG 处理复杂 Schema

当 schema 很大时，把完整 schema 放入每次 prompt 并不现实。Notebook 构建了一个简单 `VectorDB`：

- 用 Voyage `voyage-2` 为每个“表-列-类型”生成 embedding；
- 用 pickle 持久化 embeddings、metadata 和 query cache；
- 查询时将用户问题 embedding，与 schema embedding 点积相似度排序；
- 只取相似度超过阈值且排名靠前的字段。

RAG prompt 只提供相关列，例如薪资查询会优先召回 `employees.salary`、`employees.department_id`、`departments.name` 等字段。这样可以减少上下文噪声，并让方案扩展到更大的数据库。

### 4.6 SQL 执行与自我改进

自我改进循环的核心是：

```text
生成 SQL
  ↓
执行 SQL
  ↓
成功：返回结果
失败：把错误信息、原 SQL、用户问题反馈给 Claude
  ↓
Claude 生成修正版 SQL
```

`execute_sql_with_feedback` 捕获异常并返回错误字符串；`generate_prompt_with_self_improvement` 最多尝试 3 次。这个模式对生产系统很重要，因为 Text-to-SQL 的主要风险之一是生成的查询看似合理但无法执行，或使用了不兼容的 SQL 方言。

---

## 5. 指标与结果

评估使用 Promptfoo，测试内容覆盖：

- 简单查询语法；
- Engineering 部门员工数量；
- 最老员工的详细信息；
- New York 部门平均薪资且员工数大于 5；
- 高于部门平均薪资的员工及百分比差；
- 多聚合层级查询；
- 部门预算分配分析，包括 CTE、窗口函数和分区排序。

评估维度包括：

| 维度                    | 含义                                 |
| ----------------------- | ------------------------------------ |
| Syntax                  | SQL 是否能被解析和执行               |
| Query Semantics         | 是否表达了自然语言查询意图           |
| Result Correctness      | 执行结果是否与预期一致               |
| Complex Query Handling  | 是否能处理子查询、窗口函数、多级聚合 |
| Cost / Latency / Tokens | 质量提升带来的资源代价               |

Notebook 中给出的对比结果如下：

| 模型与策略            | 通过率 | 平均延迟(ms) | 平均 tokens |   成本 |
| --------------------- | -----: | -----------: | ----------: | -----: |
| 3H Basic              |  83.3% |         1561 |         383 | 0.0023 |
| 3H Few-Shot           |  77.8% |         1758 |         572 | 0.0027 |
| 3H CoT+Few-Shot       |  88.9% |         2187 |         765 | 0.0034 |
| 3H RAG+Few-Shot+CoT   |  88.9% |         2564 |        1001 | 0.0044 |
| 3.5S Basic            |  88.9% |         1887 |         309 |  0.020 |
| 3.5S Few-Shot         |  94.4% |         2297 |         496 |  0.024 |
| 3.5S CoT+Few-Shot     |   100% |         3900 |         765 |  0.041 |
| 3.5S RAG+Few-Shot+CoT |   100% |         4614 |         984 |  0.050 |

主要结论是：Sonnet 在复杂查询上更稳；CoT 和 RAG 能提升复杂任务通过率，但会增加延迟、token 和成本。Haiku 成本更低，适合简单查询或作为初筛模型；Sonnet 更适合高价值、高复杂度查询。

---

## 6. 技术亮点

1. **从一次性生成升级为执行闭环**  
   Text-to-SQL 不能只看生成文本，必须执行验证并处理错误反馈。

2. **Schema 自动发现**  
   通过数据库元数据动态生成 schema，避免手写文档失效。

3. **XML 标签作为轻量结构化协议**  
   `<sql>` 和 `<thought_process>` 让模型输出更容易解析、测试和展示。

4. **RAG 用于 schema 裁剪**  
   大数据库不应无脑塞完整 schema，按查询检索相关表列更可扩展。

5. **评估覆盖语法、语义和结果**  
   只检查 SQL 是否可执行不够，还要验证结果是否符合预期。

6. **模型和策略可按复杂度分层选择**  
   简单查询可用低成本模型，复杂查询再升级到 Sonnet + CoT + RAG。

---

## 7. 局限与注意点

- 示例数据库只有两张表，真实企业数据库会有更多表、关系、权限和业务术语。
- Notebook 中的 CoT 示例使用了 `YEAR(hire_date)`，但 SQLite 原生并不支持 MySQL 风格 `YEAR()`，说明方言约束必须更严格。
  - 生成 SQL 后直接执行存在安全风险，生产中应限制只读查询、加超时、加行数限制，并禁止危险语句。
  - RAG 只索引列名和类型，没有索引外键关系、业务定义、样例值、列统计信息和数据血缘。
- 自我改进依赖错误信息，无法保证修正后的 SQL 语义一定正确。
- `<sql>` 字符串解析较脆弱，应增加 robust parser、校验和重试机制。

---

## 8. 工程启发

1. **Text-to-SQL 应设计成“生成 + 执行 + 校验”系统**，而不是单纯的 prompt demo。
2. **Schema 上下文质量决定上限**：真实系统应加入外键、列说明、样例数据、常见指标定义和业务术语映射。
3. **复杂查询需要分层策略**：先用便宜模型处理简单问题，对高复杂度或失败查询升级模型和 prompt。
4. **评估集必须覆盖业务关键查询**：尤其是窗口函数、CTE、复杂聚合、权限过滤和边界条件。
5. **生产化必须重视安全**：默认只读、SQL 白名单、查询计划检查、超时限制、审计日志和权限隔离都不可省略。
