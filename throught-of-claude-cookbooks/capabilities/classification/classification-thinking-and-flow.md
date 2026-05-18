# Claude Cookbooks Classification 思想方式与核心流程总结

> 来源：`capabilities/classification` cookbook 里的分类示例。
>
> 主题：如何用 Claude 构建一个可评估、可迭代、可解释的文本分类系统。

---

## 一、这套 cookbook 的核心思想

这个分类示例真正想传达的不是“写一个 prompt 让 Claude 分类”，而是一种构建 LLM 应用的方法论：

> **不要一开始就追求复杂方案，而是从最简单的 baseline 开始，用评估发现问题，再针对问题逐步加上下一个能力。**

也就是说，它采用的是一种递进式工程思路：

```text
先定义问题
  ↓
建立可量化评估
  ↓
做最简单 baseline
  ↓
观察错误模式
  ↓
针对错误加能力
  ↓
再次评估
  ↓
持续迭代
```

这和很多 LLM 应用开发中的常见误区相反。

常见误区是：

```text
一上来就写复杂 prompt / 加 RAG / 加 agent / 加 workflow
```

而这个 cookbook 展示的是：

```text
先证明简单方案不够，再引入复杂能力。
```

这样做的好处是：

1. 每一步为什么存在都很清楚。
2. 每个新增组件都能用数据证明价值。
3. 避免过度工程。
4. 最后得到的是一个可解释、可维护、可回归测试的系统。

---

## 二、任务本质：固定标签分类

这个示例的任务是保险客服工单分类。

输入是一条客户支持 ticket，例如：

```text
I just got my auto policy renewal bill and the cost seems to be more than what I usually pay.
Could you explain the reason for the increase?
```

输出是固定标签之一，例如：

- Billing Inquiries
- Policy Administration
- Claims Assistance
- Coverage Explanations
- Quotes and Proposals
- Account Management
- Billing Disputes
- Claims Disputes
- Policy Comparisons
- General Inquiries

这里的关键不是“让模型自由判断”，而是：

> **让模型在一个明确的标签集合中做选择。**

所以整个系统围绕三个问题展开：

1. 标签定义是否清楚？
2. 模型能否稳定输出合法标签？
3. 模型在哪些标签之间容易混淆？

---

## 三、核心流程总览

整体流程可以概括为：

```text
1. 定义分类任务和标签体系
2. 准备 train / test 数据
3. 建立评估框架
4. 做随机分类 baseline
5. 做 simple Claude classifier
6. 分析错误和混淆类别
7. 构建向量检索库 VectorDB
8. 做 RAG-enhanced classifier
9. 加入 chain-of-thought reasoning
10. 用 Promptfoo 做系统化评估
11. 根据准确率、成本、延迟选择生产方案
```

---

## 四、每一步的作用

### 1. 定义分类任务和标签体系

**作用：明确分类边界。**

分类任务最容易失败的地方不是模型不聪明，而是类别定义不清楚。

例如：

```text
Billing Inquiries：询问账单、费用、付款方式等
Billing Disputes：投诉错误收费、要求退款、争议费用等
```

这两个类别都和 billing 有关，但业务意图不同。

所以第一步要做的是：

- 明确有哪些类别。
- 给每个类别写清楚定义。
- 尽量说明类别之间的差别。

这一步决定了后面 prompt 和评估的基础。

---

### 2. 准备 train / test 数据

**作用：把“用于辅助分类的数据”和“用于评估的数据”分开。**

cookbook 里有两份数据：

```text
train.tsv：作为历史标注样例库
 test.tsv：作为最终测试集
```

这里的 train 不是用来 fine-tune 模型，而是作为 RAG 的案例库。

也就是说：

```text
train data -> 做 embedding -> 存入向量库 -> 检索相似案例
 test data -> 用来评估分类效果
```

这样可以保证评估相对公平：

- 模型分类时可以参考训练案例。
- 但准确率是在独立测试集上计算的。

---

### 3. 建立评估框架

**作用：让 prompt 改动可以被量化比较。**

评估框架负责：

1. 遍历测试集。
2. 对每条 ticket 调用分类器。
3. 收集预测标签。
4. 和真实标签比较。
5. 输出 accuracy、precision、recall、F1、confusion matrix。

其中 confusion matrix 很关键。

因为总体准确率只能告诉你：

```text
整体对了多少
```

但 confusion matrix 能告诉你：

```text
哪些类别经常被混淆
```

例如：

