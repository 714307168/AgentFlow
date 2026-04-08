# 2026-05 下一期规划

## 1. 目标

下一期不再以“补点功能”为主，而是进入多端扩展阶段，但前提是继续守住当前已经稳定下来的消息链路、协作组链路和日志诊断链路。

这一期建议围绕 5 个主题推进：

1. `mac` 桌面端落地，补齐桌面双平台能力。
2. `iOS` 客户端立项，但先按“可上线能力”和“审核高风险能力”拆开做。
3. `微信小程序` 做轻量控制面，不追求一开始就和 Android 完全同构。
4. 建立统一的跨端文件传输能力，让桌面端本地文件可以发到 Android / iOS / 小程序。
5. 重构设置页，让连接、更新、日志、文件传输、任务、协作组配置都更清晰。

## 2. 总体判断

### 2.1 推荐顺序

不建议 `mac / iOS / 小程序` 三条线同时全量开工。推荐顺序：

1. 先做 `mac`
2. 再做统一文件传输底座
3. 再做 `iOS MVP`
4. 最后做 `微信小程序 Lite`

原因：

- `mac` 基于现有 `Electron` 桌面端演进，投入最小，收益最快。
- 文件传输是 Android / iOS / 小程序共同依赖的底座，应该先统一协议，再做客户端。
- `iOS` 存在明显审核风险，必须先收敛能力边界。
- `微信小程序` 适合做轻量入口，不适合作为第一优先级的主控制端。

### 2.2 平台边界

建议把三类客户端定位拆开：

- `Desktop Windows / macOS`：完整主控端，承担本地 CLI、任务调度、协作组虚拟 PM、文件源头和主要执行能力。
- `Android / iOS`：移动主客户端，承担消息、审批、文件收发、协作组、日志上传、运行状态查看。
- `微信小程序`：轻量副客户端，承担消息查看、状态查看、提醒确认、文件接收、快速回复，不承担完整实时控制和重型任务管理。

## 3. 平台约束

### 3.1 mac 端

`mac` 端本质上不是新产品线，而是现有桌面端增加一套打包、签名、更新和权限适配。

关键约束：

- 需要补 `macOS` 打包产物。
- 需要补 `Developer ID` 签名和 `Notarization`。
- 需要校验自动更新在 `mac` 上的下载、安装、重启链路。

官方参考：

- Apple notarization: <https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution>

### 3.2 iOS 端

截至 `2026-04-06`，Apple 当前 `App Store Review Guidelines` 里，`4.2.7` 对 remote desktop / thin client 类应用仍然是高风险条款。对于“远程镜像某个软件/服务”的 App，审核限制明显高于普通消息类 App。

这意味着：

- `iOS` 不能默认按“安卓完全镜像版”规划。
- 如果目标是 `App Store` 正式上架，必须先收敛到“伴随型客户端”能力。
- 如果要保留完整远程控制能力，需要提前准备 `TestFlight / 内测 / 企业分发` 路线，不要把 App Store 首发当作本期刚性目标。

建议把 iOS 分成两层：

- `iOS Safe Track`
  - 消息查看与回复
  - 协作组查看与 @ 交互
  - 运行状态和任务结果查看
  - 文件接收、下载、预览、转发
  - 连接状态、日志上传、通知提醒
- `iOS Risk Track`
  - 强实时远程控制
  - 完整桌面镜像式能力
  - 复杂后台长连接恢复
  - 可能被判定为 thin client 的高风险能力

官方参考：

- Apple review guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- Apple BackgroundTasks: <https://developer.apple.com/documentation/backgroundtasks>

### 3.3 微信小程序

微信小程序官方提供了文件上传、文件下载和 WebSocket 能力，但从平台形态看，它更适合作为“轻量消息与文件入口”，不适合作为长期前台实时控制终端。

这一点建议作为明确边界：

- 可以做消息列表、聊天查看、快速回复、文件接收、运行状态查看。
- 可以做轻量指令触发，比如“重新连接”“重试同步”“运行预设任务”“@PM”。
- 不建议把它做成和 Android 一样的全量运行控制端。
- 不建议把复杂的多会话实时同步、长时后台保活、重型任务编排优先放到小程序上。

这里对小程序定位的结论，主要基于官方能力面和平台运行形态做出的架构判断。

官方参考：

- `wx.uploadFile`: <https://developers.weixin.qq.com/miniprogram/dev/api/network/upload/wx.uploadFile.html>
- `wx.downloadFile`: <https://developers.weixin.qq.com/miniprogram/dev/api/network/download/wx.downloadFile.html>
- `wx.connectSocket`: <https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/wx.connectSocket.html>

## 4. 统一文件传输方案

