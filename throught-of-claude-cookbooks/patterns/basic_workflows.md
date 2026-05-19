# 《Basic Multi-LLM Workflows》学习笔记：用三种基础模式组织多个 Claude 调用

> 源 Notebook：`patterns/agents/basic_workflows.ipynb`

## 1. 学习目标

这篇 notebook 的目标是讲清楚三种最基础的多 LLM 工作流：**Prompt-Chaining**、**Parallelization** 和 **Routing**。

它不是在展示某个复杂 Agent 框架，而是在回答一个更基础的问题：

> 当一次 Claude 调用不够用时，如何用简单的 Python 控制结构，把多个 Claude 调用组织成更稳定、更可控的工作流？

学完后，你应该能判断一个任务应该：

- 顺序拆成多个步骤执行；
- 并发分给多个模型调用处理；
- 先分类，再走不同的专用处理路径。

这三个模式非常基础，但也很重要。后续很多 Agent、workflow、多工具系统，本质上都可以拆回这三类结构：**顺序执行、并行执行、条件路由**。

## 2. 这个示例解决的问题

单次 prompt 适合简单任务，但遇到稍复杂的业务流程时会有几个问题：

- 一次性让模型完成太多事情，输出容易漂移；
- 不同子任务可能互相独立，却被串在一次调用里，浪费时间；
- 不同输入需要不同处理方式，但单一 prompt 很难兼顾所有场景；
- 程序很难观察中间过程，也很难定位哪一步出了问题。

这篇 notebook 用三个小例子展示如何解决这些问题：

| 模式 | 示例任务 | 解决的问题 |
|---|---|---|
| Prompt-Chaining | 把业绩文本整理成 Markdown 表格 | 多步骤顺序转换 |
| Parallelization | 分析市场变化对不同利益相关者的影响 | 多个独立子任务并发处理 |
| Routing | 把客服工单分配给 billing / technical / account / product | 根据输入选择专用处理路径 |

## 3. 核心概念

### 3.1 Prompt-Chaining

Prompt-Chaining 是把一个任务拆成多个连续步骤。每一步都是一次 Claude 调用，前一步的输出会成为后一步的输入。

适合场景：

- 数据清洗；
- 文本格式转换；
- 分阶段抽取；
- 先粗处理再精加工的任务。

它的核心特点是：**步骤之间有依赖关系，必须按顺序执行**。

### 3.2 Parallelization

Parallelization 是把多个互不依赖的输入或子任务同时交给多个 Claude 调用处理。

适合场景：

- 多角色分析；
- 批量文档处理；
- 多角度头脑风暴；
- 多个候选方案生成。

它的核心特点是：**子任务之间没有依赖，可以并发执行以降低总耗时**。

### 3.3 Routing

Routing 是先让 Claude 判断输入属于哪一类，再把输入交给对应的专用 prompt 或处理链路。

适合场景：

- 客服工单分流；
- 内容审核分流；
- 用户意图识别；
- 多专家系统入口。

它的核心特点是：**先分类，再执行专用逻辑**。

### 3.4 结构化输出解析

notebook 使用 XML 标签让 Claude 输出可解析字段，例如：

```xml
<reasoning>...</reasoning>
<selection>account</selection>
```

然后用 `extract_xml` 取出对应内容。这样模型输出就不只是给人看的文本，而是可以被程序消费的中间结果。

## 4. 整体流程图

三个 workflow 可以用下面的方式理解：

```text
Prompt-Chaining
输入文本
  ↓
步骤 1：抽取信息
  ↓
步骤 2：转换格式
  ↓
步骤 3：排序 / 规范化
  ↓
步骤 4：生成最终结果
```

```text
Parallelization
输入 A ─┐
输入 B ─┼─> 多个 Claude 调用并发执行 ─> 多个结果
输入 C ─┘
```

```text
Routing
用户输入
  ↓
Claude 判断类型
  ↓
选择对应 route
  ↓
调用专用 prompt
  ↓
生成最终回复
```

这三种流程分别对应三种控制结构：

| 工作流 | 程序控制结构 | 关键词 |
|---|---|---|
| Prompt-Chaining | 顺序循环 | pipeline |
| Parallelization | 并发执行 | fan-out |
| Routing | 条件分支 | dispatch |

