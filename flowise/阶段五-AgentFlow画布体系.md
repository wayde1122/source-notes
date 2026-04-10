# 第五阶段：单独攻克 AgentFlow 画布体系（packages/agentflow）

## 阶段目标

理解新画布体系的三个核心问题：
1. 节点画布的状态模型是什么？
2. 节点配置如何驱动表单与编辑器？
3. 画布、节点面板、节点编辑器三者如何协作？

---

## 一、包定位与公开 API

`packages/agentflow` 是一个**独立的前端 SDK 包**，可以作为 npm 包单独发布和使用。它对外暴露：

```typescript
// 主组件（直接使用）
export { Agentflow }            // 完整画布组件
export { AgentflowProvider }    // Provider（自定义集成时使用）

// 主 Hook
export { useAgentflow }         // 编程式控制画布

// 高级 Context Hooks
export { useAgentflowContext, useApiContext, useConfigContext }

// 工具函数
export { filterNodesByComponents, validateFlow, evaluateFieldVisibility }

// 类型
export type { FlowData, FlowNode, FlowEdge, AgentFlowInstance, ... }
```

---

## 二、目录结构速览

```
packages/agentflow/src/
├── Agentflow.tsx            ← 主画布组件（内部 + 外部组合）
├── AgentflowProvider.tsx    ← 根 Provider（所有 Context 的安装点）
├── useAgentflow.ts          ← 编程式实例 Hook
├── index.ts                 ← 公开 API 导出
│
├── core/                    ← 核心抽象层（纯逻辑，无 UI）
│   ├── types/               ← 类型定义（agentflow、flow、node、api、validation）
│   ├── node-catalog/        ← 节点目录与过滤（filterNodesByComponents）
│   ├── node-config/         ← 节点图标与颜色配置（DEFAULT_AGENTFLOW_NODES）
│   ├── primitives/          ← 基础原语（不依赖框架）
│   ├── theme/               ← Design token（颜色/字体/间距）
│   ├── utils/               ← 工具函数（fieldVisibility 等）
│   └── validation/          ← 流程图结构校验
│
├── infrastructure/          ← 基础设施层（状态管理 + API 适配）
│   ├── store/               ← Context + Reducer（画布状态）
│   │   ├── AgentflowContext.tsx     ← 主状态 Context（核心）
│   │   ├── agentflowReducer.ts      ← 纯函数 Reducer
│   │   ├── ApiContext.tsx           ← API 配置 Context
│   │   └── ConfigContext.tsx        ← 功能开关 Context
│   └── api/                 ← API 适配层（与 Flowise Server 通信）
│       ├── client.ts        ← axios 客户端
│       ├── nodes.ts         ← 节点 API
│       ├── chatflows.ts     ← ChatFlow API
│       ├── credentials.ts   ← 凭证 API
│       ├── tools.ts         ← 工具 API
│       └── loadMethodRegistry.ts ← 动态加载方法分发
│
├── features/                ← 功能特性层（UI 功能模块）
│   ├── canvas/              ← 画布核心（节点类型、边类型、Hook）
│   ├── node-editor/         ← 节点编辑对话框（EditNodeDialog）
│   ├── node-palette/        ← 节点面板（AddNodesDrawer）
│   └── generator/           ← AI 流程生成（GenerateFlowDialog）
│
└── atoms/                   ← 原子 UI 组件（表单控件）
    ├── NodeInputHandler.tsx  ← 节点参数渲染总入口
    ├── ArrayInput.tsx        ← 数组类型输入
    ├── ConditionBuilder.tsx  ← 条件构建器
    ├── CredentialTypeSelector.tsx ← 凭证选择器
    ├── Dropdown.tsx          ← 下拉选择
    ├── JsonInput.tsx         ← JSON 编辑器
    ├── VariableInput.tsx     ← 变量插值输入
    ├── VariablePicker.tsx    ← 变量选择器
    ├── RichTextEditor.tsx    ← 富文本编辑器
    ├── StructuredOutputBuilder.tsx ← 结构化输出构建器
    └── MessagesInput.tsx     ← 消息列表输入
```

---

## 三、画布状态模型（infrastructure/store）

### 3.1 AgentflowState（核心状态）

```typescript
const initialState: AgentflowState = {
    nodes: [],              // 画布上的所有节点（ReactFlow FlowNode[]）
    edges: [],              // 画布上的所有连线（ReactFlow FlowEdge[]）
    chatflow: null,         // 当前 ChatFlow 的数据库记录
    isDirty: false,         // 是否有未保存的变更
    reactFlowInstance: null,// ReactFlow 实例引用（用于 fitView 等操作）
    editingNodeId: null,    // 当前正在编辑的节点 ID
    editDialogProps: null   // 编辑对话框的配置
}
```

### 3.2 agentflowReducer（状态变更）

所有状态变更通过纯函数 Reducer 处理：

