# S07 - Task System（持久化任务系统）

> 源码：`agents/s07_task_system.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**把任务状态从对话中搬到文件系统，让它在上下文压缩后依然存活。**

s03 的 `TodoManager` 把任务存在内存的 `self.items` 列表中——一旦 s06 的 auto_compact 触发，messages 被重置，模型就忘了之前的任务列表。s07 把每个任务持久化为独立的 JSON 文件，并引入依赖图（blockedBy/blocks），即使对话被压缩，Agent 也能通过 `task_list` 重新读取所有任务状态。

**关键洞察：** "State that survives compression — because it's outside the conversation."

---

## 架构图

```
.tasks/
  task_1.json  {"id":1, "subject":"...", "status":"completed", ...}
  task_2.json  {"id":2, "blockedBy":[1], "status":"pending", ...}
  task_3.json  {"id":3, "blockedBy":[2], "blocks":[], ...}

Dependency resolution:
+----------+     +----------+     +----------+
| task 1   | --> | task 2   | --> | task 3   |
| complete |     | blocked  |     | blocked  |
+----------+     +----------+     +----------+
     |                ^
     +--- 完成 task 1 会自动从 task 2 的 blockedBy 中移除
```

---

## 代码拆解

### 1. TaskManager 类（第 46-123 行）

#### 初始化与底层 IO

```python
class TaskManager:
    def __init__(self, tasks_dir: Path):
        self.dir = tasks_dir
        self.dir.mkdir(exist_ok=True)
        self._next_id = self._max_id() + 1
```

- 启动时自动创建 `.tasks/` 目录
- `_max_id()` 扫描已有文件找最大 ID，`_next_id` 从最大值 +1 开始，保证 ID 不冲突
- 每个任务存为 `task_{id}.json`，一个任务一个文件

**为什么一个任务一个文件，而不是一个大 JSON？**
- 避免并发写冲突（虽然这里是单线程，但为生产环境做准备）
- 更新单个任务时不需要读写整个列表
- 文件名即索引，查找 O(1)

#### `create` — 创建任务

```python
def create(self, subject: str, description: str = "") -> str:
    task = {
        "id": self._next_id, "subject": subject, "description": description,
        "status": "pending", "blockedBy": [], "blocks": [], "owner": "",
    }
    self._save(task)
    self._next_id += 1
    return json.dumps(task, indent=2)
```

新任务的数据结构包含：

| 字段 | 说明 |
| --- | --- |
| `id` | 自增 ID |
| `subject` | 任务标题 |
| `description` | 详细描述 |
| `status` | `pending` / `in_progress` / `completed` |
| `blockedBy` | 依赖列表（哪些任务必须先完成） |
| `blocks` | 被阻塞列表（完成本任务能解锁哪些） |
| `owner` | 预留字段（多 Agent 场景） |

#### `update` — 更新任务状态与依赖

```python
def update(self, task_id: int, status: str = None,
           add_blocked_by: list = None, add_blocks: list = None) -> str:
    task = self._load(task_id)
    if status:
        task["status"] = status
        if status == "completed":
            self._clear_dependency(task_id)
    if add_blocked_by:
        task["blockedBy"] = list(set(task["blockedBy"] + add_blocked_by))
    if add_blocks:
        task["blocks"] = list(set(task["blocks"] + add_blocks))
        for blocked_id in add_blocks:
            blocked = self._load(blocked_id)
            if task_id not in blocked["blockedBy"]:
                blocked["blockedBy"].append(task_id)
                self._save(blocked)
    self._save(task)
```

三个核心行为：

1. **状态更新** — 改 `status`，如果标为 `completed` 则触发依赖清理
2. **添加依赖** — `add_blocked_by` 声明"本任务被谁阻塞"，用 `set` 去重
3. **添加阻塞** — `add_blocks` 声明"本任务阻塞了谁"，并**双向更新**：同时把自己加入被阻塞任务的 `blockedBy` 列表

双向更新保证了依赖图的一致性——不需要 LLM 手动维护两端。

#### `_clear_dependency` — 完成任务时自动解锁

```python
def _clear_dependency(self, completed_id: int):
    for f in self.dir.glob("task_*.json"):
        task = json.loads(f.read_text())
        if completed_id in task.get("blockedBy", []):
            task["blockedBy"].remove(completed_id)
            self._save(task)
```

遍历所有任务，把已完成的 ID 从别人的 `blockedBy` 中移除。这是**级联更新**——完成一个任务可能同时解锁多个下游任务。

示例：

```
完成前: task_2.blockedBy = [1, 5]
完成 task_1 后: task_2.blockedBy = [5]  (自动移除了 1)
完成 task_5 后: task_2.blockedBy = []   (完全解锁，可以开始)
```

#### `list_all` — 列出所有任务

```python
def list_all(self) -> str:
    for t in tasks:
        marker = {"pending": "[ ]", "in_progress": "[>]", "completed": "[x]"}.get(t["status"], "[?]")
        blocked = f" (blocked by: {t['blockedBy']})" if t.get("blockedBy") else ""
        lines.append(f"{marker} #{t['id']}: {t['subject']}{blocked}")
