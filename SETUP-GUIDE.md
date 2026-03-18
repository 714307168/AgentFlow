# Claude Code Remote - 完整配置指南

## 🎯 快速开始（5分钟配置）

### 前提条件
- ✅ Relay Server 已启动（端口 8080）
- ✅ 电脑和手机在同一局域网
- ✅ 已安装最新的 APK

---

## 📋 完整配置步骤

### 步骤 1：启动服务器

```bash
cd relay-server
./relay-server.exe
```

**验证服务器启动成功**：
```bash
curl http://localhost:8080/health
# 应该返回: ok
```

---

### 步骤 2：在管理面板注册 Agent 和 Device

#### 2.1 访问管理面板
- 打开浏览器访问：`http://localhost:8080/admin`
- 登录账号：`admin`
- 登录密码：`changeme`

#### 2.2 注册 Agent（电脑端）
1. 点击左侧菜单 **Agents**
2. 点击 **Add Agent** 按钮
3. 填写信息：
   - **Agent ID**: `my-agent-001`（自定义，记住这个 ID）
   - **Note**: `我的电脑`（可选）
4. 点击 **Save**
5. **重要**：点击 **Get Token** 按钮，复制生成的 Token
   - 示例：`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - 保存到记事本，稍后配置 Local Agent 时需要

#### 2.3 注册 Device（手机端）
1. 点击左侧菜单 **Devices**
2. 点击 **Add Device** 按钮
3. 填写信息：
   - **Device ID**: `my-phone-001`（自定义，记住这个 ID）
   - **Agent ID**: `my-agent-001`（**必须填写**，与上面创建的 Agent ID 一致）
   - **Note**: `我的手机`（可选）
4. 点击 **Save**
5. **重要**：点击 **Get Token** 按钮，复制生成的 Token
   - 保存到记事本，稍后配置 Android App 时需要

---

### 步骤 3：配置 Local Agent（电脑端）

#### 3.1 启动 Local Agent
```bash
cd local-agent
npm start
```

#### 3.2 配置连接信息
1. 右键点击系统托盘的 Local Agent 图标
2. 选择 **设置**
3. 在"服务器连接"区域填写：
   - **中继服务器地址**: `ws://localhost:8080/ws`
   - **Agent ID**: `my-agent-001`（与管理面板一致）
   - **认证令牌**: 粘贴步骤 2.2 复制的 Agent Token
4. 点击 **重新连接** 按钮
5. 等待连接状态变为"已连接"

#### 3.3 添加项目
1. 在设置界面找到"项目管理"区域
2. 点击 **添加项目** 按钮
3. 填写信息：
   - **项目名称**: `测试项目`
   - **项目路径**: `D:\projects\my-project`（你的项目路径）
4. 点击 **保存**
5. 项目会自动绑定到服务器

---

### 步骤 4：配置 Android App（手机端）

#### 4.1 获取电脑 IP 地址
```bash
# Windows 命令行执行
ipconfig

# 查找 "IPv4 地址"
# 示例：192.168.31.207
```

#### 4.2 安装并配置 App
1. 安装 APK：`android-app/app/build/outputs/apk/debug/app-debug.apk`
2. 打开 App
3. 点击右上角 **⚙️ 设置** 图标
4. 填写配置：
   - **服务器地址**: `http://192.168.31.207:8080`（改成你的电脑 IP）
   - **Device ID**: `my-phone-001`（与管理面板一致）
   - **Token**: 粘贴步骤 2.3 复制的 Device Token
5. 点击 **保存**
6. 返回主界面

#### 4.3 连接服务器
1. 在主界面标题栏查看连接状态
2. 如果显示 **🔴 未连接**，点击右上角的 **🔄 刷新图标**
3. 等待状态变为 **🟢 已连接**
4. 项目列表会自动同步显示

---

## 🔍 连接状态说明

### 状态指示器
- **🟢 已连接** - 连接正常，可以使用
- **🟠 连接中** - 正在建立连接
- **🟠 重连中** - 连接失败，自动重试中
- **🔴 未连接** - 已断开连接

### 手动控制连接
- **连接**：点击 **🔄 刷新图标**
- **断开**：点击 **❌ 关闭图标**

---

## ❌ 常见问题排查

### 问题 1：一直显示"重连中"

**可能原因**：
1. 服务器未启动
2. 设备未在管理面板注册
3. 设备未绑定到 Agent
4. Token 错误
5. 网络地址错误

**排查步骤**：

#### 检查 1：服务器是否运行
```bash
curl http://localhost:8080/health
# 应该返回: ok
```

#### 检查 2：设备是否注册
1. 访问 `http://localhost:8080/admin`
2. 进入 **Devices** 页面
3. 确认你的 Device ID 存在
4. 确认 **Agent ID** 字段已填写

