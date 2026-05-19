# 《How to build a RAG system using Claude 3 and MongoDB》学习笔记：RAG 与外部知识集成

> 源 Notebook：`third_party/MongoDB/rag_using_mongodb.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **RAG 与外部知识集成** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Build chatbot RAG system with Claude and MongoDB using tech news as knowledge base.

从学习角度看，这篇 notebook 不是孤立的代码片段，而是在展示一个可迁移流程：先准备输入和上下文，再通过 Claude 或外部服务完成关键处理，最后把结果整理成可验证、可复用的输出。

## 3. 核心概念

### 第三方服务

这类 notebook 的核心是把 Claude 接入外部系统，例如 LlamaIndex、Pinecone、MongoDB、Deepgram、ElevenLabs、WolframAlpha。

### 数据流

必须区分数据由第三方服务处理、由 Claude 理解生成、还是由本地代码编排。

### 认证与依赖

外部服务通常需要 API key、SDK、索引、数据库或网络权限。

### RAG / Tool Integration

很多第三方示例围绕检索、向量库、语音、搜索或计算工具展开。

### 边界划分

Claude 不应替代外部系统的确定性能力，而应负责解释、生成、决策或整合。

### Notebook 阅读线索

- Step 1: Library installation, data loading and preparation
- Step 2: Database and collection creation
- Step 3: Vector search index creation
- Step 4: Data ingestion
- Step 5: Vector Search
- Step 6: Handling user queries with Claude 3 models

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
from io import BytesIO

import pandas as pd
import requests
from google.colab import userdata


def download_and_combine_parquet_files(parquet_file_urls, hf_token):
    """
    Downloads Parquet files from the provided URLs using the given Hugging Face token,
    and returns a combined DataFrame.

    Parameters:
    - parquet_file_urls: List of strings, URLs to the Parquet files.
    - hf_token: String, Hugging Face authorization token.

    Returns:
    - combined_df: A pandas DataFrame containing the combined data from all Parquet files.
    """
    headers = {"Authorization": f"Bearer {hf_token}"}
    all_dataframes = []

    for parquet_file_url in parquet_file_urls:
        response = requests.get(parquet_file_url, headers=headers, timeout=60)
        if response.status_code == 200:
            parquet_bytes = BytesIO(response.content)
            df = pd.read_parquet(parquet_bytes)
            all_dataframes.append(df)
        else:
            print(
                f"Failed to download Parquet file from {parquet_file_url}: {response.status_code}"
            )

    if all_dataframes:
        combined_df = pd.concat(all_dataframes, ignore_index=True)
        return combined_df
    else:
        print("No dataframes to concatenate.")
        return None
```

这段代码对应源 notebook 的第 5 个代码单元，重点关注 `download_and_combine_parquet_files`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 主执行流程与 API 调用

```python
# Uncomment the links below to load more data
# For the full list of data visit: https://huggingface.co/datasets/MongoDB/tech-news-embeddings/tree/refs%2Fconvert%2Fparquet/default/train
parquet_files = [
    "https://huggingface.co/api/datasets/AIatMongoDB/tech-news-embeddings/parquet/default/train/0000.parquet",
    # "https://huggingface.co/api/datasets/AIatMongoDB/tech-news-embeddings/parquet/default/train/0001.parquet",
    # "https://huggingface.co/api/datasets/AIatMongoDB/tech-news-embeddings/parquet/default/train/0002.parquet",
    # "https://huggingface.co/api/datasets/AIatMongoDB/tech-news-embeddings/parquet/default/train/0003.parquet",
    # "https://huggingface.co/api/datasets/AIatMongoDB/tech-news-embeddings/parquet/default/train/0004.parquet",
    # "https://huggingface.co/api/datasets/AIatMongoDB/tech-news-embeddings/parquet/default/train/0005.parquet",
]

hf_token = userdata.get("HF_TOKEN")
combined_df = download_and_combine_parquet_files(parquet_files, hf_token)
```

这段代码对应源 notebook 的第 7 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：get_mongo_client

```python
import pymongo
from google.colab import userdata


def get_mongo_client(mongo_uri):
    """Establish connection to the MongoDB."""
    try:
        client = pymongo.MongoClient(mongo_uri)
        print("Connection to MongoDB successful")
        return client
    except pymongo.errors.ConnectionFailure as e:
        print(f"Connection failed: {e}")
        return None


mongo_uri = userdata.get("MONGO_URI")
if not mongo_uri:
    print("MONGO_URI not set in environment variables")

mongo_client = get_mongo_client(mongo_uri)

DB_NAME = "tech_news"
COLLECTION_NAME = "hacker_noon_tech_news"

db = mongo_client[DB_NAME]
collection = db[COLLECTION_NAME]
```

这段代码对应源 notebook 的第 16 个代码单元，重点关注 `get_mongo_client`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Connection to MongoDB successful
```
### 5.4 核心函数 / 类定义：handle_user_query

```python
def handle_user_query(query, collection):
    get_knowledge = vector_search(query, collection)

    search_result = ""
    for result in get_knowledge:
        search_result += (
            f"Title: {result.get('title', 'N/A')}, "
            f"Company Name: {result.get('companyName', 'N/A')}, "
            f"Company URL: {result.get('companyUrl', 'N/A')}, "
            f"Date Published: {result.get('published_at', 'N/A')}, "
            f"Article URL: {result.get('url', 'N/A')}, "
            f"Description: {result.get('description', 'N/A')}, \n"
        )

    response = client.messages.create(
        model="claude-opus-4-1",
        max_tokens=1024,
        system="You are Venture Captital Tech Analyst with access to some tech company articles and information. You use the information you are given to provide advice.",
        messages=[
            {
                "role": "user",
                "content": "Answer this user query: "
                + query
                + " with the following context: "
                + search_result,
            }
        ],
    )

    return (response.content[0].text), search_result
```

这段代码对应源 notebook 的第 25 个代码单元，重点关注 `handle_user_query`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

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

- 先确认第三方服务在流程中承担什么职责：检索、存储、语音、计算还是编排。
- 替换示例 API key、索引名称、数据库连接、音频文件或数据源。
- 保留 Claude 调用与第三方结果整合逻辑，调整 prompt 和输出结构。
- 加入外部服务失败时的 fallback、超时和重试策略。

此外，还需要替换示例中的模型、路径、数据源、prompt、评估标准和输出格式，使它们符合你的业务场景。

## 9. 局限与注意事项

需要重点注意：

- 外部服务不可用
- 认证失败
- 数据同步问题
- 成本叠加
- 供应商 API 变化

生产环境中还应补充：错误处理、重试、日志、权限控制、成本监控、数据脱敏、回归测试和人工抽检。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例的输入、核心处理过程和输出分别是什么？
- Claude 在流程中承担什么职责？第三方服务或本地代码承担什么职责？
- 哪些代码片段是迁移时必须保留的骨架？
- 如果换成你的业务数据，需要替换哪些 prompt、路径、API key 或配置？
- 这个示例要进入生产环境，还缺哪些评估、监控、安全和异常处理？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **RAG 与外部知识集成** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
