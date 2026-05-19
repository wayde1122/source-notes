# 《Evaluator-Optimizer Workflow》学习笔记：用生成-评估闭环改进模型输出

> 源 Notebook：`patterns/agents/evaluator_optimizer.ipynb`

## 1. 学习目标

这篇 notebook 讲的是 **Evaluator-Optimizer** 工作流，也就是“生成器 + 评估器 + 反馈循环”的模式。

它要解决的问题是：

> 当一次 Claude 生成的结果还不够好时，如何让系统自动评价结果、给出反馈，并把反馈带回下一轮生成中？

学完后，你应该能够：

- 理解 Generator 和 Evaluator 的职责分工；
- 知道什么任务适合用反馈循环优化；
- 看懂 `generate`、`evaluate`、`loop` 三个核心函数；
- 设计一个简单的评价 rubric；
- 明白为什么生产环境必须增加最大迭代次数和外部验证。

## 2. 这个示例解决的问题

很多 LLM 应用不是“生成一次就结束”。例如代码生成、文案润色、报告撰写、结构化输出等任务，第一版结果通常可用但不够好：

- 代码可能算法正确，但缺少异常处理；
- 文案可能意思正确，但语气不合适；
- 报告可能结构完整，但缺少关键证据；
- JSON 可能大体正确，但不符合严格 schema。

Evaluator-Optimizer 的思路是：不要让人手动指出问题，而是让另一个 LLM 调用扮演 evaluator，专门负责检查结果，并把反馈返回给 generator。

notebook 使用的示例是一个代码任务：实现一个支持 `push(x)`、`pop()`、`getMin()` 且所有操作都是 O(1) 的栈。

这个任务很适合演示该模式，因为它有明确评价标准：

| 评价维度               | 含义                                     |
| ---------------------- | ---------------------------------------- |
| Correctness            | 代码是否正确实现栈和最小值查询           |
| Time Complexity        | 所有操作是否都是 O(1)                    |
| Style & Best Practices | 是否有异常处理、类型注解、文档和边界处理 |

## 3. 核心概念

### 3.1 Generator

Generator 是生成器，负责根据任务要求生成候选答案。

在第一轮中，它只看到原始任务；在后续轮次中，它还会看到之前的尝试和 evaluator 给出的反馈。

它的职责不是评价自己，而是根据反馈改进输出。

### 3.2 Evaluator

Evaluator 是评估器，负责判断当前答案是否满足标准。

notebook 特意要求 evaluator：

```text
You should be evaluating only and not attempting to solve the task.
```

这很重要。Evaluator 如果同时负责“评价”和“重写”，角色就会混乱。这个模式的稳定性来自职责分离：**生成器生成，评估器评估**。

### 3.3 Feedback Loop

Feedback Loop 是整个模式的核心：

```text
生成 → 评估 → 反馈 → 再生成 → 再评估
```

每一轮都不是盲目重试，而是把上一轮反馈放进上下文，让下一轮生成更有方向。

### 3.4 PASS / NEEDS_IMPROVEMENT / FAIL

notebook 用结构化标签输出评估状态：

```xml
<evaluation>PASS, NEEDS_IMPROVEMENT, or FAIL</evaluation>
<feedback>What needs improvement and why.</feedback>
```

程序根据 `<evaluation>` 决定是否停止循环，根据 `<feedback>` 构造下一轮生成上下文。

## 4. 整体流程图

```text
用户任务
  ↓
Generator 生成第一版结果
  ↓
Evaluator 按标准评估
  ↓
是否 PASS？
  ├─ 是：返回最终结果
  └─ 否：提取 feedback
          ↓
      把历史尝试和反馈加入 context
          ↓
      Generator 生成改进版
          ↓
      再次评估
```

这个流程适合“有标准、可改进”的任务。不适合没有明确评价标准、或者反馈无法稳定改善结果的任务。

## 5. 核心代码精读

### 5.1 依赖：LLM 调用与 XML 解析

```python
from util import extract_xml, llm_call
```

这篇 notebook 仍然复用两个辅助函数：

- `llm_call`：调用 Claude 并返回文本；
- `extract_xml`：从 Claude 输出中提取结构化标签。

这里的 XML 标签包括：

