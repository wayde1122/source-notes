# 04 Tool Use With Pydantic

github - claude-cookbooks\tool_use\tool_use_with_pydantic.ipynb

## 1. 讲的是什么

这篇讲的是：即使 Claude 已经按照工具 schema 生成了参数，客户端仍然要做二次数据校验。

notebook 用一个 `save_note` 工具演示这个思路，并引入了 Pydantic 模型来约束：

- `Author`
- `Note`
- `SaveNoteResponse`

## 2. 为什么要这么做

tool use 可以提升结构稳定性，但它不等于“数据一定合法”。  
模型可能仍然会出现这些问题：

- 字段类型不对
- email 格式不对
- 某个嵌套对象缺字段
- 模型给了“看起来合理”的值，但程序不接受

所以这篇不是在否定 tool schema，而是在补最后一道程序边界：Claude 负责尽量生成结构化参数，Pydantic 负责判断这些参数能不能真的进入系统。

## 3. 这样做的好处是什么

### 3.1 让 tool use 真正接到 typed code world

只要模型输出被转成明确的数据模型，后面的业务代码就能像正常 Python 程序一样处理，而不是到处防字符串和空字段。

### 3.2 把“看起来像”变成“真的合法”

工具 schema 的作用是帮助 Claude 输出得更像目标结构；Pydantic 的作用是让客户端只接受真的合法的数据。

### 3.3 更适合写入系统

一旦涉及：

- 落库
- 创建对象
- 触发动作
- 发通知

客户端校验就几乎是必须的。否则工具调用只是“形式上结构化”，并没有真正安全。

## 4. 如何使用

真正的使用动作是：

1. 先定义 Pydantic 模型
2. 再定义工具 schema
3. Claude 调用工具后，客户端取出工具参数
4. 用 Pydantic 验证参数是否合法
5. 验证通过后再执行真实业务逻辑
6. 构造结构化结果回给 Claude

最小代码示例如下：

```python
class Author(BaseModel):
    name: str
    email: EmailStr


class Note(BaseModel):
    note: str
    author: Author
    priority: int = 3
    is_public: bool = False


tool_use = next(block for block in message.content if block.type == "tool_use")
validated_note = Note(**tool_use.input)
save_note(**validated_note.model_dump())
```

完整使用示例可以这样理解：

输入：

```text
Save a public note from Alice (alice@example.com) saying the Q3 launch review is delayed.
```

Claude 会尝试调用 `save_note`，把 note 文本、author、priority、是否公开这些字段填出来。  
这时客户端不会直接信任这份输入，而是先跑一遍 Pydantic。只有通过验证，才真的执行保存。

这篇最重要的启发是：tool use 负责生成结构，程序负责决定这份结构能不能落地。
