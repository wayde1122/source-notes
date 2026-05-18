# 01 Extracting Structured JSON

github - claude-cookbooks\tool_use\extracting_structured_json.ipynb

## 1. 讲的是什么

这篇讲的是：**用 Claude 的 tool use 来稳定产出结构化 JSON。**

它的重点不是“调用外部工具”，而是把 tool 的 `input_schema` 当成输出协议：

1. 定义一个工具；
2. 把目标字段写进 `input_schema`；
3. 让 Claude 调用这个工具；
4. 从 `tool_use.input` 里拿结构化结果。

所以这篇的核心是：

> 用 tool schema 代替“请严格输出 JSON”这种脆弱提示词。

notebook 里演示了 5 类任务：

1. 文章摘要
2. 命名实体识别
3. 情感分析
4. 文本分类
5. 未知字段抽取

这些任务表面不同，但套路一样：**把输出定义成工具参数结构。**

---

## 2. 为什么这样做

直接让模型“输出 JSON”经常会有几个问题：

- 字段名漂移：`author` 变成 `authors`，`topics` 变成 `tags`
- JSON 前后夹杂解释文字
- 类型不稳定：数组变字符串，数字变自然语言
- 字段一多，prompt 很难约束住

而 tool use 的好处是：Claude 一旦选择调用工具，就会倾向于按照 `input_schema` 填参数。

这不代表 100% 正确，但比自由文本 JSON 稳定很多。

这篇的真正启发是：

> 不要让模型“写 JSON”，而是让模型“填字段”。

---

## 3. 这里的工具可以是“虚拟工具”

notebook 里的工具名像：

- `print_summary`
- `print_entities`
- `print_sentiment_scores`
- `print_classification`

但它们不一定真的要执行。

很多时候，这类工具只是一个**结构化输出容器**：

- Claude 生成 `tool_use` block；
- 程序读取 `tool_use.input`；
- 不需要真的调用一个外部函数。

也就是说，这里的 tool use 更像是：

> 用工具参数承载结构化输出。

---

## 4. notebook 里的几个例子

### 4.1 文章摘要

工具：`print_summary`

字段包括：

- `author`
- `topics`
- `summary`
- `coherence`
- `persuasion`
- `counterpoint`

这个例子说明：摘要不一定是一段自然语言，也可以是一个结构化对象。

不过原 notebook 这里有个小问题：`counterpoint` 出现在 `required` 里，但没有在 `properties` 里定义。真实项目里最好补上：

```python
"counterpoint": {
    "type": "string",
    "description": "A concise counterargument to the article's main point.",
}
```

### 4.2 命名实体识别

工具：`print_entities`

输出是实体数组，每个实体包含：

- `name`
- `type`
- `context`

这类抽取任务天然适合结构化表示。

### 4.3 情感分析

工具：`print_sentiment_scores`

输出类似：

- `positive_score`
- `negative_score`
- `neutral_score`

这说明很多原本容易写成散文的 NLP 任务，都可以改成机器可消费的字段。

### 4.4 文本分类

工具：`print_classification`

输出类别和分数。

这里要注意：如果你要的是单标签分类，就应该在 schema/prompt 里明确写“只能返回一个类别”；如果是多标签分类，也要明确说明分数是否需要加和为 1。

### 4.5 未知字段抽取

工具：`print_all_characteristics`

这个例子用了开放 schema：

```python
"input_schema": {
    "type": "object",
    "additionalProperties": True,
}
```

意思是字段名可以由 Claude 自己决定。

这适合探索阶段，比如先看看文本里有哪些特征。但它不适合直接作为稳定入库格式，因为字段名和粒度可能每次都不一样。

简单说：

- 固定 schema：适合生产
- 开放 schema：适合探索

---

## 5. 最小实操模板

核心代码长这样：

```python
from anthropic import Anthropic

client = Anthropic()

tools = [
    {
        "name": "print_summary",
        "description": "Print a structured summary of an article.",
        "input_schema": {
            "type": "object",
            "properties": {
                "author": {"type": "string"},
                "topics": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "summary": {"type": "string"},
                "coherence": {"type": "integer"},
                "persuasion": {"type": "number"},
                "counterpoint": {"type": "string"},
            },
            "required": [
                "author",
                "topics",
                "summary",
                "coherence",
                "persuasion",
                "counterpoint",
            ],
        },
    }
]

response = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    tools=tools,
    tool_choice={"type": "tool", "name": "print_summary"},
    messages=[{"role": "user", "content": query}],
)
```

这里最重要的是 `tool_choice`：

```python
tool_choice={"type": "tool", "name": "print_summary"}
```

它表示：这一轮必须调用 `print_summary`，不要直接自然语言回答。

然后从返回里取结果：

```python
def extract_tool_input(response, tool_name: str) -> dict:
    for block in response.content:
        if block.type == "tool_use" and block.name == tool_name:
            return block.input
    raise ValueError(f"No tool use found for {tool_name}")

result = extract_tool_input(response, "print_summary")
```

程序真正消费的是 `result`，不是 Claude 的普通文本回答。

---

## 6. 生产里要注意什么

tool schema 能提高稳定性，但不能替代校验。

生产里至少要处理这些情况：

- Claude 没有调用目标工具
- 调用了多个工具
- 字段缺失
- 类型不符合预期
- 分数越界
- 输出被 `max_tokens` 截断
- API 请求失败

所以拿到 `tool_use.input` 后，最好再用 Pydantic 或 JSON Schema 做一次校验。

例如：

```python
from pydantic import BaseModel, Field

class ArticleSummary(BaseModel):
    author: str
    topics: list[str]
    summary: str
    coherence: int = Field(ge=0, le=100)
    persuasion: float = Field(ge=0.0, le=1.0)
    counterpoint: str

summary = ArticleSummary.model_validate(result)
```

一句话：

> tool schema 负责让模型尽量按结构输出，业务校验负责保证结果真的能用。

---

## 7. 和 JSON mode / structured outputs 的区别

这篇 notebook 讲的是 tool use 方式，但它不是唯一选择。

大概可以这样区分：

| 方式 | 适合场景 |
|---|---|
| 普通 prompt 要 JSON | 临时实验，最简单但最不稳 |
| structured outputs / JSON mode | 只需要模型返回一个 JSON 对象 |
| tool use schema | 想把结构化结果作为工具参数，接入工具流或工作流 |

如果只是“从文本抽一个 JSON 对象”，structured outputs 可能更直接。

如果你已经在使用 tool use，或者希望强制 Claude 走某个工具路径，那用 tool schema 很自然。

---

## 8. 总结

这篇 notebook 最重要的点是：

> Tool use 不只是调用外部工具，也可以作为结构化输出机制。

它把很多 NLP 任务统一成一个模式：

> 用工具入参 schema 定义输出结构，让 Claude 填字段。

适合：

- 信息抽取
- 文本分类
- 标签生成
- 情感分析
- 表单解析
- 工单结构化
- RAG 后处理

不太适合：

- 长篇创作
- 开放式分析
- 输出结构还没想清楚的任务

一句话总结：

> 这篇讲的是 schema-driven extraction：把自然语言任务变成可验证、可消费、可接入程序的结构化数据生成任务。
