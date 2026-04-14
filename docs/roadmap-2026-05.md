# 2026-05 下一期规�?
## 0. 传输链路优化专项�?026-04-08�?
### 0.1 目标

在不打断现有桌面端、Android 端和 relay-server 通讯链路的前提下，把流量优化从“只做业务裁剪”升级为“缓存优�?+ 版本比对 + 增量拉取 + gzip 压缩”的组合方案�?
### 0.2 现状判断

- 聊天消息同步已经具备增量基础：`after_seq`、`known_items`、`content_md5`、`attachments_md5` 已经在线上链路中使用�?- 会话列表、项目列表、协作组列表仍然偏向整包覆盖，本地缓存有了，但“先比版本、没变不拉”的能力还不完整�?- relay-server 当前没有通用 JSON gzip 响应压缩，也没有�?gzip 请求体做统一解压�?- Android 日志上传目前仍然是明�?JSON 文本直传，压缩收益高�?
### 0.3 方案拆分

#### P0：低风险高收�?
1. relay-server 增加 JSON gzip 中间件�?2. Android 端日志上传改�?gzip request body�?3. relay-server 增加 gzip request body 解压兼容�?4. 保持文件下载、更新包下载、WebSocket 不进入这一轮压缩�?
发版节点�?- `desktop/app/server traffic optimization P0`

#### P1：缓存优先与版本比对

1. 为项目列表、协作组列表增加 `revision` / `meta` 接口�?2. App 启动、回前台、手动刷新时先读本地缓存，再只请求轻�?meta�?3. 版本未变化时直接复用本地列表；版本变化时只拉 delta�?4. 同步链路继续复用 single-flight，避免重复拉取�?
发版节点�?- `desktop/app/server traffic optimization P1`

#### P2：会话级精细化同�?
1. 为会话快照增�?`snapshot_revision` 或等价版本字段�?2. 聊天详情保持“本地快照先展示，后台只�?`after_seq` 之后变动”�?3. 大字段按需拉取，列表页不再默认带完整正文和大附件预览�?4. 仅对大体积快照类消息考虑 WebSocket 压缩，不压小包�?
发版节点�?- `desktop/app/server traffic optimization P2`

### 0.4 预期收益

- 首屏速度更稳，减少进入页面后的列表乱跳�?- 后台回前台时优先走缓存和轻量校验，不再频繁整包覆盖�?- 文本 JSON 流量明显下降，尤其是列表接口和日志上传�?- 继续保留现有增量同步和去重逻辑，不引入大范围协议破坏�?
### 0.5 当前进度

- `P0` 已完成第一批：relay-server JSON gzip、gzip request body 解压、Android 日志 gzip 上传�?- `P1` 已完成第二步：`/api/device/sync/meta`、稳�?`revision`、`/api/device/sync/delta` 已落地，Android 非强制同步会先比 revision，变化时优先按本地签名拉取项目增量而不是整包覆盖�?- `P1` 兼容兜底已补齐：�?relay 不支�?`sync/meta` �?`sync/delta` 时，Android 会自动缓存能力缺失并回退�?legacy 全量同步，不再反复打 404/405�?
## 1. 目标

下一期不再以“补点功能”为主，而是进入多端扩展阶段，但前提是继续守住当前已经稳定下来的消息链路、协作组链路和日志诊断链路�?
这一期建议围�?5 个主题推进：

1. `mac` 桌面端落地，补齐桌面双平台能力�?2. `iOS` 客户端立项，但先按“可上线能力”和“审核高风险能力”拆开做�?3. `微信小程序` 做轻量控制面，不追求一开始就�?Android 完全同构�?4. 建立统一的跨端文件传输能力，让桌面端本地文件可以发到 Android / iOS / 小程序�?5. 重构设置页，让连接、更新、日志、文件传输、任务、协作组配置都更清晰�?
## 2. 总体判断

### 2.1 推荐顺序

不建�?`mac / iOS / 小程序` 三条线同时全量开工。推荐顺序：

1. 先做 `mac`
2. 再做统一文件传输底座
3. 再做 `iOS MVP`
4. 最后做 `微信小程�?Lite`

