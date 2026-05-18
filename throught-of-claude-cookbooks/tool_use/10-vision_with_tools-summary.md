# 10 Vision With Tools

github - claude-cookbooks\tool_use\vision_with_tools.ipynb

## 1. 讲的是什么

这篇讲的是：把 Claude 的视觉理解能力和 tool use 结合起来，让模型看图后不要只写一段描述，而是把图里的信息填进固定 schema。

notebook 的例子是识别营养成分表，工具叫：

- `print_nutrition_info`

这个工具不是去外部查数据，而是作为结构化输出容器，让 Claude 把图片里的营养信息填进去。

## 2. 为什么要这么做

如果只让 Claude “描述这张图”，输出通常是自然语言。人能读懂，但程序很难直接接。

比如营养标签场景里，你真正需要的是：

- calories
- total fat
- cholesterol
- total carbs
- protein

而不是一段“这是一张营养成分表，上面写着……”的描述。

所以这篇的核心是：把视觉识别结果从“可读文本”变成“可消费字段”。

## 3. 这样做的好处是什么

### 3.1 图像结果能直接进入程序

字段固定后，可以直接写入数据库、做计算、做校验或进入下游流程。

### 3.2 视觉任务更可控

模型不只是描述图片，而是按 `input_schema` 填字段。  
这比纯 OCR 文本或自由描述更适合工程系统。

### 3.3 文本抽取和图像抽取可以统一成同一种接口

不管输入是文章、客服记录，还是图片，最终都可以落到 `tool_use.input` 里。

## 4. 如何使用

真实使用流程是：

1. 定义一个结构化工具 `print_nutrition_info`
2. 把图片转成 base64
3. 在 message content 里同时放图片和文本指令
4. 请求 Claude，并传入 `tools=[nutrition_tool]`
5. 如果 `stop_reason == "tool_use"`，从工具参数里拿字段

下面是 notebook 里的完整主链路：

```python
import base64

from anthropic import Anthropic

client = Anthropic()
MODEL_NAME = "claude-opus-4-1"

nutrition_tool = {
    "name": "print_nutrition_info",
    "description": "Extracts nutrition information from an image of a nutrition label",
    "input_schema": {
        "type": "object",
        "properties": {
            "calories": {
                "type": "integer",
                "description": "The number of calories per serving",
            },
            "total_fat": {
                "type": "integer",
                "description": "The amount of total fat in grams per serving",
            },
            "cholesterol": {
                "type": "integer",
                "description": "The amount of cholesterol in milligrams per serving",
            },
            "total_carbs": {
                "type": "integer",
                "description": "The amount of total carbohydrates in grams per serving",
            },
            "protein": {
                "type": "integer",
                "description": "The amount of protein in grams per serving",
            },
        },
        "required": [
            "calories",
            "total_fat",
            "cholesterol",
            "total_carbs",
            "protein",
        ],
    },
}


def get_base64_encoded_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


message_list = [
    {
        "role": "user",
        "content": [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": get_base64_encoded_image(
                        "../images/tool_use/nutrition_label.png"
                    ),
                },
            },
            {
                "type": "text",
                "text": "Please print the nutrition information from this nutrition label image.",
            },
        ],
    }
]

response = client.messages.create(
    model=MODEL_NAME,
    max_tokens=4096,
    messages=message_list,
    tools=[nutrition_tool],
)

if response.stop_reason == "tool_use":
    tool_use = response.content[-1]
    print(tool_use.name)
    print(tool_use.input)
else:
    print("No tool was called.")
```

完整使用示例可以这样理解：

输入是一张营养标签图片。Claude 看到图片后，不应该输出普通描述，而是调用：

```text
print_nutrition_info
```

然后在工具参数里填：

- `calories`
- `total_fat`
- `cholesterol`
- `total_carbs`
- `protein`

这里有个容易忽略的点：图片内容本身不会自动变成结构化数据，结构化来自你定义的 `nutrition_tool`。没有这个 schema，Claude 很可能只是写一段描述。
