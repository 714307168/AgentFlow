# 信号到回滚与热修判断模板

更新时间：2026-04-20

这份模板用于把“日志里看到某个 `signal code`”进一步落成发布和运维联动动作：

- 先看哪个接口
- 先开哪个面板
- 先判断是不是线上配置或网络问题
- 什么时候该撤更新、回滚服务端，或者直接补热修版本

它适合和下面几份文档配合使用：

- [日志信号与诊断映射表](./log-signal-diagnostic-mapping.md)
- [运维视角信号修复模板](./ops-signal-remediation-template.md)
- [发布一致性检查模板](./release-consistency-checklist.md)
- [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)

## 1. 使用顺序

建议按下面顺序判断，不要一上来就拍脑袋回滚：

1. 在日志分析页确认 `signal code`、影响平台、影响版本和出现频次。
2. 先开对应接口或管理面板，确认是不是单点账号、单设备、单机房问题。
3. 再判断问题是运维处置、服务端回滚，还是客户端热修。
4. 真正执行撤更新或热修后，回写 release id、版本号、GitHub tag 和结论。

推荐判断顺序：

~~~text
signal code
  -> 先看 mobile logs / overview
  -> 再看 admin overview / releases / update check
  -> 判断影响范围
  -> 选择：观察 / 运维修复 / 撤更新 / 回滚服务端 / 补热修
~~~

## 2. 优先查看的面板与接口

### 2.1 日志与在线状态

- `/admin/api/mobile-logs/overview`
- `/admin/api/mobile-logs?signal_code=<code>`
- `/admin/api/overview`

优先看什么：

- 同一 `signal code` 是否集中在单一版本
- 是否集中在单一平台、单一 host、单一 trace id
- 当前对应 agent / device 是否在线
- `critical_count` 是否持续上升

### 2.2 更新与发布

- `/admin/releases`
- `/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=0.0.0&build=0`
- `/api/update/check?platform=android&channel=stable&arch=&version=0.0.0&build=0`

优先看什么：

- `latestVersion`、`build`、`downloadUrl` 是否正确
- 更新中心当前最新包是否真的是稳定版本
- release id、附件、版本号、说明是否一致
- 是否已经需要把问题版本从更新中心撤下

## 3. 决策分级

### A. 先观察，不立即发版

适用于：

- 单账号、单设备、弱网场景偶发
- 日志能说明 transport 抖动，但没有集中在新版本
- 用户重新登录、手动重连后即可恢复

### B. 运维或配置修复，不立即回滚

适用于：

- 鉴权、配置、代理、网络环境导致的集中异常
- 客户端主链路代码没变，但某个服务端配置或 token 生命周期变了
- 协作组成员不可用、调度配置缺失这类非客户端补丁问题

### C. 先撤更新，再补热修

适用于：

- 新版本集中出现闪退、无法登录、无法同步
- 更新后大量用户马上出现同类 `signal code`
- 已确认问题与特定客户端版本强相关

### D. 直接回滚 relay-server

适用于：

- 多端同时受影响
- `/admin/api/overview`、鉴权、更新接口、关键管理接口一起异常
- 问题在某次服务端部署后立刻出现

## 4. 信号代码到动作模板