| Action | 效果 |
|--------|------|
| `SET_NODES` | 更新节点列表（自动 normalize，剥离内容自适应节点的宽高）|
| `SET_EDGES` | 更新连线列表 |
| `SET_CHATFLOW` | 设置当前 ChatFlow 元数据 |
| `SET_DIRTY` | 标记有未保存变更 |
| `SET_REACTFLOW_INSTANCE` | 保存 ReactFlow 实例引用 |
| `OPEN_EDIT_DIALOG` | 打开节点编辑器（设置 editingNodeId）|
| `CLOSE_EDIT_DIALOG` | 关闭节点编辑器 |
| `RESET` | 重置到初始状态 |

**特殊设计**：`normalizeNodes()` 对 `agentFlow` 和 `stickyNote` 类型的节点剥离 `width/height`，让它们保持内容自适应尺寸。

### 3.3 三个 Context 分工

| Context | 职责 |
|---------|------|
| `AgentflowStateProvider` | 画布状态（nodes/edges/dirty/editDialog）|
| `ApiProvider` | API 配置（apiBaseUrl / token / requestInterceptor）|
| `ConfigProvider` | 功能开关（isDarkMode / components 白名单 / readOnly）|

---

## 四、AgentflowProvider——根 Provider 安装层

```tsx
<AgentflowProvider apiBaseUrl="..." token="..." isDarkMode={false} components={[...]}>
    <ReactFlowProvider>           // ReactFlow 自己的 Context
        <ThemeProvider>           // MUI 主题（基于 isDarkMode）
            <ApiProvider>         // API 配置（baseUrl + token）
                <ConfigProvider>  // 功能开关
                    <AgentflowStateProvider> // 画布状态（Reducer）
                        {children}
                    </AgentflowStateProvider>
                </ConfigProvider>
            </ApiProvider>
        </ThemeProvider>
    </ReactFlowProvider>
</AgentflowProvider>
```

**CSS Variables 注入**：Provider 在 mount 时向 `<head>` 注入 `<style>` 标签，将 Design Token 转为 CSS 变量，供画布样式文件直接使用（避免主题变量只能通过 JS 传递的限制）。

---

## 五、useAgentflow——编程式实例

`useAgentflow()` 返回一个 `AgentFlowInstance` 对象，提供对画布的编程式控制：

```typescript
interface AgentFlowInstance {
    getFlow(): FlowData         // 获取当前流程数据（可序列化）
    toJSON(): string            // 转为 JSON 字符串
    validate(): ValidationResult// 校验流程结构
    fitView(): void             // 适配视图（显示所有节点）
    getReactFlowInstance()      // 获取底层 ReactFlow 实例
    addNode(nodeData): void     // 编程式添加节点
    clear(): void               // 清空画布
}
```

---

## 六、Agentflow 主组件的组成

```
<Agentflow>                          (对外暴露的主组件)
    └─ <AgentflowProvider>           (Provider 层)
        └─ <AgentflowCanvas>         (内部画布实现)
            ├─ <AgentflowHeader>     (顶部工具栏：保存/AI生成/标题)
            ├─ <ReactFlow>           (ReactFlow 画布)
            │   ├─ nodeTypes         (节点渲染类型注册)
            │   ├─ edgeTypes         (边渲染类型注册)
            │   ├─ <Background>      (网格背景)
            │   ├─ <Controls>        (缩放/全屏控件)
            │   └─ <MiniMap>         (缩略图导航)
            ├─ <AddNodesDrawer>      (右侧节点面板：拖拽添加)
            ├─ <EditNodeDialog>      (节点编辑对话框：配置参数)
            ├─ <GenerateFlowDialog>  (AI 流程生成对话框)
            └─ <ValidationFeedback>  (校验错误提示)
```

---

## 七、三大核心功能协作机制

### 7.1 画布（features/canvas）

- 注册自定义 `nodeTypes` 和 `edgeTypes` 到 ReactFlow
- Hook：
  - `useFlowNodes`：节点增删改的逻辑
  - `useFlowHandlers`：连线创建/删除的处理
  - `useDragAndDrop`：从节点面板拖拽节点到画布的逻辑

### 7.2 节点面板（features/node-palette）

```
用户点击"+"按钮 → <AddNodesDrawer> 打开
    │
    ├─ 调用 API /nodes 获取所有可用节点列表
    ├─ filterNodesByComponents() 过滤（根据 components 白名单配置）
    ├─ 按 category 分组展示节点卡片
    └─ 用户拖拽节点卡片 → useDragAndDrop 处理落点 → SET_NODES
```

### 7.3 节点编辑器（features/node-editor）

```
用户双击/点击节点 → OPEN_EDIT_DIALOG action
    │
    ▼
<EditNodeDialog> 渲染
    │
    ├─ 读取节点的 inputs 参数定义（INodeParams[]）
    ├─ <NodeInputHandler>（atoms）逐个渲染参数控件
    │   ├─ string → 文本输入
    │   ├─ number → 数字输入
    │   ├─ options → <Dropdown>
    │   ├─ boolean → <SwitchInput>
    │   ├─ json → <JsonInput>
    │   ├─ code → <CodeInput>
    │   ├─ asyncOptions → 调用 loadMethodRegistry 动态加载选项
    │   ├─ password → 密码输入（凭证选择走 <CredentialTypeSelector>）
    │   └─ 变量插值 → <VariableInput> + <VariablePicker>
    └─ 用户保存 → 更新节点 data → SET_NODES → isDirty=true
```

