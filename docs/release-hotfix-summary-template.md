# 热修发布摘要模板

更新时间：2026-04-20

这份模板用于给一次热修发布留下一份轻量摘要。

它适合处理的不是常规版本，而是这种情况：

- 已经发出一个版本
- 发现关键问题
- 需要快速补一个热修版本覆盖、替换或止损

它和其他发布文档的分工是：

- [发布回写模板](./release-writeback-template.md) 记录正常发版的完整回写
- [发布事故回写模板](./release-incident-writeback-template.md) 记录问题版本的事故收口
- 这份模板只负责把“热修版本本身”说清楚

## 1. 适用场景

以下情况适合用这份模板：

- Android 热修版本
- desktop 热修版本
- desktop + Android 联动热修
- 某次 relay-server 联动补丁发布

重点是要说明：

- 热修修了什么
- 替换了哪个问题版本
- 更新中心和 GitHub 现在对外暴露的版本是什么

## 2. 需要回答的问题

热修摘要至少要回答这六个问题：

1. 本次热修替换的是哪个问题版本。
2. 热修版本号和 build 是什么。
3. 更新中心 release id 是多少。
4. GitHub tag 和附件是什么。
5. 热修后用户应该升级到哪个版本。
6. 热修后是否已经进入观察期，还是仍需继续止损。

## 3. 使用顺序

推荐顺序：

1. 先在事故模板里记清楚问题版本和止损动作。
2. 再用这份模板记录热修版本本身。
3. 最后把摘要同步回路线图和 README。

~~~text
问题版本事故记录
  -> 热修版本摘要
  -> 发布后观察
  -> 路线图摘要
~~~

## 4. 热修摘要模板

~~~text
Hotfix title:
Date:
Owner:
Roadmap milestone:
Impacted platform:
Replaces bad version:
Hotfix version:
Hotfix build:
Summary:

Update center release id:
GitHub tag:
Artifact:
Rollout status:

User action:
Observation status:
Known risks:
Next actions:
~~~

## 5. 建议字段说明

### 5.1 Replaces bad version

这里不要写模糊描述，建议直接写：

- 问题版本号
- 问题 build
- 是否已撤更新

例如：

~~~text
Replaces bad version: Android 1.2.22 (build 106), update center retracted
~~~

### 5.2 Rollout status

建议固定写一种状态：

- 已替换问题版本
- 与旧版本并存
- 仅灰度热修
- 已完成止损但仍在观察

### 5.3 User action

直接写给用户的最终动作：

- 需要升级到热修版
- 不要继续安装旧版本
- 已安装问题版本的用户需重新下载安装

## 6. 精简示例

~~~text
Hotfix title: Android startup crash hotfix
Date: 2026-04-20
Owner: release-owner
Roadmap milestone: R-mobile-stability
Impacted platform: android
Replaces bad version: Android 1.2.22 (build 106), update center retracted
Hotfix version: 1.2.23
Hotfix build: 107
Summary: fix startup crash and encrypted preference recovery path

Update center release id: 226
GitHub tag: android-v1.2.23
Artifact: AgentFlow-1.2.23-release.apk
Rollout status: 已替换问题版本

User action: upgrade to 1.2.23 and stop installing 1.2.22
Observation status: 2-24 hour observation in progress
Known risks: long-run reconnect still needs follow-up check
Next actions: complete observation and update roadmap summary
~~~

## 7. 和其他文档的分工

- 要看常规发版详细回写：看 [发布回写模板](./release-writeback-template.md)
- 要看事故和回滚收口：看 [发布事故回写模板](./release-incident-writeback-template.md)
- 要看发布后观察：看 [发版后持续观察记录模板](./release-post-release-observation-template.md)
- 要看从信号到止损判断：看 [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)

## 8. 当前结论

后续遇到热修发布时，不再只在事故文档或路线图里零散写一句“已补热修”，而是用这份模板把替换关系、热修版本、release id、用户动作和观察状态单独写清楚。
