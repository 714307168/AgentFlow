# 多端联动发版摘要模板

更新时间：2026-04-20

这份模板用于在 `desktop / Android / relay-server` 联动发版后，快速留下一份轻量摘要。

它和 [多端首发验收模板](./multi-end-launch-acceptance-template.md) 的区别是：

- 首发验收模板偏“完整构建、测试、发布、回查记录”
- 这份摘要模板偏“最终对外发了什么、结论是什么、后续要注意什么”

适合用于：

- 常规的 `desktop + Android` 联动发布
- 带 `relay-server` 的版本同步发布
- 某个路线图节点完成后的对外摘要留档

## 1. 适用目标

这份模板重点回答：

1. 本轮一共发了哪些端。
2. 每个端的版本号、构建号、release id 是什么。
3. 是否同步发到了 GitHub Release。
4. 最终对外结论是“已发布、条件性发布，还是只发部分端”。
5. 还有哪些风险或后续动作没有做完。

## 2. 使用方式

建议在完整构建、测试、上传、回查都结束后，再补这份摘要。

顺序建议：

1. 先补完整记录到 [发布回写模板](./release-writeback-template.md) 或专项验收模板。
2. 再从完整记录里提取最关键的版本、release id、结论。
3. 最后把摘要同步回路线图、README 或发布记录。

~~~text
完整测试/验收记录
  -> 多端联动发版摘要
  -> 路线图摘要
~~~

## 3. 摘要模板

~~~text
Release title:
Date:
Owner:
Roadmap milestone:
Summary:

desktop version:
desktop release id:
desktop github tag:

android versionName:
android versionCode:
android release id:
android github tag:

relay build:
relay deployed:

Final status:
Known risks:
Next actions:
~~~

## 4. 推荐摘要结构

### 4.1 发布标题

标题不要太泛，建议直接写：

- 节点名
- 平台范围
- 发布性质

例如：

- `R-mobile-stability desktop+Android release`
- `R-release-consistency Android hotfix summary`
- `desktop+Android+relay linked release summary`

### 4.2 平台信息

每个平台最少保留这些字段：

- 版本号
- 构建号或 build
- 更新中心 release id
- GitHub tag

如果某端本轮没发，也直接写清：

~~~text
desktop: skipped
reason:
~~~

### 4.3 最终结论

建议只保留一种明确状态：

- 已全部发布
- 已部分发布
- 条件性发布
- 暂缓其余平台

不要写含糊说法，比如“基本可以”“应该没问题”。

## 5. 精简版示例

~~~text
Release title: desktop+Android linked release
Date: 2026-04-20
Owner: release-owner
Roadmap milestone: R-release-consistency
Summary: unify desktop and Android release records after update-chain fixes

desktop version: 1.1.135
desktop release id: 216
desktop github tag: desktop-v1.1.135

android versionName: 1.2.24
android versionCode: 108
android release id: 225
android github tag: android-v1.2.24

relay build: 2026.4.16 build 1
relay deployed: yes

Final status: 已全部发布
Known risks: ws 长连稳定性还需继续观察
Next actions: continue release-day writeback and follow-up verification
~~~

## 6. 和其他文档的分工

遇到不同场景时，建议这样分流：

- 要查完整测试、构建、回查过程：看 [多端首发验收模板](./multi-end-launch-acceptance-template.md)
- 要记单次正常发版的详细回写：看 [发布回写模板](./release-writeback-template.md)
- 要记事故、回滚、热修：看 [发布事故回写模板](./release-incident-writeback-template.md)
- 要记最终多端联动摘要：看这份模板

## 7. 当前结论

后续多端联动发布时，不再把完整验收内容整段堆回路线图，而是先保留完整记录，再用这份模板抽出一页摘要，方便后续快速回看。
