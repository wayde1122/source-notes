# 18 — Utils 工具库（按子域拆解）

## 1. 模块定位

`src/utils/` 是 **最大目录**（千级文件），承载 **权限、消息、模型、设置、Git、沙箱、hooks、遥测、技能、worktree、session** 等横切逻辑。本文按 **子文件夹/主题** 给设计与阅读路径，避免迷失。

## 2. 子域地图（表格）

| 子路径 | 职责摘要 |
|--------|-----------|
| `permissions/` | 规则引擎、`denialTracking`、filesystem 允许路径、bash 风险分类 |
| `messages/` | 与 API 消息互转、`systemInit`、mapper |
| `model/` | `getMainLoopModel`、解析 CLI `--model`、模型别名 |
| `settings/` | `settings.json` 读写、schema、**MDM**、`changeDetector` |
| `sandbox/` | 沙箱运行时选择、doctor |
| `hooks/` | 用户 PreToolUse/PostToolUse/Stop 等 shell hooks 执行 |
| `memory/` | 记忆文件辅助（与 memdir 分工：偏通用工具） |
| `git/` | status、diff、commit 辅助 |
| `github/` | GitHub API、PR、评论 |
| `bash/` | shell 转义、pty 相关 |
| `shell/` | `Shell.ts`、`PowerShell` 门控工具函数 |
| `swarm/` | 多 Agent 布局、teammate 初始化、重连 |
| `teammate*.ts` | teammate 邮箱、上下文、发现（根级文件） |
| `telemetry/` | 见 `13` |
| `plugins/` | 插件发现与加载缓存 |
| `skills/` | 技能扫描、变更检测 `skillChangeDetector` |
| `worktree.ts` | git worktree 模式大块逻辑（tmux、控制模式） |
| `worktreeModeEnabled.ts` | 门控封装 |
| `teleport/` | Teleport 远程开发环境 API（OAuth org UUID） |
| `fileStateCache.ts` | 读文件 LRU |
| `fileHistory.ts` | 撤销/重做快照（编辑工具用） |
| `sessionStorage.ts` | 会话 JSONL、transcript |
| `toolResultStorage.ts` | 工具结果外置、图片 offload、**内容替换预算** |
| `queryContext.ts` | `fetchSystemPromptParts` |
| `processUserInput/` | 见 `05` |
| `config.ts` | 全局配置启用 |
| `cwd.ts` / `Shell.ts` | 工作目录与 shell 封装 |
| `envUtils.ts` | 布尔 env 解析 |
| `log.ts` / `debug.ts` | 日志 |
| `errors.ts` | 统一错误类型 |
| `tokens.ts` / `tokenBudget.ts` / `context.ts` | token 计数与上下文上限 |
| `attachments.ts` | 附件与 memory 去重 |
| `abortController.ts` | 子 controller 工厂 |
| `startupProfiler.ts` / `headlessProfiler.ts` / `queryProfiler.ts` | 性能埋点 |
| `earlyInput.ts` | 启动早期键盘缓冲 |
| `renderOptions.ts` | Ink 渲染选项 |
| `theme.ts` / `systemTheme.ts` | 主题 |
| `thinking.ts` | extended thinking 配置 |
| `todo/` | Todo 列表类型与持久化 |
| `tasks.ts` | todo v2 开关等 |
| `agentSwarmsEnabled.ts` | feature 封装 |
| `toolSearch.ts` / `embeddedTools.ts` | 工具搜索、内嵌搜索工具优化 |
| `computerUse/`、`claudeInChrome/` | 计算机使用/Chrome 集成（门控） |
| `effort.ts` / `fastMode.ts` / `advisor.ts` | 产品参数 |
| `auth.ts` | 订阅类型、Bedrock/GCP 预取（`main.tsx`） |
| `asciicast.ts` | 终端录像 |
| `secureStorage/`、`keychainPrefetch.ts` | 凭据存储 |
| `managedEnv.ts` | 托管环境变量应用 |
| `warningHandler.ts` | 全局警告拦截 |
| `xdg.ts` / `windowsPaths.ts` / `platform.ts` | 路径与平台 |
| `uuid.ts` / `truncate.ts` / `array.ts` | 纯工具函数 |
| `undercover.ts` | 「卧底模式」相关（见原仓库 docs） |
| `ultraplan/` | CCR / ultraplan 会话关键字（`ccrSession.ts`） |

> 若子目录未列出：在仓库内 `Get-ChildItem utils -Directory` 补全。

## 3. 实现过程（典型：系统提示组装 `queryContext.ts`）

1. 收集 **静态 prompt 片段**（constants + 产品字符串）。
2. 注入 **工具定义**（名称、描述、JSON schema）。
3. 注入 **记忆**（memdir）。
4. 注入 **用户规则**（settings）。
5. 附加 **环境上下文**（cwd、git 分支、date、模型能力）。

## 4. 与核心模块的依赖方向（建议心智模型）

- **`query.ts` → utils**：单向扇出；避免从 utils **回指** `query.ts`（防循环）。
- **重型工具**（`worktree.ts`）被 `cli.tsx` 早调用时注意 **import 成本**（注释常有说明）。

## 5. 阅读源码策略

1. **带着问题搜**：如 “compact” → `services/compact` + `utils/messages`。
2. **读 `index`/`主文件`**：许多子目录无 index，则读被 `main.tsx` 或 `query.ts` import 最多的那个文件（用 IDE 查找引用）。
3. **单测目录**：`bun test` 或 `__tests__` 同名文件可反推边界行为。

## 6. 维护本笔记的方法

每完成一个子域精读，在表 2 加 **一行「关键导出函数」** 列扩展列。