### 4.1 目标

支持桌面端本地文件发送到：

- Android
- iOS
- 微信小程序

并支持后续反向扩展：

- Android / iOS 上传文件到桌面端
- 小程序上传轻量文件到桌面端

### 4.2 建议架构

不要继续把文件传输混在消息同步里直接塞大包。建议新增统一的 `transfer` 域。

链路建议：

1. 桌面端发起 `create transfer`
2. relay-server 返回 `transferId + upload ticket`
3. 桌面端把文件切片上传到 relay-server 的文件存储区
4. 服务端落库文件元信息
5. 服务端向目标会话投递一条轻量 `file message`
6. Android / iOS / 小程序按需拉取文件
7. 客户端完成下载后回传 `delivered / opened / failed`

### 4.3 数据模型

建议新增：

- `file_transfers`
- `file_transfer_targets`
- `file_transfer_chunks`
- `file_transfer_receipts`

核心字段：

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

- 单文件发送
- 图片 / 文本 / 压缩包 / 常见文档预览信息
- 上传进度和下载进度
- 失败重试
- 文件过期时间
- 文件大小限制

二期再做：

- 多文件批量发送
- 断点续传
- 文件夹打包发送
- 链接分享
- 桌面端拖拽发送

### 4.5 安全要求

必须同时补上：

- 文件大小上限
- 后缀与 MIME 白名单
- `sha256` 校验
- 上传超时与过期清理
- 存储配额
- 管理后台可审计

如果继续强化隐私，再做：

- 会话级文件密钥
- 接收端拉取后本地解密
- 服务端仅保存密文

## 5. 客户端规划

### 5.1 mac 端

#### 目标

让现有桌面端稳定运行在 macOS，并进入统一更新中心。

#### 范围

- 增加 `macOS` 构建产物
- 增加 `arm64 / universal` 策略
- 补齐自动更新检查与安装
- 适配日志目录、数据目录、权限提示
- 适配标题栏、托盘、窗口唤起和文件打开行为

#### 验收

- 首次安装可完成登录、连接、同步、聊天、协作组、任务调度
- 从更新中心可正常升级
- 应用重启后本地数据、任务和连接状态正常恢复

### 5.2 iOS MVP

#### 目标

先上线“能用、能过审、能接住消息和文件”的移动 companion。

#### 首期范围

- 登录与设备绑定
- 项目消息列表
- 项目聊天
- 协作组聊天
- 运行状态查看
- 文件接收与下载
- 日志上传
- 推送通知占位

#### 暂不承诺

- 完整桌面镜像式控制
- 全量后台长连接常驻
- 和 Android 完全同节奏的实时行为

#### 技术建议

- 原生 `SwiftUI + Combine/async-await`
- 网络层尽量与 Android API 保持一份明确的 `OpenAPI / schema`
- 先共用现有 relay 协议，不在 iOS 首期引入新消息模型

### 5.3 微信小程序 Lite

#### 目标

把它做成“开箱即用的轻量入口”。

#### 首期范围

- 登录与设备识别
- 消息列表
- 项目聊天只读 + 快速回复
- 协作组消息查看 + @PM
- 最近任务状态
- 文件消息接收与下载
- 一键重连 / 一键刷新

#### 不做

- 复杂设置
- 大规模本地缓存
- 重型任务配置编辑
- 完整诊断后台

#### 技术建议

- 只做 Lite 版 API 组合，不直接照搬 Android 仓库层
- UI 优先强调“快进来、快看、快回、快走”

## 6. 设置页优化方案

### 6.1 当前问题

当前设置页已经承载了太多内容：

- 连接
- 项目
- 协作组
- 本地文件
- 日志
- 定时任务
- 更新
- 运行时
- 加密

功能都在，但入口过重，信息层级不够清晰。

### 6.2 新结构

建议把设置页重构成 6 个一级分组：

1. `连接与账号`
2. `项目与协作组`
3. `消息与文件`
4. `任务与自动化`
5. `更新与日志`
6. `高级设置`

### 6.3 首页摘要卡

进入设置默认先看到总览，而不是直接落到某个长表单。

总览卡建议展示：

- 当前登录状态
- relay 连接状态
- 上次同步时间
- 当前在线设备数
- 最近日志上传状态
- 当前版本 / 最新版本
- 文件传输配额与最近失败数

### 6.4 关键交互优化

要补的交互：

- 所有保存动作分成“即时保存”和“显式应用”
- 高风险操作加确认和回滚提示
- 连接问题直接给操作按钮
  - `重新连接`
  - `强制补拉`
  - `上传日志`
  - `打开日志目录`
- 设置项旁边直接显示影响范围
  - `仅本机`
  - `当前设备`
  - `所有客户端`

