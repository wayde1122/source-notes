# S10 - Team Protocols（团队协议）

> 源码：`agents/s10_team_protocols.py`
> 项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)

---

## 核心思想

**用 `request_id` 关联请求与响应，为 Agent 团队引入两种显式协议：优雅关闭 + 计划审批。**

s09 的队友只能收发消息，没有任何协调机制。s10 在此基础上增加了两个有状态的协议，二者共用同一套 `request_id` 关联模式。

**关键洞察：** "Same request_id correlation pattern, two domains."

---

## 架构图

### 协议一：优雅关闭（Shutdown Protocol）

```
状态机：pending -> approved | rejected

Lead                              Teammate
+---------------------+          +---------------------+
| shutdown_request    |          |                     |
| { request_id: abc } | -------> | 收到请求             |
+---------------------+          | 决定：是否同意？      |
                                 +---------------------+
                                          |
+---------------------+          +--------v------------+
| 收到 response        | <------- | shutdown_response   |
| { request_id: abc,  |          | { request_id: abc,  |
|   approve: true }   |          |   approve: true }   |
+---------------------+          +---------------------+
         |
         v
  状态 -> "shutdown"，线程退出
```

### 协议二：计划审批（Plan Approval Protocol）

```
状态机：pending -> approved | rejected

Teammate                          Lead
+---------------------+          +---------------------+
| plan_approval       |          |                     |
| { plan: "..." }     | -------> | 查看计划文本         |
+---------------------+          | 批准/拒绝？          |
                                 +---------------------+
                                          |
+---------------------+          +--------v------------+
| 收到审批结果         | <------- | plan_approval       |
| { approve: true }   |          | { req_id,           |
+---------------------+          |   approve: true }   |
                                 +---------------------+
```

### 追踪器

```python
shutdown_requests = { request_id: {"target": name, "status": "pending|approved|rejected"} }
plan_requests     = { request_id: {"from": name, "plan": "...", "status": "pending|approved|rejected"} }
_tracker_lock = threading.Lock()  # 线程安全
```

---

## 两个协议的完整流程

### 优雅关闭流程

```
1. Lead 调用 shutdown_request 工具
   └─ 生成 request_id，写入 shutdown_requests（status=pending）
   └─ 向目标队友发送 shutdown_request 消息

2. 队友收到消息，调用 shutdown_response 工具
   └─ 更新 shutdown_requests[req_id]["status"]
   └─ 向 lead 发送 shutdown_response 消息
   └─ 若 approve=True，设 should_exit=True

3. 队友循环在下一轮检测到 should_exit=True，break 退出
   └─ 状态设为 "shutdown"（而非 "idle"）

4. Lead 调用 shutdown_response 工具（实为查询状态）
   └─ 返回 shutdown_requests[req_id] 的当前状态
```

### 计划审批流程

```
1. 队友调用 plan_approval 工具
   └─ 生成 request_id，写入 plan_requests（status=pending）
   └─ 向 lead 发送 plan_approval_response 消息（含计划文本）

2. Lead 收到消息，调用 plan_approval 工具
   └─ 传入 request_id + approve + feedback
   └─ 更新 plan_requests[req_id]["status"]
   └─ 向队友发送 plan_approval_response 消息（含审批结果）

3. 队友收到审批结果，决定继续执行或放弃
```

---

## s10 新增工具（相比 s09）

### Lead 新增 3 个工具（共 12 个）

| 工具名 | 说明 |
|--------|------|
| `shutdown_request` | 向指定队友发起关闭请求，返回 `request_id` |
| `shutdown_response` | 查询关闭请求的当前状态（按 `request_id`） |
| `plan_approval` | 审批队友提交的计划（approve/reject + feedback） |

### 队友新增 2 个工具（共 8 个）

| 工具名 | 说明 |
|--------|------|
| `shutdown_response` | 响应关闭请求（approve=True 则自身退出） |
| `plan_approval` | 提交计划等待 Lead 审批 |

> 注意：Lead 和队友的同名工具语义不同。`shutdown_response` 在 Lead 侧是"查询状态"，在队友侧是"回应请求"。

---

## 关键代码实现

### should_exit 标志位

```python
should_exit = False
for _ in range(50):
    ...
    for block in response.content:
        if block.type == "tool_use":
            output = self._exec(name, block.name, block.input)
            if block.name == "shutdown_response" and block.input.get("approve"):
                should_exit = True  # 本轮工具执行完再退出
    messages.append({"role": "user", "content": results})
    if should_exit:      # 下一轮循环开头检测，先让消息注入完整
        break
```

不立即退出，而是等当前轮工具结果处理完毕后再 break，确保对话历史完整。

### request_id 关联模式

```python
# 发起方（Lead/队友）：生成 ID 并追踪
req_id = str(uuid.uuid4())[:8]
with _tracker_lock:
    shutdown_requests[req_id] = {"target": teammate, "status": "pending"}

# 响应方（队友）：用 ID 更新状态
with _tracker_lock:
    if req_id in shutdown_requests:
        shutdown_requests[req_id]["status"] = "approved" if approve else "rejected"
```

用短 UUID（8位）作为关联键，简洁够用。锁保护并发写入。

---

## s09 → s10 的变化对比

| 维度 | s09 | s10 |
|------|-----|-----|
| 关闭方式 | 线程自然结束（任务完成或 50 轮上限） | Lead 主动发起，队友显式批准/拒绝 |
| 计划执行 | 队友自行决定，无需审批 | 大型工作前需提交计划，等 Lead 批准 |
| 状态追踪 | 无协议状态，只有成员状态 | `shutdown_requests` + `plan_requests` 追踪器 |
| 退出状态 | 正常结束 → `idle` | 关闭协议结束 → `shutdown`；普通结束 → `idle` |
| 工具数量 | Lead: 9，队友: 6 | Lead: 12，队友: 8 |

---

## 设计要点

1. **显式协议替代行为猜测**：不再靠"没调工具=完成"来判断，而是用显式的 `shutdown_response` / `plan_approval_response` 明确表达意图。
2. **request_id 解耦异步**：发送方不需要等待，通过 ID 在任意时刻查询状态，天然适配异步通信。
3. **队友有否决权**：`approve: false` 允许队友拒绝关闭（例如"我还有未完成的任务"），体现了真正的协商而非单向命令。
4. **人在回路（Human-in-the-loop）雏形**：Lead 审批计划，等同于在 Agent 执行高风险操作前插入人工确认点。
5. **同名工具、不同语义**：Lead 的 `shutdown_response` 是"查询"，队友的是"回应"，通过调用方上下文区分，是一种复用工具名的简化设计。

---

## 与前后模块的关系

```
s09 Agent Teams     → 持久化队友 + 基础收件箱通信
s10 Team Protocols  → + 优雅关闭协议 + 计划审批协议  ← 本节
（后续）             → 更完整的多 Agent 编排框架
```
