# 《Iteratively searching Wikipedia with Claude》学习笔记：第三方生态集成

> 源 Notebook：`third_party/Wikipedia/wikipedia-search-cookbook.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **第三方生态集成** 的核心机制：它如何准备输入、调用 Claude 或第三方服务、解析输出，并把示例流程迁移成自己的工程能力。

学完后，你应该能够：

- 说明这个 notebook 解决的具体问题；
- 找到核心 API 调用、关键参数和结果解析逻辑；
- 理解 Claude 在整个流程中负责什么，外部代码或第三方服务负责什么；
- 复用核心代码片段到自己的项目；
- 判断生产环境还需要补充哪些验证、监控和安全措施。

## 2. 这个示例解决的问题

Legacy notebook showing iterative Wikipedia searches with Claude 2 for research workflows.

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

- Prompts
- Search Implementation
- Running a Query

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
import re
from abc import abstractmethod
from dataclasses import dataclass

import wikipedia
from anthropic import AI_PROMPT, HUMAN_PROMPT, Anthropic


@dataclass
class SearchResult:
    """
    A single search result.
    """

    content: str


class SearchTool:
    """
    A search tool that can run a query and return a formatted string of search results.
    """

    def __init__():
        pass

    @abstractmethod
    def raw_search(self, query: str, n_search_results_to_use: int) -> list[SearchResult]:
        """
        Runs a query using the searcher, then returns the raw search results without formatting.

        :param query: The query to run.
        :param n_search_results_to_use: The number of results to return.
        """
        raise NotImplementedError()

    @abstractmethod
    def process_raw_search_results(
        self,
        results: list[SearchResult],
    ) -> list[str]:
        """
        Extracts the raw search content from the search results and returns a list of strings that can be passed to Claude.

        :param results: The search results to extract.
        """
        raise NotImplementedError()

    def search_results_to_string(self, extracted: list[str]) -> str:
        """
        Joins and formats the extracted search results as a string.

        :param extracted: The extracted search results to format.
        """
        result = "\n".join(
            [
                f'<item index="{i + 1}">\n<page_content>\n{r}\n</page_content>\n</item>'
                for i, r in enumerate(extracted)
            ]
        )
        return result

    def wrap_search_results(self, extracted: list[str]) -> str:
        """
        Formats the extracted search results as a string, including the <search_results> tags.

        :param extracted: The extracted search results to format.
        """
        return f"\n<search_results>\n{self.search_results_to_string(extracted)}\n</search_results>"

    def search(self, query: str, n_search_results_to_use: int) -> str:
        raw_search_results = self.raw_search(query, n_search_results_to_use)
        processed_search_results = self.process_raw_search_results(raw_search_results)
        displayable_search_results = self.wrap_search_results(processed_search_results)
        return displayable_search_results
```

这段代码对应源 notebook 的第 12 个代码单元，重点关注 `SearchResult、SearchTool、__init__、raw_search`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.2 核心函数 / 类定义：WikipediaSearchResult、WikipediaSearchTool、__init__

```python
@dataclass
class WikipediaSearchResult(SearchResult):
    title: str


class WikipediaSearchTool(SearchTool):
    def __init__(self, truncate_to_n_tokens: int | None = 5000):
        self.truncate_to_n_tokens = truncate_to_n_tokens
        if truncate_to_n_tokens is not None:
            self.tokenizer = Anthropic().get_tokenizer()

    def raw_search(self, query: str, n_search_results_to_use: int) -> list[WikipediaSearchResult]:
        search_results = self._search(query, n_search_results_to_use)
        return search_results

    def process_raw_search_results(self, results: list[WikipediaSearchResult]) -> list[str]:
        processed_search_results = [
            f"Page Title: {result.title.strip()}\nPage Content:\n{self.truncate_page_content(result.content)}"
            for result in results
        ]
        return processed_search_results

    def truncate_page_content(self, page_content: str) -> str:
        if self.truncate_to_n_tokens is None:
            return page_content.strip()
        else:
            return self.tokenizer.decode(
                self.tokenizer.encode(page_content).ids[: self.truncate_to_n_tokens]
            ).strip()

    def _search(self, query: str, n_search_results_to_use: int) -> list[WikipediaSearchResult]:
        results: list[str] = wikipedia.search(query)
        search_results: list[WikipediaSearchResult] = []
        for result in results:
            if len(search_results) >= n_search_results_to_use:
                break
            try:
                page = wikipedia.page(result)
                print(page.url)
            except wikipedia.exceptions.WikipediaException:
                # The Wikipedia API is a little flaky, so we just skip over pages that fail to load
                continue
            content = page.content
            title = page.title
            search_results.append(WikipediaSearchResult(content=content, title=title))
        return search_results
```

这段代码对应源 notebook 的第 13 个代码单元，重点关注 `WikipediaSearchResult、WikipediaSearchTool、__init__、raw_search`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.3 核心函数 / 类定义：extract_between_tags、ClientWithRetrieval、__init__

