# 崩溃日志调试版本 - 测试指南

## 版本信息
- **APK 文件**: `apk-output/app-debug-v5-with-crash-log.apk`
- **版本**: v5 (带崩溃日志功能)
- **构建时间**: 2026-03-18

## 新增功能

### 1. 全局崩溃捕获
- 自动捕获所有未处理的异常
- 将崩溃信息写入日志文件
- 包含完整的堆栈跟踪信息

### 2. 详细日志记录
在关键位置添加了详细日志：
- **MainActivity**: 应用启动、导航事件
- **ChatViewModel**: 项目加载、消息发送、WebSocket 连接
- **SessionRepository**: 初始化、项目同步、数据库操作

### 3. 日志查看界面
在设置界面新增"查看崩溃日志"按钮：
- 显示完整的崩溃日志内容
- 显示日志文件路径
- 支持清除日志功能

## 测试步骤

### 步骤 1: 安装新版本
```bash
# 卸载旧版本（如果需要）
adb uninstall com.claudecode.remote

# 安装新版本
adb install apk-output/app-debug-v5-with-crash-log.apk
```

或者直接在手机上安装 `app-debug-v5-with-crash-log.apk`

### 步骤 2: 复现闪退问题
1. 打开 App
2. 进入设置，配置服务器地址
3. 返回项目列表
4. **点击任意项目**（预期会闪退）

### 步骤 3: 查看崩溃日志
1. 重新打开 App
2. 进入设置界面
3. 点击"查看崩溃日志"按钮
4. 查看完整的崩溃信息

### 步骤 4: 提供日志信息
请将以下信息提供给我：

#### 方式 1: 截图
- 在"查看崩溃日志"界面截图
- 确保能看到完整的错误信息和堆栈跟踪

#### 方式 2: 复制文本
日志文件位置：
```
/sdcard/Android/data/com.claudecode.remote/files/crash.log
```

可以通过文件管理器找到这个文件并复制内容

#### 方式 3: adb 导出（如果可以连接）
```bash
adb pull /sdcard/Android/data/com.claudecode.remote/files/crash.log ./crash.log
```

## 日志内容说明

### 崩溃日志格式
```
================================================================================
CRASH REPORT - 2026-03-18 15:30:45.123
Thread: main
Exception: java.lang.NullPointerException
Message: Attempt to invoke virtual method on a null object reference
--------------------------------------------------------------------------------
[完整的堆栈跟踪]
================================================================================
```

### 关键信息
查看日志时，请特别注意：
1. **Exception 类型**: 什么类型的异常（NullPointerException, IllegalStateException 等）
2. **Message**: 错误消息
3. **堆栈跟踪**: 崩溃发生在哪个文件的哪一行
4. **Thread**: 崩溃发生在哪个线程

### 操作日志格式
```
[2026-03-18 15:30:45.123] INFO [MainActivity] App started
[2026-03-18 15:30:46.456] INFO [MainActivity] Navigating to chat: projectId=xxx, projectName=xxx
[2026-03-18 15:30:46.789] INFO [ChatViewModel] loadProject called: projectId=xxx, projectName=xxx
```

## 预期的日志内容

如果点击项目闪退，日志应该包含类似以下内容：

```
[时间戳] INFO [MainActivity] Navigating to chat: projectId=某个ID, projectName=某个名称
[时间戳] INFO [MainActivity] Creating ChatViewModel for projectId=某个ID
[时间戳] INFO [ChatViewModel] loadProject called: projectId=某个ID, projectName=某个名称
[时间戳] INFO [ChatViewModel] Starting to collect messages for project: 某个ID
[时间戳] ERROR [ChatViewModel] Error collecting messages
[崩溃堆栈]
```

## 常见问题

### Q: 找不到"查看崩溃日志"按钮
A: 确保安装的是 v5 版本，按钮在设置界面的"调试工具"部分

### Q: 日志显示"No crash log found"
A: 说明还没有发生崩溃，或者崩溃日志文件未创建

### Q: 点击项目后没有闪退
A: 太好了！说明问题已经修复。请告诉我具体的操作步骤

### Q: 日志内容太长，无法完整截图
A: 可以分多张截图，或者使用文件管理器复制日志文件内容

## 下一步计划

根据崩溃日志，我将：
1. **定位问题根源**: 分析堆栈跟踪，找到崩溃的具体原因
2. **修复问题**: 针对性地修复代码
3. **验证修复**: 生成新版本供测试
4. **继续账号系统重构**: 在确保稳定后，开始实施账号密码登录功能

## 技术细节

### 日志系统实现
- **CrashLogger.kt**: 全局异常处理器
- **日志文件**: 自动轮转，最大 1MB
- **线程安全**: 支持多线程并发写入
- **性能优化**: 异步写入，不影响主线程

### 增强的错误处理
- 所有 ViewModel 方法都包裹在 try-catch 中
- 数据库操作添加详细日志
- 导航参数验证和日志记录
- WebSocket 连接状态跟踪

## 联系方式

如有任何问题或需要帮助，请随时告诉我！
