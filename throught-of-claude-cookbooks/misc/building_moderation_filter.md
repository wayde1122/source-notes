# 《Building a moderation filter with Claude》学习笔记：Claude API 工程技巧

> 源 Notebook：`misc/building_moderation_filter.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Claude API 工程技巧** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Build customizable content moderation filters by defining rules and categories in prompts.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### Messages API

多数 misc 示例都围绕 Claude API 的某个工程能力展开，例如批处理、缓存、JSON 输出、引用、评估或长输出控制。

### Prompt / Request 结构

这些 notebook 往往通过请求参数、system prompt、messages 或特殊字段来控制 Claude 行为。

### 成本与延迟

prompt caching、batch processing、speculative caching 等主题都直接服务于成本和延迟优化。

### 评估与可靠性

building_evals、generate_test_cases、moderation 等示例强调如何判断输出是否可靠。

### 结构化输出

JSON、citations、schema 或固定格式输出让模型结果更容易进入后续系统。

### Notebook 阅读线索

- Basic Approach
- Example usage
- Customization
- Improving Performance with Chain of Thought (CoT)
- Improving Performance with Examples

## 4. 整体流程图

```text
示例输入 / 业务数据
  ↓
准备依赖、API key、文件或外部服务连接
  ↓
构造 prompt、请求参数、工具、索引或评估标准
  ↓
调用 Claude / 第三方服务 / 本地处理代码
  ↓
解析返回结果、指标、引用、文件或结构化输出
  ↓
展示结果，并总结迁移方式与生产化注意事项
```

阅读这类 notebook 时，最重要的是分清：Claude 负责语言理解、生成和推理；代码和第三方服务负责确定性处理、存储、检索、语音、图像、成本统计或评估执行。

## 5. 核心代码精读

### 5.1 环境、依赖与数据准备

```python
from anthropic import Anthropic

client = Anthropic()
MODEL_NAME = "claude-haiku-4-5"


def moderate_text(user_text, guidelines):
    prompt_template = """
    You are a content moderation expert tasked with categorizing user-generated text based on the following guidelines:

    {guidelines}

    Here is the user-generated text to categorize:
    <user_text>{user_text}</user_text>

    Based on the guidelines above, classify this text as either ALLOW or BLOCK. Return nothing else.
    """

    # Format the prompt with the user text
    prompt = prompt_template.format(user_text=user_text, guidelines=guidelines)

    # Send the prompt to Claude and get the response
    response = (
        client.messages.create(
            model=MODEL_NAME, max_tokens=10, messages=[{"role": "user", "content": prompt}]
        )
        .content[0]
        .text
    )

    return response
```

这段代码对应源 notebook 的第 5 个代码单元，重点关注 `moderate_text`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 主执行流程与 API 调用

```python
example_guidelines = """BLOCK CATEGORY:
    - Promoting violence, illegal activities, or hate speech
    - Explicit sexual content
    - Harmful misinformation or conspiracy theories

    ALLOW CATEGORY:
    - Most other content is allowed, as long as it is not explicitly disallowed
"""

user_comments = [
    "This movie was great, I really enjoyed it. The main actor really killed it!",
    "Delete this post now or you better hide. I am coming after you and your family.",
    "Stay away from the 5G cellphones!! They are using 5G to control you.",
    "Thanks for the helpful information!",
]

for comment in user_comments:
    classification = moderate_text(comment, example_guidelines)
    print(f"Comment: {comment}\nClassification: {classification}\n")
```

这段代码对应源 notebook 的第 7 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Comment: This movie was great, I really enjoyed it. The main actor really killed it!
Classification: ALLOW

Comment: Delete this post now or you better hide. I am coming after you and your family.
Classification: BLOCK

Comment: Stay away from the 5G cellphones!! They are using 5G to control you.
Classification: BLOCK

Comment: Thanks for the helpful information!
Classification: ALLOW
```
### 5.3 主执行流程与 API 调用

```python
cot_prompt = """You are a content moderation expert tasked with categorizing user-generated text based on the following guidelines:

BLOCK CATEGORY:
- Content that is not related to rollercoasters, theme parks, or the amusement industry
- Explicit violence, hate speech, or illegal activities
- Spam, advertisements, or self-promotion

ALLOW CATEGORY:
- Discussions about rollercoaster designs, ride experiences, and park reviews
- Sharing news, rumors, or updates about new rollercoaster projects
- Respectful debates about the best rollercoasters, parks, or ride manufacturers
- Some mild profanity or crude language, as long as it is not directed at individuals

First, inside of <thinking> tags, identify any potentially concerning aspects of the post based on the guidelines below and consider whether those aspects are serious enough to block the post or not. Finally, classify this text as either ALLOW or BLOCK inside <output> tags. Return nothing else.

Given those instructions, here is the post to categorize:

<user_post>{user_post}</user_post>"""

user_post = "Introducing my new band - Coaster Shredders. Check us out on YouTube!!"

response = (
    client.messages.create(
        model=MODEL_NAME,
        max_tokens=1000,
        messages=[{"role": "user", "content": cot_prompt.format(user_post=user_post)}],
    )
    .content[0]
    .text
)

print(response)
```

