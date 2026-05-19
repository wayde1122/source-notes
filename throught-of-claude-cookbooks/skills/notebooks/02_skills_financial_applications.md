# 《Claude Skills for financial applications》学习笔记：Skills 能力封装

> 源 Notebook：`skills/notebooks/02_skills_financial_applications.ipynb`

## 1. 学习目标

这篇 notebook 的学习目标是理解 **Skills 能力封装** 的最小可运行路径：它如何准备输入、配置 Claude 或 Agent、连接工具 / 环境 / 外部资源，并把中间结果组织成可观察、可复用的工程流程。

学完后，你应该能够：

- 说明这个示例要解决的核心问题；
- 找到代码中的关键 API 调用、核心对象和执行入口；
- 理解输入、上下文、工具调用和输出之间的数据流；
- 判断这个示例迁移到自己项目时需要替换哪些配置；
- 识别示例代码距离生产可用还缺少哪些能力。

## 2. 这个示例解决的问题

Build financial dashboards and portfolio analytics using Claude's Excel, PowerPoint, PDF skills.

从学习角度看，它不是单纯演示一个 API，而是在展示一个可迁移的工程模式：如何把 Claude 放进真实工作流中，让它读取上下文、使用工具、执行任务、产出结构化或可审计的结果。

本 notebook 的主要阅读线索包括：

