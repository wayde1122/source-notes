# 《Usage & cost Admin API cookbook》学习笔记：用量与成本可观测性

> 源 Notebook：`observability/usage_cost_api.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **用量与成本可观测性** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Programmatically access and analyze your Claude API usage and cost data via Admin API.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### Usage / Cost

通过 Admin API 或用量接口分析调用量、成本、workspace 和模型使用情况。

### 运营报表

把 API 用量转成可解释指标，用于团队治理、预算管理和异常排查。

### Notebook 阅读线索

- What You Can Do
- API Overview
- Prerequisites & Security
- Basic Usage & Cost Tracking
- Understanding Usage Data
- Basic Usage Query
- Basic Cost Tracking
- Grouping, Filtering & Pagination

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
import os
from datetime import datetime, time, timedelta
from typing import Any

import requests


class AnthropicAdminAPI:
    """Secure wrapper for Anthropic Admin API endpoints."""

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("ANTHROPIC_ADMIN_API_KEY")
        if not self.api_key:
            raise ValueError(
                "Admin API key required. Set ANTHROPIC_ADMIN_API_KEY environment variable."
            )

        if not self.api_key.startswith("sk-ant-admin"):
            raise ValueError("Invalid Admin API key format.")

        self.base_url = "https://api.anthropic.com/v1/organizations"
        self.headers = {
            "anthropic-version": "2023-06-01",
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def _make_request(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        """Make authenticated request with basic error handling."""
        url = f"{self.base_url}/{endpoint}"

        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            if response.status_code == 401:
                raise ValueError("Invalid API key or insufficient permissions") from e
            elif response.status_code == 429:
                raise requests.exceptions.RequestException(
                    "Rate limit exceeded - try again later"
                ) from e
            else:
                raise requests.exceptions.RequestException(f"API error: {e}") from e


# Test connection
def test_connection():
    try:
        client = AnthropicAdminAPI()

        # Simple test query - snap to start of day to align with bucket boundaries
        params = {
            "starting_at": (
                datetime.combine(datetime.utcnow(), time.min) - timedelta(days=1)
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ending_at": datetime.combine(datetime.utcnow(), time.min).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
            "bucket_width": "1d",
            "limit": 1,
        }

        client._make_request("usage_report/messages", params)
        print("✅ Connection successful!")
        return client

    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return None


client = test_connection()
```

这段代码对应源 notebook 的第 3 个代码单元，重点关注 `AnthropicAdminAPI、__init__、_make_request、test_connection`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：get_daily_usage、analyze_usage_data

