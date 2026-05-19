# 《Orchestrator-Workers Workflow》学习笔记：让中心模型动态拆分任务并调度多个 Worker

> 源 Notebook：`patterns/agents/orchestrator_workers.ipynb`

## 1. 学习目标

这篇 notebook 讲的是 **Orchestrator-Workers** 工作流，也就是“一个中心协调者 + 多个执行者”的模式。

它要解决的问题是：

> 当一个任务需要多个角度、多个子任务或多种输出风格时，如何让一个中心 LLM 先分析任务，再动态决定应该让哪些 worker 分别完成什么？

学完后，你应该能够：

- 理解 Orchestrator 和 Worker 的职责分工；
- 区分“固定并行”和“动态任务拆分”；
- 看懂 `parse_tasks` 和 `FlexibleOrchestrator.process` 的核心逻辑；
- 设计 orchestrator prompt 和 worker prompt；
- 判断这个模式适合什么任务，以及它的成本和延迟代价。

## 2. 这个示例解决的问题

普通并行处理通常要求开发者提前写死子任务。例如你预先定义三个方向：正式版、活泼版、技术版，然后并发生成。

但很多真实任务并不能提前确定最佳拆分方式。比如：

- 不同产品适合不同营销角度；
- 不同研究问题需要不同分析维度；
- 不同代码库需要不同检查重点；
- 不同事故排查需要不同调查路径。

Orchestrator-Workers 的核心思想是：

```text
不要提前写死所有子任务，先让 Orchestrator 根据当前输入决定任务如何拆分。
```

notebook 中的示例是产品文案生成：输入“为一个环保水瓶写产品描述”，orchestrator 先判断应该生成哪些不同风格或角度的文案，再把这些任务交给 worker 执行。

## 3. 核心概念

### 3.1 Orchestrator

Orchestrator 是中心协调者。

它不直接完成所有工作，而是负责：

- 理解原始任务；
- 判断哪些角度或子任务有价值；
- 生成结构化的任务列表；
- 为 worker 提供明确任务说明。

可以把它理解成“项目经理”或“任务规划器”。

### 3.2 Worker

Worker 是执行者。

每个 worker 接收：

- 原始任务；
- 自己的任务类型；
- 自己的任务描述；
- 额外上下文。

它只负责完成分配给自己的那一部分。

### 3.3 Dynamic Decomposition

Dynamic Decomposition 指动态任务拆分。

它和固定并行最大的区别是：

| 方式 | 子任务来源 | 特点 |
|---|---|---|
| 固定并行 | 开发者预先写死 | 简单稳定，但不够灵活 |
| Orchestrator-Workers | Orchestrator 根据输入生成 | 更灵活，但依赖规划质量 |

这个模式适合任务结构会随输入变化的场景。

### 3.4 XML Structured Output

notebook 使用 XML 作为 orchestrator 和 worker 的通信格式：

```xml
<analysis>...</analysis>
<tasks>
  <task>
    <type>formal</type>
    <description>...</description>
  </task>
</tasks>
```

worker 输出也要求包在：

```xml
<response>...</response>
```

这样程序可以稳定解析模型输出，并把它转成 Python 字典或字符串。

## 4. 整体流程图

这个 workflow 可以分成两个阶段。

```text
阶段一：分析与规划
用户任务 + 上下文
  ↓
Orchestrator LLM
  ↓
输出 analysis + tasks
  ↓
解析成 task 列表
```

```text
阶段二：执行与汇总
Task 1 → Worker 1 → Result 1
Task 2 → Worker 2 → Result 2
Task 3 → Worker 3 → Result 3
  ↓
收集 worker_results
  ↓
返回 analysis + worker_results
```

需要注意：notebook 里的 worker 是顺序执行的，并不是真正并发。它展示的是 Orchestrator-Workers 的逻辑结构；如果要生产化，可以再改成 `asyncio` 或线程池并发。

## 5. 核心代码精读

### 5.1 基础依赖与模型配置

```python
from util import extract_xml, llm_call

# Model configuration
MODEL = "claude-sonnet-4-6"  # Fast, capable model for both orchestrator and workers
```

这里复用两个工具函数：

- `llm_call`：调用 Claude；
- `extract_xml`：从 Claude 输出中提取 XML 标签内容。

`MODEL` 同时用于 orchestrator 和 worker。真实项目中可以分开配置：

- orchestrator 用更强模型，提高任务拆分质量；
- worker 用更快或更便宜的模型，降低成本。

---

### 5.2 parse_tasks：把模型计划转成程序数据结构

