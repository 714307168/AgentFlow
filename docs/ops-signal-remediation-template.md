# 运维视角信号修复模板

更新时间：2026-04-20

这份文档把日志分析页里的信号代码，进一步翻译成运维更容易直接执行的模板：

- 看到什么信号
- 用户通常会反馈什么现象
- 先做什么核查
- 再做什么修复动作
- 什么情况下只是运维处理，什么情况下需要补代码或发版

它和 [日志信号与诊断映射表](./log-signal-diagnostic-mapping.md) 的区别是：

- 映射表偏“信号 -> 代码入口”
- 这份模板偏“信号 -> 用户现象 -> 修复动作”

## 1. 使用方式

建议按下面顺序执行：

1. 在日志分析页定位 `signal code`
2. 对照这份模板确认用户可见现象
3. 先做最小运维核查
4. 再决定是运维修复、配置修复，还是需要代码补丁
5. 最后回写处理记录

## 2. Android 恢复链路信号

### `auth_recovery_failures`

用户常见现象：

- 安卓前后台回来后一直不同步
- 需要手动重连或重新登录
- 聊天页显示在线感不稳定

先做核查：

- 登录 token 是否过期
- 设备绑定是否异常
- relay-server 登录与刷新 token 接口是否正常

优先动作：

1. 确认服务端认证接口是否健康
2. 检查账号、设备、token 是否失效
3. 如只影响少量账号，先让用户重新登录
4. 如大面积出现，优先排查认证链路或最近鉴权变更

升级条件：

- 如果重新登录可恢复，先按运维事件处理
- 如果集中发生在新版本后，需要回到认证恢复代码和发版节点排查

### `foreground_recovery_follow_up_gaps`

用户常见现象：

- 回到前台后项目列表刷新了，但消息还是旧的
- 看起来恢复了连接，但聊天内容没补齐

先做核查：

- 是否出现 `Foreground session catalog refreshed`
- 后面有没有 project sync / workgroup refresh

优先动作：

1. 先确认 transport 恢复和 catalog 恢复是否都存在
2. 检查 foreground recovery 后续步骤是否缺失
3. 如缺的是 project sync，优先查项目补拉入口
4. 如缺的是 workgroup refresh，单独按协作组链路处理

升级条件：

- 如果只是偶发，可按日志聚类继续观察
- 如果持续高频，通常需要补恢复链路代码或增加守护逻辑

### `foreground_project_sync_failures`

用户常见现象：

- 列表有变化，但某个项目聊天没更新
- 进入项目后还停留在很早之前的消息

优先动作：

1. 检查项目补拉请求是否发出
2. 检查 `after_seq` 边界是否正确
3. 检查当前项目是否被错误判成冷项目

何时需要代码修复：

- 当 catalog 正常、项目补拉持续失败时，基本不是纯运维问题，通常需要代码补丁

### `foreground_workgroup_refresh_failures`

用户常见现象：

- 项目私聊正常，但协作组消息不刷新
- 协作组线程明显比项目聊天旧

优先动作：

1. 把项目链路和协作组链路分开看
2. 先确认项目 sync 是否已成功
3. 再单独看协作组 refresh 与 snapshot

## 3. Post-auth 恢复链路信号

### `post_auth_project_sync_failures`

用户常见现象：

- 登录恢复后目录有了，但具体项目消息没有接上

优先动作：

1. 确认 post-auth catalog 刷新成功
2. 看 post-auth 后 project sync 是否真的发出
3. 若缺失，优先查认证恢复后的补拉阶段

### `post_auth_workgroup_refresh_failures`

用户常见现象：

- 登录恢复后项目聊天恢复，协作组仍旧不刷新

优先动作：

1. 不要把它混成“整体恢复慢”
2. 直接按协作组 refresh 缺口处理

### `post_auth_sync_incomplete`

用户常见现象：

- 恢复后只有一部分状态回来了
- 需要再次切前后台、手动刷新，甚至重连

优先动作：

1. 把 post-auth 视为完整链路去看
2. 依次核对：
   - session catalog
   - project sync request
   - workgroup refresh

何时需要发版：