---

## 八、infrastructure/api：API 适配层

### 8.1 client.ts

```typescript
// 可配置的 axios 实例（支持 requestInterceptor 中间件）
const apiClient = axios.create({ baseURL: apiBaseUrl })
// 支持注入自定义 requestInterceptor（用于外部集成时定制鉴权）
```

### 8.2 loadMethodRegistry.ts（关键设计）

`asyncOptions` 类型的节点参数需要在运行时动态调用后端接口加载选项（如：加载 OpenAI 的模型列表）。

`loadMethodRegistry` 维护一张"loadMethod 名称 → API 调用函数"的映射表，当 `NodeInputHandler` 渲染 `asyncOptions` 参数时，查表找到对应的 API 调用函数并执行。

### 8.3 deduplicatedClient.ts

对相同 API 请求进行**去重**（在同一渲染周期内，相同参数的请求只发一次），避免节点面板加载时同时触发大量重复请求。

---

## 九、atoms：原子表单控件层

`atoms/` 是 agentflow 包内最细粒度的 UI 组件，每个组件对应一种参数类型的渲染：

| 组件 | 渲染的参数类型 | 特色 |
|------|-------------|------|
| `NodeInputHandler` | 总入口（分发） | 根据 `type` 选择子组件 |
| `VariableInput` | string（支持变量插值） | 内嵌 `{{variable}}` 语法高亮 |
| `VariablePicker` | 变量选择器 | 展示可引用的上游节点输出 |
| `ConditionBuilder` | 条件表达式构建 | 支持多条件 AND/OR 组合 |
| `ArrayInput` | 数组型参数 | 可增删行 |
| `JsonInput` | JSON 数据 | 内置 JSON 格式校验 |
| `CodeInput` | 代码（JS/Python）| 语法高亮 |
| `RichTextEditor` | 富文本 Prompt | 支持 Markdown + 变量插值 |
| `StructuredOutputBuilder` | 结构化输出 Schema | 可视化构建 JSON Schema |
| `CredentialTypeSelector` | 凭证选择 | 联动 `/credentials` API |
| `Dropdown` | options/multiOptions | 支持搜索过滤 |
| `MessagesInput` | 消息列表 | 多轮对话消息管理 |
| `ScenariosInput` | 场景列表 | 条件分支场景配置 |

---

## 十、core/validation：流程校验

`validateFlow(nodes, edges)` 在用户保存或主动触发校验时执行，检查：
- 是否有悬空节点（无连接的必需输入口）
- 是否有循环引用（DAG 约束）
- 必填参数是否填写

校验错误通过 `applyValidationErrorsToNodes()` 回写到对应节点，在画布上高亮显示错误节点。

---

## 十一、features/generator：AI 流程生成

`GenerateFlowDialog` 提供"用自然语言描述需求 → 自动生成 AgentFlow 流程图"的能力：

```
用户输入需求描述
    │
    ▼
POST /api/v1/agentflowv2-generator
    │（调用 components/src/agentflowv2Generator.ts）
    ▼
返回 FlowData（nodes + edges JSON）
    │
    ▼
onFlowGenerated 回调 → SET_NODES + SET_EDGES → 画布渲染
```

---

## 十二、本阶段回答的三个问题

**Q1：节点画布的状态模型是什么？**

以 `useReducer` 驱动的 `AgentflowState`（nodes/edges/chatflow/isDirty/editingNodeId），通过 `AgentflowContext` 注入画布，所有状态变更通过 dispatch action 的方式触发。

**Q2：节点配置如何驱动表单与编辑器？**

节点的 `inputs: INodeParams[]` 定义了所有参数的元数据（type/label/optional/show/hide），`NodeInputHandler` 根据 `type` 动态渲染对应的 atom 组件，`evaluateFieldVisibility()` 根据当前值计算条件显示/隐藏。

**Q3：画布、节点面板、节点编辑器三者如何协作？**

三者共享同一个 `AgentflowContext`：
- 节点面板拖拽 → dispatch `SET_NODES`（新增节点）
- 画布双击节点 → dispatch `OPEN_EDIT_DIALOG`（打开编辑器）
- 编辑器保存 → 更新节点 data → dispatch `SET_NODES` + `SET_DIRTY`

---

## 十三、下一阶段预告

进入 **第六阶段** → 补数据库、企业能力与运维面：
- 数据是如何落库的（TypeORM 实体 + Migration）
- 企业版能力是如何叠加在开源主链路之上的（IdentityManager + Feature Flag）
- 监控、队列、部署配置如何支撑生产运行