```text
Billing Inquiries ↔ Billing Disputes
Claims Assistance ↔ Claims Disputes
Coverage Explanations ↔ Policy Comparisons
```

这一步让后面的迭代有方向，而不是凭感觉改 prompt。

---

### 4. Random baseline

**作用：建立最低性能基准。**

随机分类器会在 10 个类别里随机选一个。

因为有 10 个类别，所以随机准确率大约是 10%。

这一步看起来简单，但很重要。

它回答了一个问题：

> 如果系统完全没有智能，只靠瞎猜，表现是多少？

后面 simple classifier 达到约 70%，RAG 达到约 94%，CoT 达到约 95%+，这些提升才有参照物。

---

### 5. Simple Claude classifier

**作用：测试 Claude 单靠类别定义能做到什么程度。**

这个阶段的 prompt 包含：

```text
1. 分类任务说明
2. 类别定义
3. 当前 ticket
4. 输出格式要求
```

大致结构是：

```xml
<categories>
  <category>
    <label>Billing Inquiries</label>
    <content>...</content>
  </category>
</categories>

<ticket>
  用户 ticket
</ticket>

Respond with just the label.
```

这里有几个重要设计点。

#### 5.1 用 XML 结构化 prompt

**作用：减少歧义。**

XML tags 可以清楚地区分：

- 哪部分是类别定义。
- 哪部分是用户 ticket。
- 哪部分是输出要求。

这让模型更容易理解输入结构。

#### 5.2 控制输出格式

**作用：方便程序解析和评估。**

分类系统希望输出：

```text
Billing Inquiries
```

而不是：

```text
This ticket should be categorized as Billing Inquiries because...
```

稳定、简短、可解析的输出对生产系统很重要。

#### 5.3 使用低随机性设置

**作用：提高分类稳定性。**

分类任务通常不需要创造性。相同输入应该尽量得到相同输出。

这个 simple classifier 的准确率大约能到 70%。

这说明：

> 只靠类别定义，Claude 已经能解决大部分简单样例，但对边界模糊的类别还不够稳。

---

### 6. 错误分析

**作用：找出 simple classifier 的主要瓶颈。**

从 simple classifier 的 confusion matrix 可以看到，模型主要错在相近类别之间。

例如：

```text
Billing Inquiries vs Billing Disputes
Claims Assistance vs Claims Disputes
Policy Comparisons vs Coverage Explanations
```

这说明问题不是模型完全不懂，而是：

> 类别边界需要更多具体案例来说明。

因此下一步引入 RAG 是有明确原因的。

不是为了“炫技”而加 RAG，而是因为错误分析证明：

```text
抽象类别定义不够，需要相似历史案例辅助判断。
```

---

### 7. 构建 VectorDB

**作用：把历史标注样例变成可检索的案例库。**

VectorDB 做的事情是：

```text
1. 读取 train.tsv 中的 ticket
2. 用 embedding 模型把文本转成向量
3. 保存向量和标签 metadata
4. 对新 ticket 也做 embedding
5. 计算相似度
6. 找出最相似的 K 条历史样例
```

它的作用不是替代 Claude，而是给 Claude 提供更相关的上下文。

可以理解为：

```text
Claude = 决策者
VectorDB = 帮 Claude 找相似历史案例的检索系统
```

这一步解决的是：

> 当前 ticket 和过去哪些已标注 ticket 最像？

---

### 8. RAG-enhanced classifier

**作用：用动态 few-shot examples 改善分类准确率。**

RAG classifier 会先检索相似案例，再把这些案例放入 prompt。

大致结构是：

```xml
<categories>
  类别定义
</categories>

<ticket>
  当前 ticket
</ticket>

<examples>
  <example>
    <query>历史 ticket 1</query>
    <label>Billing Disputes</label>
  </example>
  <example>
    <query>历史 ticket 2</query>
    <label>Billing Inquiries</label>
  </example>
</examples>

Respond with just the label.
```

这一步的核心不是简单 few-shot，而是：

> 每条输入都有自己最相关的 few-shot examples。

这比固定示例更强，因为不同 ticket 需要参考不同历史案例。

RAG 的价值是：

1. 让模型看到具体业务边界。
2. 帮助模型区分相似标签。
3. 不需要 fine-tune。
4. 标注样例可以持续增加。

这一阶段准确率从约 70% 提升到约 94%。

---

### 9. RAG + Chain-of-thought reasoning

**作用：让模型在最终分类前显式比较候选类别。**

有些分类错误不是因为没有相似样例，而是因为 ticket 本身语义模糊，需要推理。