这段代码对应源 notebook 的第 11 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
<thinking>
The post appears to be promoting a band rather than discussing rollercoasters, theme parks, or the amusement industry. This falls under the "spam, advertisements, or self-promotion" category, which is grounds for blocking the post.
</thinking>

<output>BLOCK</output>
```
### 5.4 主执行流程与 API 调用

```python
examples_prompt = """You are a content moderation expert tasked with categorizing user-generated text based on the following guidelines:

BLOCK CATEGORY:
- Content that is not related to rollercoasters, theme parks, or the amusement industry
- Explicit violence, hate speech, or illegal activities
- Spam, advertisements, or self-promotion

ALLOW CATEGORY:
- Discussions about rollercoaster designs, ride experiences, and park reviews
- Sharing news, rumors, or updates about new rollercoaster projects
- Respectful debates about the best rollercoasters, parks, or ride manufacturers
- Some mild profanity or crude language, as long as it is not directed at individuals

Here are some examples:
<examples>
Text: I'm selling weight loss products, check my link to buy!
Category: BLOCK

Text: I hate my local park, the operations and customer service are terrible. I wish that place would just burn down.
Category: BLOCK

Text: Did anyone ride the new RMC raptor Trek Plummet 2 yet? I've heard it's insane!
Category: ALLOW

Text: Hercs > B&Ms. That's just facts, no cap! Arrow > Intamin for classic woodies too.
Category: ALLOW
</examples>

Given those examples, here is the user-generated text to categorize:
<user_text>{user_text}</user_text>

Based on the guidelines above, classify this text as either ALLOW or BLOCK. Return nothing else."""

user_post = "Why Boomerang Coasters Ain't It (Don't @ Me)"

response = (
    client.messages.create(
        model=MODEL_NAME,
        max_tokens=1000,
        messages=[{"role": "user", "content": examples_prompt.format(user_text=user_post)}],
    )
    .content[0]
    .text
)

print(response)
```

这段代码对应源 notebook 的第 13 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
ALLOW
```

## 6. 示例运行过程拆解

这个 notebook 的运行过程通常可以拆成五步：

1. **准备输入**：例如文本、PDF、网页、图片、CSV、音频、向量库数据或评估样本。
2. **配置依赖**：包括 Claude SDK、第三方 SDK、API key、模型名称、缓存参数或索引配置。
3. **执行核心调用**：调用 Claude、批处理接口、视觉能力、检索框架、语音服务或评估逻辑。
4. **解析结果**：把返回文本、JSON、引用、指标、文件或工具结果转换成可读输出。
5. **复盘效果**：检查输出是否满足目标，并识别成本、延迟、准确性或可靠性上的限制。

## 7. 关键设计思路

### 7.1 明确 Claude 与外部逻辑的边界

Claude 适合理解上下文、生成解释、做推理和整合信息；确定性的检索、批处理、音频转写、图像编码、成本统计和规则校验应交给代码或外部系统。

### 7.2 用结构化流程降低不确定性

无论是 JSON、citations、eval rubric、batch request、RAG pipeline 还是视觉 prompt，本质都是把模型输出约束成系统可以继续处理的形式。

### 7.3 把示例改造成可验证流程

学习时不要只看输出是否漂亮，还要看是否能验证：有没有指标、测试集、引用、日志、成本统计或人工复核点。

## 8. 如何迁移到自己的项目

迁移时建议：

- 把示例 prompt 和输入替换为你的业务数据，例如文档、网页、测试用例或用户请求。
- 保留关键 API 参数和响应解析逻辑，替换模型、缓存断点、批处理规模或评估指标。
- 为生产环境加入日志、成本统计、失败重试和回归测试。
- 如果示例涉及 JSON、引用或评估，优先把输出结构和验收标准固定下来。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- API 参数变化
- 成本估算不足
- 缓存命中率低
- 输出格式漂移
- 缺少真实评估集

生产环境中还应补充：错误处理、重试、日志、权限控制、成本监控、数据脱敏、回归测试和人工抽检。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例的输入、核心处理过程和输出分别是什么？
- Claude 在流程中承担什么职责？第三方服务或本地代码承担什么职责？
- 哪些代码片段是迁移时必须保留的骨架？
- 如果换成你的业务数据，需要替换哪些 prompt、路径、API key 或配置？
- 这个示例要进入生产环境，还缺哪些评估、监控、安全和异常处理？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Claude API 工程技巧** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