- 生成器输出：`<thoughts>`、`<response>`；
- 评估器输出：`<evaluation>`、`<feedback>`。

也就是说，模型输出不仅用于阅读，还会直接影响程序控制流。

---

### 5.2 Generator：生成候选答案

核心代码：

```python
def generate(prompt: str, task: str, context: str = "") -> tuple[str, str]:
    """Generate and improve a solution based on feedback."""
    full_prompt = f"{prompt}\n{context}\nTask: {task}" if context else f"{prompt}\nTask: {task}"
    response = llm_call(full_prompt)
    thoughts = extract_xml(response, "thoughts")
    result = extract_xml(response, "response")

    print("\n=== GENERATION START ===")
    print(f"Thoughts:\n{thoughts}\n")
    print(f"Generated:\n{result}")
    print("=== GENERATION END ===\n")

    return thoughts, result
```

这段代码做了三件事：

1. 拼接生成器 prompt、上下文和任务；
2. 调用 Claude 生成回答；
3. 从回答中解析 `<thoughts>` 和 `<response>`。

其中 `context` 是关键。第一轮没有 context，后续轮次会传入上一轮反馈和历史尝试。

可以把它理解成：

```text
第一轮：generator_prompt + task
后续轮：generator_prompt + previous_attempts + feedback + task
```

### 5.3 Evaluator：只评价，不解题

核心代码：

```python
def evaluate(prompt: str, content: str, task: str) -> tuple[str, str]:
    """Evaluate if a solution meets requirements."""
    full_prompt = f"{prompt}\nOriginal task: {task}\nContent to evaluate: {content}"
    response = llm_call(full_prompt)
    evaluation = extract_xml(response, "evaluation")
    feedback = extract_xml(response, "feedback")

    print("=== EVALUATION START ===")
    print(f"Status: {evaluation}")
    print(f"Feedback: {feedback}")
    print("=== EVALUATION END ===\n")

    return evaluation, feedback
```

这段代码把原始任务和当前候选答案一起交给 evaluator。

Evaluator 返回两个信息：

- `evaluation`：是否通过；
- `feedback`：为什么不通过、需要改什么。

这里最重要的是：`evaluation` 不是随便写的自然语言，而是结构化状态。只有结构化状态才能稳定驱动程序循环。

### 5.4 Loop：把生成和评估连接成闭环

核心代码：

```python
def loop(task: str, evaluator_prompt: str, generator_prompt: str) -> tuple[str, list[dict]]:
    """Keep generating and evaluating until requirements are met."""
    memory = []
    chain_of_thought = []

    thoughts, result = generate(generator_prompt, task)
    memory.append(result)
    chain_of_thought.append({"thoughts": thoughts, "result": result})

    while True:
        evaluation, feedback = evaluate(evaluator_prompt, result, task)
        if evaluation == "PASS":
            return result, chain_of_thought

        context = "\n".join(
            ["Previous attempts:", *[f"- {m}" for m in memory], f"\nFeedback: {feedback}"]
        )

        thoughts, result = generate(generator_prompt, task, context)
        memory.append(result)
        chain_of_thought.append({"thoughts": thoughts, "result": result})
```

这是整篇 notebook 的核心。

它维护两个列表：

- `memory`：保存每次生成的结果；
- `chain_of_thought`：保存每轮生成中的 thoughts 和 result。

循环逻辑是：

```text
先生成一版 result
while True:
    evaluator 检查 result
    如果 PASS：返回
    否则：把历史结果和反馈拼进 context
    generator 基于 context 再生成
```

注意：notebook 示例没有设置最大循环次数。这是教学代码可以接受的简化，但生产环境一定要改。

### 5.5 示例 Prompt：代码生成任务的评价标准

Evaluator prompt：

```python
evaluator_prompt = """
Evaluate this following code implementation for:
1. code correctness
2. time complexity
3. style and best practices

You should be evaluating only and not attemping to solve the task.
Only output "PASS" if all criteria are met and you have no further suggestions for improvements.
Output your evaluation concisely in the following format.

<evaluation>PASS, NEEDS_IMPROVEMENT, or FAIL</evaluation>
<feedback>
What needs improvement and why.
</feedback>
"""
```

Generator prompt：

