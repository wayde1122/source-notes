# 《Tool evaluation》学习笔记：评估体系构建

> 源 Notebook：`tool_evaluation/tool_evaluation.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **评估体系构建** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Run parallel agent evaluations on tools independently from evaluation task files.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### Tool Evaluation

评估工具是否被正确选择、参数是否正确、结果是否满足任务。

### Evaluation Task

用任务文件或测试集描述工具使用场景。

### Notebook 阅读线索

- Prompts
- Agent Loop
- Helper Functions
- Main Evaluation Function
- Calculator Tool
- Run Evaluation

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
import json
import re
import time
import traceback
import xml.etree.ElementTree as ET  # noqa: S314
from pathlib import Path
from typing import Any

from anthropic import Anthropic
```

这段代码对应源 notebook 的第 2 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 主执行流程与 API 调用

```python
# Embedded evaluator prompt
EVALUATION_PROMPT = """You are an AI assistant with access to tools.

When given a task, you MUST:
1. Use the available tools to complete the task
2. Provide summary of each step in your approach, wrapped in <summary> tags
3. Provide feedback on the tools provided, wrapped in <feedback> tags
4. Provide your final response, wrapped in <response> tags

Summary Requirements:
- In your <summary> tags, you must explain:
  - The steps you took to complete the task
  - Which tools you used, in what order, and why
  - The inputs you provided to each tool
  - The outputs you received from each tool
  - A summary for how you arrived at the response

Feedback Requirements:
- In your <feedback> tags, provide constructive feedback on the tools:
  - Comment on tool names: Are they clear and descriptive?
  - Comment on input parameters: Are they well-documented? Are required vs optional parameters clear?
  - Comment on descriptions: Do they accurately describe what the tool does?
  - Comment on any errors encountered during tool usage: Did the tool fail to execute? Did the tool return too many tokens?
  - Identify specific areas for improvement and explain WHY they would help
  - Be specific and actionable in your suggestions

Response Requirements:
- Your response should be concise and directly address what was asked
- Always wrap your final response in <response> tags
- If you cannot solve the task return <response>NOT_FOUND</response>
- For numeric responses, provide just the number
- For IDs, provide just the ID
- For names or text, provide the exact text requested
- Your response should go last"""
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：agent_loop、_prepare_tool_result

```python
client = Anthropic()
model = "claude-sonnet-4-6"


def agent_loop(prompt: str, tools: list[dict[str, Any]] = None) -> tuple[str, dict[str, Any]]:
    """Simplified agent class for tool evaluation"""
    messages = [{"role": "user", "content": prompt}]

    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=EVALUATION_PROMPT,
        messages=messages,
        tools=tools,
    )

    messages.append({"role": "assistant", "content": response.content})

    # Track tool calls with timing
    tool_metrics = {}  # {tool_name: {"count": N, "durations": [X1, X2, ...]}}

    def _prepare_tool_result(tool_use_id, tool_result):
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": tool_result,
                }
            ],
        }

    while response.stop_reason == "tool_use":
        tool_use = next(block for block in response.content if block.type == "tool_use")
        tool_name = tool_use.name

        tool_start_ts = time.time()
        try:
            # Note: eval is used here for demonstration purposes to dynamically call tool functions.
            # In production, use a safer dispatch mechanism like a dictionary of functions.
            tool_response = eval(  # noqa: S307
                f"{tool_name}(**tool_use.input)"
            )  # Call the tool function with its input
        except Exception as e:
            tool_response = f"Error executing tool {tool_name}: {str(e)}\n"
            tool_response += traceback.format_exc()
        tool_duration = time.time() - tool_start_ts

        # Update tool metrics
        if tool_name not in tool_metrics:
            tool_metrics[tool_name] = {"count": 0, "durations": []}
        tool_metrics[tool_name]["count"] += 1
        tool_metrics[tool_name]["durations"].append(tool_duration)

        # Prepare tool result and append to messages
        messages.append(_prepare_tool_result(tool_use.id, tool_response))
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=EVALUATION_PROMPT,
            messages=messages,
            tools=tools,
        )
        messages.append({"role": "assistant", "content": response.content})

    response = next(
        (block.text for block in response.content if hasattr(block, "text")),
        None,
    )
    return response, tool_metrics
```

这段代码对应源 notebook 的第 6 个代码单元，重点关注 `agent_loop、_prepare_tool_result`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.4 核心函数 / 类定义：evaluate_single_task、_extract_xml_content

```python
def evaluate_single_task(
    task: dict[str, Any], tools: list[dict[str, Any]], task_index: int
) -> dict[str, Any]:
    """Evaluate a single task with the given tools."""
    start_time = time.time()

    # Run the task
    print(f"Task {task_index + 1}: Running task with prompt: {task['prompt']}")
    response, tool_metrics = agent_loop(task["prompt"], tools)

    # Extract all tagged content
    def _extract_xml_content(text, tag):
        pattern = rf"<{tag}>(.*?)</{tag}>"
        matches = re.findall(pattern, text, re.DOTALL)
        return matches[-1].strip() if matches else None

    response, summary, feedback = (
        _extract_xml_content(response, tag) for tag in ["response", "summary", "feedback"]
    )
    duration_seconds = time.time() - start_time

    return {
        "prompt": task["prompt"],
        "expected": task["response"],
        "actual": response,
        "score": int(response == task["response"]),
        "total_duration": duration_seconds,
        "tool_calls": tool_metrics,
        "num_tool_calls": sum(len(metrics["durations"]) for metrics in tool_metrics.values()),
        "summary": summary,
        "feedback": feedback,
    }
```

这段代码对应源 notebook 的第 9 个代码单元，重点关注 `evaluate_single_task、_extract_xml_content`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

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

- 替换为自己的工具集合。
- 建立工具调用测试集。
- 记录成功率、参数错误率和误调用率。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- 评估任务覆盖不足
- 只看最终答案不看工具调用过程
- 缺少回归测试

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
