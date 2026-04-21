# 平台首发后观察摘要模板

更新时间：2026-04-21

这份模板用于在某个平台第一次正式上线之后，留一份轻量但可追踪的观察摘要。

它不替代：

- 首发前准备清单
- 完整发版回写
- 按时间窗口展开的详细观察记录

它负责的是在首发已经发出去之后，把“这次首发现在是否稳定、范围是否继续维持、要不要延长观察或准备补丁”快速写清楚。

适合用于：

- `mac` 首发后的首轮观察
- `iOS Safe Track` 首发后的边界验证
- `微信小程序 Lite` 首发后的轻入口稳定性观察
- 任意新平台第一次对外可用版本发出后的观察摘要

建议搭配：

- [平台首发摘要模板](./platform-first-release-summary-template.md)
- [发版后持续观察记录模板](./release-post-release-observation-template.md)
- [发布节点回写示例](./release-roadmap-writeback-examples.md)
- [平台专项路线图回写示例](./platform-track-roadmap-writeback-examples.md)

## 1. 适用目标

这份模板重点回答：

1. 哪个平台的首发版本正在观察。
2. 当前观察窗口内，更新链路和主链路是否稳定。
3. 首发边界是否继续维持，还是已经出现要收口的问题。
4. 当前结论是结束观察、继续观察，还是准备热修。
5. 下一步是继续稳首发，还是才考虑扩边界。

## 2. 使用方式

推荐顺序：

1. 先在详细观察模板里保留分时间窗口记录。
2. 再用这份模板抽出平台首发后的阶段性结论。
3. 最后把摘要同步回路线图和平台专项文档。

~~~text
平台首发摘要
  -> 发版后持续观察记录
  -> 平台首发后观察摘要
  -> 路线图摘要
~~~

## 3. 摘要模板

~~~text
Platform:
Observed version:
Release mode:
Roadmap milestone:
Observation owner:
Observation window:
Summary:

Update flow:
Main flow:
Boundary status:
Signals and feedback:
Current decision:
Known risks:
Next actions:
~~~

## 4. 字段说明

### 4.1 Release mode

继续沿用首发阶段的模式，不要改成模糊描述：

- `full`
- `safe-track`
- `lite`
- `limited rollout`

### 4.2 Boundary status

这里要直接写边界是否保持原样，例如：

- 首发边界维持不变
- Safe Track 范围维持不变
- Lite 边界继续收紧
- 暂不扩能力，先稳观察

### 4.3 Current decision

只保留一个明确结论：

- 继续观察
- 观察完成，维持当前范围
- 准备热修
- 撤更新/收口

## 5. 精简示例

### 5.1 mac

~~~text
Platform: mac
Observed version: 1.2.0
Release mode: limited rollout
Roadmap milestone: R-mac-first
Observation owner: release-owner
Observation window: first 24 hours
Summary: 首个可安装 mac 版本已完成首轮观察，当前以稳定安装、启动、同步和更新链路为主

Update flow: check ok, package download ok, install flow stable
Main flow: launch ok, login ok, project list ok, chat view ok
Boundary status: 首发边界维持不变，暂不扩大桌面能力范围
Signals and feedback: no new blocking issues, no repeated install failures
Current decision: 观察完成，维持当前范围
Known risks: signing and notarization automation still need hardening
Next actions: continue notarization automation and update flow hardening
~~~

### 5.2 iOS Safe Track

~~~text
Platform: iOS
Observed version: 0.1.0
Release mode: safe-track
Roadmap milestone: R-ios-safe-track
Observation owner: release-owner
Observation window: first 48 hours
Summary: iOS 首发观察重点放在登录、项目列表、消息查看和轻量回复，暂不追求安卓同等覆盖

Update flow: distribution path stable
Main flow: login ok, project list ok, chat view ok, file receive ok
Boundary status: Safe Track 范围维持不变，不扩大为完整远控终端
Signals and feedback: no review-blocking regressions, no major weak-network complaints
Current decision: 继续观察
Known risks: background limits and review constraints still need follow-up
Next actions: finish first-release acceptance and keep boundary narrow
~~~

### 5.3 小程序 Lite

~~~text
Platform: mini-program
Observed version: 0.1.0
Release mode: lite
Roadmap milestone: R-mini-lite
Observation owner: release-owner
Observation window: first 24 hours
Summary: 小程序首发后的观察重点是轻量查看、快速回复、状态刷新和重连反馈

Update flow: distribution path stable
Main flow: message list ok, quick reply ok, task status ok, file receive ok
Boundary status: Lite 边界继续维持，不承接重设置和完整实时控制
Signals and feedback: no blocking issues, weak-network refresh still needs polish
Current decision: 观察完成，维持当前范围
Known risks: long-connection limits and lightweight cache constraints remain
Next actions: polish refresh feedback and keep Lite scope stable
~~~

## 6. 和其他文档的分工

- 要看平台首发本身的版本、产物和边界：看 [平台首发摘要模板](./platform-first-release-summary-template.md)
- 要看详细观察窗口：看 [发版后持续观察记录模板](./release-post-release-observation-template.md)
- 要看正式发版回写：看 [发布回写模板](./release-writeback-template.md)
- 要看平台专项阶段收口：看 [平台专项收口摘要模板](./platform-track-closure-summary-template.md)

## 7. 当前结论

后续平台第一次上线后，不再只在路线图里写一句“已观察正常”，而是先用这份模板把首发后的观察窗口、边界状态和下一步结论单独收口，再回写到总览。