## 5. 核心代码精读

### 5.1 公共依赖：LLM 调用与 XML 解析

notebook 的核心代码依赖两个辅助函数：

```python
from concurrent.futures import ThreadPoolExecutor

from util import extract_xml, llm_call
```

`llm_call` 来自 `patterns/agents/util.py`，它封装了 Claude Messages API：

```python
def llm_call(prompt: str, system_prompt: str = "", model="claude-sonnet-4-6") -> str:
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    messages = [{"role": "user", "content": prompt}]
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=messages,
        temperature=0.1,
    )
    return response.content[0].text
```

这里的关键点：

- `temperature=0.1`：让输出更稳定，适合 workflow 示例；
- `max_tokens=4096`：给中间结果和最终结果留足输出空间；
- 返回值是纯文本，后续由调用方自行解析。

`extract_xml` 用正则提取 XML 标签内容：

```python
def extract_xml(text: str, tag: str) -> str:
    match = re.search(f"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
    return match.group(1) if match else ""
```

这个函数在 Routing 中很重要，因为程序需要从 Claude 的输出中拿到 `<selection>`，再决定后续走哪条 route。

---

### 5.2 Prompt-Chaining：把一个任务拆成顺序步骤

核心代码：

```python
def chain(input: str, prompts: list[str]) -> str:
    """Chain multiple LLM calls sequentially, passing results between steps."""
    result = input
    for i, prompt in enumerate(prompts, 1):
        print(f"\nStep {i}:")
        result = llm_call(f"{prompt}\nInput: {result}")
        print(result)
    return result
```

这段代码很短，但体现了 Prompt-Chaining 的本质：

```text
result 初始值 = 原始输入
for 每一个 prompt:
    result = Claude(prompt + 上一步 result)
最终返回 result
```

也就是说，每一步都只需要关心当前阶段要做什么，而不用一次性承担完整任务。

notebook 中的示例是处理 Q3 业绩报告。它定义了 4 个步骤：

```python
data_processing_steps = [
    """Extract only the numerical values and their associated metrics from the text.
    Format each as 'value: metric' on a new line.""",
    """Convert all numerical values to percentages where possible.
    If not a percentage or points, convert to decimal.""",
    """Sort all lines in descending order by numerical value.""",
    """Format the sorted data as a markdown table with columns:
    | Metric | Value |""",
]
```

输入是一段自然语言报告：

```python
report = """
Q3 Performance Summary:
Our customer satisfaction score rose to 92 points this quarter.
Revenue grew by 45% compared to last year.
Market share is now at 23% in our primary market.
Customer churn decreased to 5% from 8%.
New user acquisition cost is $43 per user.
Product adoption rate increased to 78%.
Employee satisfaction is at 87 points.
Operating margin improved to 34%.
"""

formatted_result = chain(report, data_processing_steps)
```

最终输出会被整理成 Markdown 表格，例如：

```md
| Metric | Value |
|:--|--:|
| Customer Satisfaction | 92% |
| Employee Satisfaction | 87% |
| Product Adoption Rate | 78% |
| Revenue Growth | 45% |
```

这个例子说明：如果一个任务可以拆成多个确定步骤，Prompt-Chaining 比“一次性写一个巨大 prompt”更容易控制。

---

### 5.3 Parallelization：把独立子任务并发执行

核心代码：

```python
def parallel(prompt: str, inputs: list[str], n_workers: int = 3) -> list[str]:
    """Process multiple inputs concurrently with the same prompt."""
    with ThreadPoolExecutor(max_workers=n_workers) as executor:
        futures = [executor.submit(llm_call, f"{prompt}\nInput: {x}") for x in inputs]
        return [f.result() for f in futures]
```

这里使用 `ThreadPoolExecutor` 并发调用 `llm_call`。

它的执行结构是：

```text
同一个 prompt + input_1 → Claude 调用 1
同一个 prompt + input_2 → Claude 调用 2
同一个 prompt + input_3 → Claude 调用 3
...
等待所有结果返回
```

notebook 中的示例是利益相关者影响分析：