原因�?
- `mac` 基于现有 `Electron` 桌面端演进，投入最小，收益最快�?- 文件传输�?Android / iOS / 小程序共同依赖的底座，应该先统一协议，再做客户端�?- `iOS` 存在明显审核风险，必须先收敛能力边界�?- `微信小程序` 适合做轻量入口，不适合作为第一优先级的主控制端�?
### 2.2 平台边界

建议把三类客户端定位拆开�?
- `Desktop Windows / macOS`：完整主控端，承担本�?CLI、任务调度、协作组虚拟 PM、文件源头和主要执行能力�?- `Android / iOS`：移动主客户端，承担消息、审批、文件收发、协作组、日志上传、运行状态查看�?- `微信小程序`：轻量副客户端，承担消息查看、状态查看、提醒确认、文件接收、快速回复，不承担完整实时控制和重型任务管理�?
## 3. 平台约束

### 3.1 mac �?
`mac` 端本质上不是新产品线，而是现有桌面端增加一套打包、签名、更新和权限适配�?
关键约束�?
- 需要补 `macOS` 打包产物�?- 需要补 `Developer ID` 签名�?`Notarization`�?- 需要校验自动更新在 `mac` 上的下载、安装、重启链路�?
官方参考：

- Apple notarization: <https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution>

### 3.2 iOS �?
截至 `2026-04-06`，Apple 当前 `App Store Review Guidelines` 里，`4.2.7` �?remote desktop / thin client 类应用仍然是高风险条款。对于“远程镜像某个软�?服务”的 App，审核限制明显高于普通消息类 App�?
这意味着�?
- `iOS` 不能默认按“安卓完全镜像版”规划�?- 如果目标�?`App Store` 正式上架，必须先收敛到“伴随型客户端”能力�?- 如果要保留完整远程控制能力，需要提前准�?`TestFlight / 内测 / 企业分发` 路线，不要把 App Store 首发当作本期刚性目标�?
建议�?iOS 分成两层�?
- `iOS Safe Track`
  - 消息查看与回�?  - 协作组查看与 @ 交互
  - 运行状态和任务结果查看
  - 文件接收、下载、预览、转�?  - 连接状态、日志上传、通知提醒
- `iOS Risk Track`
  - 强实时远程控�?  - 完整桌面镜像式能�?  - 复杂后台长连接恢�?  - 可能被判定为 thin client 的高风险能力

官方参考：

- Apple review guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- Apple BackgroundTasks: <https://developer.apple.com/documentation/backgroundtasks>

### 3.3 微信小程�?
微信小程序官方提供了文件上传、文件下载和 WebSocket 能力，但从平台形态看，它更适合作为“轻量消息与文件入口”，不适合作为长期前台实时控制终端�?
这一点建议作为明确边界：

- 可以做消息列表、聊天查看、快速回复、文件接收、运行状态查看�?- 可以做轻量指令触发，比如“重新连接”“重试同步”“运行预设任务”“@PM”�?- 不建议把它做成和 Android 一样的全量运行控制端�?- 不建议把复杂的多会话实时同步、长时后台保活、重型任务编排优先放到小程序上�?
这里对小程序定位的结论，主要基于官方能力面和平台运行形态做出的架构判断�?
官方参考：

- `wx.uploadFile`: <https://developers.weixin.qq.com/miniprogram/dev/api/network/upload/wx.uploadFile.html>
- `wx.downloadFile`: <https://developers.weixin.qq.com/miniprogram/dev/api/network/download/wx.downloadFile.html>
- `wx.connectSocket`: <https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/wx.connectSocket.html>

## 4. 统一文件传输方案

### 4.1 目标

支持桌面端本地文件发送到�?
- Android
- iOS
- 微信小程�?
并支持后续反向扩展：

- Android / iOS 上传文件到桌面端
- 小程序上传轻量文件到桌面�?
### 4.2 建议架构

不要继续把文件传输混在消息同步里直接塞大包。建议新增统一�?`transfer` 域�?
链路建议�?
1. 桌面端发�?`create transfer`
2. relay-server 返回 `transferId + upload ticket`
3. 桌面端把文件切片上传�?relay-server 的文件存储区
4. 服务端落库文件元信息
5. 服务端向目标会话投递一条轻�?`file message`
6. Android / iOS / 小程序按需拉取文件
7. 客户端完成下载后回传 `delivered / opened / failed`

