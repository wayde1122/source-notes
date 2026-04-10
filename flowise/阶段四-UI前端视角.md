# 第四阶段：回头读 UI——建立产品视角（packages/ui）

## 阶段目标

理解 UI 如何向后端发请求、画布页面如何组织状态、菜单/布局/权限/工作区这些横切能力如何接入。重点不是每个组件的细节，而是产品骨架。

---

## 一、目录结构速览

```
packages/ui/src/
├── index.jsx              ← React 根节点（Provider 堆叠）
├── App.jsx                ← 主应用（主题 + 路由挂载）
├── api/                   ← 所有后端 API 调用封装（axios）
├── store/                 ← 全局状态（Redux + Context）
│   ├── index.jsx          ← createStore 入口
│   ├── reducer.jsx        ← 根 reducer 合并
│   ├── actions.js         ← Action 类型常量
│   ├── constant.js        ← 全局常量（baseURL、ErrorMessage 等）
│   ├── context/           ← React Context（ReactFlowContext、ConfigContext 等）
│   └── reducers/          ← 各业务 reducer
├── routes/                ← 路由定义
├── layout/                ← 布局（MainLayout、AuthLayout、MinimalLayout）
├── views/                 ← 各业务页面
├── ui-component/          ← 通用 UI 组件库
├── menu-items/            ← 侧边菜单配置
├── themes/                ← MUI 主题
├── hooks/                 ← 自定义 Hook
├── utils/                 ← 工具函数（authUtils 等）
└── assets/                ← 静态资源（图片、样式）
```

---

## 二、应用启动层次（index.jsx）

React 根节点通过多层 Provider 嵌套建立全局能力：

```jsx
<React.StrictMode>
  <Provider store={store}>           {/* Redux 全局状态 */}
    <BrowserRouter>                  {/* React Router */}
      <SnackbarProvider>             {/* 全局通知 Toast */}
        <ConfigProvider>             {/* 应用配置（isAuthEnabled、isCommunityNodesEnabled 等）*/}
          <ErrorProvider>            {/* 全局错误边界处理 */}
            <ConfirmContextProvider> {/* 全局确认对话框 */}
              <ReactFlowContext>     {/* 画布状态 Context（节点/边/选中等）*/}
                <App />
              </ReactFlowContext>
            </ConfirmContextProvider>
          </ErrorProvider>
        </ConfigProvider>
      </SnackbarProvider>
    </BrowserRouter>
  </Provider>
</React.StrictMode>
```

**App.jsx** 极简：读取 Redux 中的 `customization`（主题配置），应用 MUI 主题，渲染路由。

---

## 三、路由系统（routes/）

### 3.1 路由文件分工

| 路由文件 | 职责 |
|---------|------|
| `index.jsx` | 组合所有路由树 |
| `MainRoutes.jsx` | 主业务路由（需登录）|
| `CanvasRoutes.jsx` | 画布路由（chatflow/agentflow 编辑器）|
| `ChatbotRoutes.jsx` | 公开聊天机器人页面（无需登录）|
| `ExecutionRoutes.jsx` | 执行记录页面 |
| `AuthRoutes.jsx` | 登录/注册页面 |
| `RequireAuth.jsx` | 认证守卫（未登录跳转）|
| `DefaultRedirect.jsx` | 默认重定向（根据权限和角色）|

### 3.2 主业务路由（MainRoutes.jsx）核心路径

