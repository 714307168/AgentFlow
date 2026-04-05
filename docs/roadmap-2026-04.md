# 2026-04 开发计划

## 1. 目标

后续开发不再以零散修补为主，而是按以下顺序推进：

1. 先稳定通讯底座，解决桌面和安卓“断了以后难恢复、恢复后不同步、同步后界面乱跳”的问题。
2. 再稳定协作组和虚拟 PM，解决归属、并发、消息路由和存储边界问题。
3. 最后补定时任务和自动编排，把自动化能力建立在稳定链路之上。

## 2. 主要问题

- 安卓后台回来后经常无法自动刷新消息，需要杀进程或点登录。
- 桌面端更新、重启、断线后仍然需要手动重新连接。
- 发消息后的运行状态反馈慢，偶发重复执行、重复展示或迟迟不进入运行中。
- 协作组消息、私聊消息和消息列表入口边界还不够清晰。
- 虚拟 PM 的唯一性、`@PM` 触发链路和多协作组并发能力还不稳定。
- 线上缺少完整日志闭环，问题定位过度依赖复现。

## 3. 开发阶段

### 阶段一：通讯底座与同步恢复

目标：把“重连、恢复、补拉、状态反馈”收敛成统一机制。

范围：

- 建立统一连接状态模型：`connecting / connected / degraded / reconnecting / offline`
- 桌面端统一重连入口，按钮、启动、唤醒、解锁、网络恢复共用一套恢复流程
- 安卓前后台恢复统一走“重连 + 增量同步 + 当前会话补拉”
- 发送链路补 `clientMessageId / ack / retry / dedupe`
- 同步链路补 single-flight，避免重复拉取和乱序覆盖
- 打开聊天窗口时立即触发一次最新增量同步

阶段验收：

- 安卓后台较长时间后切回前台，不需要杀进程即可恢复同步
- 桌面端更新、重启后无需手动点重新连接
- 刷新按钮可以真正触发重连和补拉，而不是只刷新当前界面
- 同一条消息不重复运行、不重复展示

### 阶段二：协作组与虚拟 PM 稳定化

目标：把协作组从“能用”做成“可预期、可解释、可并发”。

范围：

- 协作组聊天记录独立存储，不再混入私聊
- 消息列表中新增协作组入口，桌面和安卓保持一致
- 虚拟 PM 固定运行在桌面宿主侧，不在服务端执行
- 每个协作组只允许一个有效 PM
- `@PM` 独立路由、独立状态反馈、独立失败说明
- 多协作组按组隔离排队，互不阻塞

阶段验收：

- 同一协作组不会再出现双 PM
- `@PM` 能明确看到触发、处理中、完成或失败
- 多个协作组同时活跃时不会相互阻塞

### 阶段三：日志与诊断能力

目标：建立问题排查闭环。

范围：

- 手机端日志收集、打包、上传
- 服务端日志接收、检索和基础分析
- 桌面 / 安卓 / 服务端统一 `traceId`
- 关键事件埋点：发送、ack、同步、重连、前后台恢复、补拉、失败重试

阶段验收：

- 能通过日志定位是发送失败、relay 投递失败、ack 丢失还是 UI 未落库
- 大部分同步问题不再依赖用户二次复现

### 阶段四：定时任务与自动编排

目标：在稳定通讯底座上补自动化能力。

范围：

- 桌面本地调度器
- 项目 / 协作组定时任务
- 一次性、延迟、每日、每周任务
- 任务结果进入现有聊天和活动流
- 安卓端仅做远程管理，不承担调度执行

阶段验收：

- 定时任务不会打断手动执行
- 定时任务失败可重试，但不会形成重试风暴

## 4. 当前冲刺

### 当前状态（2026-04-05）

- 阶段一完成度约 `92%`
- 阶段二完成度约 `92%`
- 阶段三完成度约 `100%`
- 阶段四完成度约 `86%`

### 已完成

