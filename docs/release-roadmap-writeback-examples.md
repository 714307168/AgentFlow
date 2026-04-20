# 发布节点回写示例

更新时间：2026-04-21

这份文档不再讲“应该怎么写”，而是直接给出几种可以复制改写的真实发布节点回写示例。

它适合解决的问题是：

- 路线图里要回写发版结果，但每次都要临时组织措辞
- 已经有模板了，但缺少足够短、足够像真实记录的示例
- 想把路线图控制在摘要级别，不再写成长段说明

建议配合：

- [发布回写模板](./release-writeback-template.md)
- [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- [热修发布摘要模板](./release-hotfix-summary-template.md)
- [版本观察结束结论模板](./release-observation-closure-template.md)

## 1. 使用方式

推荐顺序：

1. 先在对应模板里保留完整信息。
2. 再从完整信息里抽 3 到 5 行关键结论。
3. 最后把这份文档里的相近示例改一下，回写到路线图。

目标是让路线图始终只保留：

- 节点名
- 平台
- 版本
- release id
- 是否联动
- 一句结论

## 2. 常规单端发版示例

适用：

- 只发 desktop
- 只发 Android

示例：

~~~text
- `R-release-consistency` 已发布：
  - desktop `1.1.136`
  - 更新中心 release id：`230`
  - GitHub tag：`desktop-v1.1.136`
  - 结论：桌面端本轮修复已对外发布，进入常规观察
~~~

示例：

~~~text
- `R-mobile-stability` 已发布：
  - Android `1.2.24 (build 108)`
  - 更新中心 release id：`225`
  - GitHub tag：`android-v1.2.24`
  - 结论：安卓启动链路修复已对外发布，继续观察长连与恢复表现
~~~

## 3. 多端联动发版示例

适用：

- desktop + Android
- desktop + Android + relay-server

示例：

~~~text
- `R-message-transfer` 已发布：
  - desktop `1.1.135`
  - Android `1.2.20 (build 104)`
  - relay-server `2026.4.16 build 1`
  - 更新中心 release id：desktop `216`，Android `217`
  - 结论：消息与传输链路本轮联动版本已完成对外发布
~~~

示例：

~~~text
- `R-release-consistency` 已发布：
  - desktop `1.1.135`
  - Android `1.2.24 (build 108)`
  - relay-server 已联动部署
  - 更新中心 release id：desktop `216`，Android `225`
  - 结论：更新链路与版本一致性修复已落到线上
~~~

## 4. 热修发版示例

适用：

- 替换问题版本
- 先撤更新，再补热修

示例：

~~~text
- `R-mobile-stability` 热修已发布：
  - 替换问题版本：Android `1.2.22 (build 106)`
  - 热修版本：Android `1.2.23 (build 107)`
  - 更新中心 release id：`226`
  - 结论：问题版本已止损，热修版本进入观察
~~~

示例：

~~~text
- `R-release-consistency` 热修已发布：
  - 替换问题版本：desktop `1.1.135`
  - 热修版本：desktop `1.1.136`
  - 更新中心 release id：`230`
  - 结论：桌面端已切到热修版本，继续观察更新提示链路
~~~

## 5. 观察结束示例

适用：

- 发版后观察结束
- 热修观察结束

示例：

~~~text
- `R-mobile-stability` 观察完成：
  - Android `1.2.24 (build 108)` 继续维持当前版本
  - 更新中心 release id：`225`
  - 结论：启动、登录、同步主链路稳定，结束专项观察
~~~

示例：

~~~text
- `R-release-consistency` 热修观察完成：
  - desktop `1.1.136` 继续维持当前版本
  - 更新中心 release id：`230`
  - 结论：更新提示与安装链路稳定，恢复常规发布节奏
~~~

## 6. 平台首发示例

适用：

- `mac`
- `iOS Safe Track`
- `小程序 Lite`

示例：

~~~text
- `R-mac-first` 已首发：
  - mac `1.2.0`
  - 更新中心 release id：`301`
  - GitHub tag：`mac-v1.2.0`
  - 结论：首个可安装版本已对外可用，后续继续补齐签名和更新链路细节
~~~

示例：

~~~text
- `R-ios-safe-track` 已首发：
  - iOS Safe Track `0.1.0`
  - 结论：首发范围受限，只保留安全路径验证与基础可用能力
~~~

## 7. 不推荐写法

不要在路线图里继续写成下面这种又长又散的段落：

~~~text
本轮整体上已经把很多东西都做了，具体包括桌面端、安卓端和服务端的若干修复，
版本也已经发了，更新中心也做了调整，后续看情况再补……
~~~

原因：

- 看不出到底发了哪些端
- 看不出具体版本号
- 看不出 release id
- 看不出结论是已发布、热修还是观察完成

## 8. 当前结论

后续路线图回写时，优先直接套这份文档里的短样例，再按实际版本号和 release id 改写，避免总览继续膨胀成叙述性大段文本。
