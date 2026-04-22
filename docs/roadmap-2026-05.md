# 2026-05 路线图总览

更新时间：2026-04-22

这份文档只保留当前真正还需要持续推进的主线、最近已经完成的节点，以及后续该看哪份细化文档。

旧版 `roadmap-2026-05.md` 同时塞了过多历史进度、专项设计和发版记录，已经不适合继续作为总览入口使用。后续原则是：

- 总览文档只负责回答“现在做到了哪一步、下一步做什么、对应哪份详细设计”。
- 细节设计拆到独立文档，避免路线图继续膨胀成大文件。
- 每次有代码或版本落地，只回写摘要进度和发版节点，不再把完整实现说明堆进总览。

## 1. 当前状态判断

项目当前已经不再是“先把基础链路跑起来”的阶段，而是进入了“稳定现有双端主链路，再逐步扩到多端”的阶段。

现状可以概括为：

- Windows 桌面端 + Android + relay-server 的主链路已经可用。
- 流量优化已经有 revision / meta / delta / after_seq / 本地缓存 / gzip 的组合基础。
- WebSocket 的第一阶段可观测性和恢复状态机已经补上，后续重点转向边缘代理与线上验证。
- 项目级授权主链路已经闭环，后续主要是继续压实细节和跨端一致性。
- 多端扩展还没有正式开工，但设计前置条件已经具备，适合开始按平台拆计划。

## 2. 已完成的主线

以下主线已经进入“已落地，后续只做补丁和验证”的状态：

- `R-project-scope-access`
  - relay-server `effective-scope`
  - 桌面端授权项目多选
  - Android 端 scope 裁切、缓存清理、详情入口守卫
- `R-traffic-control`
  - JSON gzip
  - device sync `meta / delta`
  - 会话增量同步
  - ACK / 背压
  - 冷项目降频与本地缓存优先
- `R-ws-observability`
  - 桌面端和 Android 端连接事件、close code、恢复原因诊断
  - relay-server close-code 聚合和代理层核查清单
- `R-provider-registry`
  - CLI / API fallback
  - provider registry
  - 本地命令 IPC gateway
- `R-message-transfer`
  - 图片和文件已并入消息时间线
  - capability layer 已有第一阶段抽象

对应细化文档：