### 4.3 数据模型

建议新增�?
- `file_transfers`
- `file_transfer_targets`
- `file_transfer_chunks`
- `file_transfer_receipts`

核心字段�?
- `transfer_id`
- `sender_device_id`
- `source_project_id`
- `target_type`
- `target_id`
- `file_name`
- `mime_type`
- `size_bytes`
- `sha256`
- `storage_key`
- `encryption_mode`
- `expires_at`
- `status`

### 4.4 能力边界

首期只做这几项：

- 单文件发�?- 图片 / 文本 / 压缩�?/ 常见文档预览信息
- 上传进度和下载进�?- 失败重试
- 文件过期时间
- 文件大小限制

二期再做�?
- 多文件批量发�?- 断点续传
- 文件夹打包发�?- 链接分享
- 桌面端拖拽发�?
### 4.5 安全要求

必须同时补上�?
- 文件大小上限
- 后缀�?MIME 白名�?- `sha256` 校验
- 上传超时与过期清�?- 存储配额
- 管理后台可审�?
如果继续强化隐私，再做：

- 会话级文件密�?- 接收端拉取后本地解密
- 服务端仅保存密文

## 5. 客户端规�?
### 5.1 mac �?
#### 目标

让现有桌面端稳定运行�?macOS，并进入统一更新中心�?
#### 范围

- 增加 `macOS` 构建产物
- 增加 `arm64 / universal` 策略
- 补齐自动更新检查与安装
- 适配日志目录、数据目录、权限提�?- 适配标题栏、托盘、窗口唤起和文件打开行为

#### 验收

- 首次安装可完成登录、连接、同步、聊天、协作组、任务调�?- 从更新中心可正常升级
- 应用重启后本地数据、任务和连接状态正常恢�?
### 5.2 iOS MVP

#### 目标

先上线“能用、能过审、能接住消息和文件”的移动 companion�?
#### 首期范围

- 登录与设备绑�?- 项目消息列表
- 项目聊天
- 协作组聊�?- 运行状态查�?- 文件接收与下�?- 日志上传
- 推送通知占位

#### 暂不承诺

- 完整桌面镜像式控�?- 全量后台长连接常�?- �?Android 完全同节奏的实时行为

#### 技术建�?
- 原生 `SwiftUI + Combine/async-await`
- 网络层尽量与 Android API 保持一份明确的 `OpenAPI / schema`
- 先共用现�?relay 协议，不�?iOS 首期引入新消息模�?
### 5.3 微信小程�?Lite

#### 目标

把它做成“开箱即用的轻量入口”�?
#### 首期范围

- 登录与设备识�?- 消息列表
- 项目聊天只读 + 快速回�?- 协作组消息查�?+ @PM
- 最近任务状�?- 文件消息接收与下�?- 一键重�?/ 一键刷�?
#### 不做

- 复杂设置
- 大规模本地缓�?- 重型任务配置编辑
- 完整诊断后台

#### 技术建�?
- 只做 Lite �?API 组合，不直接照搬 Android 仓库�?- UI 优先强调“快进来、快看、快回、快走�?
## 6. 设置页优化方�?
### 6.1 当前问题

当前设置页已经承载了太多内容�?
- 连接
- 项目
- 协作�?- 本地文件
- 日志
- 定时任务
- 更新
- 运行�?- 加密

功能都在，但入口过重，信息层级不够清晰�?
### 6.2 新结�?
建议把设置页重构�?6 个一级分组：

1. `连接与账号`
2. `项目与协作组`
3. `消息与文件`
4. `任务与自动化`
5. `更新与日志`
6. `高级设置`

### 6.3 首页摘要�?
进入设置默认先看到总览，而不是直接落到某个长表单�?
总览卡建议展示：

- 当前登录状�?- relay 连接状�?- 上次同步时间
- 当前在线设备�?- 最近日志上传状�?- 当前版本 / 最新版�?- 文件传输配额与最近失败数