| 路由路径 | 视图组件 | 业务域 |
|---------|---------|-------|
| `/` → redirect | DefaultRedirect | 智能重定向 |
| `/chatflows` | `views/chatflows` | ChatFlow 列表 |
| `/agentflows` | `views/agentflows` | AgentFlow 列表 |
| `/agentflowsv2` | `views/agentflowsv2` | AgentFlow v2 列表 |
| `/marketplaces` | `views/marketplaces` | 模板市场 |
| `/tools` | `views/tools` | 工具管理 |
| `/assistants` | `views/assistants` | OpenAI/自定义助手 |
| `/credentials` | `views/credentials` | 凭证管理 |
| `/variables` | `views/variables` | 环境变量 |
| `/document-stores` | `views/docstore` | 文档存储 |
| `/evaluations` | `views/evaluations` | 评估（企业版）|
| `/datasets` | `views/datasets` | 数据集（企业版）|
| `/apikey` | `views/apikey` | API 密钥 |
| `/logs` | `views/serverlogs` | 服务器日志 |
| `/executions` | `views/agentexecutions` | 执行记录 |
| `/users` | `views/users` | 用户管理（企业版）|
| `/roles` | `views/roles` | 角色管理（企业版）|
| `/workspace` | `views/workspace` | 工作区管理（企业版）|

所有视图均通过 `Loadable(lazy(() => import(...)))` 实现**代码分割 + 懒加载**。

---

## 四、全局状态管理（store/）

### 4.1 Redux 状态（store/reducers/）

| Reducer | 管理的状态 |
|---------|-----------|
| `customizationReducer` | 主题、侧边栏开关、字体大小 |
| `canvasReducer` | 画布节点/边的 dirty 状态、是否保存中 |
| `authSlice` | 当前用户信息（username、权限）|
| `dialogReducer` | 全局对话框的打开状态 |
| `notifierReducer` | 全局通知队列（通过 notistack）|

### 4.2 React Context（store/context/）

| Context | 管理的状态 |
|---------|-----------|
| `ReactFlowContext` | 画布核心状态：节点列表、边列表、选中节点、chatflow 元信息 |
| `ConfigContext` | 应用级配置：`isAuthEnabled`、`isCommunityNodesEnabled` 等 |
| `ErrorContext` | 全局错误捕获与上报 |
| `ConfirmContextProvider` | 全局确认框（统一调用入口，避免各页面重复写）|

**ReactFlowContext** 是画布页面最重要的状态容器，管理：
- `nodes` / `edges`（当前画布所有节点和边）
- `selectedNode`（当前选中节点）
- 节点参数变更、连线变更的处理函数

---

## 五、API 层（api/）

### 5.1 HTTP 客户端（api/client.js）

```javascript
const apiClient = axios.create({
    baseURL: `${baseURL}/api/v1`,
    headers: {
        'Content-type': 'application/json',
        'x-request-from': 'internal'   // ← 告诉服务端这是内部管理后台调用
    },
    withCredentials: true               // ← 携带 Cookie（JWT 认证）
})
```

**关键设计**：请求头 `x-request-from: internal` 是服务端区分"管理后台请求"和"公开 API 请求"的标记，管理后台请求走 JWT 验证，公开 API 走 API Key 验证。

**Token 刷新机制**：响应拦截器捕获 401 错误，若服务端返回 `TOKEN_EXPIRED + retry=true`，则自动调用 `/auth/refreshToken` 刷新，然后重试原请求。

### 5.2 业务 API 文件一览

| API 文件 | 对应后端路由 |
|---------|------------|
| `chatflows.js` | `/chatflows`（CRUD + 导入导出）|
| `prediction.js` | `/internal-prediction`（画布内测试预测）|
| `nodes.js` | `/nodes`（获取节点列表和配置）|
| `credentials.js` | `/credentials` |
| `documentstore.js` | `/document-store`（文档上传/切块/向量化）|
| `tools.js` | `/tools` |
| `variables.js` | `/variables` |
| `marketplaces.js` | `/marketplaces` |
| `user.js` | `/users`（企业版用户管理）|
| `workspace.js` | `/workspace`（企业版工作区）|
| `auth.js` | `/auth`（登录/登出/刷新 token）|

---

## 六、视图层按业务批次解读（views/）

### 第一批：核心主链路

**`views/chatflows`**
- ChatFlow 列表页
- 展示所有 chatflow 卡片（名称、描述、最后修改时间）
- 支持新建（跳转到画布）、复制、导出、删除

