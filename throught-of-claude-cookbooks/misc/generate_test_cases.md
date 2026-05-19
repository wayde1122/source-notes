# 《Generate synthetic test data for your prompt template》学习笔记：评估体系构建

> 源 Notebook：`misc/generate_test_cases.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **评估体系构建** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Generate synthetic test cases to evaluate and improve your Claude prompt templates effectively.

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

- Prompt Template for Generating the Data

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
import re

import anthropic

# Enter your API key here
api_key = ""
CLIENT = anthropic.Anthropic(api_key=api_key)
MODEL_NAME = "claude-sonnet-4-6"
```

这段代码对应源 notebook 的第 3 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：format_prompt_template_for_synth_evals

```python
# Formatting Prompt Templates for Synthetic Evaluations

# This function prepares the prompt template for generating synthetic test data.


def format_prompt_template_for_synth_evals(prompt_template, examples=None):
    """Format a prompt template for synthetic evaluations."""
    synth_test_data_prompt_template_with_example = """<Prompt Template>
{{PROMPT_TEMPLATE}}
</Prompt Template>

Your job is to construct a test case for the prompt template above. This template contains "variables", which are placeholders to be filled in later. In this case, the variables are:

<variables>
{{CONSTRUCT_VARIABLES_NAMES}}
</variables>

Here are the example test cases provided by the user.
<examples>
{{EXAMPLES}}
</examples>

First, in <planning> tags, do the following:

1. Summarize the prompt template. What is the goal of the user who created it?
2. For each variable in <variables>, carefully consider what a paradigmatic, realistic example of that variable would look like. You'll want to note who will be responsible "in prod" for supplying values. Written by a human "end user"? Downloaded from a website? Extracted from a database? Think about things like length, format, and tone in addition to semantic content. Use the examples provided by the user to guide this exercise. The goal is to acquire a sense of the statistical distribution the examples are being drawn from. The example you write should be drawn from that same distribution, but sufficiently different from the examples that it provides additional signal. A tricky balancing act, but I have faith in you.

Once you're done, output a test case for this prompt template with a full, complete, value for each variable. The output format should consist of a tagged block for each variable, with the value inside the block, like the below:

<variables>
{{CONSTRUCT_VARIABLES_BLOCK}}
</variables>"""

    synth_test_data_prompt_template_without_example = """<Prompt Template>
{{PROMPT_TEMPLATE}}
</Prompt Template>

Your job is to construct a test case for the prompt template above. This template contains "variables", which are placeholders to be filled in later. In this case, the variables are:

<variables>
{{CONSTRUCT_VARIABLES_NAMES}}
</variables>

First, in <planning> tags, do the following:

1. Summarize the prompt template. What is the goal of the user who created it?
2. For each variable in <variables>, carefully consider what a paradigmatic, realistic example of that variable would look like. You'll want to note who will be responsible "in prod" for supplying values. Written by a human "end user"? Downloaded from a website? Extracted from a database? Think about things like length, format, and tone in addition to semantic content.

Then, output a test case for this prompt template with a full, complete, value for each variable. The output format should consist of a tagged block for each variable, with the value inside the block, like the below:
<variables>
{{CONSTRUCT_VARIABLES_BLOCK}}
</variables>"""

    if examples:
        examples_block = "\n".join([construct_example_block(example) for example in examples])
        return (
            synth_test_data_prompt_template_with_example.replace(
                "{{PROMPT_TEMPLATE}}", prompt_template
            )
            .replace("{{CONSTRUCT_VARIABLES_NAMES}}", construct_variables_names(prompt_template))
            .replace("{{CONSTRUCT_VARIABLES_BLOCK}}", construct_variables_block(prompt_template))
            .replace("{{EXAMPLES}}", examples_block)
        )
    else:
        return (
            synth_test_data_prompt_template_without_example.replace(
                "{{PROMPT_TEMPLATE}}", prompt_template
            )
            .replace("{{CONSTRUCT_VARIABLES_NAMES}}", construct_variables_names(prompt_template))
            .replace("{{CONSTRUCT_VARIABLES_BLOCK}}", construct_variables_block(prompt_template))
        )
```

这段代码对应源 notebook 的第 7 个代码单元，重点关注 `format_prompt_template_for_synth_evals`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：get_test_data

```python
def get_test_data(prompt_template, examples, custom_planning=None):
    """Generate test data using the Claude API."""
    synth_eval_prompt_ready = format_prompt_template_for_synth_evals(prompt_template, examples)

    messages = [
        {
            "role": "user",
            "content": synth_eval_prompt_ready,
        }
    ]
    if custom_planning:
        messages.append(
            {
                "role": "assistant",
                "content": custom_planning,
            }
        )

    message = (
        CLIENT.messages.create(
            max_tokens=4000,
            messages=messages,
            model=MODEL_NAME,
            temperature=1,
        )
        .content[0]
        .text
    )

    return message
```

这段代码对应源 notebook 的第 9 个代码单元，重点关注 `get_test_data`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.4 核心函数 / 类定义：call_claude_with_template

```python
# We'll use this function to sample Claude's response to the filled-in template,
# once we have our example values/test case.


def call_claude_with_template(prompt_template, variables):
    """Call Claude with a filled prompt template."""
    filled_template = prompt_template
    for var, value in variables.items():
        filled_template = filled_template.replace(f"{{{{{var}}}}}", value)

    message = (
        CLIENT.messages.create(
            max_tokens=4000,
            messages=[
                {
                    "role": "user",
                    "content": filled_template,
                }
            ],
            model=MODEL_NAME,
            temperature=0.7,
        )
        .content[0]
        .text
    )

    return message
```

这段代码对应源 notebook 的第 10 个代码单元，重点关注 `call_claude_with_template`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **评估体系构建** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