### 6.4 关键交互优化

要补的交互：

- 所有保存动作分成“即时保存”和“显式应用�?- 高风险操作加确认和回滚提�?- 连接问题直接给操作按�?  - `重新连接`
  - `强制补拉`
  - `上传日志`
  - `打开日志目录`
- 设置项旁边直接显示影响范�?  - `仅本机`
  - `当前设备`
  - `所有客户端`

### 6.5 文件传输中心

设置页里新增 `传输中心`�?
- 最近上�?- 最近下�?- 失败重试
- 文件过期时间
- 存储占用
- 清理缓存

这会成为 Android / iOS / 小程序统一文件能力的桌面管理入口�?
## 7. 还要一起补的能�?
下一期除了三端和文件传输，建议顺手补 6 项基础能力�?
### 7.1 推送与提醒

- Android 真正打通消息提�?- iOS 预留 APNs
- 小程序补订阅消息策略

### 7.2 统一设备在线�?
- 每台设备明确 `online / idle / background / offline`
- 列表页直接展示在线来源和最后活跃时�?
### 7.3 会话搜索

- 项目消息搜索
- 协作组消息搜�?- 文件消息过滤

### 7.4 崩溃与异常上�?
- 桌面�?crash
- Android crash
- iOS crash
- 小程序错误上�?
### 7.5 API 版本�?
在进入多端后，必须开始对 relay API 做版本边界：

- `v1 mobile API`
- `v1 transfer API`
- `v1 workgroup API`

避免一个客户端升级把另一个客户端带崩�?
### 7.6 权限模型

文件传输和多端接入后，需要明确：

- 哪些设备能收文件
- 哪些项目能发文件
- 协作组是否允许共享文�?- 是否允许小程序下载敏感附�?
## 8. 分阶段开发建�?
### 阶段 A：多端底座收�?
目标�?
- 文件传输协议
- 设备在线态协�?- API 版本边界
- 设置页信息架构重�?
交付物：

- relay-server 新增 transfer �?- desktop 设置页新结构
- 多端统一 transfer schema

### 阶段 B：mac 端发�?
目标�?
- 完成 mac 打包、签名、notarization、更新接�?
交付物：

- `mac` 安装�?- 更新中心 `mac` 通道
- GitHub Release 附件

### 阶段 C：桌面到移动文件传输

目标�?
- 桌面文件�?Android
- 桌面文件�?iOS
- 桌面文件发小程序

交付物：

- 桌面传输中心
- Android 接收�?- iOS 接收�?- 小程序下载页

### 阶段 D：iOS MVP

目标�?
- 可上线的 companion 版本

交付物：

- 登录
- 消息
- 协作�?- 文件
- 日志上传

### 阶段 E：微信小程序 Lite

目标�?
- 轻量消息与文件入�?
交付物：

- 会话列表
- 聊天查看
- 快速回�?- 文件下载
- @PM

## 8.1 发布节点

为避�?roadmap 只记录开发项、不记录真实发版节奏，后续每个阶段都补一个明确发布节点：

- `R-desktop-patch`：桌面端稳定�?/ 设置�?/ 传输中心类改动，合并后走一次桌面端补丁发版，并记录更新中心版本号�?- `R-mobile-feature`：Android 文件接收、消息同步或更新链路的阶段性完成后，走一�?Android 发版，并同步记录版本号与 build�?- `R-multi-end`：涉及桌�?+ Android + relay-server 联动的完整链路落地后，补一次“三端对齐”发版节点，包含更新中心�?GitHub Release�?- `R-mac-first`：mac 首个可安装版本完成后，单独记�?`mac` 更新中心通道�?GitHub Release 附件上线时间�?
当前已发生的发布节点�?
- `2026-04-08`：桌面端 `1.1.119` 已发布到更新中心，对应设置页布局修复、项�?协作组表单整理、传输中心体验补强�?- `2026-04-08`：`R-multi-end` 已完成一轮三端对齐发布，桌面�?`1.1.120`、Android `1.2.14 (build 98)`、relay-server `2026.4.8 build 1` 已发布或登记到更新中心，对应设备项目列表 `delta` 同步、旧 relay 自动降级�?gzip 传输优化�?- `2026-04-08`：桌面端 `1.1.121` �?Android `1.2.15 (build 99)` 计划作为聊天视图补丁发版，补齐桌面活动列表只保留最�?30 条并固定到底、Android 聊天与活动面板进入即定位到最新一条�?
## 9. 建议优先�?
### P0

