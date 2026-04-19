# WebSocket 加固联调核查模板

更新时间：2026-04-19

这份模板用于给 `R-ws-hardening` 提供一份可以直接执行的联调核查入口，确保 relay-server、反向代理、桌面端和移动端不是各自“看起来没问题”，而是一起验证真实掉线、恢复、补拉和日志闭环。

## 1. 使用方式

每次做 WS 加固联调时，至少一起记录这四类信息：

- 反向代理配置是否满足 WebSocket 长连接要求
- relay-server 的超时、close code、ping/pong 是否按预期工作
- 客户端是否能在断线后恢复并补齐状态
- 线上日志是否能把一轮掉线与恢复串起来

## 2. 联调基本信息

~~~text
Release node: R-ws-hardening
Date:
Owner:
Relay build:
Desktop build:
Android build:
Proxy type:
Environment:
~~~

## 3. 反向代理核查

至少确认以下项：

- [ ] WebSocket upgrade 头被正确透传
- [ ] `Connection: upgrade` 行为正确
- [ ] `proxy_read_timeout` 足够长，不会过早切断空闲长连接
- [ ] `proxy_send_timeout` 足够长
- [ ] `proxy_connect_timeout` 合理
- [ ] 关闭或规避会破坏 WS 的缓冲策略
- [ ] 反向代理没有额外吞掉 close code 或自定义错误页
- [ ] TLS、证书轮换和 SNI 不会影响长连接复用

建议附一段当前实际配置片段：

~~~text
proxy:
ws route:
read timeout:
send timeout:
connect timeout:
buffering:
notes:
~~~

## 4. 服务端核查

至少确认以下项：

- [ ] relay-server 能记录最近的连接建立、认证成功、socket close、socket error
- [ ] close code 与 close reason 能进入聚合或诊断输出
- [ ] ping/pong 超时不会被误判成正常退出
- [ ] 认证过期、权限失效、服务端重启能给出可诊断的 close reason
- [ ] reconnect 后的 catch-up 仍通过 `meta / delta / after_seq` 补齐，而不是假定 WS 已经等于状态同步完成
- [ ] 服务端对重复连接、陈旧连接和僵尸连接有明确处理策略

建议记录：

~~~text
ping interval:
pong timeout:
idle timeout:
unexpected close codes:
aggregated metrics:
notes:
~~~

## 5. 客户端核查

桌面端和移动端都要确认：

- [ ] 连接阶段至少能区分 `connect / auth / catch-up / stable`
- [ ] 断线后会带原因进入重连，而不是盲重试
- [ ] 重连成功后会主动补拉 catalog 和增量状态
- [ ] 网络切换、应用切后台、系统挂起恢复后不会停留在“看似在线”的假状态
- [ ] 诊断导出中能看到最近一轮 close code、error、reconnect schedule
- [ ] 不会因为重复重连造成并发 socket 抢占

## 6. 场景矩阵

每个场景至少记录“触发方式、预期行为、实际行为、结论”。

| 场景 | 触发方式 | 预期行为 | 关键观测点 | 结果 |
| --- | --- | --- | --- | --- |
| 应用切后台再恢复 | 手动切后台 30s 后恢复 | 自动重连并补齐增量 | 客户端状态阶段、最后 close code |  |
| 网络切换 | Wi-Fi 切 4G 或断网再恢复 | 旧 socket 失效，新 socket 成功补齐 | reconnect reason、catch-up 完成时间 |  |
| 代理空闲超时 | 人为缩短代理 timeout 或空闲等待 | 能识别为异常关闭并恢复 | 代理日志、relay close 聚合 |  |
| 服务端重启 | 重启 relay-server | 客户端重连后不丢关键状态 | reconnect 次数、after_seq 补拉 |  |
| token 过期或刷新失败 | 伪造过期 token | 给出明确认证失败，不假装稳定 | auth 失败原因、用户提示 |  |
| 陈旧 socket | 保留旧连接再登录新连接 | 服务端淘汰陈旧连接 | connection id、close reason |  |

## 7. 判定标准

满足以下条件才算本轮联调通过：

- [ ] 反向代理、relay-server、客户端三侧日志能串起同一轮掉线与恢复
- [ ] 至少覆盖一次真实异常关闭和一次主动恢复
- [ ] 恢复后消息、活动、项目状态没有明显缺口
- [ ] 没有出现“UI 显示已连接，但实际长期不补拉”的假恢复
- [ ] 没有出现并发多 socket 抢占同一设备状态

## 8. 阻塞记录

~~~text
issue:
layer:
impact:
temporary mitigation:
owner:
next action:
~~~

## 9. 发布前结论

只保留一个明确结果：

- 可随版本发布
- 需要补丁后再发
- 仅允许灰度，不允许全量

并补一句原因。