**`views/canvas`**
- ChatFlow 画布编辑器（基于 ReactFlow）
- 拖拽节点、连线、配置节点参数
- 保存 chatflow 定义到后端
- 内嵌聊天测试窗口（调用 internal-prediction）

**`views/chatmessage`**
- 会话消息记录查看
- 支持查看 agentReasoning（Agent 推理过程）、usedTools、sourceDocuments

### 第二批：AgentFlow 与助手

**`views/agentflows`** / **`views/agentflowsv2`**
- 两个版本的 AgentFlow 列表页
- v2 使用 `packages/agentflow` 新画布引擎

**`views/assistants`**
- OpenAI Assistants API 接入页
- 自定义 Assistant 配置页

### 第三批：数据管理

**`views/docstore`**（文档存储）
- 文档仓库列表
- 文档上传 → 切块预览 → 向量化配置 → 向量存储

**`views/credentials`** / **`views/variables`** / **`views/tools`**
- 凭证管理、环境变量、自定义工具的 CRUD

### 第四批：企业版能力

**`views/users`** / **`views/roles`** / **`views/workspace`** / **`views/organization`**
- 用户、角色、工作区、组织管理（仅企业版可用）

### 最后批

**`views/marketplaces`**
- 模板市场（浏览预制 chatflow，一键导入）

**`views/evaluations`** / **`views/evaluators`** / **`views/datasets`**
- LLM 应用评估套件（企业版）

**`views/serverlogs`**
- 服务端日志查看

---

## 七、布局系统（layout/）

| 布局 | 使用场景 |
|------|---------|
| `MainLayout` | 带侧边栏的主业务页面 |
| `AuthLayout` | 登录/注册页面（无侧边栏）|
| `MinimalLayout` | 极简布局（嵌入式聊天机器人等）|

`MainLayout` 包含：
- 顶部导航栏（Header）
- 左侧菜单栏（Sidebar，由 `menu-items/` 配置）
- 内容区（`<Outlet />`，渲染子路由组件）

---

## 八、画布状态模型

画布页面（`views/canvas`）的状态流转：

```
ReactFlowContext (全局 Context)
    ├─ nodes[]          ← ReactFlow 节点数组
    ├─ edges[]          ← ReactFlow 边数组
    ├─ selectedNode     ← 当前选中的节点
    └─ chatflow         ← 当前 ChatFlow 的 DB 记录（含 flowData JSON）

用户操作 → 更新 Context → ReactFlow 画布重渲染
用户点击"保存" → 将 { nodes, edges } 序列化为 flowData JSON → PUT /chatflows/:id
用户点击"测试" → POST /internal-prediction/:id { question }
```

---

## 九、本阶段回答的三个问题

**Q1：页面如何向后端发请求？**

通过 `src/api/` 下各业务 API 文件封装的 axios 函数调用，统一走 `apiClient`（基础路径 `/api/v1`，携带 `x-request-from: internal` 标记和 JWT Cookie）。

**Q2：画布类页面如何组织状态？**

画布状态通过 `ReactFlowContext`（React Context）管理，包含节点列表、边列表、选中节点等。画布组件订阅 Context，操作通过 Context 提供的回调函数更新状态，触发 ReactFlow 重渲染。

**Q3：菜单、布局、权限、工作区这些横切能力如何接入？**

- **菜单**：由 `menu-items/` 静态配置，`MainLayout` 读取配置渲染侧边栏。
- **布局**：通过路由配置中的 `element` 字段选择布局组件（`MainLayout` / `AuthLayout`）。
- **权限**：通过 `RequireAuth` 守卫组件（未登录跳转），企业版路由在后端通过 `IdentityManager.checkFeatureByPlan()` 守门。
- **工作区**：企业版 `ConfigContext` 提供工作区信息，页面根据工作区权限显示/隐藏功能。

---

## 十、下一阶段预告

进入 **第五阶段** → 单独攻克 `packages/agentflow`，理解新画布体系：
- 节点画布的状态模型是什么？
- 节点配置如何驱动表单与编辑器？
- 画布、节点面板、节点编辑器三者如何协作？