### 6.5 文件传输中心

设置页里新增 `传输中心`：

- 最近上传
- 最近下载
- 失败重试
- 文件过期时间
- 存储占用
- 清理缓存

这会成为 Android / iOS / 小程序统一文件能力的桌面管理入口。

## 7. 还要一起补的能力

下一期除了三端和文件传输，建议顺手补 6 项基础能力：

### 7.1 推送与提醒

- Android 真正打通消息提醒
- iOS 预留 APNs
- 小程序补订阅消息策略

### 7.2 统一设备在线态

- 每台设备明确 `online / idle / background / offline`
- 列表页直接展示在线来源和最后活跃时间

### 7.3 会话搜索

- 项目消息搜索
- 协作组消息搜索
- 文件消息过滤

### 7.4 崩溃与异常上报

- 桌面端 crash
- Android crash
- iOS crash
- 小程序错误上报

### 7.5 API 版本化

在进入多端后，必须开始对 relay API 做版本边界：

- `v1 mobile API`
- `v1 transfer API`
- `v1 workgroup API`

避免一个客户端升级把另一个客户端带崩。

### 7.6 权限模型

文件传输和多端接入后，需要明确：

- 哪些设备能收文件
- 哪些项目能发文件
- 协作组是否允许共享文件
- 是否允许小程序下载敏感附件

## 8. 分阶段开发建议

### 阶段 A：多端底座收口

目标：

- 文件传输协议
- 设备在线态协议
- API 版本边界
- 设置页信息架构重组

交付物：

- relay-server 新增 transfer 域
- desktop 设置页新结构
- 多端统一 transfer schema

### 阶段 B：mac 端发布

目标：

- 完成 mac 打包、签名、notarization、更新接入

交付物：

- `mac` 安装包
- 更新中心 `mac` 通道
- GitHub Release 附件

### 阶段 C：桌面到移动文件传输

目标：

- 桌面文件发 Android
- 桌面文件发 iOS
- 桌面文件发小程序

交付物：

- 桌面传输中心
- Android 接收页
- iOS 接收页
- 小程序下载页

### 阶段 D：iOS MVP

目标：

- 可上线的 companion 版本

交付物：

- 登录
- 消息
- 协作组
- 文件
- 日志上传

### 阶段 E：微信小程序 Lite

目标：

- 轻量消息与文件入口

交付物：

- 会话列表
- 聊天查看
- 快速回复
- 文件下载
- @PM

## 8.1 发布节点

为避免 roadmap 只记录开发项、不记录真实发版节奏，后续每个阶段都补一个明确发布节点：

- `R-desktop-patch`：桌面端稳定性 / 设置页 / 传输中心类改动，合并后走一次桌面端补丁发版，并记录更新中心版本号。
- `R-mobile-feature`：Android 文件接收、消息同步或更新链路的阶段性完成后，走一次 Android 发版，并同步记录版本号与 build。
- `R-multi-end`：涉及桌面 + Android + relay-server 联动的完整链路落地后，补一次“三端对齐”发版节点，包含更新中心和 GitHub Release。
- `R-mac-first`：mac 首个可安装版本完成后，单独记录 `mac` 更新中心通道和 GitHub Release 附件上线时间。

当前已发生的发布节点：

- `2026-04-08`：桌面端 `1.1.119` 已发布到更新中心，对应设置页布局修复、项目/协作组表单整理、传输中心体验补强。

## 9. 建议优先级

### P0

- relay-server 文件传输域
- 桌面端传输中心
- 设置页重构
- API 版本化

### P1

- mac 打包与更新
- Android 文件接收
- iOS 项目脚手架

### P2

- iOS MVP
- 小程序 Lite
- 推送与提醒

## 10. 风险与决策

### 高风险

- `iOS App Store` 审核风险
- 小程序实时控制体验不稳定
- 文件传输引入存储和带宽成本

### 需要先定的决策

1. iOS 本期目标是 `App Store`，还是先 `TestFlight / 内测`
2. 文件存储是继续走 relay-server 本机磁盘，还是拆对象存储
3. 小程序是只做“查看 + 快速回复”，还是要带完整聊天编辑和文件上传
4. mac 是否要求和 Windows 同步发版

## 11. 最终建议

这一期最稳的打法不是“三端一起铺”，而是：

1. 先把 `mac + 统一文件传输 + 设置页重构` 做完
2. `iOS` 先走 companion MVP，避开高审核风险能力
3. `微信小程序` 明确做 Lite，不追求和 Android 完全一致

这样能在不打散现有主链路的情况下，把下一期真正做成“多端扩展”，而不是再次进入零散补丁模式。
## Progress Update 2026-04-07

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