```python
def parse_tasks(tasks_xml: str) -> list[dict]:
    """Parse XML tasks into a list of task dictionaries."""
    tasks = []
    current_task = {}

    for line in tasks_xml.split("\n"):
        line = line.strip()
        if not line:
            continue

        if line.startswith("<task>"):
            current_task = {}
        elif line.startswith("<type>"):
            current_task["type"] = line[6:-7].strip()
        elif line.startswith("<description>"):
            current_task["description"] = line[12:-13].strip()
        elif line.startswith("</task>"):
            if "description" in current_task:
                if "type" not in current_task:
                    current_task["type"] = "default"
                tasks.append(current_task)

    return tasks
```

这段代码负责把 orchestrator 生成的 XML 任务列表解析成 Python 列表。

输入类似：

```xml
<tasks>
  <task>
    <type>formal</type>
    <description>Write a precise, technical version...</description>
  </task>
</tasks>
```

输出类似：

```python
[
    {
        "type": "formal",
        "description": "Write a precise, technical version...",
    }
]
```

这里体现了一个关键设计：**LLM 负责规划，代码负责执行规划**。

---

### 5.3 FlexibleOrchestrator：保存 prompt 模板与模型配置

```python
class FlexibleOrchestrator:
    """Break down tasks and run them in parallel using worker LLMs."""

    def __init__(
        self,
        orchestrator_prompt: str,
        worker_prompt: str,
        model: str = MODEL,
    ):
        """Initialize with prompt templates and model selection."""
        self.orchestrator_prompt = orchestrator_prompt
        self.worker_prompt = worker_prompt
        self.model = model

    def _format_prompt(self, template: str, **kwargs) -> str:
        """Format a prompt template with variables."""
        try:
            return template.format(**kwargs)
        except KeyError as e:
            raise ValueError(f"Missing required prompt variable: {e}") from e
```

这个类的构造函数保存三个东西：

- `orchestrator_prompt`：负责拆解任务的 prompt；
- `worker_prompt`：负责执行子任务的 prompt；
- `model`：调用的 Claude 模型。

`_format_prompt` 用于把运行时变量填进 prompt 模板。如果缺少变量，它会抛出明确错误。这比直接让 `format` 报错更适合调试。

---

### 5.4 process：主执行流程

`process` 是整个 workflow 的核心。

```python
def process(self, task: str, context: dict | None = None) -> dict:
    """Process task by breaking it down and running subtasks in parallel."""
    context = context or {}

    # Step 1: Get orchestrator response
    orchestrator_input = self._format_prompt(self.orchestrator_prompt, task=task, **context)
    orchestrator_response = llm_call(orchestrator_input, model=self.model)

    # Parse orchestrator response
    analysis = extract_xml(orchestrator_response, "analysis")
    tasks_xml = extract_xml(orchestrator_response, "tasks")
    tasks = parse_tasks(tasks_xml)
```

第一部分调用 orchestrator，并解析出：

- `analysis`：orchestrator 对任务的理解；
- `tasks_xml`：orchestrator 生成的子任务列表；
- `tasks`：解析后的 Python task 字典列表。

接着执行每个 worker：

```python
worker_results = []
for i, task_info in enumerate(tasks, 1):
    worker_input = self._format_prompt(
        self.worker_prompt,
        original_task=task,
        task_type=task_info["type"],
        task_description=task_info["description"],
        **context,
    )

    worker_response = llm_call(worker_input, model=self.model)
    worker_content = extract_xml(worker_response, "response")

    if not worker_content or not worker_content.strip():
        worker_content = f"[Error: Worker '{task_info['type']}' failed to generate content]"

    worker_results.append(
        {
            "type": task_info["type"],
            "description": task_info["description"],
            "result": worker_content,
        }
    )
```

这里有几个重要细节：

1. worker 不只拿到子任务，还拿到原始任务 `original_task`；
2. worker 拿到自己的 `task_type` 和 `task_description`；
3. worker 也拿到额外上下文 `context`；
4. 如果 worker 输出为空，会写入错误占位内容。

最后返回：

```python
return {
    "analysis": analysis,
    "worker_results": worker_results,
}
```

这意味着调用方不仅能看到结果，也能看到 orchestrator 的分析过程。

---

### 5.5 Orchestrator Prompt 与 Worker Prompt

Orchestrator prompt：

```python
ORCHESTRATOR_PROMPT = """
Analyze this task and break it down into 2-3 distinct approaches:

Task: {task}

Return your response in this format:

<analysis>
Explain your understanding of the task and which variations would be valuable.
Focus on how each approach serves different aspects of the task.
</analysis>

<tasks>
    <task>
    <type>formal</type>
    <description>Write a precise, technical version that emphasizes specifications</description>
    </task>
    <task>
    <type>conversational</type>
    <description>Write an engaging, friendly version that connects with readers</description>
    </task>
</tasks>
"""
```