- Table of Contents
- Prerequisites
- 1. Setup & Data Loading {#setup}
- Load Financial Data
- Helper Functions
- 2. Use Case 1: Financial Dashboard Creation {#financial-dashboard}
- 2.1 Excel Financial Model {#excel-model}
- 💡 Best Practices for Excel Generation
- 2.2 Executive PowerPoint {#executive-ppt}
- 3. Use Case 2: Portfolio Analysis Workflow {#portfolio-analysis}

## 3. 核心概念

### Claude Skills

Skill 是把一组说明、脚本、模板和资源封装成可复用能力的方式。

### Skill Instructions

instructions 描述技能什么时候使用、如何使用、输出什么，是 Skill 的核心入口。

### Supporting Scripts

脚本用于处理确定性计算、文件转换、数据分析或格式化任务，让 Claude 不必只靠自然语言推理。

### Artifacts

很多 Skill 会生成 Excel、PPT、PDF、报告或中间文件，文章应关注文件如何输入和输出。

### Domain Workflow

Skill 的价值在于把领域流程固化下来，例如金融分析、品牌规范、文档生成。

### Table of Contents

这是 notebook 中显式出现的主题，代表该示例的一个关键学习节点。阅读时应结合对应代码单元理解它如何参与 `Skills 能力封装`。

### 1. Setup & Installation {#setup}

这是 notebook 中显式出现的主题，代表该示例的一个关键学习节点。阅读时应结合对应代码单元理解它如何参与 `Skills 能力封装`。

## 4. 整体流程图

```text
用户目标 / 示例任务
  ↓
准备输入数据、文件、环境变量或外部服务凭证
  ↓
创建核心对象：Agent / Client / Environment / Session / Skill / Tool
  ↓
配置 prompt、工具权限、文件挂载或运行上下文
  ↓
触发 Claude / Agent 执行任务
  ↓
读取事件流、工具结果、生成文件或模型输出
  ↓
展示最终结果，并分析可迁移模式与生产化限制
```

这张流程图是阅读这类 notebook 的主线：不要只看最终回答，而要看每一步如何把上下文传递给 Claude，以及 Claude 的输出如何被程序继续使用。

## 5. 核心代码精读

### 5.1 环境、依赖与客户端准备

```python
# Standard imports
import json
import os
import sys
from pathlib import Path

import pandas as pd

# Add parent directory for imports
sys.path.insert(0, str(Path.cwd().parent))

# Anthropic SDK
from anthropic import Anthropic
from dotenv import load_dotenv

# Our utilities
from file_utils import (
    download_all_files,
    print_download_summary,
)

# Load environment
load_dotenv(Path.cwd().parent / ".env")

# Configuration
API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = "claude-sonnet-4-6"

if not API_KEY:
    raise ValueError("ANTHROPIC_API_KEY not found. Please configure your .env file.")

# Initialize client
client = Anthropic(api_key=API_KEY)

# Setup directories
OUTPUT_DIR = Path.cwd().parent / "outputs" / "financial"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

DATA_DIR = Path.cwd().parent / "sample_data"

print("✓ Environment configured")
print(f"✓ Output directory: {OUTPUT_DIR}")
print(f"✓ Data directory: {DATA_DIR}")
```

这段代码对应 notebook 的第 5 个代码单元，核心关注点是 `环境、依赖与客户端准备`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.2 核心函数 / 类定义：create_skills_message、format_financial_value

```python
def create_skills_message(client, prompt, skills, prefix="", show_token_usage=True):
    """
    Helper function to create messages with Skills.

    Args:
        client: Anthropic client
        prompt: User prompt
        skills: List of skill dicts [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]
        prefix: Prefix for downloaded files
        show_token_usage: Whether to print token usage

    Returns:
        Tuple of (response, download_results)
    """
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4096,
        container={"skills": skills},
        tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
        messages=[{"role": "user", "content": prompt}],
        betas=[
            "code-execution-2025-08-25",
            "files-api-2025-04-14",
            "skills-2025-10-02",
        ],
    )

    if show_token_usage:
        print(
            f"\n📊 Token Usage: {response.usage.input_tokens} in, {response.usage.output_tokens} out"
        )

    # Download files
    results = download_all_files(client, response, output_dir=str(OUTPUT_DIR), prefix=prefix)

    return response, results


def format_financial_value(value, is_currency=True, decimals=0):
    """Format financial values for display."""
    if is_currency:
        return f"${value:,.{decimals}f}"
    else:
        return f"{value:,.{decimals}f}"


print("✓ Helper functions defined")
```

这段代码对应 notebook 的第 11 个代码单元，核心关注点是 `create_skills_message、format_financial_value`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.3 主执行流程与 API 调用

```python
# Create Financial Dashboard Excel
print("Creating financial dashboard Excel file...")
print("This creates a 2-sheet dashboard optimized for the Skills API.")
print("\n⏱️ Generation time: 1-2 minutes\n")

# Prepare the financial data
fs_data = financial_statements.to_dict("records")
quarters_2024 = ["Q1_2024", "Q2_2024", "Q3_2024", "Q4_2024"]

# Extract key financial metrics
revenue_by_quarter = {
    "Q1 2024": financial_statements[financial_statements["Category"] == "Revenue"][
        "Q1_2024"
    ].values[0],
    "Q2 2024": financial_statements[financial_statements["Category"] == "Revenue"][
        "Q2_2024"
    ].values[0],
    "Q3 2024": financial_statements[financial_statements["Category"] == "Revenue"][
        "Q3_2024"
    ].values[0],
    "Q4 2024": financial_statements[financial_statements["Category"] == "Revenue"][
        "Q4_2024"
    ].values[0],
}

financial_dashboard_prompt = f"""
Create a financial dashboard Excel workbook with 2 sheets:

Sheet 1 - "P&L Summary":
Create a Profit & Loss summary table for 2024 quarters with these rows:
- Revenue: {", ".join([f"Q{i + 1}: ${v / 1000000:.1f}M" for i, v in enumerate(revenue_by_quarter.values())])}
- Gross Profit: Use values from the data
- Operating Income: Use values from the data
- Net Income: Use values from the data
- Add a Total column with SUM formulas
- Add a row showing profit margins (Net Income / Revenue)
- Apply currency formatting and bold headers
- Add a simple bar chart showing quarterly revenue

Sheet 2 - "Key Metrics":
Create a metrics dashboard with:
- Total Revenue 2024: SUM of all quarters
- Average Quarterly Revenue: AVERAGE formula
- Q4 vs Q1 Growth: Percentage increase
- Best Quarter: MAX formula to identify
- Operating Margin Q4: Calculate from data
- Year-over-year growth vs 2023

Apply professional formatting with borders, bold headers, and currency formats.
"""

# Create the Excel financial dashboard
excel_response, excel_results = create_skills_message(
    client,
    financial_dashboard_prompt,
    [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}],
    prefix="financial_dashboard_",
)

print("\n" + "=" * 60)
print_download_summary(excel_results)

if len(excel_results) > 0 and excel_results[0]["success"]:
    print("\n✅ Financial dashboard Excel created successfully!")
```

这段代码对应 notebook 的第 13 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。
### 5.4 主执行流程与 API 调用

```python
print("Creating portfolio analysis Excel workbook...")
print("This creates a focused 2-sheet portfolio analysis optimized for the Skills API.")
print("\n⏱️ Generation time: 1-2 minutes\n")

# Prepare portfolio data for the prompt
top_holdings = portfolio_df.nlargest(5, "market_value")
sector_allocation = portfolio_data["sector_allocation"]

portfolio_excel_prompt = f"""
Create a portfolio analysis Excel workbook with 2 sheets:

Sheet 1 - "Portfolio Overview":
Create a comprehensive holdings and performance table:

Section 1 - Holdings (top of sheet):
{portfolio_df[["ticker", "name", "shares", "current_price", "market_value", "unrealized_gain", "allocation_percent"]].head(10).to_string()}

Section 2 - Portfolio Summary:
- Total portfolio value: ${portfolio_data["total_value"]:,.2f}
- Total unrealized gain: ${portfolio_df["unrealized_gain"].sum():,.2f}
- Total Return: {portfolio_data["performance_metrics"]["total_return_percent"]:.1f}%
- YTD Return: {portfolio_data["performance_metrics"]["year_to_date_return"]:.1f}%
- Sharpe Ratio: {portfolio_data["performance_metrics"]["sharpe_ratio"]:.2f}
- Portfolio Beta: {portfolio_data["performance_metrics"]["beta"]:.2f}

Apply conditional formatting: green for gains, red for losses.
Add a bar chart showing top 5 holdings by value.

Sheet 2 - "Sector Analysis & Risk":
Create sector allocation and risk metrics:

Section 1 - Sector Allocation:
{json.dumps(sector_allocation, indent=2)}
Include a pie chart of sector allocation.

Section 2 - Key Risk Metrics:
- Portfolio Beta: {portfolio_data["performance_metrics"]["beta"]:.2f}
- Standard Deviation: {portfolio_data["performance_metrics"]["standard_deviation"]:.1f}%
- Value at Risk (95%): $62,500
- Maximum Drawdown: -12.3%
- Sharpe Ratio: {portfolio_data["performance_metrics"]["sharpe_ratio"]:.2f}

Section 3 - Rebalancing Recommendations:
- Reduce Technology from 20% to 18%
- Increase Healthcare from 8.7% to 10%
- Maintain current diversification

Apply professional formatting with clear sections and headers.
"""

# Create portfolio analysis Excel
portfolio_response, portfolio_results = create_skills_message(
    client,
    portfolio_excel_prompt,
    [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}],
    prefix="portfolio_analysis_",
)

print("\n" + "=" * 60)
print_download_summary(portfolio_results)

if len(portfolio_results) > 0 and portfolio_results[0]["success"]:
    print("\n✅ Portfolio analysis Excel created successfully!")
```

这段代码对应 notebook 的第 19 个代码单元，核心关注点是 `主执行流程与 API 调用`。阅读时要看清楚：输入从哪里来、Claude 或托管服务在哪一步被调用、返回结果如何进入后续流程。

## 6. 示例运行过程拆解

可以把这个 notebook 的运行过程拆成五步：

1. **准备任务和上下文**：包括用户问题、示例文件、CSV、代码库、Slack 消息、测试目录或配置文件。
2. **创建执行对象**：根据主题创建 client、agent、environment、session、skill 或工具集合。
3. **绑定能力边界**：配置 prompt、工具权限、MCP、文件挂载、系统指令或 schema。
4. **执行并观察过程**：通过普通响应、事件流、文件输出或工具调用结果观察 Claude 的执行过程。
5. **读取结果并复盘**：查看最终文本、报告、代码修改、图表、文件或评估结果，并理解它为什么能解决原始任务。

如果 notebook 中包含输出示例，建议重点比较“输入任务”和“最终输出”之间经过了哪些中间状态；这些中间状态通常就是迁移到你自己项目时最值得复用的部分。

## 7. 关键设计思路

### 7.1 把 Claude 放进明确的工程边界

这类示例的重点不是让 Claude 自由发挥，而是通过 Agent、Session、Tool、Skill 或 Environment 给它设定边界：它能看什么、能调用什么、最终要产出什么。

### 7.2 把不确定推理和确定性代码分开

Claude 适合理解任务、规划步骤、生成解释和处理非结构化信息；确定性的文件处理、API 调用、计算、格式转换应尽量放在代码或工具中。

### 7.3 保留可观察的中间过程

事件流、日志、打印输出、生成文件和结构化返回值都很重要。它们让你能调试 Agent 为什么这么做，而不是只看到最终答案。

### 7.4 示例代码要看“可迁移骨架”

每篇 notebook 都有演示数据，但真正值得带走的是骨架：初始化、配置、执行、解析、验证。这些部分通常可以直接迁移到自己的业务场景。

## 8. 如何迁移到自己的项目

迁移时建议按下面步骤做：

- 把重复出现的业务流程抽象成 skill instructions。
- 将确定性步骤放入脚本，例如数据清洗、比率计算、格式检查或文件生成。
- 为 skill 准备示例输入和期望输出，方便测试和复用。
- 把组织规范、品牌规则、财务口径等知识写入 skill，而不是每次都写进 prompt。

更具体地说，你需要替换：

- 示例中的输入数据或任务描述；
- API key、外部服务凭证或 MCP 配置；
- prompt、系统指令和输出格式；
- 文件路径、挂载目录或运行环境；
- 最终结果的验收标准，例如测试、人工审核或自动评估。

## 9. 局限与注意事项

这个 notebook 是教学示例，不应直接视为生产方案。需要特别注意：

- instructions 过宽导致误触发
- 脚本依赖缺失
- 生成文件不可复现
- 领域规则过期
- 缺少测试样例

此外还要补充：

- 错误处理和重试机制；
- 成本、延迟和速率限制监控；
- 敏感数据脱敏和权限审计；
- 对最终结果的自动化评估或人工复核；
- 对长任务的状态保存、恢复和超时处理。

## 10. 学习检查点

学完这篇 notebook，可以用下面的问题检查自己：

- 这个示例中的核心对象是什么？Agent、Session、Environment、Skill、Tool 分别承担什么职责？
- Claude 在流程中负责哪一部分？哪些部分由普通 Python 代码或外部服务完成？
- 示例输入是什么？最终输出是什么？中间经过了哪些可观察步骤？
- 如果迁移到自己的项目，最先要替换哪些路径、prompt、工具或凭证？
- 这个示例如果进入生产环境，最需要补哪些安全、评估和监控能力？

## 11. 一句话总结

这篇 notebook 的核心价值在于：它用一个具体示例展示了 **Skills 能力封装** 如何从概念变成可运行、可观察、可迁移的 Claude 工程流程。
