# 《Citations》学习笔记：文档引用与可验证回答

> 源 Notebook：`misc/using_citations.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **文档引用与可验证回答** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Enable Claude to provide detailed source citations when answering document-based questions for verification.

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

- Setup
- Document Types
- Plain Text Documents
- Visualizing Citations
- PDF Documents
- Custom Content Documents
- Using the Context Field
- PDF Highlighting

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
import os

import anthropic

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
# ANTHROPIC_API_KEY = "" # Put your API key here!

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
```

这段代码对应源 notebook 的第 4 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：visualize_raw_response

```python
# Read all help center articles and create a list of documents
articles_dir = "./data/help_center_articles"
documents = []

for filename in sorted(os.listdir(articles_dir)):
    if filename.endswith(".txt"):
        with open(os.path.join(articles_dir, filename)) as f:
            content = f.read()
            # Split into title and body
            title_line, body = content.split("\n", 1)
            title = title_line.replace("title: ", "")
            documents.append(
                {
                    "type": "document",
                    "source": {"type": "text", "media_type": "text/plain", "data": body},
                    "title": title,
                    "citations": {"enabled": True},
                }
            )

QUESTION = "I just checked out, where is my order tracking number? Track package is not available on the website yet for my order."

# Add the question to the content
content = documents

response = client.messages.create(
    model="claude-sonnet-4-6",
    temperature=0.0,
    max_tokens=1024,
    system="You are a customer support bot working for PetWorld. Your task is to provide short, helpful answers to user questions. Since you are in a chat interface avoid providing extra details. You will be given access to PetWorld's help center articles to help you answer questions.",
    messages=[
        {"role": "user", "content": documents},
        {
            "role": "user",
            "content": [{"type": "text", "text": f"Here is the user's question: {QUESTION}"}],
        },
    ],
)


def visualize_raw_response(response):
    raw_response = {"content": []}

    print("\n" + "=" * 80 + "\nRaw response:\n" + "=" * 80)

    for content in response.content:
        if content.type == "text":
            block = {"type": "text", "text": content.text}
            if hasattr(content, "citations") and content.citations:
                block["citations"] = []
                for citation in content.citations:
                    citation_dict = {
                        "type": citation.type,
                        "cited_text": citation.cited_text,
                        "document_title": citation.document_title,
                    }
                    if citation.type == "page_location":
                        citation_dict.update(
                            {
                                "start_page_number": citation.start_page_number,
                                "end_page_number": citation.end_page_number,
                            }
                        )
                    block["citations"].append(citation_dict)
            raw_response["content"].append(block)

    return json.dumps(raw_response, indent=2)


print(visualize_raw_response(response))
```

这段代码对应源 notebook 的第 7 个代码单元，重点关注 `visualize_raw_response`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
================================================================================
Raw response:
================================================================================
{
  "content": [
    {
      "type": "text",
      "text": "Based on the documentation, I can explain why you don't see tracking yet: "
    },
    {
      "type": "text",
      "text": "You'll receive an email with your tracking number once your order ships. If you don't receive a tracking number within 48 hours of your order confirmation, please contact our customer support team for assistance.",
      "citations": [
        {
          "type": "char_location",
          "cited_text": "Once your order ships, you'll receive an email with a tracking number. ",
          "document_title": "Order Tracking Information"
        },
        {
          "type": "char_location",
...
```
### 5.3 主执行流程与 API 调用

```python
import base64
import json

# Read and encode the PDF
pdf_path = "data/Constitutional AI.pdf"
with open(pdf_path, "rb") as f:
    pdf_data = base64.b64encode(f.read()).decode()

pdf_response = client.messages.create(
    model="claude-sonnet-4-6",
    temperature=0.0,
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_data},
                    "title": "Constitutional AI Paper",
                    "citations": {"enabled": True},
                },
                {"type": "text", "text": "What is the main idea of Constitutional AI?"},
            ],
        }
    ],
)

print(visualize_raw_response(pdf_response))
print(visualize_citations(pdf_response))
```

这段代码对应源 notebook 的第 11 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
================================================================================
Raw response:
================================================================================
{
  "content": [
    {
      "type": "text",
      "text": "Based on the paper, here are the key aspects of Constitutional AI:\n\n"
    },
    {
      "type": "text",
      "text": "Constitutional AI is a method for training a harmless AI assistant through self-improvement, without any human labels identifying harmful outputs. The only human oversight is provided through a list of rules or principles, hence the name \"Constitutional AI\".",
      "citations": [
        {
          "type": "page_location",
...
```
### 5.4 主执行流程与 API 调用

```python
import fitz  # PyMuPDF

# Setup paths and read PDF
pdf_path = "data/Amazon-com-Inc-2023-Shareholder-Letter.pdf"
output_pdf_path = "data/Amazon-com-Inc-2023-Shareholder-Letter-highlighted.pdf"

# Read and encode the PDF
with open(pdf_path, "rb") as f:
    pdf_data = base64.b64encode(f.read()).decode()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    temperature=0,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_data},
                    "title": "Amazon 2023 Shareholder Letter",
                    "citations": {"enabled": True},
                },
                {
                    "type": "text",
                    "text": "What was Amazon's total revenue in 2023 and how much did it grow year-over-year?",
                },
            ],
        }
    ],
)

print(visualize_raw_response(response))

# Collect PDF citations
pdf_citations = []
for content in response.content:
    if hasattr(content, "citations") and content.citations:
        for citation in content.citations:
            if citation.type == "page_location":
                pdf_citations.append(citation)

doc = fitz.open(pdf_path)

# Process each citation
for citation in pdf_citations:
    if citation.type == "page_location":
        text_to_find = citation.cited_text.replace("\u0002", "")
        start_page = citation.start_page_number - 1  # Convert to 0-based index
        end_page = citation.end_page_number - 2

        # Process each page in the citation range
        for page_num in range(start_page, end_page + 1):
            page = doc[page_num]

            text_instances = page.search_for(text_to_find.strip())

            if text_instances:
                print(f"Found cited text on page {page_num + 1}")
                for inst in text_instances:
                    highlight = page.add_highlight_annot(inst)
                    highlight.set_colors({"stroke": (1, 1, 0)})  # Yellow highlight
                    highlight.update()
            else:
                print(f"{text_to_find} not found on page {page_num + 1}")

# Save the new PDF
doc.save(output_pdf_path)
doc.close()

print(f"\nCreated highlighted PDF at: {output_pdf_path}")
```

这段代码对应源 notebook 的第 17 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
================================================================================
Raw response:
================================================================================
{
  "content": [
    {
      "type": "text",
      "text": "According to the letter, "
    },
    {
      "type": "text",
      "text": "Amazon's total revenue grew 12% year-over-year (\"YoY\") from $514B to $575B in 2023",
      "citations": [
        {
          "type": "page_location",
          "cited_text": "In 2023, Amazon\u2019s total revenue grew 12% year-over-year (\u201cYoY\u201d) from $514B to $575B. ",
          "document_title": "Amazon 2023 Shareholder Letter",
          "start_page_number": 1,
          "end_page_number": 2
        }
      ]
    },
    {
      "type": "text",
      "text": ".\n\nBreaking this down by segment:\n"
    },
    {
      "type": "text",
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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **文档引用与可验证回答** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
