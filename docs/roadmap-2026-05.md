# 2026-05 路线图总览

更新时间：2026-04-19

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

- Android 启动闪退修复已落地：
  - 修复点：加密偏好损坏恢复、前台服务启动异常保护
  - Android `1.2.24 (build 108)` 已发布到更新中心
  - 更新中心 release id：`225`

## 5. 文档拆分入口

后续不要再把所有计划继续堆回这一份总览。

当前建议直接从这里分流：

- 同步和省流量： [Project Sync Signature 设计](./project-sync-signature-design.md)
- WS 稳定性： [WebSocket 稳定性与恢复专项](./ws-stability-and-recovery-plan.md)
- 授权和受控远程协作： [受控授权远程协作设计](./controlled-remote-authorization.md)
- 项目级授权实施： [项目级授权 MVP 实施方案](./project-scope-access-mvp.md)
- 多端扩展： [多端扩展计划](./platform-expansion-plan.md)
- 发布和更新中心： [更新中心与发布说明](./release-and-update-center.md)

## 6. 下一轮文档迭代计划

下一轮自动优化优先补这些文档缺口：

1. `mac` 首发补一份构建、签名、更新、日志目录和回滚清单。
2. `iOS Safe Track` 补一份能力边界和 API 契约清单，明确哪些功能不进首发。
3. `微信小程序 Lite` 补一份缓存、消息、文件和登录态边界说明。
4. 发布文档补一份“更新中心 + GitHub + 本地版本号”三者一致性检查模板。

## 7. 当前结论

接下来的工作重点不是再补零散补丁，而是：

1. 把 Android 稳定性和发布可靠性继续压实。
2. 把 WS 和同步链路剩余的线上验证做完。
3. 在已有 capability 和传输基础上，正式按 `mac -> 统一传输 -> iOS Safe Track -> 小程序 Lite` 的顺序推进。