- relay-server 文件传输�?- 桌面端传输中�?- 设置页重�?- API 版本�?
### P1

- mac 打包与更�?- Android 文件接收
- iOS 项目脚手�?
### P2

- iOS MVP
- 小程�?Lite
- 推送与提醒

## 10. 风险与决�?
### 高风�?
- `iOS App Store` 审核风险
- 小程序实时控制体验不稳定
- 文件传输引入存储和带宽成�?
### 需要先定的决策

1. iOS 本期目标�?`App Store`，还是先 `TestFlight / 内测`
2. 文件存储是继续走 relay-server 本机磁盘，还是拆对象存储
3. 小程序是只做“查�?+ 快速回复”，还是要带完整聊天编辑和文件上�?4. mac 是否要求�?Windows 同步发版

## 11. 最终建�?
这一期最稳的打法不是“三端一起铺”，而是�?
1. 先把 `mac + 统一文件传输 + 设置页重构` 做完
2. `iOS` 先走 companion MVP，避开高审核风险能�?3. `微信小程序` 明确�?Lite，不追求�?Android 完全一�?
这样能在不打散现有主链路的情况下，把下一期真正做成“多端扩展”，而不是再次进入零散补丁模式�?## Progress Update 2026-04-07

- [x] Desktop settings information architecture refactor: overview / message / automation / advanced panes landed.
- [x] Desktop settings overview now exposes local runtime metrics for attachments, updates, history, and logs.
- [x] Relay server transfer MVP landed.
- [x] Relay transfer APIs now support upload / list / detail / download / receipt.
- [x] Relay transfer flow is covered by end-to-end Go tests.
- [x] Desktop transfer center now supports relay upload and recent transfer history in settings.
- [x] Android settings now include a transfer center with refresh / download / open actions.
- [x] Relay transfer APIs now support scoped filters and signed-in device discovery for richer targeting.
- [x] Desktop transfer center now supports device / project / workgroup targeting, scoped filters, and receipt details.
- [x] Android transfer center now shows project / workgroup scope, expiry, and receipt details.
- [x] Android project chat and workgroup chat now surface scoped transfer actions directly inside the conversation views.
- [x] Android transfer presentation helpers are split into reusable formatter utilities and covered by JVM unit tests.
- [x] Relay server now exposes protocol version metadata and rejects incompatible API version headers before request handling.
- [x] Desktop local agent, desktop WebSocket, Android Retrofit, Android WebSocket, and Android update downloads now all send a shared relay API version header set.
- [x] Relay `/api/devices` now exposes unified mobile presence state plus `last_active_at` / `last_seen_at` timestamps.
- [x] Desktop transfer center now renders mobile receiver presence and uses presence-aware device labels for targeting.

## Progress Update 2026-04-08

- [x] Desktop transfer center now supports one-click cleanup for attachment cache, update cache, or all transfer cache, and refreshes storage metrics immediately after cleanup.
- [x] Desktop transfer center now surfaces recent upload / download health, flags expired or failed transfers, and offers retry-send shortcuts with the same target scope.
- [x] Desktop `1.1.119` patch release was published to the update center for the latest settings layout and transfer-center UX fixes.
- [x] Desktop settings now use consistent risk confirmations plus recovery hints for destructive actions such as deleting projects, deleting workgroups, revoking access, and clearing local caches.
- [x] Desktop settings now show effect-scope pills for key options so users can distinguish local-only settings from current-device settings at a glance.
- [x] Desktop `1.1.121` and Android `1.2.15 (build 99)` were published to the update center for the chat/activity bottom-anchor patch.
- [x] Session sync payloads now carry a stable `snapshot_revision`, and Android skips redundant runtime snapshot rewrites when the session view has not materially changed.
- [x] Android and desktop remote sync now only request `fetch_item_detail` when omitted content or attachments cannot be reconstructed from the local cache, reducing duplicate detail backfills during overlap sync windows.
- [x] Session sync payloads now strip oversized attachment previews before trimming sync windows, and the desktop remote cache preserves existing inline previews when the relay only sends lightweight attachment metadata.
- [x] Desktop remote session store now consumes `snapshot_revision` to skip redundant runtime-state rewrites, and only emits chat snapshots when runtime fields or sync items materially change.
- [x] Android and desktop session-sync requests now send the client-known `snapshot_revision`, and the desktop runtime replies with `runtime_unchanged` plus incremental items when the session shell has not changed, further shrinking repeat sync payloads.
- [x] Android sync now fast-paths empty `session.sync` deltas and skips redundant Room transactions when neither runtime shell nor message sequence advanced.
- [x] Android project-sync dedupe keys now include the locally known `snapshot_revision`, so requests with different known runtime shells are no longer incorrectly coalesced into the same single-flight window.