- 当这类信号在新版本后集中抬升，且人工重连只能临时缓解时，应进入补丁版本处理

### `android_manual_reconnect_likely`

用户常见现象：

- 用户反馈“必须手动重连才恢复”

优先动作：

1. 把它视为恢复链没有自动收口
2. 先排 auth / foreground / post-auth 三段是否断链
3. 若高频，优先进入恢复链稳定性修复而不是只做提示文案

## 4. 桌面端恢复链路信号

### `desktop_auth_recovery_failures`

用户常见现象：

- 桌面端一直重连
- 明明在线过，但很快又掉
- 手机端看桌面项目一直不稳定

优先动作：

1. 检查桌面 token 刷新
2. 检查 controller / agent 重新鉴权是否成功
3. 如认证恢复始终失败，先不要继续追后面的 catalog/snapshot 现象

### `desktop_catalog_refresh_gaps`

用户常见现象：

- 桌面端 transport 已恢复，但远端项目目录不刷新
- 协作组目录和远端项目目录缺一部分

优先动作：

1. 检查 follow-up refresh 后是否真的出现 project/workgroup catalog update
2. 如目录更新本身没落地，优先修 catalog 链路，不要先去查聊天页

### `desktop_remote_snapshot_gaps`

用户常见现象：

- 看起来已连接，但当前聊天窗口还是旧内容
- 活跃项目和活跃协作组只有目录更新，没有详情更新

优先动作：

1. 对照 active sync request 与 snapshot update
2. 如果 active sync 已请求但 snapshot 不落地，优先查 snapshot 构建和写入路径

### `desktop_resume_catchup_stalled`

用户常见现象：

- 桌面端恢复后像是“半恢复”
- 用户经常需要重启桌面端或手动断开重连

优先动作：

1. 把它当作桌面端的完整恢复链路问题
2. 按 auth recovery -> follow-up -> active sync -> snapshot 逐段排

### `desktop_recovery_jitter`

用户常见现象：

- 桌面端连接状态反复抖动
- 有时几分钟内多次 reconnect

优先动作：

1. 优先检查网络、代理、stale socket
2. 再检查 health-check 是否过于激进

## 5. 调度与协作组任务信号

这类信号多数不直接表现为“消息不同步”，而是表现为：

- 协作组任务没人接
- 任务重复排队
- 已派发但迟迟不结束

优先信号：

- `desktop_scheduled_workgroup_task_failures`
- `desktop_scheduled_workgroup_task_config_gaps`
- `desktop_scheduled_workgroup_task_dispatch_blocked`
- `desktop_scheduled_workgroup_task_member_unavailable`
- `desktop_scheduled_workgroup_task_dispatch_failures`
- `desktop_scheduled_workgroup_task_repeat_failures`
- `desktop_scheduled_workgroup_task_stalled_after_dispatch`
- `desktop_scheduled_workgroup_task_reentry`

统一优先动作：

1. 先看 taskId / dispatchRunId 是否唯一且可串联
2. 再看 assignee、project mapping、member online state
3. 再区分是配置缺口、派发阻塞，还是下游执行卡死

运维判断原则：

- 配置缺口优先修配置
- 成员不可用优先修在线状态和绑定关系
- 下游派发失败或 dispatched 后卡死，优先进入代码排查

## 6. 更新链路运维动作

### 当日志和接口都指向更新异常时

优先按这三层排：

1. 更新中心
   - `latestVersion`
   - `downloadUrl`
   - release id
2. 客户端本地版本
   - desktop 当前版本
   - Android `versionName / versionCode`
3. 构建产物
   - 文件名
   - SHA
   - 上传目标是否正确

最常见动作：

- 撤回问题版本
- 修正更新中心记录
- 补发热修版本

## 7. 运维处理记录模板

~~~text
signal code:
user symptom:
scope:
operator checks:
temporary mitigation:
final fix:
need patch release:
need doc update:
~~~

## 8. 当前结论

这份模板的重点不是替代代码排查，而是先把“用户反馈”翻译成“运维动作”。后续看到日志分析页 signal code 时，先从这份模板判断该不该立即修配置、重试恢复、撤回版本，还是直接进入代码补丁流程。
