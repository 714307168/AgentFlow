# 平台首发摘要模板

更新时间：2026-04-20

这份模板用于给某个平台第一次正式上线时，留下一份轻量但可追踪的首发摘要。

它不替代：

- 首发前的准备清单
- 完整构建、测试、发布、回查记录

它负责的是在首发完成后，把“这次到底上线了什么、版本是什么、状态如何、还有什么边界没做”快速写清楚。

适合用于：

- `mac` 首发
- `iOS Safe Track` 首发
- `微信小程序 Lite` 首发
- 后续新增任意平台的第一次正式可用版本

建议搭配：

- [多端首发验收模板](./multi-end-launch-acceptance-template.md)
- [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- [发布回写模板](./release-writeback-template.md)
- 对应平台专项文档，例如 [mac 首发发布检查清单](./mac-first-release-checklist.md)

## 1. 适用目标

这份模板重点回答：

1. 哪个平台在这次正式首发。
2. 首发版本号、构建号、产物和 release id 是什么。
3. 首发范围是完整可用、受限可用，还是 Safe Track / Lite。
4. 哪些能力已经包含，哪些能力还明确没做。
5. 首发后的下一步路线是什么。

## 2. 使用方式

建议在首发完成并完成最小验收后再补这份摘要。

推荐顺序：

1. 先在平台专项清单和完整验收模板中保留完整记录。
2. 再用这份模板抽出平台首发的最终结论。
3. 最后把摘要同步回路线图和 README。

~~~text
平台专项准备/验收
  -> 平台首发摘要
  -> 路线图摘要
~~~

## 3. 摘要模板

~~~text
Platform:
Release date:
Owner:
Roadmap milestone:
Release mode:
Summary:

Version:
Build:
Artifact:
Update center release id:
GitHub tag:

Included capabilities:
Excluded capabilities:
Verification result:
Final status:
Known risks:
Next actions:
~~~

## 4. 字段说明

### 4.1 Release mode

建议直接写清楚首发策略，不要只写“已上线”：

- `full`
- `safe-track`
- `lite`
- `limited rollout`

### 4.2 Included capabilities

这里只写已经确定包含的能力，例如：

- 登录
- relay 连接
- 项目列表同步
- 消息查看
- 更新检查
- 日志导出

### 4.3 Excluded capabilities

首发时明确写出未包含能力，比模糊承诺更重要，例如：

- 不支持静默更新
- 不支持附件上传
- 不支持完整协作组控制
- 不支持后台常驻

### 4.4 Final status

只保留一种明确结论：

- 已首发
- 条件性首发
- 仅灰度首发
- 延后完整能力

## 5. 精简示例

~~~text
Platform: mac
Release date: 2026-05-02
Owner: release-owner
Roadmap milestone: R-mac-first
Release mode: limited rollout
Summary: first installable mac desktop release with update-center integration

Version: 1.2.0
Build: 0
Artifact: AgentFlow-1.2.0-arm64.dmg
Update center release id: 301
GitHub tag: mac-v1.2.0

Included capabilities: login, relay connect, project list, chat view, update check, log export
Excluded capabilities: universal build, full notarization automation, silent update
Verification result: install ok, launch ok, sync ok, update check ok
Final status: 已首发
Known risks: notarization and universal package still need follow-up
Next actions: continue notarization automation and update flow hardening
~~~

## 6. 和其他文档的分工

- 要看平台首发前准备项：看对应平台专项清单
- 要看完整构建、测试、发布、回查：看 [多端首发验收模板](./multi-end-launch-acceptance-template.md)
- 要看联动发布的多端最终摘要：看 [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- 要看单次正常发版详细回写：看 [发布回写模板](./release-writeback-template.md)
- 要看首发后事故和回滚：看 [发布事故回写模板](./release-incident-writeback-template.md)

## 7. 当前结论

后续每个平台第一次上线时，不再只在路线图里写一句“已开始/已首发”，而是先用这份模板把首发范围、版本、边界和下一步写清楚，再把摘要回写到总览。