## Progress Update 2026-04-10

- [x] Relay device logs `Connection Hotspots` now persist real co-occurring replay contexts (`signal + trace/workgroup/task/dispatch`) instead of composing filters from unrelated top IDs.
- [x] Device logs overview now exposes `Replay Hotspot Context` chips so hotspot jump-back filters replay an actually observed context group, reducing tie-break noise when top trace/task IDs come from different logs.
- [x] Device logs `Recovery Health` panels now also replay grouped `trace/workgroup/connection snapshot` contexts from the same observed logs, instead of stitching panel filters from unrelated top counters.
- [x] Relay hotspot replay-context selection is covered by a dedicated Go unit test to prevent regressions in grouped-context ranking.
- [x] Android `api/device/sync/delta` requests now also opt into gzip request-body compression, so large `knownProjects` payloads no longer go over the wire as plain JSON during foreground refresh and revision catch-up.
- [x] Android request-compression behavior is now covered by a dedicated JVM unit test, so future relay traffic optimizations can safely reuse the same gzip interceptor path as device-log uploads.
- [x] Android workgroup catalogs now keep a per-agent payload revision/hash cache and skip redundant `StateFlow` rewrites when a foreground refresh or reconnect returns the same workgroup payload again.
- [x] Desktop workgroup relay payloads now publish an explicit stable `revision`, and workgroup command results reuse the same revision so Android can skip redundant catalog refreshes without recomputing fallback hashes.
- [x] Android workgroup refresh requests now send the locally known per-agent `revision`, and desktop replies with an explicit `changed=false` lightweight payload when the catalog is unchanged, trimming repeated WebSocket list transfers during reconnect and foreground refresh.
- [x] Desktop now memoizes serialized workgroup catalogs and relay payloads between structure changes, so repeated list requests and UI lookups reuse the in-memory snapshot instead of reserializing the same workgroups on every read.
- [x] Workgroup collaboration sessions now carry a stable `snapshot_revision`, and Android / desktop remote clients send their known revision so unchanged session refreshes can return `snapshot_unchanged` payloads and skip redundant message-list rewrites.

## Progress Update 2026-04-11

