# S11 - Autonomous Agents（自主 Agent）

> 源码：`agents/s11_autonomous_agents.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**Agent 自己找活干，不需要 Lead 手动分配任务。**

s10 的队友是被动的——Lead 派任务，队友执行。s11 引入了空闲轮询机制：队友完成当前任务后进入 IDLE 状态，主动扫描任务看板，发现未认领的任务就自动 claim 并继续工作。

**关键洞察：** "The agent finds work itself."

---

## 队友生命周期状态机

```
+-------+
| spawn |
+---+---+
    |
    v
+-------+  tool_use    +-------+
| WORK  | <----------- |  LLM  |
+---+---+              +-------+
    |
    | stop_reason != tool_use  OR  idle 工具被调用
    v
+--------+
| IDLE   | 每 5s 轮询，最多 60s
+---+----+
    |
    +---> 检查收件箱 -> 有消息? -> 恢复 WORK
    |
    +---> 扫描 .tasks/ -> 有未认领任务? -> claim -> 恢复 WORK
    |
    +---> 超时 (60s) -> shutdown（自然退出）
```

---

## 新增核心机制

### 1. 任务看板（Task Board）

任务以 JSON 文件存储在 `.tasks/` 目录，每个任务一个文件：

```
.tasks/
  task_1.json
  task_2.json
  task_3.json
```

任务文件结构：

```json
{
  "id": 1,
  "subject": "写单元测试",
  "description": "为 utils.py 补充测试",
  "status": "pending",
  "owner": null,
  "blockedBy": null
}
```

任务状态流转：`pending` → `in_progress` → `completed`

### 2. 自动扫描与认领

```python
def scan_unclaimed_tasks() -> list:
    # 条件：status=pending + 无 owner + 无 blockedBy
    for f in sorted(TASKS_DIR.glob("task_*.json")):
        task = json.loads(f.read_text())
        if task.get("status") == "pending" and not task.get("owner") and not task.get("blockedBy"):
            unclaimed.append(task)

def claim_task(task_id, owner):
    with _claim_lock:          # 加锁防止多队友同时 claim 同一任务
        task["owner"] = owner
        task["status"] = "in_progress"
        path.write_text(json.dumps(task))
```

`_claim_lock` 是专门为任务认领加的锁，避免多线程竞争条件。

### 3. `idle` 工具——显式信号 "我没活了"

```python
{"name": "idle", "description": "Signal that you have no more work. Enters idle polling phase."}
```

LLM 主动调用此工具表示"当前任务做完了，进入等待"。这解决了 s09/s10 中靠 `stop_reason != tool_use` 猜测完成状态的问题——这里是**显式宣告**。

触发后：
1. 工作循环 break
2. 状态设为 `idle`
3. 进入轮询阶段

### 4. 身份重注入（Identity Re-injection）

上下文压缩后 LLM 可能"忘记自己是谁"。当对话历史很短（`len(messages) <= 3`）时，在认领新任务前插入身份块：

```python
def make_identity_block(name, role, team_name):
    return {
        "role": "user",
        "content": f"<identity>You are '{name}', role: {role}, team: {team_name}. Continue your work.</identity>",
    }

# 认领任务时检查
if len(messages) <= 3:
    messages.insert(0, make_identity_block(name, role, team_name))
    messages.insert(1, {"role": "assistant", "content": f"I am {name}. Continuing."})
```

通过在消息历史开头注入身份，确保 LLM 在压缩后依然知道自己的角色。

---

## IDLE 轮询逻辑详解

```python
POLL_INTERVAL = 5   # 每 5 秒检查一次
IDLE_TIMEOUT  = 60  # 最多等待 60 秒

polls = IDLE_TIMEOUT // POLL_INTERVAL   # = 12 次
for _ in range(polls):
    time.sleep(POLL_INTERVAL)

    # 优先级 1：收件箱有消息 -> 立即恢复工作
    inbox = BUS.read_inbox(name)
    if inbox:
        # shutdown_request -> 直接退出
        # 其他消息 -> 加入对话历史，resume=True，break
        ...

    # 优先级 2：扫描未认领任务
    unclaimed = scan_unclaimed_tasks()
    if unclaimed:
        claim_task(unclaimed[0]["id"], name)
        # 注入任务描述到对话历史
        resume = True
        break

# 12 次都没找到工作 -> shutdown
if not resume:
    self._set_status(name, "shutdown")
    return
```

收件箱消息优先于任务看板，确保协调指令能及时响应。

---

## shutdown 处理变化（对比 s10）

s11 简化了关闭流程：收到 `shutdown_request` 直接退出，不再需要 `shutdown_response` 工具响应：

```python
# WORK 阶段收到 shutdown_request
if msg.get("type") == "shutdown_request":
    self._set_status(name, "shutdown")
    return   # 直接退出，不回复

# IDLE 阶段收到 shutdown_request（同样处理）
if msg.get("type") == "shutdown_request":
    self._set_status(name, "shutdown")
    return
```

---

## 工具对比（s10 → s11）

### 队友工具：+2 个（共 10 个）

| 新增工具 | 说明 |
|----------|------|
| `idle` | 宣告无工作，进入空闲轮询 |
| `claim_task` | 按 ID 认领任务看板上的任务 |

### Lead 工具：+2 个（共 14 个）

| 新增工具 | 说明 |
|----------|------|
| `idle` | Lead 侧注册但返回 "Lead does not idle."（占位） |
| `claim_task` | Lead 也可手动认领任务 |

---

## 新增交互命令

| 命令 | 说明 |
|------|------|
| `/tasks` | 列出所有任务及状态（`[ ]` pending / `[>]` in_progress / `[x]` completed） |
| `/team` | 列出所有队友及状态 |
| `/inbox` | 查看 lead 收件箱 |

---

## s10 → s11 变化对比

| 维度 | s10 | s11 |
|------|-----|-----|
| 任务分配 | Lead 手动通过消息指派 | 队友自动扫描 `.tasks/` 认领 |
| 空闲行为 | 任务完成后变 idle，不再干活 | 进入轮询，主动找新任务 |
| 完成信号 | 靠 `stop_reason != tool_use` 推断 | 显式调用 `idle` 工具宣告 |
| 上下文压缩 | 无处理 | 历史过短时重注入身份块 |
| 关闭流程 | 协商式（需 shutdown_response） | 简化直接退出 |
| 超时退出 | 无（需 Lead 手动关闭） | 空闲 60s 无任务自动 shutdown |

---

## 设计要点

1. **拉取模型（Pull Model）**：队友主动拉取任务，而非等待 Lead 推送。去中心化，Lead 压力更小。
2. **`_claim_lock` 防竞争**：多队友并发时，任务只能被一个人 claim，锁是必须的。
3. **`idle` 作为显式状态边界**：把"工作→等待"的转换从隐式推断变为显式工具调用，逻辑更清晰。
4. **身份重注入解决失忆问题**：长对话压缩后 LLM 会丢失角色上下文，通过在历史开头插入 `<identity>` 块来补救。
5. **超时自动 shutdown**：无需 Lead 干预，空闲超时的队友自动退出，资源自清理。

---

## 与前后模块的关系

```
s09 Agent Teams      → 持久化队友 + 收件箱通信
s10 Team Protocols   → + 关闭协议 + 计划审批
s11 Autonomous Agents → + 任务看板 + 空闲轮询 + 自动认领  ← 本节
```
