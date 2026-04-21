# 跨端联动首发回写示例

更新时间：2026-04-21

这份文档不再讲完整模板，而是直接给出“跨端联动首发后，路线图里该怎么回写”的短样例。

它适合解决这几个问题：

- 已经做完多端首发验收，但路线图里还总是回写成长段说明
- 已经有多端首发验收模板和多端联动发版摘要模板，但缺少更像真实路线图语气的短样例
- 想把 `desktop / Android / relay-server` 或未来 `desktop-mac / iOS / 小程序` 的联动首发节点稳定控制在摘要级别

建议配合：

- [多端首发验收模板](./multi-end-launch-acceptance-template.md)
- [多端联动发版摘要模板](./multi-end-release-summary-template.md)
- [发布节点回写示例](./release-roadmap-writeback-examples.md)

## 1. 使用方式

推荐顺序：

1. 先在多端首发验收模板里保留完整构建、测试、发布和回查记录。
2. 再从完整记录里抽 3 到 5 行，回写到路线图。
3. 路线图里只保留“发了哪些端、版本是什么、是否联动、结论是什么”，不要重新展开验收过程。

路线图里最好让人一眼看出：

- 本轮首发涉及哪些端
- 每个端的版本或 build 是什么
- relay-server 是否联动部署
- 当前结论是已首发、条件性首发，还是只发了部分端

## 2. desktop + Android 联动首发示例

### 2.1 双端一起首发

~~~text
- `R-cross-end-transfer` 联动首发完成：
  - desktop `1.3.0`，Android `1.3.0 (build 120)`
  - 更新中心 release id：desktop `310`，Android `311`
  - 结论：首轮跨端传输能力已完成双端对外首发，进入联动观察
~~~

### 2.2 双端加 relay-server 联动首发

~~~text
- `R-cross-end-transfer` 联动首发完成：
  - desktop `1.3.0`，Android `1.3.0 (build 120)`
  - relay-server `2026.5.02 build 1` 已联动部署
  - 更新中心 release id：desktop `310`，Android `311`
  - 结论：跨端传输底座首发版本已联动上线，后续继续观察长链路稳定性
~~~

## 3. 新平台并入现有双端首发示例

### 3.1 desktop-win + desktop-mac

~~~text
- `R-mac-first` 联动首发完成：
  - desktop-win `1.3.2`，desktop-mac `1.0.0`
  - 更新中心 release id：win `320`，mac `321`
  - 结论：双桌面端已形成首个可对外联动版本，后续继续补签名和安装链路细节
~~~

### 3.2 desktop + Android + iOS Safe Track

~~~text
- `R-ios-safe-track` 联动首发完成：
  - desktop `1.3.4`，Android `1.3.4 (build 125)`，iOS Safe Track `0.1.0`
  - 结论：移动三端首轮协同能力已形成受限可用版本，后续继续稳观察和弱网恢复
~~~

### 3.3 desktop + Android + 小程序 Lite

~~~text
- `R-mini-lite` 联动首发完成：
  - desktop `1.3.5`，Android `1.3.5 (build 127)`，小程序 Lite `0.1.0`
  - 结论：轻入口协同链路已完成首发，当前继续维持 Lite 边界并补交互细节
~~~

## 4. 条件性首发或部分首发示例

### 4.1 只发部分端

~~~text
- `R-cross-end-transfer` 条件性首发：
  - desktop `1.3.0` 已发布，Android 首发延后
  - relay-server 已联动部署
  - 结论：当前先放行桌面链路，安卓端待首轮问题收口后补发
~~~

### 4.2 新平台灰度并入

~~~text
- `R-ios-safe-track` 条件性首发：
  - desktop / Android 维持当前稳定版本
  - iOS Safe Track `0.1.0` 先做受限范围首发
  - 结论：当前只验证安全路径与基础链路，不把三端能力一次性全放开
~~~

## 5. 不推荐写法

不要在路线图里继续写这种又长又散的段落：

~~~text
本轮联动首发整体推进顺利，涉及多个端和一些服务端调整，版本也都处理了，后面继续看情况补细节和观察结果。
~~~

原因：

- 看不出到底发了哪些端
- 看不出具体版本和 release id
- 看不出是完整联动首发还是条件性首发
- 很容易把路线图重新写成过程汇报

## 6. 当前结论

后续跨端联动首发节点回写时，优先复用这份文档里的短样例，把完整验收和发版结论压成路线图语气，避免总览继续膨胀。