- [x] Android foreground, reconnect, and manual-refresh entrypoints now use a lightweight session-shell sync plan instead of requesting message syncs for every project, prioritizing only running / queued / recently active sessions to reduce traffic and speed up list recovery.
- [x] Session-shell sync selection is split into a reusable planner utility and covered by a JVM unit test so later sync-policy changes can be adjusted without reworking `MessageRepository`.
- [x] Android chat auto-loading of older history is now blocked until the initial bottom anchor has been applied, preventing the first open / resume path from immediately prepending history and leaving the user in the middle of the conversation.
- [x] `R-mobile-feature`: Android `1.2.18 (build 102)` was published to the update center on `2026-04-11` for the session-shell sync and chat bottom-anchor recovery patch. Release id: `201`.
- [x] Desktop runtime queue execution now keeps strict FIFO order by local acceptance sequence instead of reordering queued runs by timestamp or `runId`, so older queued prompts no longer get jumped by newer ones when timestamps collide or an active run is interrupted.
- [x] Desktop runtime queue order is now covered by a dedicated Node test, including the interrupt-while-running path that previously inserted newer work at the front of the queue.
- [x] `R-desktop-patch`: desktop `1.1.124` was published to the update center on `2026-04-11` for the FIFO queue execution fix. Release id: `202`.
- [x] Desktop settings `Projects & Workgroups` pane now stretches the main content column to the available viewport height again, restoring inner scrolling so lower projects remain reachable instead of being clipped below the fold.
- [x] Desktop `1.1.125` was published to the update center on `2026-04-11` for the settings-pane scroll recovery patch. Release id: `203`.
- [x] Desktop `1.1.126` was published to the update center on `2026-04-11` for Codex slash/tool support, including `/tools`, `/search`, and Codex `--search` project settings sync. Release id: `204`.
- [x] Desktop runtime settings now probe local CLI provider availability for `Claude Code` and `OpenAI Codex`, exposing install/version status plus a manual refresh action before users bind projects to a missing provider runtime.
- [x] Desktop provider selectors now stay aligned with local CLI runtime availability across the default runtime, add-project flow, and per-project overrides, blocking new switches to missing providers while still showing legacy bindings that already point to an unavailable local runtime.
- [x] Desktop Codex workspace support now covers additional low-risk CLI entry points, including `/review`, `/features`, `/version`, `/completion`, and read-only `/mcp list|get` inspection from the in-app chat flow.
- [x] Desktop `1.1.127` was published to the update center on `2026-04-11` for the `Projects & Workgroups` pane scroll recovery patch, fixing the right-side content area that could still get clipped and stop scrolling to lower items. Release id: `205`.
- [x] Desktop `1.1.128` was published to the update center on `2026-04-11` for the Codex resume compatibility patch, fixing `codex exec resume` runs that incorrectly appended `--search` and failed before the session resumed. Release id: `206`.
- [x] Desktop settings `Projects & Workgroups` now expose a project-level Codex web-search toggle, so Codex projects can enable or disable future `--search` runs without relying on slash commands only.
- [x] Desktop UI-driven remote project list refreshes now share a short coalescing window, so repeated `getProjects({ refreshRemote: true })` calls from settings and workspace views no longer fan out into duplicate remote catalog and prioritized session-sync bursts.
- [x] Desktop settings `refreshProjectPaneData(true)` now reuses the project catalog fetched earlier in the same refresh pass before loading workgroups, avoiding a second immediate `getProjects({ refreshRemote: true })` call from the same settings refresh cycle.
- [x] Desktop settings `Messages & Files` pane now reuses the same message-pane load helper to fetch projects before workgroups and forces `skipProjectRefresh`, removing another duplicate `getProjects({ refreshRemote: ... })` call during transfer-center entry and refresh.
- [x] Desktop automation pane and scheduled-task loader now reuse the shared project catalog loader instead of issuing a second direct `getProjects({ refreshRemote: ... })`, so overview and automation settings refreshes no longer duplicate the project request before listing scheduled tasks.
- [x] Desktop overview pane now runs through a shared overview loader, fetching the project catalog once and then reusing it for workgroups plus scheduled tasks with `skipProjectRefresh`, reducing another layer of duplicate settings-page project refreshes.
- [x] Shared desktop settings pane loaders now propagate the same `force` flag to local-data, access-grant, relay-device, and relay-transfer refreshers, so explicit refresh flows no longer mix forced remote catalog reloads with stale cached side panels from the same pane visit.
- [x] Desktop transfer-center refresh paths now reuse a shared transfer-pane loader for relay devices plus transfer history, keeping the manual refresh button aligned with the message-pane bootstrap path and trimming another slice of duplicated settings refresh logic.
- [x] Desktop transfer-center filter and receipt toggles now share one filter-change helper for `sync fields + mark dirty + force refresh`, reducing another cluster of repeated event-handler code in the settings renderer.
- [x] Desktop transfer send/retry/manual-refresh paths now reuse a shared transfer-refresh request helper for `mark dirty + optional device refresh + force reload`, so transfer-center post-action refreshes no longer duplicate the same renderer-side state choreography.
- [x] Desktop completion-sound handling now covers remote project runs as well as local runtime completions, so a remote session finishing on the desktop side also triggers the same completion chime instead of staying silent.
- [x] `R-desktop-patch`: desktop `1.1.129` was published to the update center on `2026-04-13` for the unified completion-sound patch, so both local and remote project runs now play the same completion prompt on finish. Release id: `207`. GitHub Release: `v1.1.129`.

