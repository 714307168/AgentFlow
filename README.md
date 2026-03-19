# Claude Code Remote

通过安卓 App 远程控制本地 Claude Code，公网 Relay Server 做最小化消息中转，支持端到端加密。

```
Android App  <—WS/HTTPS—>  Relay Server  <—WS/HTTPS—>  Local Agent
   (E2E)                    (透传)                        (E2E)
                                                            │
                                                            └── Claude Code
```

## 项目结构

| 目录 | 技术栈 | 说明 |
|---|---|---|
| `android-app/` | Kotlin + Compose | 安卓客户端，会话管理、消息收发、设置配置 |
| `relay-server/` | Go 1.21 | 公网中转服务器，鉴权、路由、队列缓冲、TLS |
| `local-agent/` | Electron + TypeScript | 本地常驻代理，桥接 Relay Server 与 Claude Code |

## 快速开始

### Relay Server

```bash
cd relay-server
go build -o relay-server ./...

# 基本启动
./relay-server

# 自定义配置
./relay-server \
  -port 8080 \
  -jwt-secret "your-secret-key" \
  -cors-origins "https://your-app.com" \
  -tls-cert /path/to/cert.pem \
  -tls-key /path/to/key.pem
```

支持环境变量配置：

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 监听端口 | `8080` |
| `JWT_SECRET` | JWT 签名密钥 | `change-me-in-production` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `PING_INTERVAL` | WS 心跳间隔（秒） | `30` |
| `QUEUE_SIZE` | 每项目消息队列大小 | `100` |
| `TLS_CERT` | TLS 证书路径 | 空（不启用） |
| `TLS_KEY` | TLS 私钥路径 | 空（不启用） |
| `CORS_ORIGINS` | 允许的 CORS 来源 | `*` |

### Local Agent

```bash
cd local-agent
npm install
npm run build
npm start
```

启动后在系统托盘右键 → Settings 配置：
- Relay Server URL（如 `ws://your-server:8080/ws`）
- Agent ID
- Authentication Token
- E2E 加密开关

也可通过环境变量预配置：`RELAY_SERVER_URL`、`AGENT_ID`、`AGENT_TOKEN`

### Android App

用 Android Studio 打开 `android-app/` 目录，Sync Gradle 后运行。

首次启动后点击右上角齿轮图标进入设置页面，配置：
- Relay Server URL
- Device ID
- Authentication Token
- E2E 加密开关

## 核心特性

- 双向实时同步 — App 与本地 Claude Code 消息/状态实时互通
- 会话=项目 — 每个会话映射到一个本地项目目录
- 跨平台常驻 — Windows / macOS / Linux 本地代理后台运行
- 离线唤醒 — 本地代理离线时可远程触发重连
- 桌面联动唤起 — 手机端发消息前会请求唤醒 Agent，桌面端在收到远程消息时自动弹出对应项目窗口
- 流式输出清洗 — Local Agent 会过滤 ANSI 控制字符、输入回显和 prompt 噪音，手机端按 `stream_id + seq` 去重重组
- 服务器最小化 — 仅做消息路由，不存储项目内容
- 自定义服务器 — 三端均支持自行填写服务器地址和客户端信息
- 端到端加密 — X25519 密钥交换 + AES-256-GCM，Relay Server 仅透传密文

## 端到端加密

采用 X25519 ECDH 密钥交换 + AES-256-GCM 对称加密方案：

1. Agent 和 Device 各自生成 X25519 密钥对
2. 通过 `e2e.offer` / `e2e.answer` 事件交换公钥（经 Relay Server 透传）
3. 双方用 X25519 协商出共享密钥
4. 后续消息 payload 使用 AES-256-GCM 加密，Relay Server 只能看到密文
5. 每条消息使用随机 12 字节 nonce，防止重放

Relay Server 全程无法解密消息内容，仅根据 Envelope 头部的 `event`、`project_id` 等元数据进行路由。

## 协议概览

通信基于 WebSocket 长连接，消息格式为统一 Envelope：

```json
{
  "id": "uuid",
  "event": "message.send",
  "project_id": "uuid",
  "stream_id": "uuid",
  "seq": 1,
  "ts": 1710000000000,
  "payload": {}
}
```

当前实现中的流式回复事件为 `message.chunk` 和 `message.done`，而不是单一的 `message.stream` 包装事件。

E2E 加密启用后，payload 变为：

```json
{
  "encrypted": true,
  "ciphertext": "base64...",
  "nonce": "base64..."
}
```

详细协议与 API 定义见 [claude-code-remote-app-spec.md](./claude-code-remote-app-spec.md)。

## 当前消息链路

1. Android App 在发送消息或文件前，先调用 `POST /api/agent/wakeup` 请求唤醒对应 Agent。
2. App 随后通过 WebSocket 发送 `message.send` 到 Relay Server，再转发给 Local Agent。
3. Local Agent 收到远程消息后会自动唤起桌面上的项目终端窗口，并把消息写入 Claude Code PTY。
4. Agent 将清洗后的增量文本拆成 `message.chunk`，结束时发送 `message.done`。
5. Android App 按 `stream_id + seq` 去重、排序并拼装流式文本，避免重复 chunk 导致内容混乱。

## 许可证

MIT