```python
def get_daily_usage(client, days_back=7):
    """Get usage data for the last N days."""
    end_time = datetime.combine(datetime.utcnow(), time.min)
    start_time = end_time - timedelta(days=days_back)

    params = {
        "starting_at": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ending_at": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bucket_width": "1d",
        "limit": days_back,
    }

    return client._make_request("usage_report/messages", params)


def analyze_usage_data(response):
    """Process and display usage data."""
    if not response or not response.get("data"):
        print("No usage data found.")
        return

    total_uncached_input = total_output = total_cache_creation = 0
    total_cache_reads = total_web_searches = 0
    daily_data = []

    for bucket in response["data"]:
        date = bucket["starting_at"][:10]

        # Sum all results in bucket
        bucket_uncached = bucket_output = bucket_cache_creation = 0
        bucket_cache_reads = bucket_web_searches = 0

        for result in bucket["results"]:
            bucket_uncached += result.get("uncached_input_tokens", 0)
            bucket_output += result.get("output_tokens", 0)

            cache_creation = result.get("cache_creation", {})
            bucket_cache_creation += cache_creation.get(
                "ephemeral_1h_input_tokens", 0
            ) + cache_creation.get("ephemeral_5m_input_tokens", 0)
            bucket_cache_reads += result.get("cache_read_input_tokens", 0)

            server_tools = result.get("server_tool_use", {})
            bucket_web_searches += server_tools.get("web_search_requests", 0)

        daily_data.append(
            {
                "date": date,
                "uncached_input_tokens": bucket_uncached,
                "output_tokens": bucket_output,
                "cache_creation": bucket_cache_creation,
                "cache_reads": bucket_cache_reads,
                "web_searches": bucket_web_searches,
                "total_tokens": bucket_uncached + bucket_output,
            }
        )

        # Add to totals
        total_uncached_input += bucket_uncached
        total_output += bucket_output
        total_cache_creation += bucket_cache_creation
        total_cache_reads += bucket_cache_reads
        total_web_searches += bucket_web_searches

    # Calculate cache efficiency
    total_input_tokens = total_uncached_input + total_cache_creation + total_cache_reads
    cache_efficiency = (
        (total_cache_reads / total_input_tokens * 100) if total_input_tokens > 0 else 0
    )

    # Display summary
    print("📊 Usage Summary:")
    print(f"Uncached input tokens: {total_uncached_input:,}")
    print(f"Output tokens: {total_output:,}")
    print(f"Cache creation: {total_cache_creation:,}")
    print(f"Cache reads: {total_cache_reads:,}")
    print(f"Cache efficiency: {cache_efficiency:.1f}%")
    print(f"Web searches: {total_web_searches:,}")

    return daily_data


# Example usage
if client:
    usage_response = get_daily_usage(client, days_back=7)
    daily_usage = analyze_usage_data(usage_response)
```

这段代码对应源 notebook 的第 5 个代码单元，重点关注 `get_daily_usage、analyze_usage_data`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
📊 Usage Summary:
Uncached input tokens: 267,751
Output tokens: 2,848,746
Cache creation: 0
Cache reads: 0
Cache efficiency: 0.0%
Web searches: 0
```
### 5.3 核心函数 / 类定义：fetch_all_usage_data、large_dataset_example

```python
def fetch_all_usage_data(client, params, max_pages=10):
    """Fetch all paginated usage data."""
    all_data = []
    page_count = 0
    next_page = None

    print("📥 Fetching paginated data...")

    while page_count < max_pages:
        current_params = params.copy()
        if next_page:
            current_params["page"] = next_page

        try:
            response = client._make_request("usage_report/messages", current_params)

            if not response or not response.get("data"):
                break

            page_data = response["data"]
            all_data.extend(page_data)
            page_count += 1

            print(f"  Page {page_count}: {len(page_data)} time buckets")

            if not response.get("has_more", False):
                print(f"✅ Complete: Retrieved all data in {page_count} pages")
                break

            next_page = response.get("next_page")
            if not next_page:
                break

        except Exception as e:
            print(f"❌ Error on page {page_count + 1}: {e}")
            break

    print(f"📊 Total retrieved: {len(all_data)} time buckets")
    return all_data


def large_dataset_example(client, days_back=3):
    """Example of handling a large dataset with pagination."""
    # Use recent time range to ensure we have data
    start_time = datetime.combine(datetime.utcnow(), time.min) - timedelta(days=days_back)
    end_time = datetime.combine(datetime.utcnow(), time.min)

    params = {
        "starting_at": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ending_at": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bucket_width": "1h",  # Hourly data for more buckets
        "group_by[]": ["model"],
        "limit": 24,  # One day per page
    }

    all_buckets = fetch_all_usage_data(client, params, max_pages=5)

    # Process the large dataset
    if all_buckets:
        total_tokens = sum(
            sum(
                result.get("uncached_input_tokens", 0) + result.get("output_tokens", 0)
                for result in bucket["results"]
            )
            for bucket in all_buckets
        )
        print(f"📈 Total tokens across all data: {total_tokens:,}")

    return all_buckets


# Example usage - use shorter time range to find recent data
if client:
    large_dataset = large_dataset_example(client, days_back=3)
