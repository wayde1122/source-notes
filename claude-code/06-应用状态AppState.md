# 06 — 应用状态（AppState / Store）

## 1. 模块定位与边界

| 项目 | 说明 |
|------|------|
| **职责** | 终端应用运行期的 **单一事实来源**：设置 JSON、模型选择、权限模式与规则、MCP 连接、任务列表、teammate UI、bridge 状态、推测执行（speculation）、footer 焦点等。 |
| **核心文件** | `state/AppStateStore.ts`、`state/AppState.tsx`、`state/store.ts`、`state/selectors.ts`、`state/onChangeAppState.ts`、`state/teammateViewHelpers.ts` |
| **不包含** | 磁盘上 `settings.json` 的序列化细节（多在 `utils/settings/*`）；会话 JSONL（`utils/sessionStorage`）。 |

## 2. 设计目标

1. **`DeepImmutable` 类型**：`AppState` 用不可变语义约束，更新通过 **`setAppState(prev => next)`** 完成，便于 React 与调试回放。
2. **与 `ToolUseContext` 对齐**：工具与 `query()` 通过 `getAppState`/`setAppState` 读写同一 store；子 Agent 可能使用 **no-op setAppState** + `localDenialTracking`（见 `Tool.ts` 注释）。
3. **可选字段门控**：如 `showTeammateMessagePreview` 仅在某些 feature 下存在，配合 DCE。

## 3. `AppState` 形状要点（`AppStateStore.ts`）

阅读时关注分组：

- **设置与模型**：`settings`、`verbose`、`mainLoopModel`、`mainLoopModelForSession`
- **UI 布局**：`expandedView`、`footerSelection`、`coordinatorTaskIndex`、`viewSelectionMode`
- **权限**：`toolPermissionContext`（内含 `mode`、`alwaysAllowRules` 等，类型来自 `Tool.ts`）
- **产品模式**：`kairosEnabled`、`remoteSessionUrl`、`isBriefOnly`
- **任务与多代理**：与 `tasks/types`、`teammate` 相关字段
- **推测执行**：`SpeculationState` 机（`idle` / `active` 带 `abort`、`messagesRef`、`writtenPathsRef` 等）
- **Bridge**：WS 状态、权限回调类型在 `bridge/bridgePermissionCallbacks` 导入
- **MCP**：连接列表、资源、`ChannelPermissionCallbacks`、`ElicitationRequestEvent` 队列
- **杂项**：`spinnerTip`、`agent`（CLI `--agent`）、`todoList`（与 `utils/todo` 类型）

## 4. 实现过程

### 4.1 Store 抽象（`store.ts`）

- 通用 **订阅/派发** 抽象，供非 React 读者使用（如底层服务）。

### 4.2 React 集成（`AppState.tsx`）

- **Provider** 注入初始 state 与 `setAppState`。
- **Hooks**：`useAppState`、`useSetAppState`（模式与 React 19 项目常见写法一致）。
- **性能**：复杂选择器放 `selectors.ts`，避免全树重渲染。

### 4.3 变更回调（`onChangeAppState.ts`）

- 聚合「设置变更 → 持久化 / 遥测 / 侧车同步」等副作用（读文件内注释与订阅列表）。

## 5. 与上下游接口

| 消费者 | 用法 |
|--------|------|
| `main.tsx` | 计算初始 state（如 `kairosEnabled`） |
| `REPL.tsx` / `PromptInput` | 读模型、footer、权限模式 |
| `hooks/useCanUseTool` | 读规则、写决策 |
| `ToolUseContext` | 每轮工具执行读最新权限与连接 |
| `bridge/*` | 更新远程连接指示与回调 |

## 6. 阅读源码建议顺序

1. `AppStateStore.ts`：通读 `export type AppState`。
2. `AppState.tsx`：Provider 与 hook。
3. `selectors.ts`：常用派生状态。
4. `onChangeAppState.ts`：副作用边界。

## 7. 写扩展功能时的约束

- 新增顶层字段需同步 **持久化策略**（是否进 `settings` 或仅内存）。
- 子 Agent 若不能弹 UI，避免依赖 **仅 REPL 存在** 的字段（查 `ToolUseContext` 注释）。
