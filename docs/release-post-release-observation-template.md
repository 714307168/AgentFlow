# 发版后持续观察记录模板

更新时间：2026-04-20

这份模板用于在版本已经发布出去之后，持续记录上线后的一段观察期结果。

它关注的不是：

- 发版前检查
- 上传发布步骤
- 事故后的回滚动作

它关注的是：

- 刚发出去后有没有立刻出现异常
- 30 分钟、2 小时、24 小时内是否出现新问题
- 更新检查、下载、安装、启动、主链路是否持续正常
- 是否已经可以结束观察，还是要继续盯版本

建议搭配：

- [发布回写模板](./release-writeback-template.md)
- [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- [发布事故回写模板](./release-incident-writeback-template.md)
- [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)

## 1. 适用场景

以下场景建议都补观察记录：

- desktop 单端发布
- Android 单端发布
- desktop + Android 联动发布
- 含 relay-server 的联动发布
- 热修版本刚上线后的稳定性观察

## 2. 观察目标

这份模板主要回答五个问题：

1. 发布后是否立刻出现明显异常。
2. 更新中心和下载链路是否持续稳定。
3. 安装、启动、登录、同步、聊天主链路是否稳定。
4. 日志信号和线上反馈是否在上升。
5. 当前版本是否可以结束观察，还是要继续盯或准备热修。

## 3. 使用方式

建议把观察窗口拆成固定时间点，不要只写一句“观察正常”：

1. 发布后 `0-30 分钟`
2. 发布后 `30 分钟-2 小时`
3. 发布后 `2-24 小时`

如果是高风险版本，也可以追加：

4. 发布后 `24-72 小时`

推荐记录顺序：

~~~text
发布摘要
  -> 观察时间点
  -> 更新链路状态
  -> 主链路状态
  -> 日志/用户反馈
  -> 结论
~~~

## 4. 基本信息模板

~~~text
Release title:
Release date:
Owner:
Platforms:
Roadmap milestone:
Observed version:
Update center release id:
GitHub tag:
~~~

## 5. 每个观察时间点模板

对每个时间点至少记录：

- 观察窗口
- 更新检查结果
- 下载与安装结果
- 启动与登录结果
- 主链路结果
- 是否出现新的 signal code 或用户反馈
- 当前判断

模板：

~~~text
Observation window:
Update check:
Download/install:
Startup/login:
Main flow:
Signals/logs:
User feedback:
Decision:
Notes:
~~~

## 6. 推荐观察项

### 6.1 更新链路

至少看这些：

- `/api/update/check` 是否继续返回正确版本
- 下载链接是否持续可访问
- 是否还有重复提示旧版本升级
- 是否有错误附件、错误包名、错误 build 暴露出来

### 6.2 客户端主链路

至少看这些：

- 安装后能否正常启动
- 登录和 relay 连接是否正常
- 项目列表是否同步
- 聊天和消息刷新是否正常
- 关键设置页或更新页是否正常

### 6.3 服务端和日志

如果本轮联动了 relay-server，至少看这些：

- `/health` 是否正常
- `/admin/api/overview` 是否正常
- 是否出现新的高频 `signal code`
- 是否有 close code、sync gap、auth recovery 异常集中上升

## 7. 结束观察的建议条件

满足下面条件时，通常可以结束这一轮观察：

- 更新接口持续返回正确版本
- 安装、启动、登录、同步主链路稳定
- 没有明显新增高频信号
- 没有持续新增用户投诉
- 没有再次进入撤更新或热修判断

如果不满足，就不要写“观察完成”，而要明确：

- 延长观察
- 准备热修
- 撤更新
- 回滚 relay-server

## 8. 精简示例

~~~text
Release title: Android 1.2.24 hotfix observation
Release date: 2026-04-19
Owner: release-owner
Platforms: android
Roadmap milestone: R-mobile-stability
Observed version: 1.2.24 (build 108)
Update center release id: 225
GitHub tag: android-v1.2.24

Observation window: 0-30 minutes
Update check: ok
Download/install: ok
Startup/login: ok
Main flow: sync and chat ok
Signals/logs: no new critical spikes
User feedback: no new crash reports
Decision: continue observation

Observation window: 30 minutes-2 hours
Update check: ok
Download/install: ok
Startup/login: ok
Main flow: stable
Signals/logs: no repeated auth or sync failures
User feedback: no new blocking issues
Decision: keep current release

Observation window: 2-24 hours
Update check: ok
Download/install: ok
Startup/login: stable
Main flow: stable
Signals/logs: normal
User feedback: no significant regressions
Decision: observation complete
~~~

## 9. 和其他文档的分工

- 要看发版前检查：看 [发布一致性检查模板](./release-consistency-checklist.md)
- 要看正常发版后的完整记录：看 [发布回写模板](./release-writeback-template.md)
- 要看多端联动最终摘要：看 [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- 要看事故、回滚、热修：看 [发布事故回写模板](./release-incident-writeback-template.md)
- 要看从信号到止损决策：看 [信号到回滚与热修判断模板](./release-ops-signal-decision-template.md)

## 10. 当前结论

后续发版后不再只写一句“已观察正常”，而是把观察窗口、主链路状态、日志信号和是否结束观察统一落到这份模板里，方便后续追溯和判断是否需要继续发补丁。