例如：

```text
I have a question about my bill, but I think the amount may be wrong.
```

这里同时包含：

```text
question about bill -> Billing Inquiries
amount may be wrong -> Billing Disputes
```

RAG + CoT 会让 Claude 先分析：

```text
用户是在普通询问，还是在提出收费错误的争议？
```

然后再输出最终类别。

输出结构类似：

```xml
<response>
  <scratchpad>分析过程</scratchpad>
  <category>Billing Disputes</category>
</response>
```

程序只解析 `<category>` 里的最终标签。

这一步主要提升的是边界样例的表现。

准确率可以进一步到约 95%–97%。

---

### 10. Promptfoo 系统化评估

**作用：把 notebook 里的实验变成可重复的评估流程。**

notebook 适合探索，但生产系统需要更系统的评估工具。

Promptfoo 可以做：

- 多个 prompt 版本对比。
- 多个 temperature 对比。
- 自动 pass / fail 判断。
- 保存结果。
- 回归测试。

在这个 cookbook 中，Promptfoo 比较了：

```text
Simple
RAG
RAG + CoT
```

以及不同 temperature：

```text
0.0, 0.2, 0.4, 0.6, 0.8
```

评估结果说明：

```text
Simple：约 70%
RAG：约 90%+
RAG + CoT：约 95%+
```

这一步的价值是：

> 让 prompt 工程从经验主义变成实验驱动。

---

## 五、这套方法论的核心原则

### 原则 1：先有评估，再做优化

不要先问：

```text
我应该怎么写最强 prompt？
```

而是先问：

```text
我怎么知道这个 prompt 更强？
```

所以 evaluation framework 是整个流程的地基。

---

### 原则 2：从最简单方案开始

先做 simple classifier，而不是直接上 RAG + CoT。

因为只有 simple classifier 失败了，才知道 RAG 是否必要。

这避免了无意义的复杂化。

---

### 原则 3：通过错误模式决定下一步

不是随机尝试技巧，而是看 confusion matrix：

```text
模型主要错在哪里？
```

如果错误集中在相似类别之间，那么就加相似案例，也就是 RAG。

如果错误集中在模糊意图判断，那么就加 reasoning，也就是 CoT。

---

### 原则 4：RAG 是为了补充业务边界

RAG 在这个任务里的作用不是“查知识”，而是：

```text
提供相似历史标注样例，让模型理解业务标签边界。
```

这和普通问答场景里的 RAG 不完全一样。

在分类场景中，RAG 更像是动态 few-shot learning。

---

### 原则 5：输出必须稳定可解析

分类系统不是聊天机器人。

它的输出要能被程序消费。

所以输出应尽量是：

```text
单一标签
结构化字段
固定 schema
```

不要让模型自由发挥。

---

### 原则 6：最终方案要考虑准确率、成本、延迟

RAG + CoT 准确率最高，但也可能带来：

- 更多 token
- 更高延迟
- 更复杂系统

生产中不一定永远选最复杂方案。

可以根据业务需求选择：

| 场景 | 方案 |
|---|---|
| 类别很清晰、成本敏感 | Simple classifier |
| 有少量标注样例、准确率要求较高 | RAG classifier |
| 类别边界复杂、错误成本高 | RAG + CoT |
| 大规模批量分类、对实时性不敏感 | Batch / Promptfoo / 离线评估流程 |

---

## 六、可以迁移到其他分类任务的通用模板

这套流程不只适用于保险工单，也适用于：

- 客服意图识别
- 邮件分类
- 工单路由
- 风险等级判断
- 内容审核标签
- 销售线索分类
- 用户反馈归因
- 文档类型识别

通用流程是：

```text
1. 定义标签集合
2. 为每个标签写清楚定义和边界
3. 准备少量标注数据
4. 划分 train / test
5. 建立评估函数
6. 做 random baseline
7. 做 simple LLM classifier
8. 看 confusion matrix
9. 如果相似标签混淆：加 RAG examples
10. 如果边界样例仍错：加 reasoning
11. 用系统化 eval 做 prompt 回归测试
12. 根据准确率 / 成本 / 延迟选择上线方案
```

---

## 七、一句话总结

这个 cookbook 的核心不是某个具体 prompt，而是一种 LLM 应用开发范式：

> **把 LLM 分类任务当成一个可评估、可诊断、可迭代的系统工程来做：先定义标签和评估，再从简单 baseline 出发，通过错误分析逐步引入 RAG 和 reasoning，最后用系统化评估选择生产方案。**
