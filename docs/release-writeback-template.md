# 发布回写模板

更新时间：2026-04-20

这份模板用于处理“发版成功后怎么把结果写清楚”这个问题。

它解决的不是：

- 发版前怎么检查
- 出事故后怎么回滚

它解决的是：

- 本轮到底发了哪些端
- 对外版本号和构建号是什么
- 更新中心 release id 是多少
- GitHub Release tag 和附件是什么
- 本轮测试和最小验收结论是什么

这样后续再回头看路线图、README、发布记录时，不需要重新翻命令历史、聊天记录或管理后台截图。

建议和下面几份文档一起使用：

- [发布一致性检查模板](./release-consistency-checklist.md)
- [发布上传 Runbook](./release-upload-runbook.md)
- [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)
- [发布事故回写模板](./release-incident-writeback-template.md)

## 1. 适用场景

以下情况发完之后，都建议用这份模板补一条发布回写：

- 只发 desktop
- 只发 Android
- desktop + Android 联动发布
- desktop + Android + relay-server 联动发布
- 某个专项节点正式进入“已发布”状态

## 2. 回写目标

正常发版后的回写，至少要回答六个问题：

1. 这次发的是哪几个端。
2. 每个端真正对外的版本号和构建号是什么。
3. 更新中心 release id 是多少。
4. GitHub Release 是否同步发布，tag 和附件是什么。
5. 发版前后最小测试和验收是否通过。
6. 这次发布对应路线图里的哪个节点。

## 3. 最小回写顺序

建议按这个顺序写，不要把信息分散到多个地方：

1. 先写发布摘要。
2. 再写每个端的版本号和构建信息。
3. 再写更新中心和 GitHub Release 信息。
4. 再写测试与最小验收结论。
5. 最后把路线图节点和后续注意事项回写进去。

~~~text
发布摘要
  -> 平台版本信息
  -> 更新中心记录
  -> GitHub Release
  -> 测试与验收
  -> 路线图节点
~~~

## 4. 发布摘要模板

~~~text
Release title:
Release date:
Owner:
Scope:
Platforms:
Roadmap milestone:
Summary:
~~~

建议至少写清：

- 是功能发布、稳定性修复，还是热修
- 影响哪些平台
- 是否包含 relay-server 联动发布
- 用户能感知到的核心变化是什么

## 5. 平台版本回写

### 5.1 Desktop

至少记录：

- `local-agent/package.json` 里的 `version`
- 实际构建产物文件名
- 是否同步发到了更新中心
- 是否同步发到了 GitHub Release

模板：

~~~text
desktop version:
desktop package:
desktop update center:
desktop github release:
desktop notes:
~~~

### 5.2 Android

至少记录：

- `versionName`
- `versionCode`
- 实际 APK 文件名
- 是否同步发到了更新中心
- 是否同步发到了 GitHub Release

模板：

~~~text
android versionName:
android versionCode:
android package:
android update center:
android github release:
android notes:
~~~

### 5.3 relay-server

如果本轮包含 relay-server 联动发布，至少记录：

- 部署时间
- 构建标识
- 是否完成健康检查

模板：

~~~text
relay deployed at:
relay build:
relay health check:
relay notes:
~~~

## 6. 更新中心回写

这一部分用于把“发版成功”落成可追踪记录，而不是只记一个模糊版本号。

至少记录：

- `release id`
- `platform / channel / arch / version / build`
- `filename`
- `mandatory`
- `min_supported_version`
- `/api/update/check` 的核查结果

模板：

~~~text
desktop release id:
desktop version:
desktop build:
desktop filename:
desktop update check:

android release id:
android version:
android build:
android filename:
android update check:

notes:
~~~

如果本轮只发一个端，另一段可以省略。

## 7. GitHub Release 回写

如果本轮同步发 GitHub Release，至少记录：

- tag
- release title
- 附件名
- release note 文件或摘要

模板：

~~~text
github tag:
github title:
github assets:
github notes:
~~~

如果本轮没有同步发 GitHub Release，也建议写清：

~~~text
github release: skipped
reason:
~~~

## 8. 测试与验收回写

不要只写“已测试”，至少写最小可追踪结论。

建议记录：

- 本轮跑了哪些测试
- 哪些是自动化测试
- 哪些是人工最小验收
- 是否有已知风险留到后续版本

模板：

~~~text
relay tests:
desktop tests:
android tests:
desktop acceptance:
android acceptance:
relay acceptance:
known risks:
~~~

## 9. 路线图回写

回写到路线图时，建议最少保留这几项：

- 路线图节点名
- 发布日期
- 版本号
- 更新中心 release id
- 是否联动 relay-server

推荐写法：

~~~text
- `R-some-milestone` 已发布：
  - desktop `1.1.x`
  - Android `1.2.x (build xxx)`
  - relay-server `yyyy.mm.dd build x`
  - 更新中心 release id：desktop `xxx`，Android `yyy`
~~~

这样路线图只保留摘要，细节继续落到这份模板，不再继续膨胀。

## 10. 完整示例

~~~text
Release title: Android startup crash fix
Release date: 2026-04-19
Owner: release-owner
Scope: stability fix
Platforms: android
Roadmap milestone: R-mobile-stability
Summary: fix encrypted preference recovery and startup guard

android versionName: 1.2.24
android versionCode: 108
android package: app-release.apk
android update center: yes
android github release: yes

android release id: 225
android version: 1.2.24
android build: 108
android filename: AgentFlow-1.2.24-release.apk
android update check: ok

github tag: android-v1.2.24
github title: Android 1.2.24
github assets: AgentFlow-1.2.24-release.apk

android tests: .\\gradlew.bat :app:testReleaseUnitTest
android acceptance: install ok, launch ok, update prompt ok
known risks: ws long-run reconnect still needs follow-up verification
~~~

## 11. 当前结论

后续每次正常发版，不再只把版本号简短写进路线图，而是先用这份模板把版本、release id、GitHub、测试和验收结论沉淀下来，再把摘要同步回总览。
