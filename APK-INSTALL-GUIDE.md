# Android App 安装指南

## 📦 APK 文件

生成的 APK 文件位于：`apk-output/` 目录

| 文件名 | 大小 | 说明 |
|--------|------|------|
| `ClaudeCodeRemote-debug.apk` | 13 MB | Debug 版本（推荐测试使用） |
| `ClaudeCodeRemote-release-unsigned.apk` | 11 MB | Release 版本（未签名） |

---

## 📱 安装步骤

### 方法 1：直接安装 Debug 版本（推荐）

1. **传输 APK 到手机**
   - 通过 USB 数据线连接手机
   - 将 `ClaudeCodeRemote-debug.apk` 复制到手机存储
   - 或通过微信/QQ 等发送到手机

2. **启用未知来源安装**
   - 打开手机设置
   - 进入"安全"或"应用管理"
   - 启用"允许安装未知来源应用"

3. **安装 APK**
   - 在手机上找到 APK 文件
   - 点击安装
   - 按照提示完成安装

### 方法 2：使用 ADB 安装

```bash
# 确保手机已连接并启用 USB 调试
adb devices

# 安装 Debug 版本
adb install apk-output/ClaudeCodeRemote-debug.apk

# 或安装 Release 版本
adb install apk-output/ClaudeCodeRemote-release-unsigned.apk
```

---

## ⚙️ 配置 App

### 1. 启动 App
安装完成后，在手机上找到"Claude Code Remote"图标并启动

### 2. 配置连接信息

在 App 设置界面输入以下信息：

#### 服务器地址
```
ws://YOUR_SERVER_IP:8080/ws
```
- 如果 Relay Server 在本地：`ws://192.168.x.x:8080/ws`
- 如果 Relay Server 在公网：`ws://your-domain.com:8080/ws`
- 如果使用 HTTPS：`wss://your-domain.com:8080/ws`

#### Device ID
```
my-phone
```
（或在管理面板中创建的任何 Device ID）

#### JWT Token
1. 访问管理面板：http://YOUR_SERVER_IP:8080/admin
2. 登录（用户名：admin，密码：admin123）
3. 进入 "Overview" 页面
4. 在 "Android App Setup" 部分：
   - 输入 Device ID
   - 点击 "Get Token" 按钮
   - 复制生成的 Token
5. 粘贴到 App 的 Token 输入框

#### Agent ID（可选）
```
test-agent
```
（绑定到指定的 Local Agent）

### 3. 连接测试

1. 点击"连接"按钮
2. 查看连接状态
3. 如果显示"已连接"，说明配置成功

---

## 🔧 构建信息

### 构建时间
2026-03-16 18:10

### 版本信息
- **应用 ID**: `com.claudecode.remote`
- **版本号**: 1.0 (versionCode: 1)
- **最低 Android 版本**: Android 8.0 (API 26)
- **目标 Android 版本**: Android 14 (API 34)

### 技术栈
- Kotlin 1.9.22
- Jetpack Compose
- Material 3
- OkHttp WebSocket
- Retrofit
- Kotlinx Serialization
- Coroutines

### 构建警告
构建过程中有一些警告，但不影响功能：
- ✅ AndroidManifest.xml 中的 package 属性已弃用（已在 namespace 中定义）
- ✅ 参数名称阴影警告（不影响功能）
- ✅ WebSocketListener 参数命名警告（不影响功能）

---

## 🌐 网络配置

### 本地网络测试
如果 Relay Server 在本地运行：
1. 确保手机和电脑在同一 WiFi 网络
2. 查看电脑 IP 地址：
   ```bash
   ipconfig  # Windows
   ifconfig  # Linux/Mac
   ```
3. 使用电脑的局域网 IP（例如：192.168.1.100）

### 公网访问
如果需要从外网访问：
1. 配置路由器端口转发（8080 端口）
2. 或使用内网穿透工具（如 frp、ngrok）
3. 或部署到云服务器

### 防火墙设置
确保 8080 端口未被防火墙阻止：
```bash
# Windows 防火墙
netsh advfirewall firewall add rule name="Relay Server" dir=in action=allow protocol=TCP localport=8080
```

---

## 🐛 故障排查

### 无法连接到服务器
1. 检查服务器地址是否正确
2. 确认 Relay Server 正在运行
3. 检查防火墙设置
4. 确认手机和服务器网络互通

### Token 无效
1. 检查 Token 是否过期（Device Token 有效期 24 小时）
2. 重新生成 Token
3. 确认 Device ID 已在管理面板注册

### 连接断开
1. 检查网络稳定性
2. 查看 Relay Server 日志
3. 重启 App 重新连接

---

## 📝 使用说明

### 发送命令
1. 在 App 中输入命令
2. 点击发送
3. 等待 Local Agent 执行
4. 查看返回结果

### 查看历史
- App 会保存最近的命令历史
- 可以快速重新发送之前的命令

### 项目管理
- 可以创建多个项目
- 每个项目绑定到不同的 Agent
- 切换项目即可控制不同的电脑

---

## 🔐 安全建议

1. **不要在公网使用 Debug 版本**
   - Debug 版本包含调试信息
   - 建议仅在测试环境使用

2. **使用 HTTPS/WSS**
   - 在生产环境使用 TLS 加密
   - 配置 SSL 证书

3. **定期更换 Token**
   - Device Token 24 小时过期
   - 定期重新生成 Token

4. **启用 E2E 加密**
   - 在 Local Agent 设置中启用
   - 确保端到端加密通信

---

## 📞 支持

如有问题，请查看：
- 项目文档：`README.md`
- 测试报告：`TEST-REPORT.md`
- 配置指南：`CLAUDE.md`

---

**构建完成时间**: 2026-03-16 18:10
**构建状态**: ✅ 成功
**APK 位置**: `apk-output/`