```

这段代码对应源 notebook 的第 11 个代码单元，重点关注 `fetch_all_usage_data、large_dataset_example`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
📥 Fetching paginated data...
  Page 1: 24 time buckets
  Page 2: 24 time buckets
  Page 3: 24 time buckets
✅ Complete: Retrieved all data in 3 pages
📊 Total retrieved: 72 time buckets
📈 Total tokens across all data: 1,336,287
```
### 5.4 核心函数 / 类定义：export_usage_to_csv、export_costs_to_csv

```python
import csv


def export_usage_to_csv(client, output_file="usage_data.csv", days_back=30):
    """Export usage data to CSV for external analysis."""

    end_time = datetime.combine(datetime.utcnow(), time.min)
    start_time = end_time - timedelta(days=days_back)

    params = {
        "starting_at": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ending_at": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "group_by[]": ["model", "service_tier", "workspace_id"],
        "bucket_width": "1d",
    }

    try:
        # Collect all data across pages
        rows = []
        page_count = 0
        max_pages = 20  # Allow more pages for export
        next_page = None

        while page_count < max_pages:
            current_params = params.copy()
            if next_page:
                current_params["page"] = next_page

            response = client._make_request("usage_report/messages", current_params)
            page_count += 1

            # Process this page's data
            for bucket in response.get("data", []):
                date = bucket["starting_at"][:10]
                for result in bucket["results"]:
                    rows.append(
                        {
                            "date": date,
                            "model": result.get("model", ""),
                            "service_tier": result.get("service_tier", ""),
                            "workspace_id": result.get("workspace_id", ""),
                            "uncached_input_tokens": result.get("uncached_input_tokens", 0),
                            "output_tokens": result.get("output_tokens", 0),
                            "cache_creation_tokens": (
                                result.get("cache_creation", {}).get("ephemeral_1h_input_tokens", 0)
                                + result.get("cache_creation", {}).get(
                                    "ephemeral_5m_input_tokens", 0
                                )
                            ),
                            "cache_read_tokens": result.get("cache_read_input_tokens", 0),
                            "web_search_requests": result.get("server_tool_use", {}).get(
                                "web_search_requests", 0
                            ),
                        }
                    )

            # Check if there's more data
            if not response.get("has_more", False):
                break

            next_page = response.get("next_page")
            if not next_page:
                break

        # Write CSV
        if rows:
            with open(output_file, "w", newline="") as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=rows[0].keys())
                writer.writeheader()
                writer.writerows(rows)

            print(f"✅ Exported {len(rows)} rows to {output_file}")
        else:
            print(f"No usage data to export for the last {days_back} days")
            print("💡 Try increasing days_back or check if you have recent API usage")

    except Exception as e:
        print(f"❌ Export failed: {e}")


def export_costs_to_csv(client, output_file="cost_data.csv", days_back=30):
    """Export cost data to CSV."""

    end_time = datetime.combine(datetime.utcnow(), time.min)
    start_time = end_time - timedelta(days=days_back)

    params = {
        "starting_at": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ending_at": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "group_by[]": ["workspace_id", "description"],
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应源 notebook 的第 13 个代码单元，重点关注 `export_usage_to_csv、export_costs_to_csv`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
✅ Exported 36 rows to my_usage_data.csv
✅ Exported 72 cost records to my_cost_data.csv
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

- 替换组织和 workspace 配置。
- 把输出接入你的 BI、告警或成本报表。
- 定期运行并保存历史趋势。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- 权限不足
- 成本口径不一致
- 缺少历史基线

生产环境中还应补充：错误处理、重试、日志、权限控制、成本监控、数据脱敏、回归测试和人工抽检。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例的输入、核心处理过程和输出分别是什么？
- Claude 在流程中承担什么职责？第三方服务或本地代码承担什么职责？
- 哪些代码片段是迁移时必须保留的骨架？
- 如果换成你的业务数据，需要替换哪些 prompt、路径、API key 或配置？
- 这个示例要进入生产环境，还缺哪些评估、监控、安全和异常处理？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **用量与成本可观测性** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
