# Claude Code 远程双向同步技术文档（安卓 App → 公网服务器 → 本地 Claude Code）

> 目标：安卓 App 作为移动端入口，通过公网最小化中转服务器与本地 Claude Code 常驻代理保持**双向同步**；会话=项目；支持 Win/macOS/Linux 常驻 + 离线唤醒。

---

## 1. 目标（Goals）
- **双向同步**：安卓 App 与本地 Claude Code 的消息/状态实时互通。
- **会话=项目**：每个会话映射到一个本地项目目录/工作区上下文。
- **跨平台常驻**：Windows/macOS/Linux 本地代理后台运行。
- **离线唤醒**：本地代理离线时，可远程触发唤醒/重连。
- **服务器最小化**：服务器仅做消息路由、鉴权、队列缓冲。

## 2. 范围（Scope）
**包含：**
- 安卓 App（UI、消息收发、会话管理、设备绑定）
- 公网服务器（鉴权、路由、队列、推送）
- 本地代理（Claude Code 适配、文件系统绑定、常驻服务）

**不包含：**
- Claude Code 核心算法/模型能力
- 企业级多租户复杂权限
- 历史数据长期归档（可扩展）

---

## 3. 架构（Architecture）
```
Android App  <—WS/HTTPS—>  Public Relay Server  <—WS/HTTPS—>  Local Agent (Win/macOS/Linux)
                                                                               │
                                                                               └── Claude Code (local)
```
**设计原则：**
- 服务器无状态/低状态（短时缓存、最小持久化）
- 本地代理持有项目上下文与 Claude Code 交互
- App 与本地代理都通过服务器建立**长连接**

---

## 4. 协议 & API 字段
### 4.1 通用 Envelope
```json
{
  "type": "event|command|reply",
  "event": "string",
  "session_id": "uuid",
  "project_id": "uuid",
  "message_id": "uuid",
  "timestamp": 1710000000000,
  "payload": { }
}
```

### 4.2 主要事件（WS）
- `session.create`
- `session.list`
- `message.send`
- `message.chunk`
- `message.done`
- `message.error`
- `project.bind`
- `agent.heartbeat`
- `agent.wakeup`
- `file.sync`
- `error`

### 4.3 核心 API（HTTPS）
#### 创建会话
`POST /api/session`
```json
{
  "project_name": "string",
  "device_id": "string"
}
```
**返回**
```json
{ "session_id": "uuid", "project_id": "uuid" }
```

#### 绑定项目
`POST /api/project/bind`
```json
{ "project_id": "uuid", "local_path": "/path/to/project" }
```

#### 触发唤醒
`POST /api/agent/wakeup`
```json
{ "agent_id": "uuid", "reason": "string" }
```

### 4.4 API 字段表（细化）
#### 4.4.1 通用 Envelope（WS/HTTP 回包）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| type | enum(event\|command\|reply) | 是 | 消息类型 |
| event | string | 是 | 事件名，如 `message.send` |
| session_id | uuid | 否 | 会话ID（会话级事件必填） |
| project_id | uuid | 否 | 项目ID（绑定后建议带） |
| message_id | uuid | 否 | 消息ID/请求ID |
| device_id | string | 否 | 设备ID（App侧） |
| agent_id | uuid | 否 | 本地代理ID |
| timestamp | int(ms) | 是 | 服务端生成时间戳 |
| payload | object | 是 | 业务负载 |
| error | object | 否 | 错误信息（仅 error/reply） |

#### 4.4.2 HTTP 通用响应
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | int | 是 | 0=成功，非0失败 |
| message | string | 是 | 文案 |
| data | object | 否 | 业务数据 |

#### 4.4.3 会话/绑定请求体
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| project_name | string | 否 | 新建会话时用于命名 |
| device_id | string | 是 | App 设备标识 |
| device_name | string | 否 | 设备名（机型/别名） |
| local_path | string | 否 | 本地路径（Agent 侧上报） |

