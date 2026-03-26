# Claude Code Remote

[English](./README.en.md)

`Claude Code Remote` 是一个自托管的远程协作方案，用来通过手机控制桌面端 Claude Code。

```text
Android App  <-->  Relay Server  <-->  Local Agent  <-->  Claude Code CLI
```

它由三部分组成：

- `android-app/`：Android 客户端，负责项目列表、聊天、文件接收、更新下载
- `local-agent/`：桌面端 Agent，负责连接中继、管理 Claude Code CLI、保存本地历史
- `relay-server/`：自托管中继服务，负责认证、同步、设备协调、后台管理和更新中心

## 功能概览

- 手机端查看项目列表、聊天记录和运行状态
- 桌面端执行 Claude Code CLI，并把消息、活动、附件同步到手机端
- 支持自托管 Relay Server，不依赖第三方中转
- 支持桌面端和 Android 端检查更新
- 支持后台管理、用户体系、设备绑定、版本发布和按事件类型统计流量
- 支持按项目保存本地历史，并基于增量序列同步到移动端

## 仓库结构

```text
.
|-- android-app/   Android 客户端
|-- local-agent/   Electron 桌面端 Agent
|-- relay-server/  Go 中继服务和管理后台
|-- docs/          补充文档
`-- CLAUDE.md      项目协作说明
```

## 工作方式

桌面端 Agent 是项目数据的真实来源。

- 每个项目单独保存历史数据
- 每条消息和活动都有递增的同步序列
- 手机端按 `after_seq` 拉取增量数据
- 大历史场景下不再走整包全量同步
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

- `config.json`：中继地址、账号信息、项目列表、默认配置
- `app-settings.json`：启动、更新、日志等系统设置
- `i18n.json`：界面语言
- `runtime-history/<projectId>.json`：项目历史、活动、队列、会话信息

### Android

Android 端使用 Room 和 Preferences 保存：

- 已同步消息
- 每个项目的 `lastSyncSeq`
- 登录态和更新设置

## 更新中心

更新中心内置在 `relay-server` 中。

支持能力：

- 桌面端检查更新
- Android 端检查更新
- 可选自动检查
- 可选自动下载
- 安装仍需用户确认

后台管理概览页同时提供：

- 在线桌面端 / 设备连接总览
- 发布版本管理
- 按事件类型聚合的上下行流量统计

示例接口：

```text
/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
```

## 文档导航

- [English README](./README.en.md)
- [更新中心与发布说明](./docs/release-and-update-center.md)
- [发布上传 Runbook](./docs/release-upload-runbook.md)
- [桌面端说明](./local-agent/README.md)
- [协作说明](./CLAUDE.md)

## 开源说明

- 不要把真实生产域名、服务器 IP、数据库文件、发布脚本和口令提交到仓库
- 本地部署脚本请保留在本机，并加入 `.gitignore`
- 安装包和 APK 只通过发布中心或 GitHub Releases 附件分发，不提交到源码仓库
- 文档中的域名、账号、密码、服务器地址都应使用占位符示例
