# AgentFlow

[English](./README.en.md)

`AgentFlow` 是一个让你可以“用手机远程查看和协作桌面端 AI 编程会话”的自托管方案。

通俗点说，它主要解决这几件事：

- 你的 AI 编程主环境跑在电脑上
- 你出门后，想用手机继续看项目状态、看消息、发指令、收文件
- 你不想把这些数据交给第三方中转，希望服务端自己部署、自己掌控
- 你希望把办公室、机房或现场电脑作为受控的远程协作节点，授权给自己或同事做调试、部署、巡检和远程办公跟进

它不是一个单纯的聊天 App，也不是一个普通的远程桌面工具。  
它更像是一个“桌面 AI 工作台 + 手机协作端 + 自建中继服务”的组合。

```text
Android App  <-->  Relay Server  <-->  Local Agent  <-->  Claude Code CLI / Codex CLI
```

## 一句话理解

如果你平时是在电脑上跑 Claude Code、Codex 这类 CLI Agent，那么 `AgentFlow` 可以让你：

- 在手机上查看电脑端项目列表、会话、运行状态
- 给电脑端项目继续发消息，让本地 Agent 接着干活
- 收到电脑端同步过来的消息、活动、附件和文件
- 通过你自己部署的 Relay Server 做同步、设备管理和更新分发

## 这个程序适合谁

- 主要在 Windows 桌面上跑 AI 编程 CLI 的个人开发者
- 需要“电脑执行，手机跟进”的远程协作场景
- 需要对办公室电脑、现场机器或运维节点做受控授权远程协作的人
- 想自托管中继、账号、更新中心，不想依赖公开云中转
- 想把项目历史、消息、运行状态按项目长期保存的人

如果你只是想远程控制桌面，或者只是想做普通 IM，这个项目不是为那个目标设计的。

## 它由什么组成

整个项目分成三部分：

- `android-app/`
  Android 客户端。负责查看项目、聊天、消息同步、附件接收、更新下载。
- `local-agent/`
  桌面端 Agent。负责连接 Relay、管理本地项目、调用 Claude Code CLI / Codex CLI、保存本地历史。
- `relay-server/`
  你自己部署的中继服务。负责认证、同步、设备协调、管理后台、更新中心。

## 它到底能干什么

当前核心能力主要是这些：

- 手机查看桌面端项目列表、消息记录、运行状态
- 手机继续给某个桌面项目发消息，让本地 Agent 接着执行
- 桌面端把消息、活动、附件、运行状态同步到手机
- 可作为受控授权远程协作入口，适合现场调试、部署跟进、问题排查和远程办公
- 支持自托管 Relay Server，不依赖第三方中转
- 支持桌面端和 Android 端版本检查与更新中心
- 支持后台管理：用户、设备、版本发布、流量统计
- 支持按项目保存本地历史，并通过增量同步减少流量

## 一个典型使用流程

你可以把它理解成下面这条链路：

1. 你在电脑上安装并运行 `local-agent`
2. `local-agent` 在本机连接 Claude Code CLI 或 Codex CLI
3. 你部署自己的 `relay-server`，让桌面端和手机端都连到它
4. 你在 Android 手机上登录同一个账号
5. 手机端就可以看到电脑上的项目、消息和状态
6. 你在手机里继续发消息，桌面端收到后继续执行
7. 执行结果、活动和附件再同步回手机

如果是现场调试、部署或远程办公场景，也可以把它理解成一套“受控授权远程协作链路”：
1. 把某台办公室电脑、机房机器或现场机器接入 `local-agent`
2. 通过你自建的 `relay-server` 管理账号、设备和访问关系
3. 让被授权的人只通过项目消息、状态、文件和执行结果参与协作，而不是直接暴露整台桌面

## 和普通聊天 / 远程控制有什么区别

