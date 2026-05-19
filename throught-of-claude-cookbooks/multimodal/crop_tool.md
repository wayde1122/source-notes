# 《Giving Claude a crop tool for better image analysis》学习笔记：多模态视觉理解

> 源 Notebook：`multimodal/crop_tool.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **多模态视觉理解** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Give Claude a crop tool to zoom into image regions for detailed analysis of charts, documents, and diagrams.

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

- When is a Crop Tool Useful?
- Setup
- Load an Example Chart
- Define the Crop Tool
- The Agentic Loop
- Demo: Chart Analysis
- Try Another Example
- Summary

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
from io import BytesIO

from anthropic import Anthropic
from datasets import load_dataset
from IPython.display import Image, display
from PIL import Image as PILImage

client = Anthropic()
MODEL = "claude-opus-4-6"
```

这段代码对应源 notebook 的第 5 个代码单元，重点关注 `环境、依赖与数据准备`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：pil_to_base64、handle_crop

```python
def pil_to_base64(image: PILImage.Image) -> str:
    """Convert PIL Image to base64 string."""
    if image.mode in ("RGBA", "P"):
        image = image.convert("RGB")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return base64.standard_b64encode(buffer.getvalue()).decode("utf-8")


# Tool definition for the Anthropic API
CROP_TOOL = {
    "name": "crop_image",
    "description": "Crop an image by specifying a bounding box.",
    "input_schema": {
        "type": "object",
        "properties": {
            "x1": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Left edge of bounding box as normalized 0-1 value, where 0.5 is the horizontal center of the image",
            },
            "y1": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Top edge of bounding box as normalized 0-1 value, where 0.5 is the vertical center of the image",
            },
            "x2": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Right edge of bounding box as normalized 0-1 value, where 0.5 is the horizontal center of the image",
            },
            "y2": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Bottom edge of bounding box as normalized 0-1 value, where 0.5 is the vertical center of the image",
            },
        },
        "required": ["x1", "y1", "x2", "y2"],
    },
}


def handle_crop(image: PILImage.Image, x1: float, y1: float, x2: float, y2: float) -> list:
    """Execute the crop and return the result for Claude."""
    # Validate
    if not all(0 <= c <= 1 for c in [x1, y1, x2, y2]):
        return [{"type": "text", "text": "Error: Coordinates must be between 0 and 1"}]
    if x1 >= x2 or y1 >= y2:
        return [{"type": "text", "text": "Error: Invalid bounding box (need x1 < x2 and y1 < y2)"}]

    # Crop
    w, h = image.size
    cropped = image.crop((int(x1 * w), int(y1 * h), int(x2 * w), int(y2 * h)))

    return [
        {
            "type": "text",
            "text": f"Cropped to ({x1:.2f},{y1:.2f})-({x2:.2f},{y2:.2f}): {cropped.width}x{cropped.height}px",
        },
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": pil_to_base64(cropped)},
        },
    ]
```

这段代码对应源 notebook 的第 9 个代码单元，重点关注 `pil_to_base64、handle_crop`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：ask_with_crop_tool

```python
def ask_with_crop_tool(image: PILImage.Image, question: str) -> str:
    """Ask Claude a question about an image, with the crop tool available."""

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"Answer the following question about this image.\n\nThe question is: {question}\n\n",
                },
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": pil_to_base64(image),
                    },
                },
                {
                    "type": "text",
                    "text": "\n\nUse your crop_image tool to examine specific regions including legends and axes.",
                },
            ],
        }
    ]

    while True:
        response = client.messages.create(
            model=MODEL, max_tokens=1024, tools=[CROP_TOOL], messages=messages
        )

        # Print assistant's response
        for block in response.content:
            if hasattr(block, "text"):
                print(f"[Assistant] {block.text}")
            elif block.type == "tool_use":
                print(f"[Tool] crop_image({block.input})")

        # If Claude is done, return
        if response.stop_reason != "tool_use":
            return

        # Execute tool calls and continue
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result = handle_crop(image, **block.input)
                # Display the cropped image
                for item in result:
                    if item.get("type") == "image":
                        display(Image(data=base64.b64decode(item["source"]["data"])))
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result}
                )

        messages.append({"role": "user", "content": tool_results})
```

这段代码对应源 notebook 的第 13 个代码单元，重点关注 `ask_with_crop_tool`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.4 核心函数 / 类定义：ask_with_agent_sdk

```python
import tempfile


async def ask_with_agent_sdk(image: PILImage.Image, question: str):
    """Ask a question using the Claude Agent SDK with file-based image access."""
    global tool_working_dir

    with tempfile.TemporaryDirectory() as tmpdir:
        image_path = f"{tmpdir}/chart.png"
        image.save(image_path)
        tool_working_dir = tmpdir

        options = ClaudeAgentOptions(
            mcp_servers={"crop": crop_server},
            allowed_tools=["Read", "mcp__crop__crop_image"],
            cwd=tmpdir,
        )

        prompt = f"""Answer the following question about chart.png. Use your crop tool to examine specific regions of the image.

The question is: {question}"""

        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)

            async for message in client.receive_response():
                msg_type = type(message).__name__
                if msg_type in ("SystemMessage", "ResultMessage"):
                    continue

                if hasattr(message, "content") and isinstance(message.content, list):
                    for block in message.content:
                        if hasattr(block, "text"):
                            print(f"[Assistant] {block.text}")
                        elif hasattr(block, "name"):
                            print(f"[Tool] {block.name}({block.input})")
                        elif hasattr(block, "content") and isinstance(block.content, list):
                            for item in block.content:
                                if isinstance(item, dict) and item.get("type") == "image":
                                    img_data = item.get("data") or item.get("source", {}).get(
                                        "data"
                                    )
                                    if img_data:
                                        display(Image(data=base64.b64decode(img_data)))


# Run the same question with the Agent SDK
print(f"Question: {question}\n")
await ask_with_agent_sdk(chart_image, question)
```

这段代码对应源 notebook 的第 22 个代码单元，重点关注 `ask_with_agent_sdk`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Question: Is Cyan the minimum?

[Assistant] I'll first read the image to understand its content, then examine specific regions if needed.
[Tool] Read({'file_path': 'chart.png'})

<IPython.core.display.Image object>
[Assistant] Looking at this pie chart, I can clearly see the different segments and their relative sizes. Let me crop the area showing the Cyan segment to examine it more closely.
[Tool] mcp__crop__crop_image({'image_path': 'chart.png', 'x1': 0.4, 'y1': 0.6, 'x2': 0.7, 'y2': 0.9})

<IPython.core.display.Image object>
[Assistant] Now I can clearly analyze the chart. Looking at the pie chart:

**Yes, Cyan is the minimum.**

The pie chart shows 5 categories with the following relative sizes (from largest to smallest):
1. **Royal Blue** - the largest segment (takes up roughly half the pie)
2. **Peru** (tan/brown) - second largest
3. **Red** - medium-sized segment
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
