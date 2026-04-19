# 日志信号与诊断映射表

更新时间：2026-04-20

这份文档用于把“日志里看到了什么信号”直接映射成：

- 可能对应的故障现象
- 优先排查哪一层
- 应该先看哪个代码入口

目标是继续缩短线上定位路径，减少“看见一条日志后还得重新猜整条链路”的时间损耗。

## 1. 使用方式

先按你看到的日志信号找分组，再顺着右侧入口去看：

~~~text
日志信号
  -> 故障现象
  -> 优先排查层
  -> 代码入口
  -> 关联专项文档
~~~

## 2. Android 前后台恢复链路

| 日志信号 | 典型现象 | 优先排查层 | 代码入口 | 说明 |
| --- | --- | --- | --- | --- |
| `Scheduling foreground recovery passes` | 应用恢复后开始一轮补救，但后续是否真正补齐未知 | Android | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt` | 这是恢复链路起点，单独出现不代表恢复成功 |
| `Running foreground recovery pass` | 前后台恢复开始执行某一轮 pass | Android | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt` | 要继续配合后续 catalog / project sync / workgroup refresh 看是否完整 |
| `Starting foreground sync` | 看起来进入同步流程了 | Android | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt` | 只说明开始，不说明详情已补齐 |
| `Foreground session catalog refreshed` | 列表可能刷新，但聊天详情仍可能是旧的 | Android | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt`, `android-app/app/src/main/java/com/claudecode/remote/domain/SessionRepository.kt` | catalog 成功后还要看项目补拉是否继续 |
| `Skipping foreground project sync because relay is not connected` | 用户看到“在线状态刚恢复，但消息没刷新” | Android / relay | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt` | 说明恢复链路在 transport 层就断了 |
| `Failed to request project syncs on foreground` | 列表恢复了，但项目消息没有补齐 | Android | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt`, `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt` | 常见于前台恢复只完成 catalog，没有进入单项目补拉 |
| `Failed to refresh workgroups on foreground` | 项目聊天正常，但协作组线程还是旧的 | Android | `android-app/app/src/main/java/com/claudecode/remote/MainActivity.kt` | 用于区分项目链路和协作组链路不是同一处断点 |
| `Starting post-auth session sync` | auth 修复后进入 catch-up 链路 | Android | `android-app/app/src/main/java/com/claudecode/remote/service/RelayConnectionService.kt` | 是 auth 恢复后的关键起点 |
| `Post-auth session catalog refreshed` | 认证后目录刷新成功，但消息仍可能未补齐 | Android | `android-app/app/src/main/java/com/claudecode/remote/service/RelayConnectionService.kt` | 仍需配合 project sync / workgroup refresh 一起看 |
| `Requested project syncs after relay authentication` | 认证后已请求项目补拉 | Android | `android-app/app/src/main/java/com/claudecode/remote/service/RelayConnectionService.kt` | 如果这条缺失，通常是 auth 后同步链中断 |
| `Completed post-auth workgroup refresh` | 认证后协作组刷新闭环完成 | Android | `android-app/app/src/main/java/com/claudecode/remote/service/RelayConnectionService.kt` | 到这里才算 auth 后的主要恢复链基本闭环 |

### Android 链路判定

如果你看到：

- 有 `Foreground session catalog refreshed`
- 但没有 `Requested project syncs after relay authentication`
- 或者有 `Failed to request project syncs on foreground`

那么更像是：

- transport 恢复了一部分
- 但项目详情补拉没有真正完成

优先关联文档：

- [消息、同步与更新故障排查清单](./message-sync-update-troubleshooting.md)
- [WebSocket 稳定性与恢复专项](./ws-stability-and-recovery-plan.md)

## 3. 桌面端 relay follow-up 链路

