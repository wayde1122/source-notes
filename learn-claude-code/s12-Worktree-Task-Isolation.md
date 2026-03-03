# S12 - Worktree + Task Isolation（Worktree 任务隔离）

> 源码：`agents/s12_worktree_task_isolation.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**用 Git Worktree 为每个任务创建独立的目录沙箱，任务是控制平面，Worktree 是执行平面。**

s11 的多 Agent 在同一目录下并发修改文件，存在文件冲突风险。s12 将每个任务映射到一个独立的 worktree 目录，不同任务的代码改动互不干扰，可以真正并行执行。

**关键洞察：** "Isolate by directory, coordinate by task ID."

---

## 架构图

```
控制平面（任务看板）              执行平面（Worktree）
.tasks/task_12.json              .worktrees/auth-refactor/
{                                  ├── (独立的工作目录)
  "id": 12,                        └── branch: wt/auth-refactor
  "subject": "Implement auth",
  "status": "in_progress",   ←→   .worktrees/index.json
  "worktree": "auth-refactor"      {
}                                    "worktrees": [{
                                       "name": "auth-refactor",
                                       "path": ".../.worktrees/auth-refactor",
                                       "branch": "wt/auth-refactor",
                                       "task_id": 12,
                                       "status": "active"
                                     }]
                                   }

                                 .worktrees/events.jsonl
                                   (追加写入的生命周期事件日志)
```

---

## 三大核心组件

### 1. TaskManager（任务管理器）

任务以 JSON 文件存储在 `.tasks/` 目录，每个任务独立一文件。

任务结构：

```json
{
  "id": 1,
  "subject": "实现 auth 重构",
  "description": "...",
  "status": "pending",
  "owner": "",
  "worktree": "",
  "blockedBy": [],
  "created_at": 1234567890.0,
  "updated_at": 1234567890.0
}
```

核心方法：

| 方法 | 说明 |
|------|------|
| `create(subject, description)` | 创建新任务，自动分配递增 ID |
| `get(task_id)` | 获取任务详情 |
| `update(task_id, status, owner)` | 更新状态或负责人 |
| `bind_worktree(task_id, worktree)` | 将任务绑定到 worktree，同时将状态改为 `in_progress` |
| `unbind_worktree(task_id)` | 解绑（任务完成时调用） |
| `list_all()` | 列出所有任务（带状态标记） |

### 2. WorktreeManager（Worktree 管理器）

封装 `git worktree` 命令，并维护 `.worktrees/index.json` 索引。

Worktree 生命周期：

```
create → active → kept（保留分支）
                → removed（删除目录 + 可选标记任务完成）