- 不是纯聊天工具：它的重点是“围绕项目和本地 Agent 的工作流”
- 不是远程桌面：它不传整块屏幕，而是同步结构化的项目消息、活动和状态
- 更适合做“受控授权远程协作”：让现场调试、部署跟进、远程办公围绕项目进行，而不是开放整台机器给别人随便操作
- 不是 SaaS 云产品：它支持你自己部署 Relay Server 和更新中心
- 不是一次性会话：它按项目持久化历史，适合长期跟踪

## 仓库结构

```text
.
|-- android-app/   Android 客户端
|-- local-agent/   Electron 桌面端 Agent
|-- relay-server/  Go 中继服务和管理后台
|-- docs/          补充文档
`-- CLAUDE.md      项目协作说明
```

## 工作原理

桌面端 `local-agent` 是项目数据的真实来源。

- 每个项目独立保存历史
- 每条消息和活动都有递增同步序列
- 手机端按 `after_seq` 拉增量，而不是反复整包全量同步
- 大历史会话优先走本地缓存，再补差量
- 更新包由 `relay-server` 内置更新中心统一分发

## 快速开始

### 1. 启动 Relay Server

```bash
cd relay-server
go build ./...
go test ./...
```

常用环境变量：

- `PORT`
- `JWT_SECRET`
- `LOG_LEVEL`
- `CORS_ORIGINS`
- `DATA_DIR`
- `DATABASE_PATH`
- `ADMIN_USER`
- `ADMIN_PASSWORD`

### 2. 启动桌面端 Agent

```bash
cd local-agent
npm install
npm run build
npm start
```

Windows 打包：

```bash
cd local-agent
npm run dist:win
```

### 3. 构建 Android App

```bash
cd android-app
./gradlew.bat :app:compileDebugKotlin
./gradlew.bat :app:assembleRelease
```

## 本地数据

### 桌面端

桌面端默认数据目录：

- `%APPDATA%\\claude-code-agent`

常见文件：

- `config.json`：Relay 地址、账号信息、项目列表、默认配置
- `app-settings.json`：启动、更新、日志等系统设置
- `i18n.json`：界面语言
- `runtime-history/<projectId>.json`：项目历史、活动、队列、会话状态

### Android

Android 端使用 Room 和 Preferences 保存：

- 已同步消息
- 每个项目的同步游标
- 本地聊天快照
- 登录态和更新设置

## 更新中心

更新中心内置在 `relay-server` 中。

支持：

- 桌面端检查更新
- Android 端检查更新
- 可选自动检查
- 可选自动下载
- 安装动作仍然需要用户确认

后台管理页同时提供：

- 在线桌面端 / 设备连接概览
- 版本发布管理
- 按事件类型聚合的上下行流量统计

示例接口：

```text
/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
```

## 文档导航

- [English README](./README.en.md)
- [2026-05 路线图总览](./docs/roadmap-2026-05.md)
- [多端扩展计划](./docs/platform-expansion-plan.md)
- [Relay Server Deployment](./docs/relay-server-deployment.md)
- [WebSocket 稳定性与恢复专项](./docs/ws-stability-and-recovery-plan.md)
- [Project Sync Signature 设计](./docs/project-sync-signature-design.md)
- [受控授权远程协作设计](./docs/controlled-remote-authorization.md)
- [项目级授权 MVP 实施方案](./docs/project-scope-access-mvp.md)
- [项目级授权三端实施与发版检查表](./docs/project-scope-access-checklist.md)
- [项目级授权接口 Schema](./docs/project-scope-access-api-schema.md)
- [更新中心与发布说明](./docs/release-and-update-center.md)
- [发布上传 Runbook](./docs/release-upload-runbook.md)
- [GitHub Releases 发布](./docs/github-releases.md)
- [桌面端说明](./local-agent/README.md)
- [协作说明](./CLAUDE.md)

## 开源说明

- 不要把真实生产域名、服务器 IP、数据库文件、发布脚本和口令提交到仓库
- 本地部署脚本请保留在本机，并加入 `.gitignore`
- 安装包和 APK 通过更新中心或 GitHub Releases 分发，不直接提交到源码仓库
- 公共文档中的域名、账号、密码、服务器地址都应使用占位符示例
