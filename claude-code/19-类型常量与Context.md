# 19 — 类型（types）、常量（constants）与上下文（context）

## 1. `src/types/` — 共享类型域

**目标**：把易循环的联合类型从 `Tool.ts` / `message` 实现中剥离，供全仓 import。

| 文件 | 内容 |
|------|------|
| `message.ts` | `UserMessage`、`AssistantMessage`、`SystemMessage`、`ProgressMessage`、`ToolUseSummaryMessage` 等 **判别联合** |
| `permissions.ts` | `PermissionMode`、`PermissionResult`、`AdditionalWorkingDirectory`、`ToolPermissionRulesBySource` |
| `tools.ts` | `BashProgress`、`MCPProgress`、`AgentToolProgress` 等各工具进度 payload |
| `hooks.ts` | `HookProgress`、`PromptRequest`/`PromptResponse` |
| `ids.ts` | `SessionId`、`AgentId` 等 **branded types** |
| `plugin.ts` | `LoadedPlugin`、`PluginError` |
| `textInputTypes.ts` | `OrphanedPermission` 等输入相关 |
| `utils.ts` | `DeepImmutable` 等元类型 |

**实现原则**：类型文件 **无运行时副作用**（或极少），可被 SDK 与 CLI 共用。

---

## 2. `src/constants/` — 产品常量与提示资产

常见子项：

- `prompts.ts`：系统提示主入口 `getSystemPrompt`（被 `cli` dump 路径使用）。
- `oauth.ts`、`product.ts`：OAuth 端点、产品名、远程 URL。
- `tools.ts`：禁用工具集合、`ALL_AGENT_DISALLOWED_TOOLS` 等（`tools.ts` re-export）。
- `xml.ts`：本地命令输出 XML 标签常量（`QueryEngine`）。
- `querySource.ts`：`QuerySource` 枚举（遥测区分来源）。

**阅读顺序**：从 `main.tsx` / `QueryEngine` import 的 constants 反查。

---

## 3. `src/context/` — 轻量「运行时上下文」模型

| 文件 | 职责 |
|------|------|
| `notifications.ts` | `Notification` 类型；`ToolUseContext.addNotification` 消费 |
| `stats.ts` | `StatsStore` 等（若存在）用于状态条统计 |

与 React `context` 不同：此处多为 **纯类型 + 小模块**，勿与 `state/AppState` 混淆。

---

## 4. `schemas/`（若存在，根目录）

- 可能含 **JSON Schema** 或 Zod 导出的静态定义，用于设置校验、SDK；以仓库实际文件为准。

---

## 5. 实现过程（类型演进）

1. 新业务先在某模块内写局部类型。
2. 出现 **循环 import** 时上移到 `types/`。
3. `Tool.ts` 仅 re-export 必要类型给旧代码路径。

---

## 6. 文档建议

维护 **`types/README` 式索引**（可选）：按「消息 / 权限 / 进度 / ID」四块链接到文件。
