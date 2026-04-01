# 08 — React Hooks 层

## 1. 模块定位与边界

| 项目 | 说明 |
|------|------|
| **职责** | 把 **权限判定、Bridge 连接、通知、工具专用权限子逻辑** 封装为可复用 Hooks，供 `components/*` 与少数工具 UI 使用。 |
| **物理路径** | `src/hooks/*` |

## 2. 设计目标

1. **关注点分离**：`useCanUseTool` 集中 **规则 + hooks + UI 承诺** 的异步流程，避免在 `toolExecution` 内写 Ink。
2. **可测试**：Hook 依赖 `getAppState`，测试可包裹 fake Provider。

## 3. 文件与职责

| 路径 | 职责 |
|------|------|
| `useCanUseTool.tsx` | **核心**：给定 tool name + input，返回是否允许、是否需弹窗、Promise 解析时机；与 `utils/permissions`、session hooks 协调。 |
| `useReplBridge.tsx` | REPL 与 Bridge 会话的连接、重连、状态指示。 |
| `notifs/` | 与 `context/notifications` 对应的 UI/订阅 hook。 |
| `toolPermission/` | 工具权限日志、分类辅助（如 `permissionLogging.ts` 被 `toolExecution` 引用） |

## 4. 实现过程（`useCanUseTool` 概念）

1. **输入**：工具名、参数对象、当前 `ToolUseContext` 快照。
2. **快速路径**：匹配 `alwaysAllow`/`alwaysDeny`/`alwaysAsk`。
3. **PreToolUse**：执行用户配置的 shell hooks，可能改写 input 或直接拒绝。
4. **交互**：若需确认，向 UI 注册 `requestPrompt` 回调；返回的 `PromptResponse` 驱动后续。
5. **输出**：`PermissionResult`（允许/拒绝/附带记忆规则）。

> 具体分支以源码为准；与 `services/tools/toolExecution.ts` **成对阅读**。

## 5. 与上下游接口

| 模块 | 关系 |
|------|------|
| `toolExecution.ts` | 调用 `canUseTool`（函数形态可能由 hook 工厂提供） |
| `components/permissions` | 消费 pending 状态 |
| `types/permissions.ts` | 结果类型 |
| `utils/hooks/sessionHooks` | 会话级 hook 状态 |

## 6. 阅读源码建议顺序

1. `hooks/useCanUseTool.tsx`：从导出函数起读。
2. `hooks/toolPermission/permissionLogging.ts`：与遥测字段对应。
3. `hooks/useReplBridge.tsx`：与 `16-Bridge` 文档交叉。

## 7. 扩展注意

- 新增工具权限类型时：通常需同时改 **`components/permissions`** 与 **`useCanUseTool` 分发**。