- [WebSocket 稳定性与恢复专项](./ws-stability-and-recovery-plan.md)
- [Project Sync Signature 设计](./project-sync-signature-design.md)
- [受控授权远程协作设计](./controlled-remote-authorization.md)
- [项目级授权 MVP 实施方案](./project-scope-access-mvp.md)
- [跨端文件传输协议与回执验收清单](./transfer-protocol-and-receipt-checklist.md)
- [WebSocket 加固联调核查模板](./ws-hardening-joint-verification-template.md)
- [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)
- [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)
- [冷项目同步与项目签名验收清单](./cold-project-sync-acceptance.md)
- [消息、同步与更新故障排查清单](./message-sync-update-troubleshooting.md)
- [日志信号与诊断映射表](./log-signal-diagnostic-mapping.md)
- [运维视角信号修复模板](./ops-signal-remediation-template.md)
- [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)
- [发布事故回写模板](./release-incident-writeback-template.md)
- [发布回写模板](./release-writeback-template.md)
- [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- [跨端联动首发回写示例](./multi-end-first-release-writeback-examples.md)
- [平台首发摘要模板](./platform-first-release-summary-template.md)
- [平台首发后观察摘要模板](./platform-first-post-release-observation-template.md)
- [平台首发后边界推进回写示例](./platform-first-boundary-writeback-examples.md)
- [平台首发后风险与热修回写示例](./platform-first-risk-writeback-examples.md)
- [发版后持续观察记录模板](./release-post-release-observation-template.md)
- [热修发布摘要模板](./release-hotfix-summary-template.md)
- [版本观察结束结论模板](./release-observation-closure-template.md)
- [单端发版摘要模板](./single-end-release-summary-template.md)
- [单端热修观察结束结论模板](./single-end-hotfix-observation-closure-template.md)
- [发布节点回写示例](./release-roadmap-writeback-examples.md)
- [平台专项收口摘要模板](./platform-track-closure-summary-template.md)
- [平台专项路线图回写示例](./platform-track-roadmap-writeback-examples.md)
- [平台专项阶段切换回写示例](./platform-track-stage-transition-writeback-examples.md)
- [平台专项阶段完成短收口示例](./platform-track-stage-closure-writeback-examples.md)
- [平台专项阶段暂停与延后推进回写示例](./platform-track-pause-writeback-examples.md)
- [平台专项重新开启后的短回写示例](./platform-track-restart-writeback-examples.md)
- [平台专项并入新一轮计划的短回写示例](./platform-track-next-cycle-writeback-examples.md)
- [平台专项拆分成子阶段后的短回写示例](./platform-track-substage-writeback-examples.md)
- [平台专项转入常规维护后的短回写示例](./platform-track-maintenance-writeback-examples.md)
- [平台专项重新收窄边界后的短回写示例](./platform-track-rescope-writeback-examples.md)
- [平台专项从维护态重新升级为专项后的短回写示例](./platform-track-reupgrade-writeback-examples.md)
- [平台专项首发延期后的短回写示例](./platform-track-launch-delay-writeback-examples.md)
- [平台专项验收未通过后的短回写示例](./platform-track-acceptance-failure-writeback-examples.md)
- [平台专项多次延期后的短回写示例](./platform-track-multi-delay-writeback-examples.md)
- [平台专项验收通过但暂不首发的短回写示例](./platform-track-accepted-but-not-launching-writeback-examples.md)
- [平台专项首发窗口错过后的短回写示例](./platform-track-missed-launch-window-writeback-examples.md)
- [平台专项延期后重新进入首发准备的短回写示例](./platform-track-reenter-launch-prep-writeback-examples.md)
- [平台专项首发窗口临时前移后的短回写示例](./platform-track-launch-window-moved-up-writeback-examples.md)
- [平台专项重新进入首发准备后再次收窄边界的短回写示例](./platform-track-reenter-launch-prep-rescope-again-writeback-examples.md)

## 3. 当前仍在推进的主线

### P0：稳定性与发布可靠性

目标：先把线上最影响使用体验的问题收口，再推进新平台。

当前重点：

1. Android 启动、升级、恢复登录和本地加密存储兼容性继续压实。
2. WS 第二阶段继续做 relay-server / 反向代理 / 客户端联动验证，减少“已连接但未补齐”的假恢复。
3. 发布链路继续压实，保证更新中心、GitHub、版本号、构建产物和 release note 一致。

发版节点：

- `R-mobile-stability`
- `R-ws-hardening`
- `R-release-consistency`

### P1：同步精度和流量继续收口

目标：继续减少“没变化也参与同步”的无效流量。

当前重点：

1. 继续推进项目级 `project_signature + sync_bucket` 的落地和使用边界。
2. 活跃项目优先同步，冷项目继续下沉为低频检查。
3. 消息列表、活动列表、会话详情继续坚持“先缓存，后增量，按需补细节”。
4. 只在真正必要时才触发 detail backfill、历史翻页和大字段回补。

发版节点：

- `R-sync-precision`

详细设计：

- [Project Sync Signature 设计](./project-sync-signature-design.md)
- [WebSocket 加固联调核查模板](./ws-hardening-joint-verification-template.md)
- [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)
- [冷项目同步与项目签名验收清单](./cold-project-sync-acceptance.md)
- [消息、同步与更新故障排查清单](./message-sync-update-troubleshooting.md)
- [日志信号与诊断映射表](./log-signal-diagnostic-mapping.md)
- [运维视角信号修复模板](./ops-signal-remediation-template.md)
- [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)
- [发布事故回写模板](./release-incident-writeback-template.md)
- [发布回写模板](./release-writeback-template.md)
- [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- [跨端联动首发回写示例](./multi-end-first-release-writeback-examples.md)
- [平台首发摘要模板](./platform-first-release-summary-template.md)
- [平台首发后观察摘要模板](./platform-first-post-release-observation-template.md)
- [平台首发后边界推进回写示例](./platform-first-boundary-writeback-examples.md)
- [平台首发后风险与热修回写示例](./platform-first-risk-writeback-examples.md)
- [发版后持续观察记录模板](./release-post-release-observation-template.md)
- [热修发布摘要模板](./release-hotfix-summary-template.md)
- [版本观察结束结论模板](./release-observation-closure-template.md)
- [单端发版摘要模板](./single-end-release-summary-template.md)
- [单端热修观察结束结论模板](./single-end-hotfix-observation-closure-template.md)
- [发布节点回写示例](./release-roadmap-writeback-examples.md)
- [平台专项收口摘要模板](./platform-track-closure-summary-template.md)
- [平台专项阶段切换回写示例](./platform-track-stage-transition-writeback-examples.md)
- [平台专项阶段完成短收口示例](./platform-track-stage-closure-writeback-examples.md)
- [平台专项阶段暂停与延后推进回写示例](./platform-track-pause-writeback-examples.md)
- [平台专项重新开启后的短回写示例](./platform-track-restart-writeback-examples.md)
- [平台专项并入新一轮计划的短回写示例](./platform-track-next-cycle-writeback-examples.md)
- [平台专项拆分成子阶段后的短回写示例](./platform-track-substage-writeback-examples.md)
- [平台专项转入常规维护后的短回写示例](./platform-track-maintenance-writeback-examples.md)
- [平台专项重新收窄边界后的短回写示例](./platform-track-rescope-writeback-examples.md)
- [平台专项从维护态重新升级为专项后的短回写示例](./platform-track-reupgrade-writeback-examples.md)
- [平台专项首发延期后的短回写示例](./platform-track-launch-delay-writeback-examples.md)
- [平台专项验收未通过后的短回写示例](./platform-track-acceptance-failure-writeback-examples.md)
- [平台专项多次延期后的短回写示例](./platform-track-multi-delay-writeback-examples.md)
- [平台专项验收通过但暂不首发的短回写示例](./platform-track-accepted-but-not-launching-writeback-examples.md)
- [平台专项首发窗口错过后的短回写示例](./platform-track-missed-launch-window-writeback-examples.md)
- [平台专项延期后重新进入首发准备的短回写示例](./platform-track-reenter-launch-prep-writeback-examples.md)
- [平台专项首发窗口临时前移后的短回写示例](./platform-track-launch-window-moved-up-writeback-examples.md)
- [平台专项重新进入首发准备后再次收窄边界的短回写示例](./platform-track-reenter-launch-prep-rescope-again-writeback-examples.md)

### P2：多端扩展

目标：在不打散现有 Windows + Android 主链路的前提下，正式进入多端扩展阶段。

当前重点：

1. 先做 `mac` 桌面端，补齐双平台桌面能力。
2. 再继续做统一文件传输底座和跨端 capability 对齐。
3. `iOS` 先走 Safe Track，不按“安卓完全镜像版”规划。
4. `微信小程序` 先做 Lite 入口，不承担完整实时控制终端角色。
5. 设置页继续拆分，减少大文件和重复逻辑。

发版节点：

- `R-mac-first`
- `R-cross-end-transfer`
- `R-ios-safe-track`
- `R-mini-lite`
- `R-settings-restructure`

详细设计：

- [多端扩展计划](./platform-expansion-plan.md)
- [跨端文件传输协议与回执验收清单](./transfer-protocol-and-receipt-checklist.md)
- [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)

## 4. 最近进度与发版记录

### 2026-04-15

- `R-traffic-control` 已发布：
  - desktop `1.1.134`
  - Android `1.2.19 (build 103)`
  - relay-server 当前构建同步登记
  - 更新中心 release id：desktop `214`，Android `215`

### 2026-04-16

- `R-provider-registry` 和 `R-runtime-gateway` 已发布：
  - desktop `1.1.135`
  - 更新中心 release id：`216`
- `R-message-transfer` 和 `R-multi-end-capability` 已发布：
  - desktop `1.1.135`
  - Android `1.2.20 (build 104)`
  - relay-server `2026.4.16 build 1`
  - 更新中心 release id：desktop `216`，Android `217`

### 2026-04-19

- 桌面端运行时兼容性与环境自检本轮继续压实：
  - 新增桌面端 legacy Windows / Windows Server 安全启动模式，老环境会自动切到更保守的图形启动参数
  - 新增 Windows portable 打包入口，服务器环境可先绕开 NSIS 安装器验证主程序可运行性
  - 新增 provider runtime 自动维护：本地 CLI 有升级则自动升级，没有 CLI 时尝试通过 npm 国内镜像自动补装运行时
  - 新增 `npm run doctor` 环境自检入口，可直接输出本机运行条件、provider 可用性和自动维护准备状态

- Android 启动闪退修复已落地：
  - 修复点：加密偏好损坏恢复、前台服务启动异常保护
  - Android `1.2.24 (build 108)` 已发布到更新中心
  - 更新中心 release id：`225`
- 发布文档本轮继续收口：
  - 新增 [发布一致性检查模板](./release-consistency-checklist.md)
  - 补齐了更新中心、GitHub Release、本地版本号三者一致性核对入口
- 多端扩展配套文档本轮继续前推：
  - 新增 [mac 首发发布检查清单](./mac-first-release-checklist.md)
  - 新增 [多端首发验收模板](./multi-end-launch-acceptance-template.md)
  - 路线图里的文档缺口继续从“列计划”转成“有模板可直接执行”
- `iOS / 微信小程序` 规划文档继续落地：
  - 新增 [iOS Safe Track 规划](./ios-safe-track-plan.md)
  - 新增 [微信小程序 Lite 边界说明](./mini-program-lite-boundary.md)
  - 多端扩展入口继续从总览拆向按平台边界执行
- 统一传输、WS 加固和回滚模板本轮补齐：
  - 新增 [跨端文件传输协议与回执验收清单](./transfer-protocol-and-receipt-checklist.md)
  - 新增 [WebSocket 加固联调核查模板](./ws-hardening-joint-verification-template.md)
  - 新增 [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)
  - 路线图剩余文档缺口从“缺执行模板”进一步收口到“继续拆大文档和按版本回写”
- 链路说明与省流量验收入口本轮继续补齐：
  - 新增 [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)
  - 新增 [冷项目同步与项目签名验收清单](./cold-project-sync-acceptance.md)
  - 后续查消息链路和查同步流量时不再只回头翻总览或大设计文档
- 故障排查入口本轮继续补齐：
  - 新增 [消息、同步与更新故障排查清单](./message-sync-update-troubleshooting.md)
  - 常见线上问题现在可以先按症状定位，再进入对应专项文档或代码文件
- 日志信号映射入口本轮继续补齐：
  - 新增 [日志信号与诊断映射表](./log-signal-diagnostic-mapping.md)
  - 现在可以从 foreground/post-auth/follow-up/update 等关键日志直接映射到故障现象与代码入口
- 运维修复模板本轮继续补齐：
  - 新增 [运维视角信号修复模板](./ops-signal-remediation-template.md)
  - 现在可以从 signal code 直接落到用户现象、运维动作和是否需要补丁发版
- 发布与运维联动模板本轮继续补齐：
  - 新增 [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)
  - 现在可以从 signal code 继续落到优先查看接口/面板，以及该观察、撤更新、回滚服务端还是补热修
- 发布事故回写模板本轮继续补齐：
  - 新增 [发布事故回写模板](./release-incident-writeback-template.md)
  - 现在可以把更新中心字段、GitHub Release、客户端版本号和回滚动作统一回写，不再散落在多个地方
- 正常发版回写模板本轮继续补齐：
  - 新增 [发布回写模板](./release-writeback-template.md)
  - 现在正常发版后的版本号、release id、GitHub tag、测试与验收也有统一回写入口
- 多端联动发版摘要模板本轮继续补齐：
  - 新增 [多端联动发版摘要模板](./multi-end-release-summary-template.md)
  - 现在多端联动发布后可以把最终对外结论单独抽成轻量摘要，不再把完整验收内容塞回总览
- 平台首发摘要模板本轮继续补齐：
  - 新增 [平台首发摘要模板](./platform-first-release-summary-template.md)
  - 现在 `mac / iOS / 小程序` 这类首发节点也可以把首发范围、边界和后续动作单独抽成摘要
- 发版后持续观察模板本轮继续补齐：
  - 新增 [发版后持续观察记录模板](./release-post-release-observation-template.md)
  - 现在发布后 `30 分钟 / 2 小时 / 24 小时` 的观察结论也有统一记录入口
- 热修发布摘要模板本轮继续补齐：
  - 新增 [热修发布摘要模板](./release-hotfix-summary-template.md)
  - 现在热修版本也可以把替换关系、release id、用户动作和观察状态单独抽成摘要
- 版本观察结束结论模板本轮继续补齐：
  - 新增 [版本观察结束结论模板](./release-observation-closure-template.md)
  - 现在观察期结束时也可以把最终结论、用户动作和团队动作单独抽成轻量记录
- 单端发版摘要模板本轮继续补齐：
  - 新增 [单端发版摘要模板](./single-end-release-summary-template.md)
  - 现在只发 desktop 或只发 Android 时也可以把版本、release id、用户动作和最终结论单独抽成摘要
- 单端热修观察结束结论模板本轮继续补齐：
  - 新增 [单端热修观察结束结论模板](./single-end-hotfix-observation-closure-template.md)
  - 现在单端热修在观察结束时也可以把最终结论、用户动作和团队动作单独抽成轻量记录
- 发布节点回写示例本轮继续补齐：
  - 新增 [发布节点回写示例](./release-roadmap-writeback-examples.md)
  - 现在路线图回写时可以直接套用短样例，不再每次临时组织发布摘要措辞
- 平台专项收口摘要模板本轮继续补齐：
  - 新增 [平台专项收口摘要模板](./platform-track-closure-summary-template.md)
  - 现在 `mac / iOS / 小程序` 这类平台专项节点也可以把阶段结论和下一步动作单独收口
- 平台专项路线图回写示例本轮继续补齐：
  - 新增 [平台专项路线图回写示例](./platform-track-roadmap-writeback-examples.md)
  - 现在平台专项收口后的路线图回写也有短样例可直接复用，不再只能在总览里临时组织措辞
- 平台首发后观察摘要模板本轮继续补齐：
  - 新增 [平台首发后观察摘要模板](./platform-first-post-release-observation-template.md)
  - 现在平台首次上线后的观察结论也能先抽成轻量摘要，再决定是否结束观察或继续稳边界
- 平台首发后边界推进回写示例本轮继续补齐：
  - 新增 [平台首发后边界推进回写示例](./platform-first-boundary-writeback-examples.md)
  - 现在平台首发后是继续扩边界还是延后扩边界，也能直接复用短样例回写到路线图
- 平台首发后风险与热修回写示例本轮继续补齐：
  - 新增 [平台首发后风险与热修回写示例](./platform-first-risk-writeback-examples.md)
  - 现在平台首发后如果出现风险、准备热修或先收口，也能直接复用短样例回写到路线图
- 跨端联动首发回写示例本轮继续补齐：
  - 新增 [跨端联动首发回写示例](./multi-end-first-release-writeback-examples.md)
  - 现在多端或跨端联动首发节点也能直接复用短样例回写到路线图，不再临时组织首发结论措辞
- 平台专项阶段切换回写示例本轮继续补齐：
  - 新增 [平台专项阶段切换回写示例](./platform-track-stage-transition-writeback-examples.md)
  - 现在平台专项从规划、收口、验收到首发观察的阶段变化，也能直接复用短样例回写到路线图
- 平台专项阶段完成短收口示例本轮继续补齐：
  - 新增 [平台专项阶段完成短收口示例](./platform-track-stage-closure-writeback-examples.md)
  - 现在平台专项某一阶段完成后的结论、延后范围和下一步动作，也能直接复用短样例回写到路线图
- 平台专项阶段暂停与延后推进回写示例本轮继续补齐：
  - 新增 [平台专项阶段暂停与延后推进回写示例](./platform-track-pause-writeback-examples.md)
  - 现在平台专项因风险、依赖或优先级变化而暂停时，也能直接复用短样例回写到路线图
- 平台专项重新开启后的短回写示例本轮继续补齐：
  - 新增 [平台专项重新开启后的短回写示例](./platform-track-restart-writeback-examples.md)
  - 现在平台专项从暂停、延后或降级状态恢复推进时，也能直接复用短样例回写到路线图
- 平台专项并入新一轮计划的短回写示例本轮继续补齐：
  - 新增 [平台专项并入新一轮计划的短回写示例](./platform-track-next-cycle-writeback-examples.md)
  - 现在平台专项不单独继续展开、而是并入下一轮计划时，也能直接复用短样例回写到路线图
- 平台专项拆分成子阶段后的短回写示例本轮继续补齐：
  - 新增 [平台专项拆分成子阶段后的短回写示例](./platform-track-substage-writeback-examples.md)
  - 现在平台专项拆成“先稳主链路、再补边界、最后做观察或维护”这类子阶段时，也能直接复用短样例回写到路线图
- 平台专项转入常规维护后的短回写示例本轮继续补齐：
  - 新增 [平台专项转入常规维护后的短回写示例](./platform-track-maintenance-writeback-examples.md)
  - 现在平台专项从专项推进态切到常规维护态时，也能直接复用短样例回写到路线图
- 平台专项重新收窄边界后的短回写示例本轮继续补齐：
  - 新增 [平台专项重新收窄边界后的短回写示例](./platform-track-rescope-writeback-examples.md)
  - 现在平台专项为了稳主链路、控风险或压范围而主动收窄边界时，也能直接复用短样例回写到路线图
- 平台专项从维护态重新升级为专项后的短回写示例本轮继续补齐：
  - 新增 [平台专项从维护态重新升级为专项后的短回写示例](./platform-track-reupgrade-writeback-examples.md)
  - 现在平台专项从常规维护态重新单列推进时，也能直接复用短样例回写到路线图
- 平台专项首发延期后的短回写示例本轮继续补齐：
  - 新增 [平台专项首发延期后的短回写示例](./platform-track-launch-delay-writeback-examples.md)
  - 现在平台专项在接近首发但因链路、审核、依赖或风险问题需要延期时，也能直接复用短样例回写到路线图
- 平台专项验收未通过后的短回写示例本轮继续补齐：
  - 新增 [平台专项验收未通过后的短回写示例](./platform-track-acceptance-failure-writeback-examples.md)
  - 现在平台专项在验收阶段被打回、需要退回补问题时，也能直接复用短样例回写到路线图
- 平台专项多次延期后的短回写示例本轮继续补齐：
  - 新增 [平台专项多次延期后的短回写示例](./platform-track-multi-delay-writeback-examples.md)
  - 现在平台专项连续多轮顺延首发时，也能直接复用短样例回写到路线图
- 平台专项验收通过但暂不首发的短回写示例本轮继续补齐：
  - 新增 [平台专项验收通过但暂不首发的短回写示例](./platform-track-accepted-but-not-launching-writeback-examples.md)
  - 现在平台专项已经过线、但因节奏或风险控制暂不首发时，也能直接复用短样例回写到路线图
- 平台专项首发窗口错过后的短回写示例本轮继续补齐：
  - 新增 [平台专项首发窗口错过后的短回写示例](./platform-track-missed-launch-window-writeback-examples.md)
  - 现在平台专项明确错过原定首发窗口时，也能直接复用短样例回写到路线图
- 平台专项延期后重新进入首发准备的短回写示例本轮继续补齐：
  - 新增 [平台专项延期后重新进入首发准备的短回写示例](./platform-track-reenter-launch-prep-writeback-examples.md)
  - 现在平台专项从延期态重新回到首发准备节奏时，也能直接复用短样例回写到路线图
- 平台专项首发窗口临时前移后的短回写示例本轮继续补齐：
  - 新增 [平台专项首发窗口临时前移后的短回写示例](./platform-track-launch-window-moved-up-writeback-examples.md)
  - 现在平台专项需要把原定首发窗口提前时，也能直接复用短样例回写到路线图
- 平台专项重新进入首发准备后再次收窄边界的短回写示例本轮继续补齐：
  - 新增 [平台专项重新进入首发准备后再次收窄边界的短回写示例](./platform-track-reenter-launch-prep-rescope-again-writeback-examples.md)
  - 现在平台专项重回准备后又要二次缩范围时，也能直接复用短样例回写到路线图

### 2026-04-22

- `R-project-scope-access` 服务端回归继续压实：
  - 修复 `device sync delta` 在 `since_revision` 已匹配时仍可能遗漏客户端陈旧项目移除的问题
  - 新增项目级授权下 full-sync / delta 一致性回归测试
  - 新增 matching revision + stale known projects 清理回归测试，避免 scope 收缩后残留旧项目

### 2026-04-23

- `R-project-scope-access` Android 本地授权边界继续压实：
  - 收紧 cached scope 判断，显式项目授权下不再放行 blank / unknown agent 的聊天路由
  - 补齐旧深链 / 旧缓存页越权打开回归测试
  - 补齐未知 agent 缓存会话剔除回归测试，避免 scope 收缩后残留陈旧项目
- `R-project-scope-access` Android 本地清理路径继续收口：
  - 统一 full sync / delta sync / scope prune 的项目移除清理逻辑
  - 项目被移除时，同步清理本地 draft 和 chat snapshot，避免会话记录删掉后仍残留旧输入或旧聊天快照
  - 补齐 replacement / delta remove 纯函数回归测试，压实撤销授权后的本地缓存收缩行为

## 5. 文档拆分入口

后续不要再把所有计划继续堆回这一份总览。

当前建议直接从这里分流：

- 同步和省流量： [Project Sync Signature 设计](./project-sync-signature-design.md)
- 冷项目验收： [冷项目同步与项目签名验收清单](./cold-project-sync-acceptance.md)
- 综合排查： [消息、同步与更新故障排查清单](./message-sync-update-troubleshooting.md)
- 日志诊断： [日志信号与诊断映射表](./log-signal-diagnostic-mapping.md)
- 运维修复： [运维视角信号修复模板](./ops-signal-remediation-template.md)
- 发版判断： [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)
- 事故回写： [发布事故回写模板](./release-incident-writeback-template.md)
- 发版回写： [发布回写模板](./release-writeback-template.md)
- 联动发版摘要： [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- 联动首发回写示例： [跨端联动首发回写示例](./multi-end-first-release-writeback-examples.md)
- 平台首发摘要： [平台首发摘要模板](./platform-first-release-summary-template.md)
- 平台首发后观察： [平台首发后观察摘要模板](./platform-first-post-release-observation-template.md)
- 平台首发后边界推进： [平台首发后边界推进回写示例](./platform-first-boundary-writeback-examples.md)
- 平台首发后风险处理： [平台首发后风险与热修回写示例](./platform-first-risk-writeback-examples.md)
- 发版后观察： [发版后持续观察记录模板](./release-post-release-observation-template.md)
- 热修发布摘要： [热修发布摘要模板](./release-hotfix-summary-template.md)
- 观察结束结论： [版本观察结束结论模板](./release-observation-closure-template.md)
- 单端发版摘要： [单端发版摘要模板](./single-end-release-summary-template.md)
- 单端热修观察结束： [单端热修观察结束结论模板](./single-end-hotfix-observation-closure-template.md)
- 路线图回写示例： [发布节点回写示例](./release-roadmap-writeback-examples.md)
- 平台专项收口： [平台专项收口摘要模板](./platform-track-closure-summary-template.md)
- 平台专项回写示例： [平台专项路线图回写示例](./platform-track-roadmap-writeback-examples.md)
- 平台专项阶段切换： [平台专项阶段切换回写示例](./platform-track-stage-transition-writeback-examples.md)
- 平台专项阶段完成： [平台专项阶段完成短收口示例](./platform-track-stage-closure-writeback-examples.md)
- 平台专项阶段暂停： [平台专项阶段暂停与延后推进回写示例](./platform-track-pause-writeback-examples.md)
- 平台专项重新开启： [平台专项重新开启后的短回写示例](./platform-track-restart-writeback-examples.md)
- 平台专项并入下一轮： [平台专项并入新一轮计划的短回写示例](./platform-track-next-cycle-writeback-examples.md)
- 平台专项拆分子阶段： [平台专项拆分成子阶段后的短回写示例](./platform-track-substage-writeback-examples.md)
- 平台专项转常规维护： [平台专项转入常规维护后的短回写示例](./platform-track-maintenance-writeback-examples.md)
- 平台专项重新收窄边界： [平台专项重新收窄边界后的短回写示例](./platform-track-rescope-writeback-examples.md)
- 平台专项维护态升级： [平台专项从维护态重新升级为专项后的短回写示例](./platform-track-reupgrade-writeback-examples.md)
- 平台专项首发延期： [平台专项首发延期后的短回写示例](./platform-track-launch-delay-writeback-examples.md)
- 平台专项验收未通过： [平台专项验收未通过后的短回写示例](./platform-track-acceptance-failure-writeback-examples.md)
- 平台专项多次延期： [平台专项多次延期后的短回写示例](./platform-track-multi-delay-writeback-examples.md)
- 平台专项验收通过未首发： [平台专项验收通过但暂不首发的短回写示例](./platform-track-accepted-but-not-launching-writeback-examples.md)
- 平台专项错过首发窗口： [平台专项首发窗口错过后的短回写示例](./platform-track-missed-launch-window-writeback-examples.md)
- 平台专项重新进入首发准备： [平台专项延期后重新进入首发准备的短回写示例](./platform-track-reenter-launch-prep-writeback-examples.md)
- 平台专项首发窗口临时前移： [平台专项首发窗口临时前移后的短回写示例](./platform-track-launch-window-moved-up-writeback-examples.md)
- 平台专项重回准备后再次收窄边界： [平台专项重新进入首发准备后再次收窄边界的短回写示例](./platform-track-reenter-launch-prep-rescope-again-writeback-examples.md)
- WS 稳定性： [WebSocket 稳定性与恢复专项](./ws-stability-and-recovery-plan.md)
- WS 联调执行： [WebSocket 加固联调核查模板](./ws-hardening-joint-verification-template.md)
- 授权和受控远程协作： [受控授权远程协作设计](./controlled-remote-authorization.md)
- 项目级授权实施： [项目级授权 MVP 实施方案](./project-scope-access-mvp.md)
- 执行链路： [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)
- 多端扩展： [多端扩展计划](./platform-expansion-plan.md)
- 跨端传输： [跨端文件传输协议与回执验收清单](./transfer-protocol-and-receipt-checklist.md)
- 发布和更新中心： [更新中心与发布说明](./release-and-update-center.md)
- 发布止损： [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)

### 本轮代码回写 2026-04-22

- `R-sync-precision` 本轮继续落代码，不是只补文档。
- Android 端已把冷项目 / dormant 项目的后台 shell sync 下一次检查时间持久化到本地 `sessions` 表，App 重启后仍能延续 TTL 降频策略。
- `SessionShellSyncPlanner` 已改为同时参考 `sync_bucket` 和持久化的 `nextBackgroundCheckAfter`，避免冷项目在进程重启后重新回到高频抽样。
- 已补 Android 单测覆盖持久化 TTL 阻塞与下一次检查时间计算，确保后续继续优化同步省流量时不会回退。
- 本轮又补了 Android 侧共享 `SessionEntity` 映射，修掉 `SessionRepository` 漏传 `nextBackgroundCheckAfter` 的实际缺口，避免同步 TTL 只在部分入口生效。

## 6. 下一轮文档迭代计划

下一轮自动优化继续做三类收口：

1. 继续把大文档里的剩余可拆块迁移成按节点分工的独立文档。
2. 继续把发版相关文档里剩余还偏总览或重复的段落拆成更细的执行模板，下一轮优先补“平台专项首发窗口前移后再次回退的短回写示例”和“平台专项重新进入首发准备但最终转为观察发布的短回写示例”，并继续清理还能复用短样例的回写段落。
3. 后续每次真实代码落地或发版时，继续把验收结论和发版节点回写到对应模板与路线图。

## 7. 当前结论

接下来的工作重点不是再补零散补丁，而是：

1. 把 Android 稳定性和发布可靠性继续压实。
2. 把 WS 和同步链路剩余的线上验证做完。
3. 在已有 capability 和传输基础上，正式按 `mac -> 统一传输 -> iOS Safe Track -> 小程序 Lite` 的顺序推进。
