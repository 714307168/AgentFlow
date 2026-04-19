# 版本回滚与撤回操作模板

更新时间：2026-04-19

这份模板用于给 `R-release-consistency` 补齐最后一块操作文档，避免出现“发现问题了，但不知道该撤更新中心、回滚 GitHub 还是重新发一个热修版本”的临场混乱。

它关注的是发布后的止损动作，不替代正常发布流程。

## 1. 适用场景

以下情况应立即评估回滚或撤回：

- 客户端升级后无法启动
- 更新中心持续重复提示同一版本升级
- 桌面端或 Android 关键主链路不可用
- relay-server 新版部署后健康检查异常
- 上传到了错误附件、错误版本号或错误平台包

## 2. 决策原则

先判断是哪一种：

1. 只撤下载入口，不改现网服务
2. 回滚客户端可见最新版本
3. 回滚 relay-server 部署
4. 重新发一个热修版本覆盖问题版本

推荐原则：

- 只要新版本会导致闪退、无法登录、无法同步，优先撤回更新入口。
- 只要服务端部署影响所有端使用，优先回滚 relay-server。
- 如果问题能通过极快热修解决，也要先停止继续下发问题版本。

## 3. 基本记录

~~~text
Incident time:
Owner:
Impacted platform:
Current version:
Target rollback version:
User impact:
Decision:
~~~

## 4. 更新中心撤回清单

- [ ] 在 `/admin/releases` 确认问题版本 release id
- [ ] 撤下或取消发布问题版本
- [ ] 确认 `/api/update/check` 不再返回问题版本
- [ ] 如有必要，重新指向上一个稳定版本
- [ ] 记录是否已有用户下载到问题包

建议记录：

~~~text
platform:
bad release id:
retracted:
fallback version:
check endpoint result:
notes:
~~~

## 5. GitHub Release 处理

至少明确一种处理方式：

- 保留 release，但在标题和说明里标记已撤回
- 删除错误附件并重新上传正确附件
- 保留 tag，仅补充警告说明
- 如流程允许，再补一个明确的 hotfix tag

约束：

- 不要在没有记录的情况下静默替换附件。
- 不要让 GitHub Release 和更新中心指向不同版本结论而无人知晓。

## 6. relay-server 回滚清单

- [ ] 确认当前线上构建标识
- [ ] 回滚到上一个可用构建
- [ ] 重新执行健康检查
- [ ] 核对 `/health` 和关键管理接口
- [ ] 记录数据库迁移或兼容性风险

建议记录：

~~~text
current build:
rollback build:
deploy method:
health check:
admin overview:
notes:
~~~

## 7. 客户端回滚清单

### Desktop

- [ ] 停止下发问题安装包
- [ ] 如已自动下载，确认不会继续提示安装问题版本
- [ ] 上一个稳定安装包仍可下载

### Android

- [ ] 停止下发问题 APK
- [ ] 校验更新接口返回是否回到稳定版本
- [ ] 如新包已导致闪退，准备热修版本并单独标记风险说明

## 8. 热修覆盖模板

如果不是单纯回滚，而是马上补一个热修版本，至少记录：

~~~text
hotfix version:
fix scope:
tests:
update center release id:
github tag:
rollout strategy:
~~~

## 9. 事故后回写

问题收口后必须回写：

- [ ] 路线图发版节点
- [ ] 发布说明
- [ ] 更新中心记录
- [ ] GitHub Release 说明
- [ ] 本次事故的根因和预防动作

## 10. 当前结论

后续只要出现“版本已发出，但需要止损”的情况，先按这份模板判断是撤更新、回滚部署，还是补热修，不再临时靠记忆处理。
