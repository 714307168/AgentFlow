# 平台专项收口摘要模板

更新时间：2026-04-21

这份模板用于给某个平台专项阶段写一份轻量收口摘要。

它适合处理的不是：

- 一次具体发版
- 一次具体热修
- 一次具体观察窗口

它适合的是：

- 某个平台阶段性收口
- 某个平台一轮范围确认完成
- 某个平台首发准备阶段完成
- 某个平台当前边界已经明确，需要留一个阶段结论

常见场景：

- `R-mac-first`
- `R-ios-safe-track`
- `R-mini-lite`

## 1. 适用目标

这份模板重点回答：

1. 这个平台专项本轮收到了哪一步。
2. 当前已完成的范围是什么。
3. 当前明确不做或延后的范围是什么。
4. 现在可以对外怎么描述这个平台状态。
5. 下一步最优先继续推进什么。

## 2. 使用顺序

建议顺序：

1. 先在平台专项文档里保留完整边界和细节。
2. 再用这份模板抽出阶段性收口结论。
3. 最后把摘要同步回路线图和 README。

~~~text
平台专项设计 / 验收
  -> 平台专项收口摘要
  -> 路线图摘要
~~~

## 3. 摘要模板

~~~text
Track title:
Platform:
Roadmap milestone:
Current stage:
Summary:

Included scope:
Deferred scope:
Current release state:
User-facing position:
Known risks:
Next actions:
~~~

## 4. 字段说明

### 4.1 Current stage

建议直接写当前所处阶段：

- planning complete
- first-release ready
- safe-track ready
- lite boundary confirmed
- waiting for implementation
- waiting for release verification

### 4.2 Included scope

这里只写本轮已经明确落地或已确认纳入的内容，例如：

- 登录与账号绑定
- 项目列表
- 聊天查看与回复
- 文件接收
- 更新检查

### 4.3 Deferred scope

这里只写明确延后或明确不进当前阶段的内容，例如：

- 完整远程控制
- 复杂后台保活
- 通用桌面镜像能力
- 重型设置页

### 4.4 Current release state

建议固定写一种状态：

- 未开始发版
- 首发准备完成
- 首发待验证
- 已首发
- 首发后继续补边界

## 5. 精简示例

### 5.1 mac

~~~text
Track title: mac first release
Platform: mac
Roadmap milestone: R-mac-first
Current stage: first-release ready
Summary: mac 首发边界、更新中心接入和回滚要求已明确，可进入实现和签名验证阶段

Included scope: build target, update center integration, data/log paths, permissions, rollback path
Deferred scope: universal package optimization, broader automation polish
Current release state: 首发准备完成
User-facing position: 首个可安装桌面双平台版本正在推进
Known risks: signing, notarization, update install flow
Next actions: start build verification and notarization path validation
~~~

### 5.2 iOS

~~~text
Track title: iOS safe track
Platform: iOS
Roadmap milestone: R-ios-safe-track
Current stage: safe-track ready
Summary: iOS 首发边界已经收敛到消息、状态、文件和轻交互，不按安卓镜像版推进

Included scope: login, binding, project list, chat, workgroup chat, file receive, log upload
Deferred scope: full remote control, heavy background recovery, Android-level parity
Current release state: 首发边界确认完成
User-facing position: 先做可上架、可维护的 companion 能力
Known risks: review constraints, background limits
Next actions: align protocol reuse and first-release acceptance path
~~~

### 5.3 小程序

~~~text
Track title: mini-program lite
Platform: mini-program
Roadmap milestone: R-mini-lite
Current stage: lite boundary confirmed
Summary: 小程序首发坚持轻入口定位，只承担查看、快速回复和文件接收

Included scope: login, message list, quick reply, task status, file receive, refresh/reconnect actions
Deferred scope: heavy settings, full control terminal, large local cache
Current release state: 首发边界确认完成
User-facing position: 快查看、快回复、快离开的轻入口
Known risks: long-connection limitations, lightweight cache constraints
Next actions: keep capability scope narrow and prepare first acceptance checklist
~~~

## 6. 和其他文档的分工

- 要看平台完整边界：看平台专项文档本身
- 要看平台首发摘要：看 [平台首发摘要模板](./platform-first-release-summary-template.md)
- 要看具体发版摘要：看 [单端发版摘要模板](./single-end-release-summary-template.md) 或 [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- 要看热修和观察：看对应热修与观察模板

## 7. 当前结论

后续平台专项节点不再只在路线图里留一句“继续推进”，而是用这份模板把当前已确认范围、延后范围、用户定位和下一步动作单独收口。
