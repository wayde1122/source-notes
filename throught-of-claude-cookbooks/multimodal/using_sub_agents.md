# 《Using Haiku as a sub-agent》学习笔记：多模态视觉理解

> 源 Notebook：`multimodal/using_sub_agents.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **多模态视觉理解** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Analyze financial reports using Haiku sub-agents for extraction and Opus for synthesis.

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

- Step 1: Set up the environment
- Step 2: Gather our documents and ask a question
- Step 3: Download and convert PDFs to images
- Step 4: Generate a specific prompt for Haiku using Opus
- Step 5: Extract information from PDFs
- Step 6: Pass the information to Opus to generate a response
- Step 7: Extract response and execute Matplotlib code

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
# Import the required libraries
import base64
import io
import os
from concurrent.futures import ThreadPoolExecutor

import fitz
import requests
from anthropic import Anthropic
from PIL import Image

# Set up the Claude API client
client = Anthropic()
MODEL_NAME = "claude-haiku-4-5"
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：download_pdf、pdf_to_base64_pngs

```python
# Function to download a PDF file from a URL and save it to a specified folder
def download_pdf(url, folder):
    response = requests.get(url, timeout=60)
    if response.status_code == 200:
        file_name = os.path.join(folder, url.split("/")[-1])
        with open(file_name, "wb") as file:
            file.write(response.content)
        return file_name
    else:
        print(f"Failed to download PDF from {url}")
        return None


# Define the function to convert a PDF to a list of base64-encoded PNG images
def pdf_to_base64_pngs(pdf_path, quality=75, max_size=(1024, 1024)):
    # Open the PDF file
    doc = fitz.open(pdf_path)

    base64_encoded_pngs = []

    # Iterate through each page of the PDF
    for page_num in range(doc.page_count):
        # Load the page
        page = doc.load_page(page_num)

        # Render the page as a PNG image
        pix = page.get_pixmap(matrix=fitz.Matrix(300 / 72, 300 / 72))

        # Convert the pixmap to a PIL Image
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Resize the image if it exceeds the maximum size
        if image.size[0] > max_size[0] or image.size[1] > max_size[1]:
            image.thumbnail(max_size, Image.Resampling.LANCZOS)

        # Convert the PIL Image to base64-encoded PNG
        image_data = io.BytesIO()
        image.save(image_data, format="PNG", optimize=True, quality=quality)
        image_data.seek(0)
        base64_encoded = base64.b64encode(image_data.getvalue()).decode("utf-8")
        base64_encoded_pngs.append(base64_encoded)

    # Close the PDF document
    doc.close()

    return base64_encoded_pngs


# Folder to save the downloaded PDFs
folder = "../images/using_sub_agents"


# Create the directory if it doesn't exist
os.makedirs(folder)

# Download the PDFs concurrently
with ThreadPoolExecutor() as executor:
    pdf_paths = list(executor.map(download_pdf, pdf_urls, [folder] * len(pdf_urls)))

# Remove any None values (failed downloads) from pdf_paths
pdf_paths = [path for path in pdf_paths if path is not None]
```

这段代码对应源 notebook 的第 8 个代码单元，重点关注 `download_pdf、pdf_to_base64_pngs`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：generate_haiku_prompt

```python
def generate_haiku_prompt(question):
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"Based on the following question, please generate a specific prompt for an LLM sub-agent to extract relevant information from an earning's report PDF. Each sub-agent only has access to a single quarter's earnings report. Output only the prompt and nothing else.\n\nQuestion: {question}",
                }
            ],
        }
    ]

    response = client.messages.create(model="claude-opus-4-1", max_tokens=2048, messages=messages)

    return response.content[0].text


haiku_prompt = generate_haiku_prompt(QUESTION)
print(haiku_prompt)
```

这段代码对应源 notebook 的第 11 个代码单元，重点关注 `generate_haiku_prompt`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Extract the following information from the Apple earnings report PDF for the quarter:
1. Apple's net sales for the quarter
2. Quarter-over-quarter change in net sales
3. Key product categories, services, or regions that contributed significantly to the change in net sales
4. Any explanations provided for the changes in net sales

Organize the extracted information in a clear, concise format focusing on the key data points and insights related to the change in net sales for the quarter.
```
### 5.4 核心函数 / 类定义：extract_info、process_pdf

```python
def extract_info(pdf_path, haiku_prompt):
    base64_encoded_pngs = pdf_to_base64_pngs(pdf_path)

    messages = [
        {
            "role": "user",
            "content": [
                *[
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64_encoded_png,
                        },
                    }
                    for base64_encoded_png in base64_encoded_pngs
                ],
                {"type": "text", "text": haiku_prompt},
            ],
        }
    ]

    response = client.messages.create(model="claude-haiku-4-5", max_tokens=2048, messages=messages)

    return response.content[0].text, pdf_path


def process_pdf(pdf_path):
    return extract_info(pdf_path, haiku_prompt)


# Process the PDFs concurrently with Haiku sub-agent models
with ThreadPoolExecutor() as executor:
    extracted_info_list = list(executor.map(process_pdf, pdf_paths))

extracted_info = ""
# Display the extracted information from each model call
for info in extracted_info_list:
    extracted_info += (
        '<info quarter="' + info[1].split("/")[-1].split("_")[1] + '">' + info[0] + "</info>\n"
    )
print(extracted_info)
```

这段代码对应源 notebook 的第 13 个代码单元，重点关注 `extract_info、process_pdf`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
<info quarter="Q4">According to the condensed consolidated statements of operations, Apple's net sales changed as follows in the 2023 financial year:

Quarter Ended September 30, 2023:
- Total net sales were $89,498 million, up from $90,146 million in the prior year quarter.
- Product sales were $67,184 million and services sales were $22,314 million.

Key contributors to the changes:
- Product sales decreased from $70,958 million in the prior year quarter.
- Services sales increased from $19,188 million in the prior year quarter.

Overall, Apple's total net sales decreased slightly compared to the same quarter in the prior year, driven by a decline in product sales which was partially offset by growth in services sales.</info>
<info quarter="Q3">Based on the financial statements provided, Apple's net sales changed as follows between the quarters in the 2023 financial year:

...
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