```python
generator_prompt = """
Your goal is to complete the task based on <user input>. If there are feedback
from your previous generations, you should reflect on them to improve your solution

Output your answer concisely in the following format:

<thoughts>
[Your understanding of the task and feedback and how you plan to improve]
</thoughts>

<response>
[Your code implementation here]
</response>
"""
```

这两个 prompt 的重点分别是：

- evaluator prompt 明确评价维度和输出格式；
- generator prompt 明确要求吸收历史反馈；
- 两边都使用 XML，方便程序解析。

## 6. 示例运行过程拆解

示例任务是：

```text
Implement a Stack with:
1. push(x)
2. pop()
3. getMin()
All operations should be O(1).
```

第一轮生成器给出一个 `MinStack` 实现。核心算法是正确的：用一个普通栈保存数据，再用一个 `minStack` 保存当前最小值。

第一版代码大致如下：

```python
class MinStack:
    def __init__(self):
        self.stack = []
        self.minStack = []

    def push(self, x: int) -> None:
        self.stack.append(x)
        if not self.minStack or x <= self.minStack[-1]:
            self.minStack.append(x)

    def pop(self) -> None:
        if not self.stack:
            return
        if self.stack[-1] == self.minStack[-1]:
            self.minStack.pop()
        self.stack.pop()

    def getMin(self) -> int:
        if not self.minStack:
            return None
        return self.minStack[-1]
```

Evaluator 判断它 `NEEDS_IMPROVEMENT`，原因不是核心算法错，而是工程质量还不够：

- 空栈 `pop()` 不应该静默返回；
- 空栈 `getMin()` 不应该返回 `None`；
- 缺少类型注解；
- 缺少 docstring；
- 没有处理非法输入类型。

第二轮 generator 根据反馈改进，加入异常处理、类型注解和文档说明。

这个例子很重要，因为它展示了 Evaluator-Optimizer 的价值：它不一定只是修正错误，也可以把“能跑的答案”改进成“更接近生产质量的答案”。

## 7. 关键设计思路

### 7.1 评价标准决定优化方向

Evaluator-Optimizer 的质量高度依赖 evaluator prompt。如果评价标准写得模糊，反馈就会模糊，generator 也不知道该往哪里改。

好的 evaluator prompt 应该包含：

- 明确评价维度；
- 明确通过条件；
- 明确输出格式；
- 明确 evaluator 不要代替 generator 解题。

### 7.2 反馈必须进入下一轮上下文

如果只告诉 generator “再来一次”，它很可能重复之前的问题。

notebook 用下面的方式构造上下文：

```python
context = "\n".join(
    ["Previous attempts:", *[f"- {m}" for m in memory], f"\nFeedback: {feedback}"]
)
```

这让下一轮生成能看到：

- 之前已经生成过什么；
- evaluator 认为哪里有问题；
- 本轮应该重点修什么。

### 7.3 程序控制终止条件

当前代码的终止条件是：

```python
if evaluation == "PASS":
    return result, chain_of_thought
```

但只有这一条是不够的。真实系统至少还要加：

- 最大迭代次数；
- 最大成本预算；
- 最大耗时；
- 如果连续几轮没有改进则停止；
- evaluator 输出异常时 fallback。

### 7.4 LLM 评估不能替代真实测试

对于代码任务，LLM evaluator 可以发现风格、边界、复杂度等问题，但它不能完全替代单元测试。

更稳的方式是：

```text
Generator 生成代码
  ↓
运行单元测试 / 静态检查
  ↓
LLM Evaluator 解释失败原因或补充质量建议
  ↓
Generator 修复
```

## 8. 如何迁移到自己的项目

### 8.1 用于代码生成

可以把 evaluator prompt 改成：

```text
请从以下维度评价代码：
1. 是否通过需求
2. 是否有明显 bug
3. 是否处理边界条件
4. 是否符合项目代码风格
5. 是否需要补充测试
```

同时把真实测试结果也放进 feedback，会比单纯 LLM 评价更可靠。

### 8.2 用于文案优化

可以把 evaluator 设计成品牌审稿人：

```text
请评价文案是否符合：
1. 目标受众
2. 品牌语气
3. 信息完整性
4. 是否有夸大宣传
5. 是否有明确 CTA
```

