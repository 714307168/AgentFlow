# 发布事故回写模板

更新时间：2026-04-20

这份模板用于处理这样一类问题：

- 版本已经发出
- 更新中心、GitHub Release、客户端版本号、回滚动作已经发生过
- 但事后很难快速还原“到底发了什么、哪里错了、最后怎么止损的”

它关注的是事故结束后的统一回写，不替代发版前检查，也不替代回滚动作本身。

建议和下面几份文档一起使用：

- [发布一致性检查模板](./release-consistency-checklist.md)
- [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)
- [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)
- [更新中心与发布说明](./release-and-update-center.md)

## 1. 适用场景

以下情况处理完之后，都建议补这份回写：

- 更新中心持续提示同一版本升级
- Android 或桌面端升级后闪退、无法启动、无法登录
- GitHub Release tag、附件、说明和更新中心不一致
- 客户端本地版本号、构建产物版本、更新中心版本对不上
- 已经执行过撤更新、热修、回滚 relay-server，但现场记录散落在多个地方

## 2. 回写目标

回写至少要回答五个问题：

1. 当时真正对外下发的版本是什么。
2. 更新中心和 GitHub Release 各自显示的版本、release id、附件是什么。
3. 客户端本地版本号和构建号当时是否正确。
4. 最终执行了撤更新、热修还是回滚。
5. 后续如何避免再发生同类问题。

## 3. 最小回写顺序

建议按这个顺序补记录：

1. 先写事故摘要和影响范围。
2. 再写客户端版本号与构建产物信息。
3. 再写更新中心与 GitHub Release 的真实状态。
4. 再写回滚、撤回或热修动作。
5. 最后写根因、验证结果和预防动作。

~~~text
事故摘要
  -> 客户端版本
  -> 更新中心记录
  -> GitHub Release 记录
  -> 回滚 / 热修动作
  -> 验证结果
  -> 根因与预防
~~~

## 4. 事故摘要模板

~~~text
Incident title:
Incident time:
Owner:
Impacted platform:
Impacted users:
User visible symptom:
Discovered by:
Current status:
~~~

建议至少写清：

- 是桌面端、Android、relay-server，还是多端联动
- 用户看到的是重复升级、闪退、无法同步，还是下载错包
- 问题是发布后立刻发现，还是用户升级后陆续反馈

## 5. 客户端版本回写

### 5.1 Desktop

至少记录：

- `local-agent/package.json` 里的 `version`
- 实际上传安装包文件名
- 安装包 `sha256`
- 本地构建时间或产物修改时间

模板：

~~~text
desktop version:
desktop package:
desktop sha256:
desktop built at:
desktop notes:
~~~

### 5.2 Android

至少记录：

- `android-app/app/build.gradle.kts` 里的 `versionName`
- `versionCode`
- 实际上传 APK 路径和文件名
- `output-metadata.json` 看到的版本信息

模板：

~~~text
android versionName:
android versionCode:
android package:
android output-metadata:
android notes:
~~~

### 5.3 relay-server

如果这次事故和 relay-server 联动发布有关，至少记录：

- 部署时间
- 构建标识
- 是否执行过回滚
- 回滚到哪个构建

模板：

~~~text
relay deployed at:
relay build:
relay rollback:
relay rollback target:
relay notes:
~~~

## 6. 更新中心回写

这一部分要避免以后再出现“只知道升级出错，但不知道更新中心当时到底挂的是哪个 release id”。

至少记录：

- `/admin/releases` 里问题版本的 `release id`
- `platform / channel / arch / version / build`
- `filename`
- `published`
- `mandatory`
- `min_supported_version`
- `/api/update/check` 当时返回的 `latestVersion / build / downloadUrl`

模板：

~~~text
release id:
platform:
channel:
arch:
version:
build:
filename:
published:
mandatory:
min_supported_version:
update check latestVersion:
update check build:
update check downloadUrl:
notes:
~~~

## 7. GitHub Release 回写

至少记录：

- tag
- release title
- 附件名
- 附件是否和更新中心一致
- 是否执行了撤回说明、附件替换或 hotfix tag

模板：

~~~text
github tag:
github title:
github assets:
github note updated:
github retracted:
github hotfix tag:
notes:
~~~

## 8. 回滚与热修动作回写

这一部分只记录“最终做了什么”，不要和现场操作命令混在一起。

至少明确：

- 是否撤了更新中心问题版本
- 是否保留了 GitHub Release 但标记撤回
- 是否补了热修版本
- 是否回滚了 relay-server
- 最后对外稳定版本是什么

模板：

~~~text
update center retracted:
github release retracted:
hotfix version:
hotfix release id:
relay rollback executed:
final stable version:
decision summary:
~~~

## 9. 验证结果回写

事故收口后，至少记录最小验证：

- `/api/update/check` 是否已返回正确版本
- 下载链接是否恢复正确
- Android / Desktop 是否不再重复提示错误版本
- 如涉及 relay-server，`/health` 和 `/admin/api/overview` 是否恢复

模板：

~~~text
desktop update check:
android update check:
download verification:
desktop verification:
android verification:
relay health:
admin overview:
verified by:
verified at:
~~~

## 10. 根因与预防动作

这一部分不要只写“已修复”，要写出下次如何拦住。

建议至少拆成三类：

### 10.1 根因

- 版本号未同步更新
- 上传了错误产物
- 更新中心记录未切换
- GitHub Release 说明或附件未同步
- relay-server 新部署和客户端版本不兼容

### 10.2 为什么没在发版前发现

- 发版前未做 `/api/update/check` 回查
- 未核对 `versionName / versionCode`
- 未比对 GitHub Release 附件和更新中心附件
- 未记录 release id 和实际构建产物映射

### 10.3 预防动作

- 把 release id 回写进发布说明
- 每次发版后固定回查 `/api/update/check`
- 热修和回滚结束后固定补事故回写
- 让路线图、发布记录、更新中心记录都能互相追踪

## 11. 完整回写示例

~~~text
Incident title: Android 1.2.22 update crash
Incident time: 2026-04-20 10:40
Owner: release-owner
Impacted platform: android
Impacted users: users upgraded from update center
User visible symptom: app crashes immediately after launch
Current status: hotfix released

android versionName: 1.2.22
android versionCode: 122
android package: app-release.apk

release id: 225
platform: android
version: 1.2.22
build: 122
update check latestVersion: 1.2.22

github tag: android-v1.2.22
github assets: AgentFlow-1.2.22-release.apk

update center retracted: yes
github release retracted: marked in release note
hotfix version: 1.2.23
hotfix release id: 226
final stable version: 1.2.23

android update check: now returns 1.2.23
android verification: fresh install ok, upgrade ok

root cause: encrypted preference compatibility bug introduced in 1.2.22
prevention: post-release launch verification added for Android
~~~

## 12. 当前结论

后续只要发布事故已经进入“已处理完”阶段，就把现场结论统一落到这份模板里，避免更新中心、GitHub、客户端版本号和回滚动作继续各记各的。
