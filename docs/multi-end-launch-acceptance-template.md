# 多端首发验收模板

更新时间：2026-04-19

这份模板用于记录某一轮多端能力上线时的统一验收结果，避免出现“代码做完了，但构建、测试、发布、回查没有统一留痕”的情况。

适用场景：

- `desktop + Android` 联动发布
- `desktop + Android + relay-server` 联动发布
- `mac` / `iOS` / `微信小程序` 首发节点

## 1. 基本信息

```text
Release node:
Date:
Owner:
Scope:
Linked docs:
```

## 2. 本轮涉及端

按实际勾选：

- [ ] desktop-win
- [ ] desktop-mac
- [ ] Android
- [ ] iOS
- [ ] 微信小程序
- [ ] relay-server

## 3. 版本信息

```text
desktop-win version:
desktop-mac version:
android versionName:
android versionCode:
ios version:
mini-program build tag:
relay-server build:
```

## 4. 构建结果

每一端至少记录：

- 构建命令
- 产物路径
- SHA256
- 构建时间
- 构建机器或环境

模板：

```text
platform:
build command:
artifact:
sha256:
built at:
environment:
```

## 5. 测试结果

每一端记录本轮实际跑过的测试，而不是写计划中的测试。

推荐记录：

- relay-server `go test ./...`
- local-agent `npm test`
- android-app `.\gradlew.bat :app:testReleaseUnitTest`
- 首发端专有验证
- 手动回归项

模板：

```text
platform:
automated tests:
manual checks:
result:
notes:
```

## 6. 发布结果

每一端记录：

- 是否发布到更新中心
- 更新中心 release id
- 是否发布到 GitHub Release
- GitHub tag
- 是否联动 relay-server 部署

模板：

```text
platform:
update center:
update center release id:
github release:
github tag:
relay deployed:
```

## 7. 发布后回查

至少记录：

- 更新检查接口是否返回正确版本
- 下载链接是否可访问
- 客户端是否能识别到新版本
- 安装或升级后是否正常启动
- 关键主链路是否可用

模板：

```text
platform:
check endpoint:
download verified:
install verified:
startup verified:
main flow verified:
notes:
```

## 8. 风险与阻塞

如果本轮有未完成项，不要只写“待补”，而要明确：

- 具体缺口
- 影响范围
- 是否阻塞发布
- 下一步负责人

模板：

```text
issue:
impact:
blocks release:
owner:
next action:
```

## 9. 回滚记录

如果需要回滚，记录：

- 回滚触发原因
- 回滚到哪个版本
- 更新中心是否撤回
- GitHub Release 是否保留或重标记
- 用户侧影响

## 10. 结论

最后只保留一个明确结论：

- 可发布
- 条件性可发布
- 暂缓发布

并补一句理由。
