# 13 — 遥测、GrowthBook、远程托管设置与策略配额

## 1. 模块定位与边界

| 项目 | 说明 |
|------|------|
| **职责** | **产品分析事件**、**特性开关（Statsig/GrowthBook）**、**组织远程托管配置**（含安全对话框）、**策略与配额限制**；以及低层 **OTEL/Perfetto/BigQuery** 导出（`utils/telemetry`）。 |
| **合规注意** | 原仓库 `docs/zh/01-遥测与隐私分析.md` 等；本笔记只描述**代码结构**。 |

## 2. `services/analytics/`（核心）

典型文件（以仓库为准）：

- **`index.ts`**：`logEvent` 入口，统一 metadata 清洗。
- **`growthbook.ts`**：`initializeGrowthBook`、`getFeatureValue_CACHED_MAY_BE_STALE`、`checkStatsigFeatureGate_CACHED_MAY_BE_STALE`（`query/config` 使用的 gate 名 **`tengu_streaming_tool_execution2`**）。
- **`config.ts`**：`isAnalyticsDisabled` 等。
- **`sink.ts`**：初始化 analytics 出口、门闸。
- **`metadata.ts`**：工具名/文件扩展名等 **telemetry 安全字段**（`toolExecution` 大量 import）。
- **`pluginTelemetry.ts`**：插件加载事件。

**实现过程（一次 `logEvent`）**：

1. 调用方构造事件名 + metadata（常需通过 `_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 类型 branded 强制审查）。
2. sink 根据配置发往 **1P**、**Datadog** 等（细节读 `sink.ts`）。
3. GrowthBook 用于 **动态配置** 而非仅事件（与 `main.tsx` 刷新逻辑配合）。

## 3. `services/remoteManagedSettings/`

| 文件 | 职责 |
|------|------|
| `index.ts` | 拉取/刷新远程设置、与本地缓存合并 |
| `syncCache.ts` / `syncCacheState.ts` | 缓存与状态机 |
| `types.ts` | DTO |
| `securityCheck.tsx` | **危险变更**阻塞对话框（拒绝可致退出——行为见原仓库深度分析文） |

**与 `main.tsx` 关系**：启动期 `loadRemoteManagedSettings`、`refreshRemoteManagedSettings`；变更检测影响功能开关。

## 4. `services/policyLimits/`

- **`index.ts`**：`isPolicyAllowed`、`loadPolicyLimits`、`refreshPolicyLimits`、`waitForPolicyLimitsToLoad`（`main.tsx` import）。
- **`types.ts`**：组织策略结构。

用于 **企业策略**：禁用某些模型、功能上限等（具体策略字段读 types）。

## 5. `utils/telemetry/`（低层与扩展）

| 方向 | 文件示例 |
|------|-----------|
| 基础设施 | `instrumentation.ts`、`logger.ts`、`events.ts` |
| 追踪 | `sessionTracing.ts`、`betaSessionTracing.ts`、`perfettoTracing.ts` |
| 导出 | `bigqueryExporter.ts` |
| 业务 | `pluginTelemetry.ts`、`skillLoadedEvent.ts` |

与 `services/analytics` 分工：**analytics 偏产品事件**，**telemetry 偏性能与内部追踪管道**（有重叠处以调用栈为准）。

## 6. 与 `query` / `tools` 的接口

- **`query/config.ts`**：Statsig gate 快照 → 控制流式工具执行等行为。
- **`toolExecution.ts`**：工具调用前后打点、脱敏输入（`isToolDetailsLoggingEnabled`、`OTEL_LOG_TOOL_DETAILS` 等 env，见原 README）。

## 7. 阅读源码建议顺序

1. `services/analytics/index.ts` + `metadata.ts`。
2. `services/analytics/growthbook.ts`。
3. `services/remoteManagedSettings/index.ts` + `securityCheck.tsx`。
4. `services/policyLimits/index.ts`。
5. `utils/telemetry/instrumentation.ts`（需要性能排障时）。

## 8. 文档化建议

- 列表维护：**事件名枚举**、**gate 名**、**远程设置字段** 三张表，便于跨版本 diff。