#### 4.4.4 消息与流式 Payload
**message.send**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| content | string | 是 | 文本内容 |
| content_type | enum(text\|md\|json) | 否 | 默认 text |
| reply_to | uuid | 否 | 引用消息ID |
| metadata | object | 否 | 扩展字段 |

**message.chunk**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| stream_id | uuid | 是 | 流ID |
| seq | int | 是 | 递增序号 |
| content | string | 是 | 清洗后的增量文本 |

**message.done**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| stream_id | uuid | 是 | 流ID |
| seq_total | int | 否 | 总 chunk 数 |

**当前实现约束**
- Android App 在发送消息前会先请求 `POST /api/agent/wakeup`
- Local Agent 在收到远程 `message.send` 后，应自动唤起对应项目窗口
- `message.chunk` 的 `content` 应为适合移动端展示的纯文本，不应直接透传 ANSI 控制字符、输入回显或 prompt 行
- Android App 应按 `(stream_id, seq)` 去重并按序重组流式内容

---

## 5. 数据模型
### 5.1 Session
| 字段 | 类型 | 说明 |
|---|---|---|
| session_id | UUID | 会话唯一ID |
| project_id | UUID | 关联项目ID |
| device_id | string | 设备标识 |
| created_at | timestamp | 创建时间 |

### 5.2 Project
| 字段 | 类型 | 说明 |
|---|---|---|
| project_id | UUID | 项目唯一ID |
| name | string | 项目名 |
| local_path | string | 本地路径 |

### 5.3 Message
| 字段 | 类型 | 说明 |
|---|---|---|
| message_id | UUID | 消息唯一ID |
| session_id | UUID | 会话ID |
| sender | enum(app|agent) | 发送方 |
| content | string | 内容 |
| status | enum(pending|sent|delivered|failed) | 状态 |

---

## 6. 组件清单
- **Android App**：会话/项目管理、消息输入、实时显示
- **Relay Server**：鉴权、路由、队列缓冲、心跳监测
- **Local Agent**：Claude Code 适配器、文件监听器、任务队列
- **Claude Code**：本地执行引擎

---

## 7. 安全设计
- **双向 TLS**：App/Agent 与服务器使用 HTTPS+WSS
- **设备绑定**：设备首次登录需绑定 `device_id`
- **短期 Token**：JWT/Session Token 过期刷新
- **最小权限**：服务器不存储明文项目内容
- **本地代理隔离**：Claude Code 执行权限受限

---

## 8. 风险矩阵
| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 服务器宕机 | 通信中断 | 本地队列缓存，自动重连 |
| Token 泄露 | 会话被劫持 | 绑定设备ID + 过期刷新 |
| 本地代理离线 | 无法响应 | 远程唤醒 + watchdog |
| 文件冲突 | 数据不一致 | 版本号+时间戳冲突解决 |

---

## 9. MVP 里程碑
1. **M1**：基础 WS 双向消息转发
2. **M2**：会话=项目绑定
3. **M3**：本地代理常驻（Win/macOS/Linux）
4. **M4**：离线唤醒 + 自动重连
5. **M5**：文件同步与冲突处理

---

## 10. 实施步骤
1. 搭建最小化 Relay Server（WS/HTTP）
2. 编写 Local Agent（CLI + 服务封装）
3. Android App 集成 WS 客户端
4. 实现会话=项目映射
5. 增加唤醒/心跳机制
6. 完成跨平台部署脚本

---

## 11. 部署指南
### 11.1 服务器（Linux Minimal）
- **依赖**：Node.js/Go + Nginx
- **运行**：systemd

**示例 systemd**
```ini
[Unit]
Description=Claude Relay Server
After=network.target

[Service]
ExecStart=/usr/local/bin/relay-server --port 443
Restart=always

[Install]
WantedBy=multi-user.target
```

### 11.2 本地代理（Windows）
- 安装为 Windows Service
- 启动时自动连接服务器

**示例**
```powershell
sc create ClaudeAgent binPath= "C:\ClaudeAgent\agent.exe" start= auto
sc start ClaudeAgent
```