```python
def extract_between_tags(tag: str, string: str, strip: bool = True) -> list[str]:
    ext_list = re.findall(rf"<{tag}\s?>(.+?)</{tag}\s?>", string, re.DOTALL)
    if strip:
        ext_list = [e.strip() for e in ext_list]
    return ext_list


class ClientWithRetrieval(Anthropic):
    def __init__(self, search_tool: SearchTool, verbose: bool = True, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.search_tool = search_tool
        self.verbose = verbose

    # Helper methods
    def _search_query_stop(
        self, partial_completion: str, n_search_results_to_use: int
    ) -> tuple[list[SearchResult], str]:
        search_query = extract_between_tags("search_query", partial_completion + "</search_query>")
        if search_query is None:
            raise Exception(
                "Completion with retrieval failed as partial completion returned mismatched <search_query> tags."
            )
        print(f"Running search query against SearchTool: {search_query}")
        search_results = self.search_tool.raw_search(search_query, n_search_results_to_use)
        extracted_search_results = self.search_tool.process_raw_search_results(search_results)
        formatted_search_results = self.search_tool.wrap_search_results(extracted_search_results)
        return search_results, formatted_search_results

    def retrieve(
        self,
        query: str,
        model: str,
        n_search_results_to_use: int = 3,
        stop_sequences: list[str] = None,
        max_tokens_to_sample: int = 1000,
        max_searches_to_try: int = 5,
        temperature: float = 1.0,
    ) -> tuple[list[SearchResult], str]:
        if stop_sequences is None:
            stop_sequences = [HUMAN_PROMPT]
        prompt = (
            f"{HUMAN_PROMPT} {wikipedia_prompt} {retrieval_prompt.format(query=query)}{AI_PROMPT}"
        )
        starting_prompt = prompt
        print("Starting prompt:", starting_prompt)
        token_budget = max_tokens_to_sample
        all_raw_search_results: list[SearchResult] = []
        for tries in range(max_searches_to_try):
            partial_completion = self.completions.create(
                prompt=prompt,
                stop_sequences=stop_sequences + ["</search_query>"],
                model=model,
                max_tokens_to_sample=token_budget,
                temperature=temperature,
            )
            partial_completion, stop_reason, stop_seq = (
                partial_completion.completion,
                partial_completion.stop_reason,
                partial_completion.stop,
            )
            print(partial_completion)
            token_budget -= self.count_tokens(partial_completion)
            prompt += partial_completion
            if stop_reason == "stop_sequence" and stop_seq == "</search_query>":
                print(f"Attempting search number {tries}.")
                raw_search_results, formatted_search_results = self._search_query_stop(
                    partial_completion, n_search_results_to_use
                )
                prompt += "</search_query>" + formatted_search_results
                all_raw_search_results += raw_search_results
            else:
                break
        final_model_response = prompt[len(starting_prompt) :]
        return all_raw_search_results, final_model_response

    # Main methods
    def completion_with_retrieval(
        self,
        query: str,
        model: str,
        n_search_results_to_use: int = 3,
        stop_sequences: list[str] = None,
        max_tokens_to_sample: int = 1000,
        max_searches_to_try: int = 5,
        temperature: float = 1.0,
    ) -> str:
        if stop_sequences is None:
            stop_sequences = [HUMAN_PROMPT]
        _, retrieval_response = self.retrieve(
            query,
# ... 其余代码略，文章仅保留核心机制片段
```

这段代码对应源 notebook 的第 14 个代码单元，重点关注 `extract_between_tags、ClientWithRetrieval、__init__、_search_query_stop`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。
### 5.4 主执行流程与 API 调用

```python
import os

# Create a searcher
wikipedia_search_tool = WikipediaSearchTool()
ANTHROPIC_SEARCH_MODEL = "claude-2"

client = ClientWithRetrieval(
    api_key=os.environ["ANTHROPIC_API_KEY"], verbose=True, search_tool=wikipedia_search_tool
)

query = "Which movie came out first: Oppenheimer, or Are You There God It's Me Margaret?"

augmented_response = client.completion_with_retrieval(
    query=query,
    model=ANTHROPIC_SEARCH_MODEL,
    n_search_results_to_use=1,
    max_searches_to_try=5,
    max_tokens_to_sample=1000,
    temperature=0,
)
print(augmented_response)
```

这段代码对应源 notebook 的第 17 个代码单元，重点关注 `主执行流程与 API 调用`。阅读时要看清楚输入如何进入流程、Claude 或第三方服务在哪一步被调用、返回值如何被解析或展示。

该单元在 notebook 中的关键输出可以概括为：

```text
Starting prompt: 

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

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **第三方生态集成** 如何从概念变成可运行、可验证、可迁移的 Claude 应用流程。
