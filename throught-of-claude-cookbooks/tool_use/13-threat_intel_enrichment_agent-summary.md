# 13 Threat Intel Enrichment Agent

github - claude-cookbooks\tool_use\threat_intel_enrichment_agent.ipynb

## 1. 讲的是什么

这篇讲的是一个威胁情报 enrichment agent。  
给它一个 IOC，比如 IP、域名、文件哈希，它会自己决定先查哪个情报源，再根据结果继续追查，最后产出分析和结构化报告。

notebook 里有 4 个核心工具：

- `lookup_ip_reputation`
- `lookup_file_hash`
- `lookup_domain`
- `get_mitre_techniques`

它们现在是模拟后端，但接口设计接近真实安全产品里的 VirusTotal、AbuseIPDB、Shodan、MITRE ATT&CK 等能力。

## 2. 为什么要这么做

威胁情报分析通常不是一次工具调用就结束。

比如一个文件哈希可能揭示：

- 关联恶意软件家族
- 通信过的域名
- 连接过的 IP
- 对应 ATT&CK 技术

这意味着 agent 需要根据前一步结果决定下一步，而不是按固定脚本把所有工具都调一遍。

## 3. 这样做的好处是什么

### 3.1 可以做多步调查

Claude 不只是调用工具，而是根据新证据继续 pivot。

### 3.2 多源结果能被串起来

IP、域名、hash、MITRE 技术不是孤立结果，而是在同一个调查上下文里互相印证。

### 3.3 输出同时服务人和系统

notebook 先生成面向分析师的自然语言分析，再用 `generate_structured_report` 转成 JSON。  
这样既保留解释性，也能进入 SIEM、SOAR、工单系统。

### 3.4 用 `MAX_TURNS` 防止失控

多步 agent 必须有上限。  
这篇用 `MAX_TURNS = 10` 防止模型无限追查。

## 4. 如何使用

真实使用流程是：

1. 定义多个情报工具
2. 写一个 system prompt，规定调查方法
3. 用户输入 IOC 和类型
4. Claude 决定先调哪个工具
5. 客户端执行工具并回传结果
6. Claude 根据结果决定是否继续追查
7. 生成自然语言分析
8. 再把分析转成结构化 JSON 报告

下面是贴近 notebook 的完整 agent loop：

```python
import json

import anthropic

client = anthropic.Anthropic()
MODEL_NAME = "claude-sonnet-4-6"
MAX_TURNS = 10

tools = [
    {
        "name": "lookup_ip_reputation",
        "description": "Query IP reputation data for an IP address.",
        "input_schema": {
            "type": "object",
            "properties": {"ip_address": {"type": "string"}},
            "required": ["ip_address"],
        },
    },
    {
        "name": "lookup_file_hash",
        "description": "Query malware intelligence for a file hash.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_hash": {"type": "string"},
                "hash_type": {"type": "string"},
            },
            "required": ["file_hash", "hash_type"],
        },
    },
    {
        "name": "lookup_domain",
        "description": "Query domain reputation and registration data.",
        "input_schema": {
            "type": "object",
            "properties": {"domain": {"type": "string"}},
            "required": ["domain"],
        },
    },
    {
        "name": "get_mitre_techniques",
        "description": "Look up MITRE ATT&CK techniques related to malware or behavior.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
]


def lookup_ip_reputation(ip_address: str) -> dict:
    return {
        "ip_address": ip_address,
        "abuse_confidence": 92,
        "country": "US",
        "associated_malware": ["ExampleRAT"],
        "open_ports": [80, 443],
    }


def lookup_file_hash(file_hash: str, hash_type: str) -> dict:
    return {
        "file_hash": file_hash,
        "hash_type": hash_type,
        "malware_family": "ExampleRAT",
        "contacted_domains": ["suspicious-domain.example"],
        "contacted_ips": ["203.0.113.10"],
    }


def lookup_domain(domain: str) -> dict:
    return {
        "domain": domain,
        "reputation": "malicious",
        "resolved_ips": ["203.0.113.10"],
        "tags": ["c2", "malware"],
    }


def get_mitre_techniques(query: str) -> dict:
    return {
        "query": query,
        "techniques": [
            {
                "technique_id": "T1071",
                "technique_name": "Application Layer Protocol",
                "tactic": "Command and Control",
            }
        ],
    }


def process_tool_call(tool_name: str, tool_input: dict) -> str:
    handlers = {
        "lookup_ip_reputation": lambda inp: lookup_ip_reputation(inp["ip_address"]),
        "lookup_file_hash": lambda inp: lookup_file_hash(
            inp["file_hash"],
            inp["hash_type"],
        ),
        "lookup_domain": lambda inp: lookup_domain(inp["domain"]),
        "get_mitre_techniques": lambda inp: get_mitre_techniques(inp["query"]),
    }
    handler = handlers.get(tool_name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    return json.dumps(handler(tool_input), indent=2)


SYSTEM_PROMPT = """You are a senior threat intelligence analyst.
When given an IOC, query relevant intelligence sources, follow up on related
indicators, map findings to MITRE ATT&CK, and produce an evidence-based
assessment with severity, confidence, and recommended actions."""


def run_threat_intel_agent(ioc: str, ioc_type: str) -> tuple[str, list[dict]]:
    messages = [
        {
            "role": "user",
            "content": (
                "Investigate this indicator of compromise:\n"
                f"IOC: {ioc}\n"
                f"Type: {ioc_type}\n"
            ),
        }
    ]
    tool_calls_made = []

    for _ in range(MAX_TURNS):
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            final_text = next(
                (block.text for block in response.content if hasattr(block, "text")),
                "No analysis generated.",
            )
            return final_text, tool_calls_made

        if response.stop_reason != "tool_use":
            return f"Unexpected stop_reason: {response.stop_reason}", tool_calls_made

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            tool_calls_made.append({"tool": block.name, "input": block.input})
            result = process_tool_call(block.name, block.input)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                }
            )

        messages.append({"role": "user", "content": tool_results})

    return "Reached MAX_TURNS without completing analysis.", tool_calls_made
```

结构化报告阶段是第二步，不在主 loop 里混着做。notebook 里用 `generate_structured_report` 把自然语言分析转成 JSON：

```python
def generate_structured_report(analysis: str, ioc: str, ioc_type: str) -> dict:
    response = client.messages.create(
        model=MODEL_NAME,
        max_tokens=4096,
        system=(
            "Convert the analyst findings into a structured JSON report. "
            "Return only valid JSON."
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"IOC: {ioc}\n"
                    f"Type: {ioc_type}\n"
                    f"Analysis:\n{analysis}"
                ),
            }
        ],
    )
    return json.loads(response.content[0].text)
```

完整使用示例可以这样理解：

输入：

```text
IOC: suspicious-domain.example
Type: domain
```

Claude 可能先调 `lookup_domain`。  
如果域名结果里出现关联 IP，它可能继续调 `lookup_ip_reputation`。  
如果发现关联 malware family，它可能再调 `get_mitre_techniques`。  
最后 Claude 输出分析，再把分析转成结构化报告。

这里最关键的点是：agent 不是按固定顺序机械调用 4 个工具，而是根据工具结果继续决定下一步。
