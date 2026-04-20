# 单端发版摘要模板

更新时间：2026-04-20

这份模板用于给一次单端发布留下一份轻量摘要。

它适合的不是多端联动发布，而是这种情况：

- 只发 desktop
- 只发 Android
- 只发某一个后续新增平台

它和其他文档的分工是：

- [发布回写模板](./release-writeback-template.md) 记录完整发版回写
- [多端联动发版摘要模板](./multi-end-release-summary-template.md) 记录多端联动版本摘要
- 这份模板只负责把“单端这一版最终对外发了什么”写清楚

## 1. 适用场景

以下情况适合用这份模板：

- 桌面端单独发版
- Android 单独发版
- 单个平台稳定性修复版
- 单个平台能力增量版

重点是说明：

- 本轮只发了哪一端
- 版本号和 build 是什么
- 更新中心和 GitHub 现在对外暴露的版本是什么
- 这次单端发版的风险和后续动作是什么

## 2. 需要回答的问题

单端发版摘要至少要回答这六个问题：

1. 这次发的是哪一个端。
2. 对外版本号、build、release id 是什么。
3. 是否同步发到了 GitHub Release。
4. 是否需要用户主动升级。
5. 当前最终结论是已发布、条件性发布，还是继续观察。
6. 后续还有什么风险或补充动作。

## 3. 使用顺序

推荐顺序：

1. 先在 [发布回写模板](./release-writeback-template.md) 里保留完整记录。
2. 再用这份模板抽出单端版本的最终摘要。
3. 最后把摘要同步回路线图和 README。

~~~text
完整发版回写
  -> 单端发版摘要
  -> 路线图摘要
~~~

## 4. 摘要模板

~~~text
Release title:
Date:
Owner:
Roadmap milestone:
Platform:
Summary:

Version:
Build:
Update center release id:
GitHub tag:
Artifact:

User action:
Final status:
Known risks:
Next actions:
~~~

## 5. 建议字段说明

### 5.1 Platform

建议直接写明确值：

- `desktop-win`
- `android`
- `desktop-mac`
- 其他具体平台名

### 5.2 Final status

建议固定写一种状态：

- 已发布
- 条件性发布
- 已发布并进入观察
- 暂缓继续放量

### 5.3 User action

直接写用户最终需要做什么：

- 正常升级即可
- 需要手动重新下载安装
- 已安装旧版本用户建议升级
- 暂不建议升级

## 6. 精简示例

~~~text
Release title: desktop stability patch
Date: 2026-04-20
Owner: release-owner
Roadmap milestone: R-release-consistency
Platform: desktop-win
Summary: fix desktop update prompt and task-finish notification path

Version: 1.1.136
Build: 0
Update center release id: 230
GitHub tag: desktop-v1.1.136
Artifact: AgentFlow-1.1.136-x64-setup.exe

User action: normal upgrade
Final status: 已发布并进入观察
Known risks: long-run follow-up refresh still needs observation
Next actions: complete post-release observation and update roadmap summary
~~~

## 7. 和其他文档的分工

- 要看完整发版回写：看 [发布回写模板](./release-writeback-template.md)
- 要看多端联动版本摘要：看 [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- 要看热修版本摘要：看 [热修发布摘要模板](./release-hotfix-summary-template.md)
- 要看观察过程和观察结束：看 [发版后持续观察记录模板](./release-post-release-observation-template.md) 和 [版本观察结束结论模板](./release-observation-closure-template.md)

## 8. 当前结论

后续只发一个端时，不再借用多端模板或只在路线图里写一句版本号，而是用这份模板把平台、版本、release id、用户动作和最终结论单独沉淀下来。