```

输出示例：

```
[x] #1: 初始化项目结构
[>] #2: 实现用户认证
[ ] #3: 实现权限控制 (blocked by: [2])
[ ] #4: 编写测试用例 (blocked by: [2, 3])
```

LLM 看到这个列表就能判断：task 2 正在进行，task 3 被 task 2 阻塞，task 4 同时被 2 和 3 阻塞。

### 2. 任务工具注册（第 178-206 行）

四个任务工具：

| 工具 | 功能 | 对应 CRUD |
| --- | --- | --- |
| `task_create` | 创建新任务 | Create |
| `task_get` | 查看单个任务详情 | Read |
| `task_update` | 更新状态/依赖 | Update |
| `task_list` | 列出所有任务 | Read (list) |

没有 Delete——任务只能标为 `completed`，不能删除。这是有意为之：保留完整的历史记录。

### 3. Agent Loop（第 209-228 行）

循环结构与 s02 完全一致，没有变化。持久化任务系统完全通过工具层实现，不需要修改循环逻辑。

---

## s03 TodoManager vs s07 TaskManager

| 维度 | s03 TodoManager | s07 TaskManager |
| --- | --- | --- |
| 存储位置 | 内存（`self.items` 列表） | 磁盘（`.tasks/*.json` 文件） |
| 生命周期 | 随进程结束或上下文压缩而丢失 | 永久持久化，跨会话存活 |
| 更新方式 | 整体替换 | 增量 CRUD |
| 依赖关系 | 无 | `blockedBy` / `blocks` 双向依赖图 |
| 完成联动 | 无 | 自动清理下游任务的 `blockedBy` |
| ID 管理 | LLM 传入 | 自增 ID，系统管理 |
| 约束 | 最多 20 项，单个 in_progress | 无数量限制，无 in_progress 约束 |

---

## 数据流

```
用户输入 "实现一个带权限控制的用户系统"
    ↓
LLM 规划任务:
  task_create { subject: "初始化项目结构" }           → task_1.json
  task_create { subject: "实现用户认证" }             → task_2.json
  task_create { subject: "实现权限控制" }             → task_3.json
  task_update { task_id: 2, addBlocks: [3] }        → task_2 阻塞 task_3
    (同时自动更新 task_3.blockedBy = [2])
    ↓
LLM 查看任务列表:
  task_list → 
    [ ] #1: 初始化项目结构
    [ ] #2: 实现用户认证
    [ ] #3: 实现权限控制 (blocked by: [2])
    ↓
LLM 开始执行 task_1:
  task_update { task_id: 1, status: "in_progress" }
  bash("mkdir src && npm init -y")
  task_update { task_id: 1, status: "completed" }
    ↓
LLM 继续执行 task_2:
  task_update { task_id: 2, status: "in_progress" }
  write_file("src/auth.py", ...)
  task_update { task_id: 2, status: "completed" }
    → _clear_dependency(2) 自动将 task_3.blockedBy 从 [2] 变为 []
    ↓
LLM 看到 task_3 不再被阻塞，继续执行...

--- 假设此时触发了 auto_compact ---

messages 被压缩为摘要，但 .tasks/ 文件还在
LLM 调用 task_list 重新获取任务状态，继续工作
```

---

## 用 Node.js 重写时的对应关系

| Python（源码） | Node.js（练习） |
| --- | --- |
| `json.loads(path.read_text())` | `JSON.parse(fs.readFileSync(path, 'utf-8'))` |
| `path.write_text(json.dumps(...))` | `fs.writeFileSync(path, JSON.stringify(..., null, 2))` |
| `self.dir.glob("task_*.json")` | `fs.readdirSync(dir).filter(f => f.match(/^task_\d+\.json$/))` |
| `list(set(a + b))` | `[...new Set([...a, ...b])]` |
| `int(f.stem.split("_")[1])` | `parseInt(path.parse(f).name.split('_')[1])` |
| `max(ids) if ids else 0` | `ids.length ? Math.max(...ids) : 0` |
| `task.get("blockedBy", [])` | `task.blockedBy ?? []` |

---

## 思考与总结

1. **"对话外的状态"是解决上下文压缩信息丢失的根本方案** — s03 的 TodoManager 活在内存中，压缩就没了。s07 把状态写到磁盘，彻底解耦于对话生命周期。这个思路可以推广到任何需要跨会话持久化的状态
2. **依赖图让 Agent 的规划能力上了一个台阶** — 不再是简单的线性列表，而是 DAG（有向无环图）。LLM 可以声明"task 3 依赖 task 2"，系统自动维护阻塞/解锁关系
3. **双向更新保证一致性** — 给 task_2 添加 `blocks: [3]` 时，系统自动给 task_3 添加 `blockedBy: [2]`。不依赖 LLM 手动维护两端，减少出错概率
4. **级联解锁是自动化的关键** — `_clear_dependency` 让"完成一个任务自动解锁下游"变成系统行为而非 LLM 行为。LLM 只需标记 completed，系统负责级联
5. **一个文件一个任务的设计** — 看似笨重，但避免了读写整个列表的 IO、降低了并发冲突风险、文件名即索引。这是"简单但正确"的工程选择
6. **没有 Delete 是有意为之** — 只 complete 不删除，保留完整的任务历史。在调试和回溯时非常有价值