| 日志信号 | 典型现象 | 优先排查层 | 代码入口 | 说明 |
| --- | --- | --- | --- | --- |
| `Running relay follow-up refresh` | 桌面端已进入认证后补拉阶段 | local-agent | `local-agent/src/main.ts` | 这是桌面 follow-up 的执行起点 |
| `Requested active remote project sync` | 当前活跃远端项目正在补拉 | local-agent | `local-agent/src/main.ts` | 用于确认活跃项目没有被漏掉 |
| `Remote session snapshot updated` | 桌面端本地镜像已经更新 | local-agent | `local-agent/src/main.ts`, `local-agent/src/remote-session-store.ts` | 这条出现通常说明项目详情真正落到了桌面缓存 |
| `Completed relay follow-up refresh` | 一轮 follow-up 已收口 | local-agent | `local-agent/src/main.ts` | 要连同 `requestedActiveProjectSync` / `requestedActiveWorkgroupSync` 一起看 |
| `Reconnecting stalled socket during health-check` | 桌面端“看起来挂着”，但 transport 已僵死 | local-agent | `local-agent/src/main.ts` 及 RelayClient 相关实现 | 常见于 socket 已过期但 UI 还没完全感知 |
| relay close code 聚合异常 | 桌面端或移动端频繁掉线 | relay-server | `relay-server/handler/admin_ui.html` 以及 close signal 聚合逻辑 | 优先先看 relay 聚合，再回客户端日志 |

### 桌面链路判定

如果你看到：

- `Completed relay follow-up refresh`
- 且 `requestedActiveProjectSync=true`
- 但没有后续 `Remote session snapshot updated`

那么更像是：

- follow-up 已发起
- 但活跃项目快照并没有真正落地

优先关联文档：

- [WebSocket 加固联调核查模板](./ws-hardening-joint-verification-template.md)
- [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)

## 4. 消息发送与 accepted / 去重链路

| 日志信号 | 典型现象 | 优先排查层 | 代码入口 | 说明 |
| --- | --- | --- | --- | --- |
| `Accepted duplicate project message.send using existing trace` | 用户感觉消息“重复受理”或发送态怪异 | local-agent | `local-agent/src/message-router.ts` | 说明桌面端已经命中了去重保护 |
| `Error retrying pending send` | 手机端发送态转圈很久或反复重试 | Android | `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt` | 常用于判断是否卡在本地重试 |
| `Detected incomplete local sync` | 打开项目后聊天缺口明显 | Android | `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt` | 客户端发现本地序列不连续，准备强制补拉 |
| `Requesting sync backfill` | 某段消息正在回补 | Android | `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt` | 若这条后仍无数据，问题更可能在服务端返回或序列边界 |

### 消息链路判定

如果你看到：

- 手机已经进入发送态
- 桌面端命中 duplicate accepted
- 但用户仍说“没执行”

那么优先排查：

- 是否进入了错误对话
- 是否在项目队列里被前序任务阻塞
- 是否执行了但结果没回传到当前聊天页

优先关联文档：

- [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)
- [消息、同步与更新故障排查清单](./message-sync-update-troubleshooting.md)

## 5. 更新检查与版本重复提示链路

| 日志/接口信号 | 典型现象 | 优先排查层 | 代码入口 | 说明 |
| --- | --- | --- | --- | --- |
| `/api/update/check` 返回的 `latestVersion` 仍是旧版本 | 安装完还反复提示升级 | relay-server / client | `relay-server/handler/update.go`, `local-agent/src/update-manager.ts`, `android-app/app/src/main/java/com/claudecode/remote/update/AppUpdateManager.kt` | 先确认服务端返回，再看客户端缓存 |
| Android `versionName` 已改但 `versionCode` 未变 | 安卓提示逻辑混乱或安装后仍提示同版本 | Android build / relay-server | `android-app/app/build.gradle.kts` | 对 Android 来说 build 递增是硬要求 |
| `downloadUrl` 缺失或为空 | 检测到新版本但无法下载 | relay-server | `relay-server/handler/update.go` | 常见于发布记录不完整 |
| `silentUpdateInstall` 已开启但不安装 | 桌面端下载完后仍停留在等待状态 | local-agent | `local-agent/src/update-manager.ts`, `local-agent/src/main.ts` | 先看是否还有 running / queued task |

### 更新链路判定

如果你看到：

- `/api/update/check` 正常
- 但客户端仍反复提示旧版本

优先排查：

- 本地已安装版本缓存是否刷新
- Android `versionCode` 是否真的递增
- 桌面端是否仍在拿旧下载包文件名或旧状态

优先关联文档：

- [更新中心与发布说明](./release-and-update-center.md)
- [发布一致性检查模板](./release-consistency-checklist.md)

## 6. 建议回写模板

每次通过日志信号完成一次定位后，建议回写：

~~~text
signal:
symptom:
suspected layer:
confirmed layer:
code entry:
fix:
tests:
release impact:
~~~

## 7. 当前结论

后续线上排查时，可以先从这份映射表里把“信号 -> 现象 -> 代码入口”串起来，再去看专项设计或具体实现。这样能比“只看现象后直接全局搜代码”更快收敛。
