# Tool Use 学习地图

目录：`github - claude-cookbooks\tool_use`

这一组笔记不再按“随便看哪个都行”组织，而是按学习顺序拆成 13 篇。  
每篇都对应 `github - claude-cookbooks\tool_use` 里的一个 notebook，重点放在：

- 这篇到底在演示什么能力
- 代码主循环怎么跑
- 哪些 API / 参数最关键
- 适合抄去什么场景
- 哪些地方只是 demo，哪些能直接迁移

## 1. 建议阅读顺序

### 第一阶段：先把 tool use 基础骨架吃透

1. `01-extracting_structured_json-summary.md`  
   学会把工具 schema 当成结构化输出协议。

2. `02-calculator_tool-summary.md`  
   看懂最小闭环：`tool_use -> 执行工具 -> tool_result -> 最终回答`。

3. `03-customer_service_agent-summary.md`  
   从单工具升级到多工具和 `while response.stop_reason == "tool_use"` 循环。

4. `04-tool_use_with_pydantic-summary.md`  
   给工具输入输出加客户端校验，别把模型产物直接落系统。

5. `05-tool_choice-summary.md`  
   搞清楚 `auto`、`tool`、`any` 三种调用策略。

### 第二阶段：进入真实工程问题

6. `06-parallel_tools-summary.md`  
   学独立工具调用怎么降往返延迟。

7. `07-programmatic_tool_calling_ptc-summary.md`  
   学大结果、多循环、多依赖场景怎么把中间处理下沉到代码执行层。

8. `08-tool_search_with_embeddings-summary.md`  
   学工具太多时怎么做“工具检索”。

9. `09-tool_search_alternate_approaches-summary.md`  
   学不用 embedding 时，怎么做按需装载和 prompt cache 保护。

10. `10-vision_with_tools-summary.md`  
   学视觉输入怎么接到结构化工具输出。

### 第三阶段：长流程 agent 能力

11. `11-automatic-context-compaction-summary.md`  
   学任务太长时怎么自动压缩上下文。

12. `12-memory_cookbook-summary.md`  
   学跨会话长期记忆和会话内上下文清理怎么分工。

13. `13-threat_intel_enrichment_agent-summary.md`  
   看一个真正“会根据结果继续行动”的专业 agent 雏形。

## 2. 每篇笔记分别该看什么

| 文件 | 主题 | 重点看什么 | 看完应会什么 |
|---|---|---|---|
| `01-extracting_structured_json-summary.md` | 结构化抽取 | 工具 schema 如何约束输出 | 用 tool use 稳定产出 JSON |
| `02-calculator_tool-summary.md` | 最小闭环 | `stop_reason == "tool_use"` | 能手写一个最小工具调用循环 |
| `03-customer_service_agent-summary.md` | 多工具 agent | `while` 工具循环 | 能写最小多工具客服助手 |
| `04-tool_use_with_pydantic-summary.md` | 客户端校验 | Pydantic 在工具链中的位置 | 知道哪里必须做二次验证 |
| `05-tool_choice-summary.md` | 调用策略 | `auto/tool/any` 的差异 | 知道何时该强制调工具 |
| `06-parallel_tools-summary.md` | 并行调用 | `batch_tool` 的意义 | 知道怎么减少多工具往返 |
| `07-programmatic_tool_calling_ptc-summary.md` | PTC | `allowed_callers`、`code_execution` | 知道何时让代码替模型处理中间步骤 |
| `08-tool_search_with_embeddings-summary.md` | 工具检索 | embedding + `tool_search` | 知道大工具库怎么缩上下文 |
| `09-tool_search_alternate_approaches-summary.md` | 动态装载 | `describe_tool`、`tool_reference`、`defer_loading` | 知道不做语义检索时怎么按需加载工具 |
| `10-vision_with_tools-summary.md` | 视觉 + 工具 | 图片输入如何变结构化结果 | 能做图像字段抽取最小模板 |
| `11-automatic-context-compaction-summary.md` | 长上下文压缩 | `compaction_control` | 知道什么时候该总结并清历史 |
| `12-memory_cookbook-summary.md` | 长期记忆 | `memory_20250818`、`context_management` | 知道 memory 和 context editing 的边界 |
| `13-threat_intel_enrichment_agent-summary.md` | 专业 agent | 多轮 pivot 和结构化报告 | 能看懂 agent 为什么不是“多说几句 prompt” |

## 3. 如果只想抓主干，最少读哪几篇

最小必要集：

1. `01-extracting_structured_json-summary.md`
2. `02-calculator_tool-summary.md`
3. `03-customer_service_agent-summary.md`
4. `05-tool_choice-summary.md`
5. `07-programmatic_tool_calling_ptc-summary.md`
6. `11-automatic-context-compaction-summary.md`
7. `12-memory_cookbook-summary.md`

这 7 篇吃透后，你对 `tool_use` 目录的主干就差不多有了：

- 结构化输出
- 基础工具循环
- 多工具 agent
- 工具调用策略
- 大结果 / 多循环优化
- 长上下文压缩
- 长期记忆

## 4. 推荐阅读方法

不要把这些笔记当“知识点介绍”读，最好按下面的顺序配合原 notebook 一起看：

1. 先读当前这篇 summary，知道它到底想解决什么问题。
2. 再打开对应 notebook，只盯代码主循环和工具定义。
3. 把里面的工具名换成你自己的业务场景，试着口头改写一次。
4. 读完一篇，自己回答两个问题：
   - 这篇解决了哪个具体工程问题？
   - 它的控制流我能不能不看原文讲出来？

如果这两个问题答不出来，说明还停留在“看过”，没有到“学会”。