## Progress Update 2026-04-13

- [x] Desktop relay-device loading now uses a shared timed async cache in the main process, so repeated settings / transfer-center reads reuse the latest receiver list for a short window instead of re-requesting `/api/devices` on every pane visit.
- [x] Desktop relay-device caching now coalesces concurrent callers and drops stale in-flight results after config or login invalidation, avoiding duplicate relay requests and preventing old device payloads from being written back after the server target changes.
- [x] The relay-device cache policy is covered by dedicated Node tests for cache reuse, forced refresh, concurrent single-flight reuse, and stale-generation invalidation.
- [x] `R-desktop-patch`: desktop `1.1.130` was published to the update center on `2026-04-13` for the relay-device cache patch, reducing repeated `/api/devices` requests from settings and transfer-center refreshes. Release id: `208`. GitHub Release: `v1.1.130`.

## Progress Update 2026-04-14

- [x] Desktop runtime resolution now chooses a working local CLI when available, otherwise falls back to configured OpenAI / Anthropic API credentials without adding extra SDK dependencies.
- [x] Desktop Codex and Claude runtime probes now feed a cached main-process runtime selection path, and settings-page refresh can force a fresh CLI probe without waiting for the cache TTL.
- [x] Desktop now auto-detects the local CLI install source (`npm` / `brew` / `scoop` / `winget` when recognizable), recommends upgrades based on missing runtime capabilities, and can trigger a throttled automatic CLI self-upgrade before runs continue.
- [x] Codex command construction now adapts to the detected CLI capability set, dropping unsupported resume / web-search flags instead of sending incompatible arguments to older local CLIs.
- [x] Desktop runtime-selection, CLI-upgrade planning, and Codex CLI-compatibility paths are covered by dedicated Node tests to reduce regressions in future runtime iterations.
- [x] `R-desktop-patch`: desktop `1.1.132` was published to the update center on `2026-04-14` for the adaptive CLI / API fallback runtime patch. Release id: `212`. GitHub Release: `v1.1.132`.
- [x] Desktop runtime status cards now expose the effective runtime mode, API fallback readiness, install source, resolved CLI path, capability chips, and upgrade hints so runtime diagnostics no longer stop at a bare installed/missing badge.
- [x] Desktop provider selectors now treat API fallback as a valid runtime, so a provider with configured OpenAI / Anthropic credentials stays selectable even when the local CLI is missing; only truly unusable or degraded runtimes are blocked.
- [x] Desktop provider selectors and rejection copy now distinguish API fallback, missing CLI, and degraded local runtimes, so users no longer see stale Missing labels when a provider is still runnable through fallback.
- [x] `R-desktop-patch`: desktop `1.1.133` was published to the update center on `2026-04-14` for the runtime diagnostics and API-fallback-aware provider availability patch. Release id: `213`. GitHub Release: `v1.1.133`.
- [x] Desktop relay JSON POST requests now route through a shared helper that centralizes relay headers, body serialization, and automatic gzip compression for larger payloads instead of duplicating raw `fetch + JSON.stringify` logic across the main process.
- [x] Desktop relay JSON compression behavior is covered by dedicated Node tests, including the threshold gate plus gzip request-body generation for larger payloads such as diagnostics uploads and registry sync actions.
- [x] Desktop relay transfer-history requests now reuse a keyed timed async cache per normalized filter set, so repeated message-pane and transfer-center refreshes can reuse the latest matching list briefly instead of refetching the same `/api/transfers` query every time.
- [x] Desktop access-grant loading now uses a short-lived main-process cache and no longer triggers a follow-up remote project catalog refresh on every overview-pane read, trimming a redundant relay request chain from the settings overview path.
- [x] The keyed timed async cache behavior is covered by dedicated Node tests, including per-key TTL reuse, per-key force refresh, same-key single-flight coalescing, and targeted invalidation.

