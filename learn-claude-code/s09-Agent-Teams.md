# S09 - Agent Teams（Agent 团队协作）

> 源码：`agents/s09_agent_teams.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**让多个持久化 Agent 作为"队友"长期存活，通过收件箱相互通信、协作完成任务。**

与之前的 Subagent（s04）不同：

| 对比维度 | Subagent (s04) | Teammate (s09) |
|----------|----------------|----------------|
| 生命周期 | 派生 → 执行 → 返回摘要 → 销毁 | 派生 → 工作 → 空闲 → 工作 → … → 关闭 |
| 状态持久 | 否，一次性 | 是，长期驻留 |
| 通信方式 | 无，由 Lead 收集结果 | 通过 JSONL 收件箱互发消息 |
| 运行方式 | 同步/异步调用 | 独立线程，持续循环 |

**关键洞察：** "Teammates that can talk to each other."

---

## 架构图

```
.team/config.json                  .team/inbox/
+----------------------------+     +------------------+
| {"team_name": "default",   |     | alice.jsonl      |
|  "members": [              |     | bob.jsonl        |
|    {"name":"alice",        |     | lead.jsonl       |
|     "role":"coder",        |     +------------------+
|     "status":"idle"}       |
|  ]}                        |     send_message("alice", "fix bug"):
+----------------------------+       open("alice.jsonl", "a").write(msg)

                                    read_inbox("alice"):
spawn_teammate("alice","coder",...)   msgs = [json.loads(l) for l in ...]
      |                               open("alice.jsonl", "w").close()
      v                               return msgs  # drain（读完清空）
Thread: alice             Thread: bob
+------------------+      +------------------+
| agent_loop       |      | agent_loop       |
| status: working  |      | status: idle     |
| ... runs tools   |      | ... waits ...    |
| status -> idle   |      |                  |
+------------------+      +------------------+
```

---

## 消息类型（5 种）

| 消息类型 | 说明 |
|----------|------|
| `message` | 普通文本消息 |
| `broadcast` | 广播给所有队友 |
| `shutdown_request` | 请求优雅关闭（s10 实现） |
| `shutdown_response` | 批准/拒绝关闭（s10 实现） |
| `plan_approval_response` | 批准/拒绝计划（s10 实现） |

---

## 核心组件

### 1. MessageBus（消息总线）

基于文件系统的消息总线，每个队友有独立的 `.jsonl` 收件箱。

```python
class MessageBus:
    def send(self, sender, to, content, msg_type="message", extra=None):
        # 追加写入 {to}.jsonl
        msg = {"type": msg_type, "from": sender, "content": content, "timestamp": time.time()}
        with open(inbox_path, "a") as f:
            f.write(json.dumps(msg) + "\n")

    def read_inbox(self, name):
        # 读取并清空收件箱（drain 模式）
        messages = [json.loads(line) for line in inbox_path.read_text().splitlines()]
        inbox_path.write_text("")   # 清空
        return messages

    def broadcast(self, sender, content, teammates):
        # 向所有队友（排除自身）发送 broadcast 类型消息
        for name in teammates:
            if name != sender:
                self.send(sender, name, content, "broadcast")
```

**关键设计：追加写（append）+ 读后清空（drain）**，避免重复消费。

### 2. TeammateManager（队友管理器）

负责队友的生命周期管理，状态持久化到 `config.json`。

```python
class TeammateManager:
    def spawn(self, name, role, prompt):
        # 已有成员且状态为 idle/shutdown 时可重新激活
        # 新建线程运行 _teammate_loop
        thread = threading.Thread(target=self._teammate_loop, args=(name, role, prompt), daemon=True)
        thread.start()

    def _teammate_loop(self, name, role, prompt):
        # 每轮循环先检查收件箱，把消息追加进对话历史
        for _ in range(50):
            inbox = BUS.read_inbox(name)
            for msg in inbox:
                messages.append({"role": "user", "content": json.dumps(msg)})
            # 调用 LLM，执行工具
            response = client.messages.create(...)
            # stop_reason != "tool_use" 时退出循环
        member["status"] = "idle"  # 任务完成后变为 idle
```

### 3. Lead 的 9 个工具

| 工具名 | 说明 |
|--------|------|
| `bash` | 执行 shell 命令 |
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `edit_file` | 替换文件中的文本 |
| `spawn_teammate` | 派生持久化队友 |
| `list_teammates` | 列出所有队友及状态 |
| `send_message` | 向指定队友发消息 |
| `read_inbox` | 读取并清空 lead 自己的收件箱 |
| `broadcast` | 向所有队友广播消息 |

### 4. 队友的 6 个工具

队友拥有与 Lead 相同的基础工具（bash/read/write/edit），并额外拥有：

| 工具名 | 说明 |
|--------|------|
| `send_message` | 向任意队友（含 lead）发消息 |
| `read_inbox` | 读取自己的收件箱 |

> 注意：队友不能 `spawn_teammate`，也不能 `broadcast`，只能点对点通信。

---

## Lead 的 Agent 循环设计

```python
def agent_loop(messages):
    while True:
        # 每轮先 drain lead 的收件箱
        inbox = BUS.read_inbox("lead")
        if inbox:
            messages.append({"role": "user", "content": f"<inbox>{json.dumps(inbox)}</inbox>"})
            messages.append({"role": "assistant", "content": "Noted inbox messages."})

        response = client.messages.create(...)
        if response.stop_reason != "tool_use":
            return  # 无工具调用时退出
        # 执行工具，追加结果
```

Lead 在每次 LLM 调用前都会先检查自己的收件箱，将队友发来的消息注入对话历史。

---

## 团队状态管理

队友状态流转：

```
spawn → working → idle → (可再次 working) → shutdown
```

状态持久化到 `.team/config.json`，重新 spawn 同名队友时可复用已有配置。

---

## 交互命令

| 命令 | 说明 |
|------|------|
| `/team` | 打印所有队友及其状态 |
| `/inbox` | 查看 lead 当前收件箱 |
| `q` / `exit` | 退出 |

---

## 与前序模块的关系

```
s04 Subagent        → 一次性子任务，无通信
s08 Background Tasks → 后台并发，无通信
s09 Agent Teams      → 持久化队友 + 收件箱通信  ← 本节
s10 (下一节)         → 增加优雅关闭 / 计划审批等协调机制
```

---

## 关键设计原则

1. **JSONL 收件箱是唯一通信媒介**：不共享内存，不直接调用，解耦彻底。
2. **Drain 模式**：读完即清空，每条消息只被消费一次。
3. **daemon 线程**：主进程退出时队友线程自动终止，无需手动清理。
4. **最多 50 轮循环**：每个队友有上限，防止无限运行。
5. **状态机持久化**：`config.json` 记录所有成员状态，重启后可恢复。