```

核心方法：

| 方法 | 说明 |
|------|------|
| `create(name, task_id, base_ref)` | 创建新 worktree + 新分支 `wt/{name}`，可绑定任务 |
| `list_all()` | 列出索引中所有 worktree |
| `status(name)` | 对指定 worktree 执行 `git status` |
| `run(name, command)` | 在指定 worktree 目录中执行 shell 命令 |
| `keep(name)` | 标记为 kept（分支保留，不删除目录） |
| `remove(name, force, complete_task)` | 删除 worktree；`complete_task=True` 时自动标记绑定任务为 completed |

`create` 命令内部执行：
```bash
git worktree add -b wt/{name} .worktrees/{name} {base_ref}
```

### 3. EventBus（事件总线）

所有 worktree 生命周期操作都写入 `.worktrees/events.jsonl`，追加写、永不删除。

事件格式：

```json
{
  "event": "worktree.create.after",
  "ts": 1234567890.0,
  "task": {"id": 12},
  "worktree": {"name": "auth-refactor", "branch": "wt/auth-refactor", "status": "active"}
}
```

已定义的事件类型：

| 事件 | 触发时机 |
|------|----------|
| `worktree.create.before` | 创建前 |
| `worktree.create.after` | 创建成功后 |
| `worktree.create.failed` | 创建失败时（含 error 字段） |
| `worktree.remove.before` | 删除前 |
| `worktree.remove.after` | 删除成功后 |
| `worktree.remove.failed` | 删除失败时 |
| `worktree.keep` | 标记 kept 时 |
| `task.completed` | 因 `complete_task=True` 自动完成任务时 |

---

## 工具列表（16 个）

| 分类 | 工具名 | 说明 |
|------|--------|------|
| 基础 | `bash` | 在主工作目录执行命令 |
| 基础 | `read_file` / `write_file` / `edit_file` | 文件读写 |
| 任务 | `task_create` | 创建任务 |
| 任务 | `task_list` | 列出所有任务 |
| 任务 | `task_get` | 获取任务详情 |
| 任务 | `task_update` | 更新状态/负责人 |
| 任务 | `task_bind_worktree` | 绑定 worktree 到任务 |
| Worktree | `worktree_create` | 创建 worktree（可绑定任务） |
| Worktree | `worktree_list` | 列出所有 worktree |
| Worktree | `worktree_status` | 查看 worktree git 状态 |
| Worktree | `worktree_run` | 在 worktree 中执行命令 |
| Worktree | `worktree_keep` | 标记 worktree 为 kept |
| Worktree | `worktree_remove` | 删除 worktree |
| 观测 | `worktree_events` | 查看最近生命周期事件 |

> `bash` 在主目录执行，`worktree_run` 在指定 worktree 目录执行——这是关键区别。

---

## 典型工作流

```
1. task_create       → 创建任务（status: pending）
2. worktree_create   → 创建隔离目录 + 分支，绑定任务（status: in_progress）
3. worktree_run      → 在隔离目录中开发、测试
4. worktree_status   → 检查 git 变更
5a. worktree_remove(complete_task=True) → 工作完成，删除目录，任务标记 completed
5b. worktree_keep    → 分支保留以便后续 merge/review
```

---

## 与前序模块的区别

| 维度 | s09-s11 | s12 |
|------|---------|-----|
| 并发隔离 | 无，多线程共享同一工作目录 | Git worktree 目录级隔离 |
| 执行方式 | 多线程 Agent | 单 Agent，通过工具切换目录 |
| 任务管理 | 简单 JSON，无绑定关系 | 任务与 worktree 双向绑定 |
| 可观测性 | 无 | EventBus 记录完整生命周期 |
| Git 集成 | 无 | 每个任务独立分支 `wt/{name}` |
| 适用场景 | 协调型并发（通信为主） | 执行型并发（代码修改为主） |

---

## 设计要点

1. **控制平面与执行平面分离**：任务看板（`.tasks/`）只管"做什么"，worktree（`.worktrees/`）只管"在哪做"，通过 `task.worktree` 字段关联。
2. **目录即隔离边界**：不同任务在不同目录操作，文件冲突从根本上消除，不需要锁。
3. **`worktree_run` vs `bash`**：`bash` 在主目录执行（全局操作），`worktree_run` 在任务沙箱执行（隔离操作），两者职责明确。
4. **双向绑定**：`task.worktree = name` 和 `worktree.task_id = id` 互相记录，方便从任一侧查询。
5. **`complete_task` 一键收尾**：`worktree_remove(complete_task=True)` 同时完成删目录+标记任务+记录事件，符合"原子操作"思路。
6. **EventBus 可追溯性**：所有关键操作前后都记录事件（含失败），便于审计和调试。
7. **graceful 降级**：不在 git repo 中时，`worktree_*` 工具会返回错误提示，不崩溃。

---

## 与前后模块的关系

```
s09 Agent Teams          → 持久化队友 + 收件箱通信
s10 Team Protocols       → + 协调协议（关闭/计划审批）
s11 Autonomous Agents    → + 任务看板 + 空闲自动认领
s12 Worktree Isolation   → + Git worktree 目录隔离  ← 本节
```