### 11.3 本地代理（macOS）
- 使用 launchd
```xml
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude.agent</string>
  <key>ProgramArguments</key><array><string>/usr/local/bin/agent</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

### 11.4 本地代理（Linux）
- 使用 systemd
```ini
[Unit]
Description=Claude Local Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/agent --server wss://relay
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 12. 附录示例
### 12.1 消息流
```
App -> Server: message.send
Server -> Agent: message.send
Agent -> Server: message.reply
Server -> App: message.reply
```

### 12.2 WS 事件示例
```json
{ "type":"event","event":"agent.heartbeat","payload":{"status":"ok"} }
```

### 12.3 Windows Service 示例
```powershell
sc create ClaudeAgent binPath= "C:\ClaudeAgent\agent.exe" start= auto
```

### 12.4 launchd 示例
```xml
<plist version="1.0"><dict>...</dict></plist>
```

### 12.5 systemd 示例
```ini
[Unit]
Description=Claude Local Agent
After=network.target
```

---

## 13. 关键交互时序（精简）
### 13.1 注册/首次登录
1. App → Server：`POST /api/session`（device_id）
2. Server → App：返回 `session_id`、`project_id`、token
3. App → Server：建立 WSS，发送 `auth.login`
4. Server → App：`auth.ok` + 事件订阅确认

### 13.2 项目绑定（会话=项目）
1. App → Server：`project.bind`（project_id）
2. Server → Agent：`project.bind`（project_id）
3. Agent → Server：`project.bound`（local_path）
4. Server → App：`project.bound`

### 13.3 消息（非流式）
1. App → Server：`message.send`
2. Server → Agent：`message.send`
3. Agent → Server：`message.reply`
4. Server → App：`message.reply`

### 13.4 流式消息
1. App → Server：`POST /api/agent/wakeup`
2. App → Server：`message.send`
3. Server → Agent：`message.send`
4. Agent：自动弹出对应项目窗口，并把消息写入 Claude Code PTY
5. Agent → Server：`message.chunk`
6. Agent → Server：`message.done`
7. Server → App：转发 `message.chunk` / `message.done`
8. App：按 `(stream_id, seq)` 去重、排序并重组回复内容

### 13.5 离线唤醒
1. App → Server：`POST /api/agent/wakeup`
2. Server → Push/Relay：发送唤醒指令
3. Agent → Server：`agent.online`
4. Server → App：`agent.online`

### 13.6 断线重连
1. App/Agent 断线后指数退避重连
2. 连接后发送 `auth.resume`（last_event_id）
3. Server → 客户端：补发缺失事件（按序）
4. Server → 客户端：`sync.done`

---

## 14. WS 事件表格
| 事件 | 方向 | 触发时机 | 关键字段 |
|---|---|---|---|
| auth.login | App/Agent → Server | 建立连接后登录 | token, device_id/agent_id |
| auth.ok | Server → App/Agent | 登录成功 | expires_at |
| auth.refresh | App/Agent ↔ Server | Token 刷新 | token |
| session.create | App ↔ Server | 创建会话 | project_name, device_id |
| session.list | App ↔ Server | 拉取会话列表 | page, size |
| project.bind | App/Server/Agent | 绑定项目 | project_id, local_path |
| project.bound | Agent → Server → App | 绑定完成 | project_id, local_path |
| message.send | App → Server → Agent | 发送消息 | content, content_type |
| message.chunk | Agent → Server → App | 流式正文分片 | stream_id, seq, content |
| message.done | Agent → Server → App | 流式回复结束 | stream_id, seq_total |
| message.error | Agent → Server → App | 流式回复失败 | stream_id, error |
| agent.heartbeat | Agent → Server | 心跳 | status, uptime |
| agent.online | Agent → Server → App | 代理上线 | agent_id |
| agent.offline | Server → App | 代理离线 | agent_id |
| agent.wakeup | Server → Agent | 唤醒指令 | reason |
| file.sync | Agent ↔ Server ↔ App | 文件同步 | path, version |
| error | Server → App/Agent | 业务错误 | code, message |
