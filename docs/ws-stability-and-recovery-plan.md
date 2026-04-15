# 2026-04 WebSocket 稳定性与恢复专项

## 1. 背景

当前桌面端、Android 端和 relay-server 的实时链路已经具备可用的 WebSocket + HTTP 增量同步组合能力，但线上现象仍然集中在几类问题上：

- 前后台切换、网络切换后连接恢复慢，或者看起来已连上但消息没有及时补齐。
- 断线以后缺少足够细的 close code / close reason / 重连原因记录，排障要靠猜。
- 客户端和服务端都有 heartbeat / ping-pong，但恢复链路还不够显式，日志也还不够统一。

这一轮不推翻现有协议，也不把 WebSocket 替换成别的机制。原则是：

- WebSocket 继续做实时加速通道。
- HTTP meta/delta 继续做最终正确性兜底。
- 先补可观测性，再补恢复状态机，再做服务端和边缘层硬化。

## 2. 目标

### P0: 可观测性先行

1. 为桌面端连接快照补最近连接事件环形日志。
2. 记录最近一次 close code / close reason / error / reconnect schedule。
3. 把这些信息进入桌面端诊断导出，后续排查 WS 老掉线时不再只看一条 disconnected。
4. 统一把这一类事件命名收口，避免 Android、desktop、relay 侧日志口径继续漂移。

发版节点:

- R-ws-observability: 桌面端和诊断导出补齐连接事件观测后发一个桌面端补丁版。

### P1: 客户端恢复状态机

1. 明确区分 connect / auth / catch-up / stable 四段状态。
2. 前后台切换、网络切换、token 刷新失败、长时间无入站流量，都进入明确的恢复原因分支。
3. 恢复阶段优先做轻量校验，再做增量补拉，避免一重连就把全部项目重新刷一遍。
4. 重连退避、冷却和补拉节奏统一收口，避免多个入口互相抢连接。

发版节点:

- R-ws-recovery: desktop + Android 恢复状态机第一阶段完成后做一次双端联动发版。

### P2: 服务端与边缘层硬化

1. 检查 relay-server、反向代理、更新中心前面的 read timeout / idle timeout / websocket upgrade 配置。
2. 服务端补更明确的 close code、ping/pong、缓冲积压统计。
3. 重连成功后优先走 meta/delta 校验，确保“传输恢复了但状态没补齐”可以自动修正。

发版节点:

- R-ws-hardening: relay-server 与客户端协同硬化后做一次三端联动版。

## 3. 设计原则

1. 不把 WebSocket 当唯一真相源。消息、活动、会话壳数据都必须允许通过 revision / delta / after_seq 自愈。
2. 连接恢复必须带原因。没有 reason 的重连日志，后面很难做信号聚类和自动诊断。
3. 观测数据要做有界缓存。最近事件只保留小窗口，方便诊断，不把常驻内存继续拉大。
4. 新增字段尽量走增量兼容，避免先改协议再追着修多端。

## 4. 当前进度

### Progress Update 2026-04-16

- [x] 新建 WS 稳定性与恢复专项文档，并补发版节点。
- [x] 桌面端 RelayClient 连接快照现在记录最近连接事件环形日志、最近一次 close code / close reason、最近一次重连计划。
- [x] 桌面端诊断导出自动带出上述连接事件，后续排查掉线不再只剩粗粒度状态。
- [ ] Android 端补同口径连接事件时间线。
- [ ] relay-server 补 close-code 聚合与代理层超时核查清单。
- [ ] foreground/network-switch 恢复状态机拆成独立阶段并补测试。

## 5. 下一步建议

优先顺序保持：

1. 先把 Android 恢复日志和桌面端口径对齐。
2. 再把恢复状态机从 UI / Service 逻辑里进一步拆出来。
3. 最后再做服务端超时、边缘代理和 close-code 聚合。
