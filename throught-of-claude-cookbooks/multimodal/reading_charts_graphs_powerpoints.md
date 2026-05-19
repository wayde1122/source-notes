# 《Working with charts, graphs, and slide decks》学习笔记：多模态视觉理解

> 源 Notebook：`multimodal/reading_charts_graphs_powerpoints.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **多模态视觉理解** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Extract insights from charts, graphs, and presentations using Claude's vision analysis capabilities.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### Vision 输入

多模态 notebook 的核心是把图片、截图、图表、PDF 页面或幻灯片作为 Claude 可理解的输入。

### 图像预处理

裁剪、压缩、分辨率选择和区域放大会显著影响视觉理解质量。

### OCR / 文档转录

Claude 可以从图片或文档中提取文本，但生产中仍要考虑版式、噪声和校验。

### 图表和幻灯片理解

视觉模型不仅能读文字，还能解释坐标轴、趋势、布局和演示材料结构。

### Vision + Tools

复杂视觉任务可以结合工具，例如裁剪工具或结构化抽取工具。

### Notebook 阅读线索

- Charts and Graphs
- Ingestion and calling the Claude API
- Slide Decks

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
import base64

from anthropic import Anthropic

# While PDF support is in beta, you must pass in the correct beta header
client = Anthropic(default_headers={"anthropic-beta": "pdfs-2024-09-25"})
# For now, only claude-sonnet-4-6 supports PDFs
MODEL_NAME = "claude-sonnet-4-6"
```

这段代码对应源 notebook 的第 5 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：get_completion

```python
# Make a useful helper function.
def get_completion(messages):
    response = client.messages.create(
        model=MODEL_NAME, max_tokens=8192, temperature=0, messages=messages
    )
    return response.content[0].text
```

这段代码对应源 notebook 的第 6 个代码单元，重点关注 `get_completion`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 主执行流程与 API 调用

```python
# To start, we'll need a PDF. We will be using the .pdf document located at cvna_2021_annual_report.pdf.
# Start by reading in the PDF and encoding it as base64.
with open("./documents/cvna_2021_annual_report.pdf", "rb") as pdf_file:
    binary_data = pdf_file.read()
    base_64_encoded_data = base64.b64encode(binary_data)
    base64_string = base_64_encoded_data.decode("utf-8")
```

这段代码对应源 notebook 的第 7 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.4 主执行流程与 API 调用

```python
# Define a prompt for narrating our slide deck. We would adjut this prompt based on the nature of the deck, but keep the structure largely the same.
prompt = """
You are the Twilio CFO, narrating your Q4 2023 earnings presentation.

The entire earnings presentation document is provided to you.
Please narrate this presentation from Twilio's Q4 2023 Earnings as if you were the presenter. Do not talk about any things, especially acronyms, if you are not exactly sure you know what they mean.

Do not leave any details un-narrated as some of your viewers are vision-impaired, so if you don't narrate every number they won't know the number.

Structure your response like this:
<narration>
    <page_narration id=1>
    [Your narration for page 1]
    </page_narration>

    <page_narration id=2>
    [Your narration for page 2]
    </page_narration>

    ... and so on for each page
</narration>

Use excruciating detail for each page, ensuring you describe every visual element and number present. Show the full response in a single message.
"""
messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": base64_string,
                },
            },
            {"type": "text", "text": prompt},
        ],
    }
]

# Now we use our prompt to narrate the entire deck. Note that this may take a few minutes to run (often up to 10).
completion = get_completion(messages)
```

这段代码对应源 notebook 的第 18 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

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

- 替换示例图片为你的截图、图表、文档或业务图片。
- 保留图片读取、编码和 Claude 调用方式，调整 prompt 中的观察维度和输出格式。
- 对 OCR、图表分析等高风险任务增加人工抽检或规则校验。
- 如果图片较大或细节密集，增加裁剪、局部放大或多轮检查流程。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- 图片分辨率不足
- 图表误读
- OCR 漏字
- 隐私数据泄露
- 多图上下文过长

生产环境中还应补充：错误处理、重试、日志、权限控制、成本监控、数据脱敏、回归测试和人工抽检。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例的输入、核心处理过程和输出分别是什么？
- Claude 在流程中承担什么职责？第三方服务或本地代码承担什么职责？
- 哪些代码片段是迁移时必须保留的骨架？
- 如果换成你的业务数据，需要替换哪些 prompt、路径、API key 或配置？
- 这个示例要进入生产环境，还缺哪些评估、监控、安全和异常处理？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **多模态视觉理解** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
