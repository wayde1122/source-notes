# 17 — 记忆目录（memdir）、Skills 与内置插件

## 1. 模块定位与边界

| 项目 | 说明 |
|------|------|
| **职责** | 从磁盘加载 **项目记忆**（CLAUDE.md、`.claude` 目录）、**内置与自定义 Skills**、**bundled plugins**；在系统提示与附件管道中注入；支撑 `SkillTool` 与 `loadMemoryPrompt`。 |
| **路径** | `src/memdir/*`、`src/skills/*`、`src/plugins/bundled/*` |
| **关联** | `QueryEngine` 中 `loadMemoryPrompt`、`memdir/paths`、`utils/skills/*` |

## 2. `memdir/`（记忆加载）

典型职责：

- **路径解析**：`paths.ts` — `hasAutoMemPathOverride` 等（`QueryEngine` import）。
- **聚合 prompt**：`memdir.ts` — `loadMemoryPrompt` 把多级 CLAUDE.md / 记忆文件拼入系统上下文。
- **与 nested memory 去重**：`ToolUseContext.loadedNestedMemoryPaths` 防止 LRU 读缓存驱逐导致重复注入（见 `Tool.ts` 注释）。

**实现过程**：

1. 启动或 cwd 变更 → 扫描项目根与父链上的约定文件名。
2. 大文件走读缓存与 token 预算；必要时降级为摘要。
3. `filterDuplicateMemoryAttachments`（`query.ts` import 路径 `utils/attachments`）去重附件消息。

## 3. `skills/`（技能）

- **`skills/bundled/index.ts`**：`main.tsx` 调用 `initBundledSkills`。
- **用户技能目录**：由 `utils/skills/*`（见 `18-Utils`）解析；`SkillTool` 执行时读取 `SKILL.md` 与脚本。
- **遥测**：`utils/telemetry/skillLoadedEvent.ts` 记录加载（若启用）。

**与命令**：`commands/skills` 提供管理 UI/CLI。

## 4. `plugins/bundled/`（内置插件）

- **`initBuiltinPlugins`**（`main.tsx`）：注册随包分发的插件清单。
- 与 **`services/plugins/PluginInstallationManager`** 区别：bundled 是 **只读内置**，安装管理器处理 **用户可写** 插件。

## 5. 与 `QueryEngine` 的耦合点

- `discoveredSkillNames`：**一轮内**技能发现集合，用于 telemetry `was_discovered`（类成员注释）。
- `loadMemoryPrompt`：在 `submitMessage` 早阶段拉取。
- slash command 与 **memory** 命令：`commands/memory`。

## 6. 阅读源码建议顺序

1. `memdir/paths.ts` → `memdir/memdir.ts`。
2. `tools/SkillTool/SkillTool.ts`。
3. `skills/bundled/index.ts`。
4. `plugins/bundled/index.ts`。
5. `utils/attachments.ts`（memory 附件）。

## 7. 安全注意

- **团队记忆同步**见 `14` 与 `services/teamMemorySync` —— 防止密钥被打包进共享记忆。
