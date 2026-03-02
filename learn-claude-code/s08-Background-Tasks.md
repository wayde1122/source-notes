# S08 - Background Tasks（后台任务）

> 源码：`agents/s08_background_tasks.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**让 Agent 派出后台任务后立即继续干别的，不阻塞等待。**

之前

**关键洞察：** "Fire and forget — the agent doesn't block while the command runs."

---

## 架构图

```
Main thread                Background thread
+-----------------+        +-----------------+
| agent loop      |        | task executes   |
| ...             |        | ...             |
| [LLM call] <---+------- | enqueue(result) |
|  ^drain queue   |        +-----------------+
+-----------------+

Timeline:
Agent ----[spawn A]----[spawn B]----[other work]----
             |              |
             v              v
          [A runs]      [B runs]        (parallel)
             |              |
             +-- notification queue --> [results injected]
```

---

## 代码拆解

### 1. BackgroundManager 类（第 49-107 行）

#### 数据结构

```python
class BackgroundManager:
    def __init__(self):
        self.tasks = {}              # task_id -> {status, result, command}
        self._notification_queue = []  # 已完成任务的通知
        self._lock = threading.Lock()  # 线程安全锁
```

三个成员各司其职：

| 成员                       | 作用                                      |
| -------------------------- | ----------------------------------------- |
| `self.tasks`               | 所有任务的完整状态（供 `check` 查询）     |
| `self._notification_queue` | 已完成但尚未通知 LLM 的结果（临时缓冲区） |
| `self._lock`               | 保护 `_notification_queue` 的线程安全锁   |

#### `run` — 启动后台任务

```python
def run(self, command: str) -> str:
    task_id = str(uuid.uuid4())[:8]
    self.tasks[task_id] = {"status": "running", "result": None, "command": command}
    thread = threading.Thread(
        target=self._execute, args=(task_id, command), daemon=True
    )
    thread.start()
    return f"Background task {task_id} started: {command[:80]}"
```

- `uuid.uuid4()[:8]` 生成 8 位短 ID（如 `a3f2b7c1`），足够避免冲突且对 LLM 友好
- `daemon=True` 标记为守护线程——主线程退出时自动清理，不会挂起进程
- 立即返回 task_id，**不等待命令完成**

#### `_execute` — 线程执行体

```python
def _execute(self, task_id: str, command: str):
    try:
        r = subprocess.run(command, shell=True, cwd=WORKDIR,
                           capture_output=True, text=True, timeout=300)
        output = (r.stdout + r.stderr).strip()[:50000]
        status = "completed"
    except subprocess.TimeoutExpired:
        output = "Error: Timeout (300s)"
        status = "timeout"
    except Exception as e:
        output = f"Error: {e}"
        status = "error"
    self.tasks[task_id]["status"] = status
    self.tasks[task_id]["result"] = output or "(no output)"
    with self._lock:
        self._notification_queue.append({
            "task_id": task_id, "status": status,
            "command": command[:80],
            "result": (output or "(no output)")[:500],
        })
```

执行完成后做两件事：

1. **更新 `self.tasks`** — 存完整结果（最多 50000 字符），供 `check` 主动查询
2. **推入通知队列** — 存截断的摘要结果（最多 500 字符），供 `drain_notifications` 被动推送

通知队列中的结果做了截断（500 字符），因为它会被自动注入到 messages 中。完整结果仍可通过 `check_background` 按需获取——又是**两层加载**的思路。

超时设为 300 秒（vs 同步 bash 的 120 秒），因为后台任务通常是耗时更长的操作。

#### `check` — 查询任务状态

```python
def check(self, task_id: str = None) -> str:
    if task_id:
        t = self.tasks.get(task_id)
        return f"[{t['status']}] {t['command'][:60]}\n{t.get('result') or '(running)'}"
    lines = []
    for tid, t in self.tasks.items():
        lines.append(f"{tid}: [{t['status']}] {t['command'][:60]}")
    return "\n".join(lines) if lines else "No background tasks."
```

不传 `task_id` 则列出所有任务概览，传了则返回单个任务的详细结果。

#### `drain_notifications` — 排空通知队列

```python
def drain_notifications(self) -> list:
    with self._lock:
        notifs = list(self._notification_queue)
        self._notification_queue.clear()
    return notifs
```

`with self._lock` 保证在读取和清空队列的过程中，后台线程不会同时写入。返回后队列为空，避免重复通知。

### 2. Agent Loop 中的通知注入（第 187-214 行）

```python
def agent_loop(messages: list):
    while True:
        notifs = BG.drain_notifications()
        if notifs and messages:
            notif_text = "\n".join(
                f"[bg:{n['task_id']}] {n['status']}: {n['result']}" for n in notifs
            )
            messages.append({"role": "user", "content":
                f"<background-results>\n{notif_text}\n</background-results>"})
            messages.append({"role": "assistant", "content": "Noted background results."})
        response = client.messages.create(...)
