# 项目同步和闪退问题修复指南

## 问题描述
1. Android App 项目列表中项目名称显示为空
2. 点击项目时 App 闪退

## 根本原因
Local Agent、Relay Server 和 Android App 三端的 `project.bind` 事件字段名不一致：
- **Local Agent 发送**: `payload.id`
- **Relay Server 期望**: `payload.project_id`
- 导致项目信息无法正确存储和同步

## 已修复的文件

### 1. Local Agent
- `local-agent/src/main.ts` (line 219): `payload.id` → `payload.project_id`
- `local-agent/src/message-router.ts` (lines 134-166): 所有 `payload.id` → `payload.project_id`

### 2. Android App
- `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt`:
  - 添加 `LaunchedEffect` 导入
  - 添加 `projectId` 空值检查和自动返回逻辑
  - 优化 `remember(projectId)` 作用域
  - 导航参数添加默认值保护

- `android-app/app/src/main/java/com/claudecode/remote/ui/chat/ChatViewModel.kt`:
  - 添加 `projectId` 空值检查
  - 添加异常捕获防止崩溃
  - 避免重复 WebSocket 连接
  - 移除 `onCleared()` 中的断开连接逻辑

- `android-app/app/src/main/java/com/claudecode/remote/ui/chat/ChatScreen.kt`:
  - 添加 `projectId` 非空检查

### 3. Relay Server
- 已重启，无需修改代码

## 测试步骤

### 步骤 1: 重启 Local Agent
```bash
# 关闭当前运行的 Local Agent
# 然后重新启动
cd local-agent
npm start
```

### 步骤 2: 绑定项目
1. 打开 Local Agent 设置界面
2. 配置服务器地址: `http://192.168.31.207:8080`
3. 添加项目（如果已有项目，建议删除后重新添加）
4. 确认项目绑定成功

### 步骤 3: 测试 Android App
1. 安装最新 APK: `apk-output/app-debug-v4.apk`
2. 打开 App，进入设置
3. 配置服务器地址: `http://192.168.31.207:8080`
4. 返回项目列表，查看项目名称是否正确显示
5. 点击项目，确认不再闪退

## 验证要点

### Local Agent 日志
查看控制台输出，应该看到：
```
[MessageRouter] Project bound: <项目名称> (<项目ID>)
```

### Relay Server 日志
应该看到：
```
project bound via WebSocket
```

### Android App
- ✅ 项目列表显示完整的项目名称（不是 "Project xxxxxxxx"）
- ✅ 点击项目能正常进入聊天界面
- ✅ 聊天界面顶部显示正确的项目名称
- ✅ 连接状态显示为"已连接"

## 如果仍有问题

### 清理缓存
```bash
# Local Agent: 删除项目存储
rm -rf local-agent/projects.json

# Android App: 清除应用数据
# 在手机设置中找到 App，清除数据后重新配置
```

### 检查网络
```bash
# 确认 Relay Server 可访问
curl http://192.168.31.207:8080/health

# 应该返回: ok
```

### 查看详细日志
- Local Agent: 查看控制台输出
- Relay Server: 查看 `relay-server/relay.log`
- Android App: 使用 `adb logcat` 查看崩溃日志

## 技术细节

### 数据流
```
Local Agent (project.bind)
    ↓ WebSocket
    payload.project_id ✅
    ↓
Relay Server (hub.projectInfos)
    ↓ REST API /api/device/sync
    projects[].id, name, path ✅
    ↓
Android App (SessionRepository.syncFromServer)
    ↓ Room Database
    Session(id, name, projectId, projectPath) ✅
```

### 关键接口对比

| 组件 | 发送字段 | 接收字段 | 状态 |
|------|---------|---------|------|
| Local Agent → Relay | `payload.project_id` | `ProjectBindPayload.project_id` | ✅ |
| Relay → Android | `projects[].id` | `ProjectInfo.id` | ✅ |
| Android 导航 | `projectId` | `backStackEntry.arguments` | ✅ |

## 版本信息
- Local Agent: 已编译 (2026-03-18)
- Relay Server: 运行中 (端口 8080)
- Android App: v4 (apk-output/app-debug-v4.apk)