#### 检查 3：Token 是否正确
1. 在管理面板重新生成 Token
2. 复制新的 Token
3. 在 App 设置中更新 Token
4. 重新连接

#### 检查 4：网络地址是否正确
1. 确认电脑和手机在同一 WiFi
2. 确认电脑 IP 地址正确
3. 尝试在手机浏览器访问：`http://192.168.31.207:8080/health`
4. 如果无法访问，检查防火墙设置

---

### 问题 2：连接成功但没有项目

**原因**：设备未绑定到 Agent，或 Agent 没有添加项目

**解决方法**：
1. 在管理面板检查 Device 的 **Agent ID** 字段是否填写
2. 在 Local Agent 中添加项目
3. 在 App 中手动刷新（断开再连接）

---

### 问题 3：无法访问服务器

**检查防火墙**：
```bash
# Windows 防火墙添加规则
netsh advfirewall firewall add rule name="Claude Relay Server" dir=in action=allow protocol=TCP localport=8080
```

**检查端口占用**：
```bash
netstat -ano | findstr :8080
```

---

## 📱 查看详细日志

### Android 日志
```bash
# 查看连接日志
adb logcat -s RelayWebSocket:*

# 查看所有相关日志
adb logcat | grep -E "RelayWebSocket|SessionRepository|MessageRepository"
```

### 服务器日志
- 服务器会在控制台输出详细的 JSON 格式日志
- 关注 `"msg":"agent registered"` 和 `"msg":"device registered"`

### Local Agent 日志
- 查看 Electron 控制台输出
- 关注 `[Main] Relay connected` 和 `[Main] Relay disconnected`

---

## 🎯 完整测试流程

### 1. 测试服务器
```bash
# 健康检查
curl http://localhost:8080/health

# 测试 WebSocket（使用 wscat）
npm install -g wscat
wscat -c ws://localhost:8080/ws
```

### 2. 测试 Local Agent 连接
1. 启动 Local Agent
2. 查看托盘图标提示
3. 打开设置，查看个测试项目

### 3. 测试 Android App 连接
1. 打开 App
2. 查看标题栏连接状态
3. 查看底部是否有错误提示
4. 查看项目列表是否同步

### 4. 测试消息发送
1. 在 App 中选择一个项目
2. 发送测试消息："hello"
3. 查看是否收到回复

---

## 📊 配置检查清单

### 服务器端
- [ ] Relay Server 已启动（端口 8080）
- [ ] 健康检查返回 `ok`
- [ ] 管理面板可以访问

### 管理面板
- [ ] Agent 已注册（记录 Agent ID 和 Token）
- [ ] Device 已注册（记录 Device ID 和 Token）
- [ ] Device 的 Agent ID 字段已填写

### Local Agent
- [ ] 已启动
- [ ] 服务器地址配置正确
- [ ] Agent ID 与管理面板一致
- [ ] Token 已填写
- [ ] 连接状态显示"已连接"
- [ ] 至少添加了一个项目

### Android App
- [ ] 已安装最新 APK
- [ ] 服务器 IP）
- [ ] Device ID 与管理面板一致
- [ ] Token 已填写
- [ ] 连接状态显示"已连接"
- [ ] 项目列表已同步

---

## 🔧 高级配置

### 修改服务器端口
```bash
./relay-server.exe -port 9000
```

### 启用 TLS
```bash
./relay-server.exe -tls-cert cert.pem -tls-key key.pem
```

### 修改管理员密码
```bash
./relay-server.exe -admin-password "your-secure-password"
```

### 配置 CORS
```bash
./relay-server.exe -cors-origins "http://example.com,http://another.com"
```

---

## 📞 获取帮助

### 查看服务器版本
```bash
./relay-server.exe -version
```

### 查看所有配置选项
```bash
./relay-server.exe -help
```

### 常用命令
```bash
# 启动服务器（默认配置）
./relay-server.exe

# 启动服务器（自定义端口）
./relay-server.exe -port 9000

# 启动服务器（详细日志）
./relay-server.exe -log-level debug

# 查看数据目录
ls relay-server/data/
```

---

## ✅ 成功标志

当一切配置正确时，你应该看到：

1. **服务器日志**：
   ```json
   {"level":"info","msg":"agent registered","agent_id":"my-agent-001"}
   {"level":"info","msg":"device registered","device_id":"my-phone-001"}
   ```

2. **Local Agent**：
   - 托盘提示："已连接"
   - 设置界面显示绿色连接状态

3. **Android App**：
   - 标题栏显示：**🟢 已连接**
   - 项目列表显示电脑端添加的项目
   - 底部没有错误提示

---

## 🎉 开始

配置完成后，你可以：

1. **在手机上选择项目**
2. **发送消息给 Claude Code**
3. **查看实时回复**
4. **发送文件和图片**
5. **查看历史记录**

祝使用愉快！🚀
