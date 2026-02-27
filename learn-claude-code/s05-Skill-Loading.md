# S05 - Skill Loading（技能加载）

> 源码：`agents/s05_skill_loading.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**不要把所有知识塞进 System Prompt，按需加载。**

System Prompt 是 Agent 每次调用 LLM 都必须发送的内容，越长越贵、越慢。s05 引入两层加载机制：System Prompt 里只放技能名和简短描述（第一层），LLM 需要时通过 `load_skill` 工具获取完整内容（第二层）。

如果有 20 个技能每个 2000 tokens，全放 System Prompt 就是 40000 tokens。分两层后，System Prompt 只需 ~2000 tokens，需要时才加载 1-2 个。

**关键洞察：** "Don't put everything in the system prompt. Load on demand."

---

## 架构图

```
System prompt:
+--------------------------------------+
| You are a coding agent.              |
| Skills available:                    |
|   - git: Git workflow helpers        |  <-- Layer 1: 元数据（~100 tokens/skill）
|   - test: Testing best practices     |
+--------------------------------------+

When model calls load_skill("git"):
+--------------------------------------+
| tool_result:                         |
| <skill>                              |
|   Full git workflow instructions...  |  <-- Layer 2: 完整正文（按需加载）
|   Step 1: ...                        |
|   Step 2: ...                        |
| </skill>                             |
+--------------------------------------+
```

---

## 代码拆解

### 1. 技能文件格式（`.skills/*.md`）

技能以 Markdown 文件存放，使用 YAML frontmatter 头部：

```markdown
---
description: Git workflow helpers
tags: git, vcs
---
## Commit 规范
1. 使用 conventional commits ...
2. ...
```

`---` 之间是元数据（description、tags 等），之后是正文。这种格式在静态站点生成器（Jekyll、Hugo）中广泛使用。

### 2. SkillLoader 类（第 51-97 行）

#### `__init__` + `_load_all` — 启动时扫描全部技能文件

```python
def _load_all(self):
    if not self.skills_dir.exists():
        return
    for f in sorted(self.skills_dir.glob("*.md")):
        name = f.stem
        text = f.read_text()
        meta, body = self._parse_frontmatter(text)
        self.skills[name] = {"meta": meta, "body": body, "path": str(f)}
```

- `sorted()` 保证加载顺序稳定，不受文件系统排序影响
- `f.stem` 取文件名去掉扩展名（如 `git.md` → `git`）作为技能名
- 每个技能存储为 `{meta, body, path}` 三元组

#### `_parse_frontmatter` — 手写的极简 YAML 解析

```python
def _parse_frontmatter(self, text: str) -> tuple:
    match = re.match(r"^---\n(.*?)\n---\n(.*)", text, re.DOTALL)
    if not match:
        return {}, text
    meta = {}
    for line in match.group(1).strip().splitlines():
        if ":" in line:
            key, val = line.split(":", 1)
            meta[key.strip()] = val.strip()
    return meta, match.group(2).strip()
```

- 正则 `^---\n(.*?)\n---\n(.*)` 配合 `re.DOTALL` 匹配跨行的 frontmatter 块
- `(.*?)` 非贪婪匹配确保只取第一个 `---` 对之间的内容
- `split(":", 1)` 只按第一个冒号分割，避免 value 中含冒号时被误切
- 不依赖 `pyyaml` 等第三方库，保持零依赖的设计哲学

**局限性：** 只支持简单的 `key: value` 单行格式，不支持嵌套、列表等完整 YAML 语法。但对于技能元数据来说足够了。

#### `get_descriptions` — 第一层：轻量摘要

```python
def get_descriptions(self) -> str:
    for name, skill in self.skills.items():
        desc = skill["meta"].get("description", "No description")
        tags = skill["meta"].get("tags", "")
        line = f"  - {name}: {desc}"
        if tags:
            line += f" [{tags}]"
        lines.append(line)
```

输出示例：

```
  - git: Git workflow helpers [git, vcs]
  - test: Testing best practices [testing]
  - docker: Container management [docker, devops]
```

注入 System Prompt，让 LLM 知道有哪些技能可用，但不占太多 token。

#### `get_content` — 第二层：按需加载完整内容

```python
def get_content(self, name: str) -> str:
    skill = self.skills.get(name)
    if not skill:
        return f"Error: Unknown skill '{name}'. Available: {', '.join(self.skills.keys())}"
    return f"<skill name=\"{name}\">\n{skill['body']}\n</skill>"
```

- 找不到技能时，返回可用技能列表作为错误提示，帮助 LLM 自我修正
- 用 `<skill>` XML 标签包裹正文，给 LLM 清晰的结构化边界

### 3. System Prompt 组装（第 102-107 行）

```python
SYSTEM = f"""You are a coding agent at {WORKDIR}.
Use load_skill to access specialized knowledge before tackling unfamiliar topics.

Skills available:
{SKILL_LOADER.get_descriptions()}"""
```

这是两层加载的**衔接点**：

- `get_descriptions()` 的输出直接嵌入 System Prompt（第一层）
- Prompt 中的 "Use load_skill to access specialized knowledge" 引导 LLM 在需要时主动调用 `load_skill`（触发第二层）

### 4. load_skill 工具注册（第 164 行 + 第 176-177 行）

分发表新增一行：

```python
"load_skill": lambda **kw: SKILL_LOADER.get_content(kw["name"]),
```

工具 Schema：

```python
{"name": "load_skill", "description": "Load specialized knowledge by name.",
 "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}
```

参数只有一个 `name`，极其简洁。

### 5. Agent Loop（第 181-200 行）

循环结构与 s02/s03 完全一致，没有任何变化。再次验证了 s02 的核心洞察——**循环不变，工具可插拔**。

---

## 数据流

```
启动时:
  SkillLoader 扫描 .skills/ 目录
  → 解析 git.md, test.md, docker.md
  → get_descriptions() 输出注入 System Prompt

用户输入 "帮我配置 GitHub Actions CI"
    ↓
System Prompt 中 LLM 看到:
  Skills available:
    - git: Git workflow helpers [git, vcs]
    ↓
LLM 判断需要 git 相关知识:
  tool_use { name: "load_skill", input: { name: "git" } }
    ↓
SKILL_LOADER.get_content("git") 返回:
  <skill name="git">
  ## Commit 规范
  1. 使用 conventional commits ...
  ## CI/CD
  ...
  </skill>
    ↓
LLM 拿到完整技能内容，按照指引执行:
  tool_use { name: "write_file", input: { path: ".github/workflows/ci.yml", ... } }
    ↓
stop_reason = "end_turn"，循环结束
```

---

## s04 → s05 的演进对比

| 维度 | s04 | s05 |
| --- | --- | --- |
| 新增概念 | 子代理 | 技能加载 |
| 知识注入方式 | 全靠 System Prompt + LLM 自身知识 | 两层加载：摘要在 Prompt，正文按需获取 |
| 新增工具 | task（派子代理） | load_skill（加载技能） |
| Token 优化 | 子代理上下文隔离节省父 Agent 窗口 | 延迟加载节省 System Prompt 长度 |
| 外部知识 | 无 | `.skills/*.md` 文件系统作为知识库 |
| 循环结构 | 标准 while 循环 | **完全相同** |

---

## 与 Cursor Skills 的对应关系

这个模式就是 Cursor IDE Agent Skills 的原理：

| s05 概念 | Cursor 实现 |
| --- | --- |
| `.skills/*.md` 文件 | `.cursor/skills/*/SKILL.md` 文件 |
| YAML frontmatter 的 `description` | SKILL.md 的技能描述 |
| `get_descriptions()` 注入 System Prompt | Cursor 在 System Prompt 中列出可用 Skills |
| `load_skill("name")` 工具调用 | Cursor Agent 读取 SKILL.md 获取完整指引 |
| `<skill>` 标签包裹的正文 | Cursor 注入的技能内容 |

---

## 用 Node.js 重写时的对应关系

| Python（源码） | Node.js（练习） |
| --- | --- |
| `Path.glob("*.md")` | `fs.readdirSync(dir).filter(f => f.endsWith('.md'))` |
| `f.stem` | `path.parse(f).name` |
| `re.match(..., re.DOTALL)` | `text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)` |
| `line.split(":", 1)` | `line.indexOf(':')` + `line.slice()` 或 `line.split(/:(.*)/s)` |
| `sorted(...)` | `files.sort()` |
| f-string 模板 | 模板字面量 `` ` `` |
| `dict.get(key, default)` | `map.get(key) ?? default` |

---

## 思考与总结

1. **System Prompt 是最贵的 token** — 每次 LLM 调用都会发送 System Prompt，它的长度直接影响成本和延迟。两层加载是经典的"索引 + 内容分离"优化
2. **文件系统即知识库** — `.skills/*.md` 就是一个极简的知识库。不需要数据库、不需要向量检索，纯文件 + Markdown 就够了。扩展知识只需新增一个 `.md` 文件
3. **Frontmatter 是元数据与内容分离的标准模式** — 在 Jekyll、Hugo、Astro 等静态站点生成器中广泛使用，同时也是 Cursor Rules 和 Skills 的文件格式
4. **LLM 自主决定何时加载** — 代码不强制加载任何技能，是 LLM 根据用户需求和可用技能列表自己判断。这又一次体现了 Agent 与脚本的区别：决策权在模型
5. **错误信息也是引导** — `get_content` 找不到技能时返回可用列表，这不只是报错，更是帮助 LLM 在下一轮选对名字。好的错误信息本身就是一种 prompt engineering
6. **零依赖设计** — 手写 frontmatter 解析而不用 `pyyaml`，保持了整个系列"只依赖 anthropic SDK"的极简风格
