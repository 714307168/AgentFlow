# 单端热修观察结束结论模板

更新时间：2026-04-21

这份模板用于给一次单端热修版本的观察期写最终结论。

它适合处理的不是：

- 多端联动热修
- 常规非热修版本观察结束

它适合的是：

- Android 热修观察结束
- desktop 热修观察结束
- 某个单独平台热修后的最终收口

它和其他文档的分工是：

- [热修发布摘要模板](./release-hotfix-summary-template.md) 负责写热修版本本身
- [发版后持续观察记录模板](./release-post-release-observation-template.md) 负责记录观察过程
- 这份模板只负责写“单端热修观察结束时最终决定了什么”

## 1. 适用目标

这份模板重点回答：

1. 这个单端热修版本是否已经可以结束观察。
2. 最终结论是维持当前热修、继续观察，还是还要再补热修。
3. 用户现在应该升级到哪个版本。
4. 团队后续是恢复正常节奏，还是继续重点盯这个端。

## 2. 使用顺序

建议顺序：

1. 先在 [热修发布摘要模板](./release-hotfix-summary-template.md) 中记录热修版本。
2. 再在 [发版后持续观察记录模板](./release-post-release-observation-template.md) 中保留观察过程。
3. 最后用这份模板抽出单端热修观察的最终结论。

~~~text
单端热修发布
  -> 观察过程
  -> 单端热修观察结束结论
  -> 路线图摘要
~~~

## 3. 结论模板

~~~text
Hotfix title:
Platform:
Observed version:
Roadmap milestone:
Observation window:
Final conclusion:

Update chain status:
Main flow status:
Signals/logs summary:
User feedback summary:

User action:
Team action:
Follow-up:
~~~

## 4. Final conclusion 建议值

建议只保留一种明确结论：

- 热修观察完成，可维持当前版本
- 继续观察当前热修版本
- 继续观察，并准备下一轮热修
- 停止继续放量，转入再次热修或回滚

不要写模糊说法，比如“暂时应该没问题”。

## 5. User action 建议写法

这里直接写给用户的最终动作：

- 继续升级到当前热修版本
- 已安装旧问题版本的用户请重新下载安装热修版
- 暂不建议继续升级，等待下一版

## 6. Team action 建议写法

这里直接写团队下一步动作：

- 结束专项观察，回到常规发布节奏
- 继续观察 24 小时
- 准备下一轮热修
- 回滚并停止继续放量

## 7. 精简示例

~~~text
Hotfix title: Android startup crash hotfix
Platform: android
Observed version: 1.2.23 (build 107)
Roadmap milestone: R-mobile-stability
Observation window: 0-24 hours
Final conclusion: 热修观察完成，可维持当前版本

Update chain status: stable
Main flow status: startup, login, sync and chat stable
Signals/logs summary: no repeated crash or auth spikes
User feedback summary: no new blocking reports

User action: continue upgrading to 1.2.23
Team action: stop special monitoring and return to normal release cadence
Follow-up: keep ws reconnect and sync recovery in routine verification
~~~

## 8. 和其他文档的分工

- 要看单端热修版本摘要：看 [热修发布摘要模板](./release-hotfix-summary-template.md)
- 要看观察过程：看 [发版后持续观察记录模板](./release-post-release-observation-template.md)
- 要看最终观察结束结论：这份模板只面向单端热修
- 要看多端或常规版本的观察结束结论：看 [版本观察结束结论模板](./release-observation-closure-template.md)

## 9. 当前结论

后续单端热修不再只在聊天记录或路线图里写一句“观察没问题”，而是用这份模板把最终结论、用户动作和团队动作单独沉淀下来。