| `signal code` | 先看接口/面板 | 先判断什么 | 建议动作 |
| --- | --- | --- | --- |
| `auth_recovery_failures` | `/admin/api/mobile-logs/overview`、`/admin/api/overview`、认证相关接口日志 | 是单账号 token 问题，还是新版本后大面积 auth 恢复失败 | 单账号先重新登录；集中在新客户端版本时先停更再补热修；集中在服务端鉴权变更后则优先回滚服务端或配置 |
| `foreground_recovery_follow_up_gaps` | `/admin/api/mobile-logs?signal_code=foreground_recovery_follow_up_gaps`、日志分析页 recovery panels | 是 catalog 后续没跟上，还是整体 relay 恢复没闭环 | 低频先观察；新版本集中出现则按客户端恢复链路热修；如果与 relay 抖动同时爆发，先排服务端或代理 |
| `foreground_project_sync_failures` | 日志分析页、项目 sync 相关接口日志、`/admin/api/overview` | 项目补拉有没有真正发出，是否只影响 Android 某版本 | 单项目或冷项目误判先运维排查；同一 Android 版本持续高频时建议停更并补客户端热修 |
| `foreground_workgroup_refresh_failures` | 日志分析页、协作组相关日志、`/admin/api/overview` | 只是协作组 refresh 断了，还是所有消息链路都断了 | 如果项目私聊正常，多半不是全局回滚级别；优先修协作组链路或服务端接口，再决定是否发热修 |
| `post_auth_project_sync_failures` | `/admin/api/mobile-logs?signal_code=post_auth_project_sync_failures`、认证后 sync 日志 | auth 后 catalog 成功但 project sync 没跟上，是否集中在新版本 | 集中于客户端新版本时优先热修；若所有端认证后都不补拉，则优先回滚服务端 |
| `post_auth_workgroup_refresh_failures` | 协作组 refresh 日志、`/admin/api/overview` | 是否只影响 workgroup 链路 | 可先运维止血；若同版本持续复现再补客户端或服务端修复 |
| `post_auth_sync_incomplete` | recovery panels、`/admin/api/mobile-logs/overview` | 是单链路缺失，还是 auth 后整段恢复都没闭环 | 多端一起出现优先查 relay-server；仅新客户端版本出现则先撤更新后热修 |
| `android_manual_reconnect_likely` | `/admin/api/mobile-logs/overview`、在线状态面板 | 是否弱网与移动网络切换导致，还是新版本恢复策略退化 | 仅弱网偶发不发版；集中在某 Android 版本则补恢复策略热修 |
| `desktop_auth_recovery_failures` | `/admin/api/mobile-logs?signal_code=desktop_auth_recovery_failures`、`/admin/api/overview` | 桌面端是否在新版本后大面积 auth 恢复失败 | 单机先清缓存或重登；同版本集中出现先撤桌面更新，再发 hotfix；多端同发则查服务端鉴权 |
| `desktop_catalog_refresh_gaps` | desktop follow-up 日志、`/admin/api/mobile-logs/overview` | catalog 有没有刷新，是否只有详情未更新 | 若只有桌面某版异常，优先桌面热修；若服务端目录接口也异常，则先回滚服务端 |
| `desktop_remote_snapshot_gaps` | 桌面快照日志、`/admin/api/overview` | follow-up 发起了但 snapshot 没落地，是否集中在新桌面版本 | 单版本集中出现时先停更桌面包并补热修；多版本同时异常则优先查服务端返回 |
| `desktop_resume_catchup_stalled` | desktop health-check 日志、连接热点面板 | 是 socket 假恢复，还是 follow-up 卡死 | 高比例集中于新桌面版本时建议桌面热修；若代理层 close code 异常激增则先排网络/代理 |
| `desktop_recovery_jitter` | close-code 聚合、`/admin/api/overview` | 是否代理、网络、主机环境抖动 | 不要直接回滚客户端；先看代理和网络，只有确认版本相关才发补丁 |
| `desktop_scheduled_workgroup_task_failures` | 调度日志、workgroup 任务面板、`/admin/api/overview` | 是任务配置错，还是执行链路代码坏了 | 单个协作组先运维修；新版本后广泛失败才考虑热修 |
| `desktop_scheduled_workgroup_task_config_gaps` | 调度配置、协作组配置面板 | 是否缺配置、缺公告、缺成员映射 | 这是运维/配置问题，不是回滚级别 |
| `desktop_scheduled_workgroup_task_dispatch_blocked` | 队列状态、执行器在线状态 | 是前序任务堵塞，还是分发器异常 | 先疏通队列和在线状态；若只是积压，不要急着发版 |
| `desktop_scheduled_workgroup_task_member_unavailable` | 成员在线状态、agent presence | 成员是否离线或失去授权 | 运维处理，不建议发版 |
| `desktop_scheduled_workgroup_task_dispatch_failures` | dispatch run 日志、`/admin/api/overview` | 是分发请求失败，还是执行结果没回传 | 如果某次服务端部署后集中出现，先回滚 relay-server；若仅新桌面版本失败，则桌面热修 |
| `desktop_scheduled_workgroup_task_repeat_failures` | retry 日志、workgroup 任务面板 | 是否同一任务反复失败且版本集中 | 新版本集中时先停更再热修；无版本集中时先查任务输入和依赖环境 |
| `desktop_scheduled_workgroup_task_stalled_after_dispatch` | dispatch run 明细、执行进程在线状态 | 已分发但迟迟无结果，是进程残留还是执行器逻辑卡死 | 先清执行器与残留进程；若新版本后普遍发生，桌面热修优先 |
| `desktop_scheduled_workgroup_task_reentry` | 调度日志、队列状态 | 是否重入保护失效 | 若影响先进先出或重复执行，集中在新版本则直接补桌面热修 |

## 5. 无明显 `signal code` 时的发布判断

有些发布事故不一定先体现在 `signal code`，但要和上面的决策一起看。

### 5.1 安装后还反复提示同一版本升级

先看：

- `/admin/releases`
- `/api/update/check`
- Android `versionName / versionCode`
- 桌面端 `package.json` 版本

判断：

- 如果更新接口还在返回旧的 `latestVersion` 或错误 build，先修更新中心记录
- 如果客户端本地版本号没真正变，更像构建或打包问题
- 如果已上传错误包，先撤问题版本，再补正确包

### 5.2 更新后闪退或无法启动

先看：

- 问题是否集中在新发版本
- 更新中心是否仍在继续下发问题包
- 是否所有用户都卡在同一版本

建议动作：

1. 立即撤更新中心问题版本
2. 保留或标记 GitHub Release 为已撤回
3. 再补热修版本，不要让更多用户继续下载

### 5.3 下载地址或附件异常

先看：

- `/api/update/check` 返回的 `downloadUrl`
- `/api/update/download/{id}`
- `/admin/releases` 中 release id、附件名、`sha256`

建议动作：

- 如果只是附件错传或路径错配，先修更新中心记录
- 如果错误包已对外可见，按撤回模板处理

## 6. 执行记录模板

~~~text
signal code:
platform:
affected version:
release id:
first bad build:
checked panels:
decision:
rollback needed:
hotfix needed:
owner:
notes:
~~~

## 7. 当前结论

后续看到 `signal code` 时，不再只停留在“知道哪里坏了”，而是直接落到“先看哪个接口、该不该撤更新、该不该回滚服务端、还是应该补热修版本”的统一判断流程。