```

每轮 LLM 调用前：

1. **排空通知队列** — 获取所有已完成的后台任务结果
2. **注入消息** — 以 `<background-results>` XML 标签包裹，作为 user 消息追加
3. **模拟 assistant 确认** — 补一条 "Noted background results." 保持 user/assistant 交替格式

这样 LLM 在下一轮调用时就能看到后台任务的完成情况，决定是否需要根据结果采取行动。

### 3. bash vs background_run 的定位

```python
{"name": "bash", "description": "Run a shell command (blocking)."},
{"name": "background_run", "description": "Run command in background thread. Returns task_id immediately."},
```

注意 bash 的描述特意标注了 `(blocking)`，帮助 LLM 区分两者的使用场景：

| 场景                                                | 用什么                           |
| --------------------------------------------------- | -------------------------------- |
| 快速命令（`ls`、`cat`、`git status`）               | `bash`（同步，立即拿结果）       |
| 耗时操作（`npm install`、`pytest`、`docker build`） | `background_run`（异步，不阻塞） |

---

## 线程安全设计

```
Main thread (agent_loop)          Background thread (_execute)
         |                                    |
         |--- BG.run(cmd) ------→ thread.start()
         |                                    |
         |--- 继续其他工具调用                  |--- subprocess.run(...)
         |                                    |
         |                                    |--- with _lock:
         |                                    |      queue.append(result)
         |                                    |
         |--- drain_notifications() ←---------|
         |    with _lock:                     |
         |      copy + clear queue            |
```

`_lock` 只保护 `_notification_queue`，因为它是唯一被两个线程同时读写的数据结构。`self.tasks` 虽然也被两个线程访问，但 Python 的 GIL（全局解释器锁）保证了字典的单次赋值操作是原子的，在这个简单场景下是安全的。

---

## 数据流

```
用户输入 "跑一下测试，同时帮我格式化代码"
    ↓
LLM 返回两个工具调用:
  1. background_run { command: "pytest tests/ -v" }
     → "Background task a3f2b7c1 started: pytest tests/ -v"
  2. bash { command: "black src/" }
     → "reformatted 5 files"  (同步完成)
    ↓
Agent 继续下一轮... drain_notifications() → []  (pytest 还在跑)
    ↓
LLM 做其他事: write_file(...)、edit_file(...)
    ↓
下一轮: drain_notifications() → [{
  task_id: "a3f2b7c1",
  status: "completed",
  result: "5 passed, 1 failed..."
}]
    ↓
注入消息:
  user: "<background-results>\n[bg:a3f2b7c1] completed: 5 passed, 1 failed...\n</background-results>"
  assistant: "Noted background results."
    ↓
LLM 看到测试结果，决定修复失败的测试...
```

---

## s07 → s08 的演进对比

| 维度     | s07                         | s08                               |
| -------- | --------------------------- | --------------------------------- |
| 核心问题 | 任务状态不持久              | 长命令阻塞 Agent                  |
| 解决方案 | 持久化 JSON + 依赖图        | 线程 + 通知队列                   |
| 新增工具 | task_create/update/list/get | background_run / check_background |
| 执行模型 | 同步（阻塞）                | 异步（非阻塞）                    |
| 并发     | 无                          | 多线程并行                        |
| 消息注入 | 无                          | `<background-results>` 通知注入   |

---

## 用 Node.js 重写时的对应关系

| Python（源码）              | Node.js（练习）                                   |
| --------------------------- | ------------------------------------------------- |
| `threading.Thread`          | `child_process.spawn`（天然异步，不需要手动线程） |
| `threading.Lock`            | 不需要（Node.js 单线程，事件循环天然安全）        |
| `uuid.uuid4()[:8]`          | `crypto.randomUUID().slice(0, 8)`                 |
| `daemon=True`               | `child.unref()`（不阻止进程退出）                 |
| `_notification_queue`       | 普通数组即可（无并发问题）                        |
| `subprocess.run` (同步)     | `child_process.execSync`                          |
| 后台线程 + `subprocess.run` | `child_process.exec` + callback / `Promise`       |

Node.js 的事件循环模型天然支持异步 I/O，实现后台任务反而**更简单**——不需要线程和锁，直接用 `exec` 的回调或 Promise 就行。

---

## 思考与总结

1. **同步阻塞是 Agent 效率的最大瓶颈** — `npm install` 30 秒、`docker build` 几分钟，同步执行意味着 Agent 只能干等。后台执行让 Agent 在等待期间做其他事
2. **通知队列是生产者-消费者模式的经典应用** — 后台线程是生产者（push 结果），agent_loop 是消费者（drain 结果），队列是缓冲区。这是并发编程最基本的协作模式
3. **结果分两层：通知摘要 + 完整查询** — 通知自动注入但截断到 500 字符，完整结果通过 `check_background` 按需获取。又是 s05 两层加载思路的复用
4. **`daemon=True` 防止进程挂起** — 如果用户 Ctrl+C 退出，守护线程会自动终止。非守护线程会阻止进程退出，导致"杀不掉"
5. **消息注入的又一种形态** — s03 注入 `<reminder>`，s06 注入压缩摘要，s08 注入 `<background-results>`。消息注入是贯穿整个系列的核心技术
6. **Python vs Node.js 的并发哲学差异** — Python 用线程模拟异步，需要锁。Node.js 用事件循环天然异步，不需要锁。理解这个差异对前端转后端非常重要