Worker prompt：

```python
WORKER_PROMPT = """
Generate content based on:
Task: {original_task}
Style: {task_type}
Guidelines: {task_description}

Return your response in this format:

<response>
Your content here, maintaining the specified style and fully addressing requirements.
</response>
"""
```

两个 prompt 的职责非常清晰：

| Prompt | 负责什么 | 输出什么 |
|---|---|---|
| Orchestrator Prompt | 分析任务并拆分子任务 | `<analysis>` + `<tasks>` |
| Worker Prompt | 根据分配的任务生成内容 | `<response>` |

这是这个模式最重要的设计：**规划和执行分离**。

### 5.6 执行示例

```python
orchestrator = FlexibleOrchestrator(
    orchestrator_prompt=ORCHESTRATOR_PROMPT,
    worker_prompt=WORKER_PROMPT,
)

results = orchestrator.process(
    task="Write a product description for a new eco-friendly water bottle",
    context={
        "target_audience": "environmentally conscious millennials",
        "key_features": ["plastic-free", "insulated", "lifetime warranty"],
    },
)
```

这里的输入任务是为环保水瓶写产品描述，额外上下文包括：

- 目标受众：关注环保的千禧一代；
- 产品特性：无塑料、保温、终身质保。

Orchestrator 会基于这些信息判断应该生成哪些文案角度，再交给 worker 生成内容。

## 6. 示例运行过程拆解

运行过程可以拆成四步。

第一步，系统把原始任务和上下文填入 orchestrator prompt。

第二步，Claude 作为 orchestrator 输出分析和任务列表。例如可能生成：

```text
formal：强调规格、保温、质保等理性信息
conversational：强调生活方式和环保价值
```

第三步，程序将这些任务解析为 Python 字典，然后逐个构造 worker prompt。

第四步，每个 worker 根据自己的风格和说明生成文案，最终汇总到 `worker_results`。

这个例子的重点不是“写环保水瓶文案”，而是展示一种通用结构：

```text
中心模型决定拆分方式 → 多个执行模型完成子任务 → 程序收集结果
```

## 7. 关键设计思路

### 7.1 动态拆分比固定并行更灵活

如果你提前知道要生成 formal、conversational、technical 三种结果，用普通并行就够了。

但如果你不知道当前任务最适合哪些角度，就需要 orchestrator 先分析输入。

例如：

- 环保水瓶适合环保、生活方式、产品规格；
- 企业安全产品可能适合合规、风险、技术架构；
- 儿童教育 App 可能适合家长、教师、孩子三个视角。

这就是动态拆分的价值。

### 7.2 Worker 必须保留整体上下文

worker 只看到局部任务是不够的。

notebook 中 worker prompt 同时包含：

```text
Task: {original_task}
Style: {task_type}
Guidelines: {task_description}
```

这保证 worker 既知道整体目标，也知道自己的分工。

### 7.3 结构化输出让调度可执行

Orchestrator 输出如果只是自然语言，程序很难自动分配任务。

使用 `<tasks>`、`<type>`、`<description>` 后，程序可以把模型输出转成可执行的数据结构。

### 7.4 需要处理 worker 失败

notebook 中有一个简单校验：

```python
if not worker_content or not worker_content.strip():
    worker_content = f"[Error: Worker '{task_info['type']}' failed to generate content]"
```

这说明即使是教学示例，也要考虑 worker 可能返回空结果。

生产中还应增加：

- 重试；
- fallback worker；
- 输出格式校验；
- 失败任务记录。

## 8. 如何迁移到自己的项目

### 8.1 用于研究任务

比如输入：

```text
研究某个新技术对企业应用架构的影响
```

Orchestrator 可以拆成：

- 技术原理分析；
- 成本和收益分析；
- 风险和限制分析；
- 落地建议。

Worker 分别完成不同部分。

### 8.2 用于文档分析

比如输入一份长文档，让 orchestrator 决定需要哪些分析维度：

- 摘要；
- 风险；
- 关键条款；
- 待确认问题。

### 8.3 用于内容生成

比如营销、产品介绍、FAQ、邮件、公告等任务，可以让 orchestrator 根据目标受众和产品特性决定输出角度。

### 8.4 用于代码审查

Orchestrator 可以根据代码变更拆分 worker：

- 安全审查；
- 性能审查；
- 可维护性审查；
- 测试覆盖审查。