- 桌面端“重新连接”已升级为“强制重连 + 强制同步补拉”
- 桌面端活动列表和聊天窗口默认保持在最新位置，并限制活动列表仅保留最近 30 条
- 安卓前后台恢复已补上 token 刷新、连接恢复和会话补拉
- 安卓消息页、协作组页、Agent 列表、协作组列表的刷新已补上重连恢复
- 安卓主聊天发送链路已补发送态保持、短窗口重复点击抑制和重复发送补偿
- 安卓主聊天和协作组聊天在打开窗口时都会立刻触发一次恢复与补拉
- 安卓项目聊天与协作组会话同步已补仓库层 single-flight，重复恢复入口会复用同一次 in-flight 请求
- 桌面已补 `message.accepted` 显式回执，安卓主聊天收到入队确认后会立刻结束发送等待并补拉最新会话
- 主聊天发送链路已补稳定 `clientMessageId`、超时单次自动重试，以及桌面按 `clientMessageId` 去重入队
- 协作组消息链路已补稳定 `clientMessageId`、仓库层单次自动重试，以及桌面按 `clientMessageId` 去重用户消息
- 协作组消息链路已补显式 accepted 回执，安卓收到 accepted 后可提前结束发送等待并继续依赖后续快照承接成员执行状态
- 协作组派发结果已补汇总说明：全部失败会明确提示无人接单，部分失败会提示 accepted / failed 数量
- 手机端日志收集、打包、上传链路已接通
- 安卓消息列表已按项目 / 协作组分区，顶部计数、卡片标签与刷新后的列表锚点已按会话类型收口
- 安卓项目同步的 sync bounds / known_items / prune 查询已排除 workgroup 残留消息，并在同步初始化时清扫旧 workgroup 行
- 桌面端已收口协作组 PM 唯一性：手工 `project_manager` 成员会自动降级，普通成员保存也不再允许占用虚拟 PM 角色，聊天输入已补 `@pm` 建议
- 桌面端已收口显式 mention 路由：`@PM` / `@member` 未命中时不再回退群发，并会把路由失败直接写入协作组线程
- 桌面端已补 workgroup 发送链路日志：用户消息受理、显式路由失败、成员 dispatch accepted / done / error、handoff 与 dispatch summary 现在都可追踪
- 桌面端已继续收口协作组 handoff 文案：未匹配、已处理跳过、部分命中都能在协作组线程内明确看到
- 桌面端已统一项目私聊与协作组消息回执的 `trace_id`：accepted / result / error 与本地 message-router 日志现在可共用同一追踪键
- 服务端 mobile logs 分析页已补 `trace_id` / `workgroup_id` 提取与筛选，管理员可按 workgroup 检索并从分析结果一键回查同链路日志
- 安卓端 mobile logs 上传已显式附带 `trace_id` / `workgroup_id` 元数据，服务端优先持久化并用于分析筛选，旧日志继续走内容提取兜底
- 服务端 mobile logs 分析页已补项目补拉缺口、协作组同步失败、发送重试/重复受理等诊断规则，定位“前后台回来不同步 / 协作组不刷新 / 发消息重试”时可直接聚类
- 安卓端已补 project send / workgroup send / message.accepted 命中 / timeout 重试 / queued-send 重连原因等关键埋点，日志现在可直接串起 clientMessageId 与连接恢复阶段
- 桌面端已把虚拟 PM 内部运行态从普通项目历史里隔离：不再写入 `runtime-history`，也不再经普通 `project-session-snapshot` 通道对外广播
- 桌面端已支持从设置页上传最近日志，上传前会先 flush 本地日志，再按 `source=desktop` 复用现有设备日志接口进入服务端分析闭环
- 服务端日志后台已从 mobile logs 扩展为 device logs，支持按 `source=android/desktop` 筛选
- 服务端日志分析已新增桌面端诊断规则：`desktop_relay_recovery_loops` / `desktop_dispatch_breaks`
- 桌面端已落地阶段四第一版最小链路：本地定时任务存储、轮询调度器、设置页管理入口和 `run now`
- 定时任务第一版已先支持本地项目 `once / daily` 两种调度方式，并复用现有 `runtimeManager.enqueueMessage(...)` 进入原聊天执行链路
- 定时任务执行结果已回流到现有项目聊天线程，任务列表会记录最近一次执行状态、错误信息和下一次计划时间
- 桌面端定时任务已继续扩到 `weekly`，设置页现在可以直接配置每周时间点
- 定时任务列表已补 `queued / running / success / error` 状态区分，不再把排队和执行中混在一起
- 桌面端定时任务已补 `delay` 类型，可直接配置“多少分钟后执行”
- 桌面端定时任务已补失败自动重试的第一版：支持配置最大重试次数和重试间隔，失败后会自动回补下一次执行计划
- 桌面端定时任务已补最近事件日志：任务列表可直接看到排队、启动、完成、失败与重试事件
- 定时任务失败链路已补 runId / retryCount / retryRunAt 等诊断字段，后续可以继续往服务端分析规则对接
- 服务端日志分析已接入桌面端定时任务诊断：`desktop_scheduled_task_failures` / `desktop_scheduled_task_retry_loops`
- 桌面端协作组任务已补第一版定时派发：设置页已开放任务面板，支持 `manual / once / delay / daily / weekly`，到点后会复用现有 `dispatchWorkgroupTask(...)` 自动派发给指定成员
- 安卓端已补协作组任务远程管理增强版：Agent 列表可直接进入任务管理页，支持查看任务、新建 / 编辑 / 删除任务、手动派发、更新任务状态，以及远程开关协作组定时任务
- 服务端日志分析已补协作组定时任务诊断：`desktop_scheduled_workgroup_task_failures` / `desktop_scheduled_workgroup_task_repeat_failures`
- 桌面端定时任务列表已补暂停 / 恢复、按当前筛选结果批量启停，以及失败 / 暂停 / 排队运行中的筛选视图
- 桌面端协作组定时任务日志已补任务级诊断字段：`assigneeMemberId / dispatchProjectId / dispatchRunId / scheduleEnabled / nextRunAt / lastDispatchAt`
- 服务端日志分析已把协作组定时任务失败细分为配置缺口、成员不可用、派发阻断、下游派发失败四类，可直接区分“任务没配好”和“任务已派发链路坏了”
- 服务端日志分析页已支持按 `task_id / dispatch_run_id` 直接筛选，列表、详情和分析面板都会暴露提取出的任务与运行 ID
- 服务端日志分析已补“协作组定时任务调度重入 / 派发后长时间无结果”聚类，能直接区分“重复触发了”和“已派发但后续没收口”
- 桌面端已补调度恢复日志：启动后把残留的 queued / running / assigned 任务收口成 error 时，会显式写出“stale in-flight state”恢复记录
- 服务端日志分析已补“桌面重启后调度残留未清理 / relay 恢复抖动”聚类，可直接看出是启动收口问题还是连接恢复反复震荡
- 安卓前后台恢复链路已补“开始 foreground recovery / foreground sync / session catalog refreshed / project sync requested / workgroup refresh completed”锚点，服务端可直接定位恢复后到底断在认证、catalog、补拉还是 workgroup 刷新
- 安卓认证恢复与 post-auth 同步链路已补显式锚点，服务端日志分析可新增聚类：`auth_recovery_failures` / `foreground_recovery_follow_up_gaps` / `post_auth_sync_incomplete`
- 桌面端 controller follow-up refresh 与 remote catalog 更新链路已补显式锚点，服务端日志分析可新增聚类：`desktop_auth_recovery_failures` / `desktop_catalog_refresh_gaps`
- 服务端日志分析页已补 URL 深链与一键回查：当前筛选和 `log_id` 会写入地址栏，`traceId / workgroupId / taskId / dispatchRunId` 可直接点进过滤后的诊断视图，便于分享和回放同一组日志上下文
- 桌面端已补 `Requested active remote project sync` / `Remote session snapshot updated` 锚点，服务端日志分析可继续区分“catalog 已更新”与“active project snapshot 仍未落下”的链路断点
- 服务端日志分析页已补 signal / example 快捷联动入口：可直接按 signal 标题或示例日志正文过滤，并从单条示例里抽取 `traceId / workgroupId / taskId / dispatchRunId` 一键回查，减少手工复制日志正文
- 服务端日志分析页已补当前筛选范围的 overview 统计：可聚合查看命中日志数、source 分布、Top signals，以及 `traceId / workgroupId / taskId / dispatchRunId` 热点；signal 快捷按钮也已改成真正按 `signal_code` 过滤日志
- 服务端日志分析已补“安卓后台恢复后仍需手动重连”和“桌面重连后传输恢复但活动态未恢复”两类复合 signal；overview 排序也已提高恢复链路问题的优先级，避免被高频 scheduler 噪音淹没
- 服务端日志分析页已把 desktop controller 恢复链路拆成 3 个稳定面板：`Auth Recovery / Catalog Refresh / Active Snapshot`，可直接看到每一段是 healthy / warning / critical，并继续按对应 signal 回查日志
- 服务端日志 overview 已补 panel 级别汇总：当前筛选范围可直接看到 `Auth Recovery / Catalog Refresh / Active Snapshot` 三段在命中日志里的总体健康度、critical/warning/healthy 数量，并继续按 signal 下钻
- 服务端日志分析页已补安卓恢复链路结构化面板：`Auth Recovery / Foreground Catalog / Project Sync / Workgroup Refresh`，并且 overview 也能聚合统计安卓这 4 段的总体健康度

### 进行中

- 基于真实上传日志继续补桌面 / 安卓恢复链路的诊断规则
- 基于真实上传日志继续补桌面 / 安卓恢复链路的诊断规则

### 下一刀

1. 结合真实上传日志，再补一轮桌面 / 安卓重连与补拉问题的分析规则
2. 结合真实故障日志再细化 signal 权重和排序阈值，减少单条高频 scheduler 日志把真正的恢复问题挤下去
3. 开始收敛阶段四，把日志诊断和客户端连接态观测串起来，减少只能靠上传日志定位的问题

## 5. 后续顺序

完成本轮后，建议按这个顺序继续：

1. 安卓前后台恢复链路
2. 出站消息 ack / retry / dedupe
3. 消息列表排序和滚动稳定性
4. 协作组入口和私聊隔离
5. PM 唯一性和 `@PM` 路由
6. 日志链路和服务端分析页
7. 定时任务第一版
