

<h1 align="center">ChatPulse</h1>

<p align="center">
  <b>让 AI 角色真正「活着」的全栈社交模拟平台</b><br/>
  <sub>不是聊天机器人，是一整个会呼吸的小世界。</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs" />
  <img src="https://img.shields.io/badge/WebSocket-realtime-blue?logo=socketdotio" />
  <img src="https://img.shields.io/badge/SQLite-database-003B57?logo=sqlite" />
  <img src="https://img.shields.io/badge/Qdrant-vector--search-dc382d" />
  <img src="https://img.shields.io/badge/license-ISC-green" />
</p>

---

## 这是什么

大多数 AI 聊天应用的角色都是无状态的 —— 你说一句，它回一句，关掉页面就什么都不记得了。

ChatPulse 想做的不一样：**角色是持续存在的**。它们会记住你说过的话，会有情绪波动，会在你不在的时候继续逛街、打工、睡觉，甚至会主动给你发消息。

简单说，这是一个 AI 角色「生活」的地方，而不只是一个对话框。

---

## 核心功能

### 🧠 长期记忆

角色不只是短期对话。记忆系统使用 Qdrant 做向量语义检索，SQLite 做结构化持久存储，角色能回忆起几天前甚至更早的对话细节。支持记忆提取、日级聚合和溢出消化。

### 💬 多场景联动

同一个角色可以同时出现在：
- **私聊** — 一对一深度对话
- **群聊** — 多角色同场互动
- **朋友圈** — 发布动态、点赞、评论
- **城市模拟** — 自治生活系统

角色的行为在不同场景之间是一致的 —— 在城市里发生的事会影响它和你聊天时的态度。

### 🏙️ 自治城市

角色不聊天的时候也不是静止的。城市系统让它们可以：
- 去不同的区域和地点
- 上班赚钱、吃饭回血、购物消费
- 遭遇随机事件
- 在事件发生后主动联系你

### ⚡ 实时推送

所有角色的主动行为（主动消息、城市事件、情绪变化）通过 WebSocket 实时推送到前端，不需要手动刷新。

### 🔌 插件化架构

后端功能按模块组织，目前已有 8 个插件：

| 插件 | 功能 |
|------|------|
| `city` | 城市模拟、地点、事件 |
| `groupChat` | 群聊系统 |
| `economy` | 钱包、收入、消费 |
| `relationships` | 好感度、关系状态 |
| `scheduler` | 定时任务、日程安排 |
| `theme` | 主题与外观 |
| `adminDashboard` | 管理后台 |
| `backup` | 数据备份与恢复 |

每个插件通过统一的 `pluginContext` 注册路由和钩子，互不耦合。

---

## 技术栈

```
前端          React 19 · Vite · JSX 组件化 · Lucide React
后端          Node.js · Express 5 · ws(WebSocket)
数据库        SQLite (better-sqlite3) · 每用户独立数据库
向量检索      Qdrant · @xenova/transformers 本地嵌入
认证安全      JWT · bcryptjs · Helmet · express-rate-limit
定时任务      node-cron
容器化        Docker Compose (Qdrant)
```

---

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone https://github.com/NANA3333333/ChatPulse.git
cd ChatPulse

cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 2. 启动

**一键启动（Windows）：**
```bat
start-stack.cmd
```

**手动启动：**
```bash
# 终端 1 — 后端
cd server && node index.js

# 终端 2 — 前端
cd client && npm run dev
```

启动后访问：
- 前端：`http://127.0.0.1:5173`
- 后端 API：`http://localhost:8000`

### 3. Qdrant（可选，用于增强记忆检索）

```bash
docker compose up -d
```

Qdrant 启动后将已有记忆迁移到向量库：
```bash
cd server && npm run migrate:qdrant
```

环境变量配置（可选）：
- `QDRANT_URL` — Qdrant 地址（默认 `http://127.0.0.1:6333`）
- `QDRANT_API_KEY` — API 密钥
- `QDRANT_ENABLED` — 是否启用

---

## 项目结构

```
client/
  src/
    components/        # React 组件（聊天、群聊、动态、设置等）
    plugins/           # 前端插件
    utils/             # 工具函数

server/
  index.js             # 入口：Express + WebSocket + 插件加载
  engine.js            # AI 引擎：主动消息、对话调度
  contextBuilder.js    # 统一上下文构建管线
  memory.js            # 记忆系统：提取、检索、聚合
  emotion.js           # 情绪推导
  db.js                # 数据层：SQLite ORM
  llm.js               # LLM API 调用封装
  qdrant.js            # Qdrant 向量检索封装
  plugins/
    city/              # 城市模拟
    groupChat/         # 群聊
    economy/           # 经济系统
    relationships/     # 关系系统
    scheduler/         # 定时任务
    theme/             # 主题
    adminDashboard/    # 管理后台
    backup/            # 备份恢复

scripts/               # 运维脚本
```

---

## 上下文管线

ChatPulse 不是简单地把聊天记录塞进 prompt。上下文构建器会把以下信息整合成一致的模型输入：

- 近期对话（摘要 + 尾部原文混合模式）
- 长期记忆语义检索结果
- 角色情绪和身体状态
- 城市活动与地理位置
- 群聊可见上下文
- 社交动态

私聊和群聊都已实现 `digest + tail` 模式，在不丢失关键信息的前提下大幅压缩 prompt 长度（~40-50%）。

---

## 管理脚本

```bash
start-stack.cmd     # 启动所有服务
status-stack.cmd    # 查看服务状态
stop-stack.cmd      # 停止所有服务

# 记忆迁移
cd server && npm run migrate:qdrant
cd server && npm run migrate:qdrant -- --dry-run
cd server && npm run migrate:qdrant -- --user <userId>

# 清理城市记忆
cd server && npm run cleanup:city-memories
```

---

## Roadmap

- [ ] 多用户部署与托管能力
- [ ] 管理后台增强
- [ ] 记忆可视化与调试工具
- [ ] 城市事件编辑器
- [ ] 角色跨上下文推理能力增强

---

## License

ISC