## 9. 局限与注意事项

这个模式的主要代价是 **N+1 次模型调用**：

```text
1 次 orchestrator 调用 + N 次 worker 调用
```

因此它不适合低延迟、简单单输出任务。

还需要注意：

- 当前实现的 worker 是顺序执行，不是真正并发；
- orchestrator 拆分质量决定整体效果；
- XML 解析可能失败；
- worker 输出之间可能重复、冲突或风格不一致；
- 当前 notebook 没有 synthesis 阶段，只是返回多个 worker 结果；
- 如果最终需要一个统一答案，应该增加“综合器”模型调用。

生产化版本可以改成：

```text
Orchestrator 拆任务
  ↓
Workers 并发执行
  ↓
Synthesizer 汇总、去重、解决冲突
  ↓
Evaluator 检查最终结果
```

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- Orchestrator 和 Worker 分别负责什么？

  答：Orchestrator 负责理解原始任务、分析任务结构、决定应该拆成哪些子任务，并用结构化格式输出任务列表。它的重点是规划和调度。

  Worker 负责执行某一个具体子任务。每个 worker 根据原始任务、自己的任务类型和任务描述生成对应结果。它的重点是完成分配给自己的局部工作。

- 这个模式和普通 parallelization 有什么区别？

  答：普通 parallelization 通常是开发者提前写死要并行执行的子任务，例如固定生成 formal、technical、casual 三种版本。

  Orchestrator-Workers 则是先让 orchestrator 根据当前输入动态决定任务怎么拆、需要哪些 worker。它更灵活，适合任务结构会随输入变化的场景；代价是多了一次 orchestrator 调用，并且整体效果依赖任务拆分质量。

- 为什么 worker 需要同时看到原始任务和子任务描述？

  答：worker 只看到子任务描述，可能会丢失整体目标和重要背景；只看到原始任务，又不知道自己负责哪一部分。

  同时提供原始任务和子任务描述，可以让 worker 既理解全局目标，又清楚自己的分工。例如写产品文案时，worker 需要知道产品是什么，也需要知道自己应该写正式版、生活方式版还是技术规格版。

- `parse_tasks` 的作用是什么？

  答：`parse_tasks` 的作用是把 orchestrator 输出的 XML 任务列表解析成程序可以使用的 Python 数据结构。

  具体来说，它会从 `<task>` 中提取 `<type>` 和 `<description>`，生成类似 `{"type": "formal", "description": "..."}` 的字典列表。后续程序才能遍历这些 task，并为每个 worker 构造对应 prompt。

- 为什么 orchestrator 输出必须结构化？

  答：因为 orchestrator 的输出会直接决定后续要创建哪些 worker、每个 worker 执行什么任务。程序不能稳定地从一大段自然语言里猜出任务列表。

  使用 `<analysis>`、`<tasks>`、`<type>`、`<description>` 这样的结构化标签，可以让代码准确解析模型计划，并把它转成可执行的调度数据。

- 这个实现是否真的并行？如果不是，如何改进？

  答：这个 notebook 的实现不是真的并行。虽然类名和注释提到 parallel，但代码里是用 `for` 循环逐个调用 worker，所以 worker 实际上是顺序执行的。

  如果要改成真正并行，可以使用 `ThreadPoolExecutor`、`asyncio` 或异步 API，把多个 worker 调用同时发出，再统一收集结果。这样可以降低总等待时间，但也要处理速率限制、超时、部分失败和重试。

- 什么情况下不应该使用 Orchestrator-Workers？

  答：如果任务很简单、只需要一个直接答案，或者子任务拆分方式已经固定，就不一定需要 Orchestrator-Workers。直接单次调用或普通 parallelization 更简单、成本更低。

  另外，如果任务对低延迟要求很高，或者输出必须严格一致、不能接受 worker 之间差异和冲突，也要谨慎使用。这个模式会增加 N+1 次模型调用，并引入 orchestrator 拆分错误的风险。

- 如果 worker 输出互相冲突，应该如何处理？

  答：可以增加一个 synthesis 阶段，让综合器模型读取所有 worker 结果，去重、比较、解决冲突，并生成统一答案。

  对高风险任务，还应该加入 evaluator 或规则校验，检查最终结果是否自洽、是否符合事实和业务约束。如果冲突无法自动解决，可以把冲突点明确列出来，交给人工确认。

## 11. 一句话总结

这篇 notebook 的核心价值在于：它展示了如何让一个中心 Claude 调用根据输入动态规划任务，再把子任务分发给多个 worker，形成更灵活的多视角工作流。