```python
stakeholders = [
    """Customers:
    - Price sensitive
    - Want better tech
    - Environmental concerns""",
    """Employees:
    - Job security worries
    - Need new skills
    - Want clear direction""",
    """Investors:
    - Expect growth
    - Want cost control
    - Risk concerns""",
    """Suppliers:
    - Capacity constraints
    - Price pressures
    - Tech transitions""",
]

impact_results = parallel(
    """Analyze how market changes will impact this stakeholder group.
    Provide specific impacts and recommended actions.
    Format with clear sections and priorities.""",
    stakeholders,
)
```

每个 stakeholder 的分析彼此独立，所以可以并发处理。

这个模式的关键判断标准是：**子任务之间是否真的没有依赖关系**。如果有依赖，就不适合并发；如果没有依赖，并发可以明显减少总耗时。

---

### 5.4 Routing：先判断类型，再调用专用 prompt

Routing 的核心代码如下：

```python
def route(input: str, routes: dict[str, str]) -> str:
    """Route input to specialized prompt using content classification."""
    print(f"\nAvailable routes: {list(routes.keys())}")
    selector_prompt = f"""
    Analyze the input and select the most appropriate support team from these options: {list(routes.keys())}
    First explain your reasoning, then provide your selection in this XML format:

    <reasoning>
    Brief explanation of why this ticket should be routed to a specific team.
    Consider key terms, user intent, and urgency level.
    </reasoning>

    <selection>
    The chosen team name
    </selection>

    Input: {input}""".strip()

    route_response = llm_call(selector_prompt)
    reasoning = extract_xml(route_response, "reasoning")
    route_key = extract_xml(route_response, "selection").strip().lower()

    print("Routing Analysis:")
    print(reasoning)
    print(f"\nSelected route: {route_key}")

    selected_prompt = routes[route_key]
    return llm_call(f"{selected_prompt}\nInput: {input}")
```

这个函数分两次调用 Claude：

1. **第一次调用**：让 Claude 判断输入应该走哪个 route；
2. **第二次调用**：用对应 route 的专用 prompt 生成回答。

notebook 中定义了四类客服 route：

```python
support_routes = {
    "billing": """You are a billing support specialist. Follow these guidelines:
    1. Always start with "Billing Support Response:"
    2. First acknowledge the specific billing issue
    3. Explain any charges or discrepancies clearly
    4. List concrete next steps with timeline
    5. End with payment options if relevant""",

    "technical": """You are a technical support engineer. Follow these guidelines:
    1. Always start with "Technical Support Response:"
    2. List exact steps to resolve the issue
    3. Include system requirements if relevant
    4. Provide workarounds for common problems
    5. End with escalation path if needed""",

    "account": """You are an account security specialist. Follow these guidelines:
    1. Always start with "Account Support Response:"
    2. Prioritize account security and verification
    3. Provide clear steps for account recovery/changes
    4. Include security tips and warnings
    5. Set clear expectations for resolution time""",

    "product": """You are a product specialist. Follow these guidelines:
    1. Always start with "Product Support Response:"
    2. Focus on feature education and best practices
    3. Include specific examples of usage
    4. Link to relevant documentation sections
    5. Suggest related features that might help""",
}
```

然后输入不同工单：

```python
tickets = [
    """Subject: Can't access my account
    Message: Hi, I've been trying to log in for the past hour but keep getting an 'invalid password' error.""",
    """Subject: Unexpected charge on my card
    Message: Hello, I just noticed a charge of $49.99 on my credit card...""",
    """Subject: How to export data?
    Message: I need to export all my project data to Excel.""",
]

for ticket in tickets:
    response = route(ticket, support_routes)
    print(response)
```

示例中：

- 登录失败会被路由到 `account`；
- 信用卡扣费异常会被路由到 `billing`；
- 导出数据问题会被路由到 `technical`。

这个模式的重点是：Claude 先作为“分类器 / 路由器”，再作为“专用回答生成器”。

## 6. 三种模式如何选择

可以用下面这张表做判断：

| 模式 | 适合任务 | 主要收益 | 主要代价 |
|---|---|---|---|
| Prompt-Chaining | 步骤明确、前后依赖强 | 每一步更可控，中间结果可观察 | 总延迟累加 |
| Parallelization | 子任务独立、可同时处理 | 降低总耗时，支持多角度分析 | 并发成本和速率限制 |
| Routing | 输入类型不同，需要不同处理逻辑 | 每类输入可用专用 prompt | 路由错误会导致后续错误 |

