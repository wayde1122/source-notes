# 14 — OAuth、插件、设置同步、LSP、语音、团队记忆等剩余服务

## 1. 模块定位

`services/` 下除 **api / compact / mcp / analytics / remoteManagedSettings / policyLimits / tools** 外的 **横切业务能力**，本文聚类说明，避免在总览里碎片化。

---

## 2. OAuth（`services/oauth/`）

| 文件 | 职责 |
|------|------|
| `index.ts` | 对外导出登录状态、token 刷新协调 |
| `client.ts` | OAuth HTTP、`getOrganizationUUID`（`utils/teleport/api` 等依赖） |
| `auth-code-listener.ts` | 本地 loopback 收 authorization code |
| `crypto.ts` | 密钥派生、JWK 等 |
| `getOauthProfile.ts` | 用户/org profile |

**流程概要**：CLI 启动浏览器或已有 token → listener 收 code → 换 token → 写入安全存储（`utils/secureStorage`）→ `services/api/client` 使用。

---

## 3. 插件（`services/plugins/` + `plugins/bundled/`）

| 路径 | 职责 |
|------|------|
| `services/plugins/PluginInstallationManager.ts` | 安装、更新、作用域（user/project） |
| `services/plugins/pluginOperations.ts` | 运行时加载、启用开关 |
| `services/plugins/pluginCliCommands.ts` | `VALID_INSTALLABLE_SCOPES` 等 CLI 常量 |
| `plugins/bundled/index.ts` | `main.tsx` `initBuiltinPlugins` |

与 `utils/plugins/pluginLoader.ts`、`state/AppState` 中 `LoadedPlugin` 联动。

---

## 4. 设置同步（`services/settingsSync/`）

| 文件 | 职责 |
|------|------|
| `types.ts` | 同步载荷类型 |
| `index.ts` | 跨设备拉取/推送用户设置（与账号体系绑定） |

---

## 5. LSP（`services/lsp/`）

| 文件 | 职责 |
|------|------|
| `LSPServerManager.ts` | 管理语言服务器子进程 |
| `manager.ts` | 统一入口 |
| `config.ts` | LSP 配置解析 |
| `passiveFeedback.ts` | 被动诊断收集（与 `diagnosticTracking` 配合） |

与 **`tools/LSPTool`** 配对阅读：工具发 LSP 请求 → 结果回灌模型。

---

## 6. 语音（`services/voice.ts`、`voiceStreamSTT.ts`、`voiceKeyterms.ts`）

- **STT 流**、关键词提升、与 `voice/voiceModeEnabled.ts`、`commands/voice` 门控联动。
- 通常由 **GrowthBook + feature(`VOICE_MODE`)** 双重控制。

---

## 7. 团队记忆同步（`services/teamMemorySync/`）

| 文件 | 职责 |
|------|------|
| `index.ts` | watcher 入口 |
| `watcher.ts` | 文件系统监视 |
| `secretScanner.ts` / `teamMemSecretGuard.ts` | 防止密钥进入团队记忆 |
| `types.ts` | 同步状态 |

与 `utils/teamMemoryOps.ts`、`teammate*` 协同。

---

## 8. 提示调度（`services/tips/`）

- `tipRegistry.ts`、`tipScheduler.ts`、`tipHistory.ts`：状态栏/Spinner 旁 **技巧文案** 轮换，避免骚扰（历史去重）。

---

## 9. 其他单文件服务

| 文件 | 职责 |
|------|------|
| `notifier.ts` | 系统通知抽象 |
| `preventSleep.ts` | 长时间任务防休眠 |
| `vcr.ts` | 录像/回放测试辅助 |
| `diagnosticTracking.ts` | 诊断聚合 |
| `rateLimitMessages.ts` / `mockRateLimits.ts` / `rateLimitMocking.ts` | 限流文案与测试 |
| `claudeAiLimits.ts` | Claude.ai 订阅配额检查（`main.tsx`） |
| `mcpServerApproval.tsx` | （也可归 MCP）首次连接批准 |
| `PromptSuggestion/`（若存在） | 提示建议（见 `AppStateStore` import） |

---

## 10. 阅读顺序建议

1. 当前功能相关子文件夹 **从 `index.ts` 开始**。
2. OAuth → API client → `main.tsx` 登录流程。
3. 插件 → `utils/plugins/pluginLoader` → `AppState` 插件列表。
4. LSP → `LSPTool`。

---

## 11. 实现文档模板（单服务）

- **输入/输出**：公开函数签名。
- **持久化路径**：磁盘目录。
- **失败重试**：是否阻塞启动。
- **隐私**：是否含用户仓库路径（打点脱敏规则）。