### 8.3 用于结构化输出修复

如果你需要模型输出 JSON，可以让 evaluator 检查：

- JSON 是否可解析；
- 字段是否完整；
- 类型是否正确；
- 是否符合业务约束。

## 9. 局限与注意事项

这个模式虽然强大，但代价也明显。

需要注意：

- 每轮至少两次 LLM 调用，成本和延迟会上升；
- evaluator 本身可能误判；
- 没有最大迭代次数会导致无限循环；
- 如果评价标准太苛刻，模型可能一直无法 PASS；
- 如果评价标准太宽松，低质量结果也可能通过；
- 对代码、数据、金融、医疗等高风险场景，必须加入规则校验或人工审核。

建议生产版至少改成：

```python
max_iterations = 3
for _ in range(max_iterations):
    evaluation, feedback = evaluate(...)
    if evaluation == "PASS":
        break
    result = generate(...)
```

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- Generator 和 Evaluator 分别负责什么？

  答：Generator 负责根据任务要求生成候选答案，并在后续轮次中根据 evaluator 的反馈改进答案。它关注的是“怎么产出更好的结果”。

  Evaluator 负责检查当前答案是否满足评价标准，并指出哪里需要改进。它关注的是“当前结果是否合格，以及为什么不合格”。这个模式的关键就是职责分离：Generator 生成，Evaluator 评价。

- 为什么 evaluator prompt 要明确“只评价，不解题”？

  答：因为 evaluator 的职责是判断当前答案是否符合标准，而不是直接生成新答案。如果 evaluator 同时评价和解题，角色会混在一起，反馈可能变成另一个候选答案，generator 反而不知道应该重点修什么。

  明确“只评价，不解题”可以让 evaluator 输出更稳定的判断和反馈，也让整个闭环更清晰：评价器负责发现问题，生成器负责根据问题改进结果。

- `<evaluation>` 和 `<feedback>` 分别用于什么？

  答：`<evaluation>` 用来表示当前结果的评估状态，例如 `PASS`、`NEEDS_IMPROVEMENT` 或 `FAIL`。程序会根据它决定是否停止循环。

  `<feedback>` 用来说明当前结果哪里有问题、为什么需要改进、下一轮应该关注什么。它会被放进下一轮 generator 的上下文中，指导下一次生成。

- 为什么要保存 previous attempts？

  答：保存 previous attempts 可以让后续轮次知道前面已经生成过什么，避免 generator 重复犯同样的错误，也避免不断绕回旧方案。

  它还能帮助 generator 对照 evaluator 的反馈理解“上一版为什么不够好”，从而更有针对性地改进，而不是盲目重新生成。

- 这个模式为什么会增加成本和延迟？

  答：因为每一轮通常至少包含两次 LLM 调用：一次由 generator 生成结果，一次由 evaluator 评估结果。如果结果没有通过，还要继续进入下一轮。

  所以相比单次生成，Evaluator-Optimizer 会增加 API 调用次数、token 消耗和总耗时。迭代轮数越多，成本和延迟越高。

- 为什么生产环境必须设置最大迭代次数？

  答：因为 evaluator 不一定会给出 `PASS`，generator 也不一定能根据反馈成功改好。如果没有最大迭代次数，循环可能一直运行下去，造成无限循环、成本失控或请求长时间不返回。
  续几轮没有
  生产环境通常要设置最大迭代次数、最大耗时、最大成本预算，或者在连明显改进时提前停止，并进入 fallback 或人工处理流程。

- 代码任务中，为什么 LLM evaluator 不能替代单元测试？

  答：LLM evaluator 是基于语言理解来判断代码质量，适合发现风格、复杂度、边界条件、异常处理等问题，但它不能真正执行代码，也不能保证所有路径都被验证。

  单元测试可以用确定性的方式运行代码，验证输入输出、异常行为和边界情况。更可靠的做法是把真实测试结果和 LLM evaluator 结合起来：测试负责验证行为是否正确，LLM evaluator 负责解释问题、补充质量建议，并帮助 generator 修复。

## 11. 一句话总结

这篇 notebook 的核心价值在于：它展示了如何把一次性 Claude 生成升级成一个可迭代、可评价、可反馈的优化闭环。