一个简单判断方法：

```text
任务是否可以拆成固定顺序？
  是 → Prompt-Chaining
  否 ↓

多个子任务是否相互独立？
  是 → Parallelization
  否 ↓

不同输入是否需要不同处理方式？
  是 → Routing
```

## 7. 示例运行过程拆解

### 7.1 Chain 示例：业绩报告转表格

这个示例展示的是“逐步加工”。原始输入是自然语言报告，最终输出是 Markdown 表格。

中间过程包括：

1. 抽取数值和指标；
2. 把 points 等数字统一转换成百分比；
3. 按数值降序排序；
4. 格式化成表格。

这个示例的学习重点是：每一步 prompt 都很窄，降低了模型一次性完成复杂格式化任务的难度。

### 7.2 Parallel 示例：多利益相关者影响分析

这个示例展示的是“并发多视角分析”。客户、员工、投资人、供应商四类对象互相独立，因此可以同时分析。

这个示例的学习重点是：如果任务天然可以拆成多个独立输入，就不必串行调用模型。

### 7.3 Route 示例：客服工单分流

这个示例展示的是“先分类再处理”。不同工单需要不同专家 prompt，因此先让 Claude 选择 route，再生成对应回答。

这个示例的学习重点是：Routing 不只是分类，它还把分类结果连接到了后续处理逻辑。

## 8. 关键设计思路

### 8.1 用代码控制流程，而不是让模型自由发挥

这篇 notebook 最重要的思想是：workflow 的结构由 Python 控制，Claude 只负责每个节点上的语言理解和生成。

也就是说：

```text
代码负责：顺序、并发、分支、数据传递
Claude 负责：理解、生成、判断、转换
```

这样做比让 Claude 在一个 prompt 里自我规划所有步骤更稳定。

### 8.2 每个 prompt 只承担一个清晰职责

Chain 示例中，每个 prompt 只做一件事：抽取、转换、排序或格式化。

Routing 示例中，selector prompt 只负责选 route，专用 prompt 只负责生成回答。

这种职责拆分能降低 prompt 复杂度，也方便调试。

### 8.3 中间结果要可观察

`chain` 会打印每一步结果，`route` 会打印 routing reasoning 和 selected route。这些中间结果对调试非常关键。

如果某一步出错，可以快速定位是：

- 抽取错了；
- 转换错了；
- 排序错了；
- route 选错了；
- 专用 prompt 回答不合适。

### 8.4 结构化输出是程序化工作流的基础

Routing 中如果没有 `<selection>`，程序就无法稳定知道应该选择哪个 route。

所以只要模型输出会影响程序控制流，就应该尽量使用结构化输出，例如 XML、JSON 或 tool schema。

## 9. 如何迁移到自己的项目

### 9.1 迁移 Prompt-Chaining

如果你的任务可以拆成固定步骤，可以这样迁移：

```python
steps = [
    "第一步：抽取关键信息",
    "第二步：规范化格式",
    "第三步：根据规则校验",
    "第四步：生成最终输出",
]

result = chain(user_input, steps)
```

适合：合同信息抽取、日志摘要、报表清洗、文档结构化。

### 9.2 迁移 Parallelization

如果你有多个独立对象要分析，可以这样迁移：

```python
items = [doc1, doc2, doc3, doc4]
results = parallel("请分析以下文档并提取风险点", items)
```

适合：批量文档审查、多角色评估、多候选方案生成。

### 9.3 迁移 Routing

如果你的输入要分派到不同专家，可以这样设计：

```python
routes = {
    "refund": "你是退款处理专家……",
    "bug": "你是技术支持专家……",
    "security": "你是账号安全专家……",
}

response = route(user_ticket, routes)
```

适合：客服系统、审核系统、需求分流、内部工单系统。

## 10. 局限与注意事项

这篇 notebook 明确说明这些实现是概念示例，不是生产代码。实际使用时需要补充：

- **错误处理**：`route_key` 可能不在 `routes` 中；
- **重试机制**：Claude 输出格式可能不符合 XML 预期；
- **超时控制**：并发调用可能出现个别请求长时间不返回；
- **速率限制处理**：Parallelization 会提高瞬时 API 请求量；
- **成本控制**：Chain 和 Routing 都会增加调用次数；
- **日志和监控**：需要记录每一步输入、输出、耗时和错误；
- **评估集**：需要验证 route 准确率、输出质量和稳定性。

