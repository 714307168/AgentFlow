# 发布一致性检查模板

更新时间：2026-04-19

这份清单用于保证以下三处信息保持一致：

1. 仓库里的本地版本号
2. 更新中心里的发布记录
3. GitHub Release 里的 tag、附件和说明

它的目标不是替代发布脚本，而是防止出现“包已经发了，但版本号、附件、release note、更新接口返回值对不上”的情况。

## 1. 适用范围

当前适用于：

- desktop Windows
- Android
- relay-server 发布记录

后续 `mac` 首发后，把同样的检查项扩到 `desktop-mac`。

## 2. 发版前检查

### 2.1 本地版本号

发布前先确认：

- 桌面端版本号来自 `local-agent/package.json`
- Android 版本号来自 `android-app/app/build.gradle.kts`
- relay-server 如果本轮有联动发布，要在发布说明中明确构建标识或日期节点

至少核对：

- desktop `version`
- Android `versionName`
- Android `versionCode`

### 2.2 变更范围

发布前确认这次发的是哪几端：

- 只发 desktop
- 只发 Android
- desktop + Android
- desktop + Android + relay-server

不要在 release note 里把“未实际发布的端”一起写进去。

### 2.3 测试状态

发版前至少确认本轮相关测试已跑过：

- `relay-server`: `go test ./...`
- `local-agent`: `npm test`
- `android-app`: `.\gradlew.bat :app:testReleaseUnitTest`

如果本轮只改文档，不要发版。

## 3. 构建产物检查

### 3.1 Desktop

默认产物：

- `local-agent/release/AgentFlow-<version>-x64-setup.exe`

检查项：

- 文件名中的版本号与 `package.json` 一致
- 文件修改时间是本次构建产物
- `sha256` 已重新计算

### 3.2 Android

Android 当前存在两种候选产物路径，不要只盯一个目录：

- `android-app/app/build/outputs/apk/release/app-release.apk`
- `D:\agentflow-android-build\AgentFlow\app\outputs\apk\release\app-release.apk`

发布脚本会优先解析可用产物，但人工核查时也要明确：

- 本次真正上传的是哪一个 APK
- `output-metadata.json` 对应的 `versionName / versionCode` 是否正确
- 产物修改时间是否是本次构建

## 4. 更新中心一致性检查

上传到更新中心后，至少核对：

1. `/admin/releases` 中版本号、build、平台、附件名正确
2. `/api/update/check` 返回的 `latestVersion` 正确
3. Android 返回的 `build` 正确
4. 下载链接可访问
5. `sha256` 与本地产物一致

建议核对的接口：

```text
/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=0.0.0&build=0
/api/update/check?platform=android&channel=stable&arch=&version=0.0.0&build=0
```

## 5. GitHub Release 一致性检查

如果本轮同步发 GitHub Release，至少核对：

1. tag 是否与计划一致
2. release title 是否与版本一致
3. 上传的附件是否是本次构建产物
4. release note 是否与更新中心说明一致
5. 不要把旧版本产物误传成新 tag 附件

## 6. 发布说明模板

推荐结构：

- 本轮发布端
- 版本号
- 核心修复或能力点
- 是否联动 relay-server
- 更新中心 release id
- GitHub Release tag

示例：

```text
Android 1.2.24 (build 108)
- 修复升级后启动闪退
- 修复加密偏好损坏时的恢复路径
- 更新中心 release id: 225
```

## 7. 发版后回查

发版完成后建议至少做一次最小回查：

### Desktop

- 检查更新接口是否返回新版本
- 下载链接是否可访问
- 安装包文件名、版本号、SHA 是否一致

### Android

- 检查更新接口是否返回新版本和正确 build
- 下载 APK 后是否能正常安装
- 安装完成后是否还会重复提示同一版本升级

### Relay

- `/health` 正常
- `/admin/api/overview` 正常
- 当前发布说明里的 relay 构建信息可追踪

## 8. 常见错误

最常见的几类问题：

- 版本号已经改了，但上传的还是旧构建产物
- 更新中心已经发了，但 GitHub Release 没同步
- GitHub tag 已更新，但附件还是旧包
- Android `versionName` 更新了，但 `versionCode` 没变
- 只看 `android-app/app/build`，漏掉实际使用的是外部构建根目录产物

## 9. 当前结论

后续每次涉及发布，至少把这份清单过一遍，避免再出现：

- 更新中心版本对不上
- 本地包和远端版本不一致
- 同一版本反复提示升级
- 已经发布但无法确认实际上传的是哪一份构建产物
