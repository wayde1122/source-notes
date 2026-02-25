# LLM 提供商系统（providers/）

## 提供商接口（base.py）

### 核心数据结构

**ToolCallRequest** — LLM 返回的工具调用请求：

```python
@dataclass
class ToolCallRequest:
    id: str                    # 调用 ID（用于匹配结果）
    name: str                  # 工具名称
    arguments: dict[str, Any]  # 参数字典
```

**LLMResponse** — 统一响应格式：

```python
@dataclass
class LLMResponse:
    content: str | None                       # 文本回复
    tool_calls: list[ToolCallRequest] = []    # 工具调用列表
    finish_reason: str = "stop"               # 结束原因
    usage: dict[str, int] = {}                # token 使用量
    reasoning_content: str | None = None      # 思维模型的推理过程
```

`reasoning_content` 专门为 DeepSeek-R1、Kimi K2.5 等思维模型设计。

### 抽象接口

```python
class LLMProvider(ABC):
    async def chat(self, messages, tools=None, model=None, max_tokens=4096, temperature=0.7) -> LLMResponse: ...
    def get_default_model(self) -> str: ...
```

---

## 提供商注册表（registry.py）

### ProviderSpec 数据类

所有提供商的元数据集中管理，这是整个提供商系统最精妙的设计：

```python
@dataclass(frozen=True)
class ProviderSpec:
    name: str                     # 配置字段名
    keywords: tuple[str, ...]     # 模型名匹配关键字
    env_key: str                  # LiteLLM 环境变量名
    litellm_prefix: str = ""      # 模型名前缀
    skip_prefixes: tuple = ()     # 已有前缀时跳过
    env_extras: tuple = ()        # 额外环境变量（支持占位符）
    is_gateway: bool = False      # 是否为网关
    is_local: bool = False        # 是否为本地部署
    detect_by_key_prefix: str = ""    # API Key 前缀检测
    detect_by_base_keyword: str = ""  # API Base URL 关键字检测
    strip_model_prefix: bool = False  # 网关模式下先剥离前缀
    model_overrides: tuple = ()       # 特定模型的参数覆盖
```

### 完整的 12 个提供商注册表

**网关提供商**（可路由任意模型，优先级最高）：

| 名称       | 检测方式                   | 前缀          | 特殊处理       |
| ---------- | -------------------------- | ------------- | -------------- |
| OpenRouter | API Key 以 `sk-or-` 开头   | `openrouter/` | 全球网关       |
| AiHubMix   | API Base 含 `aihubmix`     | `openai/`     | 先剥离再加前缀 |

**标准提供商**（通过模型名关键字匹配）：

| 名称      | 关键字                | 前缀         | 特殊处理                       |
| --------- | --------------------- | ------------ | ------------------------------ |
| Anthropic | `anthropic`, `claude` | 无           | LiteLLM 原生支持               |
| OpenAI    | `openai`, `gpt`       | 无           | LiteLLM 原生支持               |
| DeepSeek  | `deepseek`            | `deepseek/`  | —                              |
| Gemini    | `gemini`              | `gemini/`    | —                              |
| Zhipu     | `zhipu`, `glm`, `zai` | `zai/`       | 额外设置 ZHIPUAI_API_KEY       |
| DashScope | `qwen`, `dashscope`   | `dashscope/` | 阿里云通义千问                 |
| Moonshot  | `moonshot`, `kimi`    | `moonshot/`  | kimi-k2.5 强制 temperature=1.0 |
| MiniMax   | `minimax`             | `minimax/`   | —                              |

**本地部署**：

| 名称 | 关键字 | 前缀           | 说明                |
| ---- | ------ | -------------- | ------------------- |
| vLLM | `vllm` | `hosted_vllm/` | 用户需提供 api_base |

**辅助**：

| 名称 | 关键字 | 前缀    | 说明             |
| ---- | ------ | ------- | ---------------- |
| Groq | `groq` | `groq/` | 主要用于语音转写 |

### 匹配优先级

1. **模型名关键字**：模型名中包含 `claude` → 匹配 Anthropic
2. **网关回退**：未匹配到时，按注册顺序找第一个有 API Key 的提供商

### 添加新提供商只需 2 步

1. 在 `PROVIDERS` 元组中添加 `ProviderSpec`
2. 在 `config/schema.py` 的 `ProvidersConfig` 中添加字段

---

## LiteLLM 实现（litellm_provider.py）

### 模型名解析（_resolve_model）

```
用户配置 "qwen-max"
    ↓ find_by_model() 匹配到 DashScope
    ↓ spec.litellm_prefix = "dashscope"
    ↓ 加前缀
最终调用 "dashscope/qwen-max"

用户配置 "anthropic/claude-3"（走 AiHubMix 网关）
    ↓ _gateway.strip_model_prefix = True
    ↓ 剥离 → "claude-3"
    ↓ _gateway.litellm_prefix = "openai"
    ↓ 加前缀
最终调用 "openai/claude-3"
```

### 环境变量设置（_setup_env）

- 网关提供商：覆盖已有环境变量
- 标准提供商：`setdefault` 不覆盖用户已设的值
- 支持 `{api_key}` / `{api_base}` 占位符扩展额外环境变量

### 调用流程

```
chat(messages, tools, model)
  │
  ├─ _resolve_model()      → 解析模型名 + 加前缀
  ├─ _apply_model_overrides() → 模型特定参数覆盖
  ├─ 注入 api_key / api_base / extra_headers
  ├─ litellm.acompletion()  → 异步调用
  └─ _parse_response()      → 解析为 LLMResponse
```

### 错误处理

调用失败不抛异常，将错误包装为 `LLMResponse(content="Error: ...", finish_reason="error")`，上层可优雅处理。