尤其是 Routing，生产环境中一定要增加 fallback：

```python
if route_key not in routes:
    route_key = "default"
```

否则模型一旦输出了未知 route，程序就可能报错。

## 11. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己是否真正理解：

- Prompt-Chaining 和一次性 prompt 的区别是什么？

  答：一次性 prompt 是把完整任务一次性交给模型完成，模型需要同时理解需求、规划步骤、处理中间结果并生成最终输出。Prompt-Chaining 则是把任务拆成多个明确步骤，每一步只完成一个小目标，并把结果传给下一步。

  它的优势是流程更可控、中间结果更容易观察，也更方便定位问题。代价是调用次数变多，总延迟和成本通常会增加。

- Chain 中为什么要把上一步结果作为下一步输入？

  答：因为 Chain 的每一步都有前后依赖。下一步不是重新处理原始输入，而是在上一步加工后的结果上继续处理。

  例如业绩报告示例中，第一步先抽取数值和指标，第二步才能基于抽取结果做单位转换，第三步才能基于转换后的数字排序，第四步再格式化成表格。把上一步结果传下去，相当于让每一步都只处理当前阶段需要处理的内容。

- Parallelization 适合什么样的子任务？什么时候不适合？

  答：Parallelization 适合彼此独立、没有先后依赖的子任务，例如批量分析多篇文档、分别评估不同利益相关者、同时生成多个候选方案。

  如果子任务之间存在依赖关系，就不适合并发。例如第二步必须依赖第一步的输出，或者多个子任务需要共享并不断更新同一份状态，这时强行并发会带来结果不一致、顺序错误或调试困难。

- Routing 为什么需要结构化输出？

  答：因为 Routing 的分类结果会直接影响程序后续走哪条分支。程序不能只依赖一段自然语言解释来猜模型选了哪个 route，而应该从稳定的字段里读取结果。

  使用 XML、JSON 或 tool schema 可以让程序准确提取 `selection` 这样的字段，从而把模型输出变成可执行的控制信号。

- 如果模型输出了不存在的 route，应该怎么处理？

  答：生产环境中不能直接用未知 route 去访问 `routes[route_key]`，否则会触发错误。更稳妥的做法是增加 fallback 和校验逻辑。

  例如：

  ```python
  route_key = extract_xml(route_response, "selection").strip().lower()

  if route_key not in routes:
      route_key = "default"
  ```

  也可以让模型重新选择一次，或者把未知输入交给人工审核 / 通用处理链路。

- 三种 workflow 分别会增加哪些成本或延迟？

  答：Prompt-Chaining 会增加串行调用次数，所以总延迟通常是每一步延迟的累加，API 成本也会随调用次数增加。

  Parallelization 可以降低墙钟时间，但会提高瞬时请求量，可能更容易触发速率限制，也会带来并发控制和失败重试成本。

  Routing 至少需要一次额外的分类调用，如果后面还要调用专用 prompt，就会比单次回答多一次模型调用。同时它还有路由错误的风险，错误分类会影响后续输出质量。

- 如何把这三个模式组合成更复杂的 Agent？

  答：可以把它们作为 Agent 的基础控制结构组合起来：先用 Routing 判断用户意图，再为不同意图选择不同的 Chain；在 Chain 的某些步骤中，如果有多个独立对象要处理，再用 Parallelization 并发执行。

  例如一个客服 Agent 可以这样设计：

  ```text
  用户输入
    ↓
  Routing：判断是账单、技术、账号还是产品问题
    ↓
  对应专用 Chain：抽取问题 → 查询信息 → 生成回复 → 检查语气和完整性
    ↓
  Parallelization：必要时并发检查知识库、历史工单、产品文档
    ↓
  最终回复
  ```

  这样复杂 Agent 不是完全依赖模型自由规划，而是由代码负责流程结构，模型负责每个节点上的理解、判断和生成。

## 12. 一句话总结

这篇 notebook 的核心价值在于：它用 `chain`、`parallel` 和 `route` 三个极简函数，展示了多 LLM 应用中最基础的三种控制结构——顺序处理、并发处理和条件路由。
