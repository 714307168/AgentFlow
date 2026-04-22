# 项目级授权 MVP 三端实施与发版检查表

更新时间：2026-04-23
关联方案：[`docs/project-scope-access-mvp.md`](./project-scope-access-mvp.md)

## Progress Update

- relay-server now filters device sync responses by project scope instead of stopping at agent-level grants.
- relay transfer access now allows authorized controllers to list, view, and download files under granted projects.
- sibling projects on the same shared agent remain hidden, and regression coverage now includes scoped full-sync, scoped delta cleanup, shared-project transfer access, and same-agent cross-project transfer denial.
- scoped sync regression coverage now also verifies full-sync and delta stay consistent, and matching revisions no longer skip stale project removals.
- Android cached scope now treats blank or unknown agent routes as blocked when explicit project scopes exist, and stale cached sessions from inaccessible agents are marked for pruning instead of being kept.
- Android project removals now clear draft and chat snapshot caches consistently across full sync, delta sync, and scope-prune paths, with regression coverage for replacement and delta removal planning.
- Android chat pages now auto-exit with a scoped access message when the current project is revoked during scope shrink, so stale open pages no longer linger after access is removed.

## 1. 用途

这一份文档不再解释为什么做，而是把 `R-project-scope-access` 直接拆成：

- relay-server 要做什么
- desktop 要做什么
- Android 要做什么
- 联调时怎么验
- 发版前要检查什么

适合作为下一轮真实开发和发版时的执行清单。

## 2. 版本目标

本次目标版本收口为一个最小闭环：

- 服务端能保存和计算项目级授权 scope
- 桌面端能创建/编辑/撤销项目级授权
- Android 端能按有效 scope 裁切项目列表、详情入口、文件和诊断入口
- 三端对未授权项目保持一致的拒绝结果

## 3. relay-server 实施清单

### 3.1 数据模型

- [ ] 新增 `node_access_grants` 表或等价存储结构
- [ ] 支持 `scope_type = all_projects | selected_projects`
- [ ] 支持 `scope_project_ids_json`
- [ ] 支持 `capability_bundle`
- [ ] 支持 `allow_file_download`
- [ ] 支持 `allow_diagnostics`
- [ ] 支持 `expires_at` / `revoked_at`

### 3.2 接口

- [ ] `GET /api/access/grants`
- [ ] `POST /api/access/grants`
- [ ] `PATCH /api/access/grants/:id`
- [ ] `POST /api/access/grants/:id/revoke`
- [x] `GET /api/access/effective-scope`

### 3.3 授权计算

- [ ] 只返回未过期且未撤销授权
- [ ] 同一账号多条授权能正确合并
- [ ] `selected_projects` 正确转换为 project id 集合
- [ ] 当 `target_device_id` 不为空时，只对匹配设备生效

### 3.4 统一校验入口

- [ ] 项目列表接口走 scope 过滤
- [ ] 项目详情接口走 scope 校验
- [ ] 文件下载接口走 scope + capability 校验
- [ ] 诊断查看/导出接口走 capability 校验
- [x] scope 外项目不进入增量同步回包

### 3.5 服务端测试

- [ ] 授权创建/编辑/撤销测试
- [x] `effective-scope` 汇总测试
- [ ] 过期授权测试
- [ ] 文件下载越权测试
- [ ] 诊断接口越权测试
- [x] scope 外项目不回传测试

## 4. desktop 实施清单

### 4.1 设置页与交互

- [ ] 新增授权管理入口
- [ ] 授权列表显示账号、节点、项目摘要、能力包、状态
- [ ] 新建授权弹窗支持项目多选
- [ ] 编辑授权支持回填项目勾选
- [ ] 撤销授权支持风险确认

### 4.2 表单字段

- [ ] 协作者账号选择
- [ ] 项目多选
- [ ] 能力包单选
- [ ] 文件下载开关
- [ ] 诊断查看开关
- [ ] 过期时间
- [ ] 备注

### 4.3 数据联动

- [ ] 创建后自动刷新授权列表
- [ ] 编辑后列表状态立即更新
- [ ] 撤销后状态显示为已撤销
- [ ] 过期授权在 UI 中有明确状态

### 4.4 桌面端测试

- [ ] 表单校验测试
- [ ] 项目多选与回填测试
- [ ] 授权列表状态渲染测试
- [ ] 撤销授权交互测试

## 5. Android 实施清单

### 5.1 scope 获取与缓存

- [x] 登录后拉取 `effective-scope`
- [x] App 回前台时刷新 `effective-scope`
- [x] scope 本地缓存与项目缓存分开保存

### 5.2 项目列表裁切

- [x] 只显示 scope 内项目
- [x] 本地残留的 scope 外项目在刷新后隐藏或清理
- [x] scope 刚新增时新项目能进入列表

### 5.3 详情与入口控制

- [x] 进入项目详情前先校验 scope
- [x] scope 外项目不能通过旧深链或旧缓存页打开
- [ ] 文件下载入口按能力包隐藏或禁用
- [ ] 诊断入口按能力包隐藏或禁用
- [ ] 发消息入口按能力包限制

### 5.4 Android 测试

- [x] scope 裁切后列表正确性测试
- [x] 撤销后缓存项目清理/隐藏测试
- [ ] 文件下载入口限制测试
- [ ] 诊断入口限制测试
- [x] 越权打开旧项目页测试

## 6. 联调清单

- [ ] 创建一条 `selected_projects` 授权，只包含 2 个项目
- [ ] 被授权账号登录后只看到这 2 个项目
- [ ] 第 3 个未授权项目无法通过列表进入
- [ ] 第 3 个未授权项目无法通过旧缓存页进入
- [ ] 已授权项目聊天、活动、状态正常
- [ ] 已授权项目文件下载权限符合能力包设置
- [ ] 已授权项目诊断权限符合能力包设置
- [ ] 撤销授权后，客户端刷新后项目列表立即收缩
- [ ] 授权过期后，客户端刷新后项目列表自动收缩

## 7. 发版前检查表

### 7.1 服务端

- [ ] 数据迁移脚本已验证
- [ ] 授权接口文档已更新
- [ ] 越权接口都有统一 403/401 响应
- [ ] 管理后台日志能看到授权变更记录

### 7.2 桌面端

- [ ] 授权 UI 在常见分辨率不挤压
- [ ] 项目多选列表可滚动且可搜索
- [ ] 撤销和过期状态文案清晰

### 7.3 Android

- [x] scope 收缩时不会残留可点击入口
- [ ] 被限制时提示文案不是泛化错误
- [ ] 本地旧缓存不会继续泄露未授权项目内容

### 7.4 三端联动

- [ ] 同一授权在 HTTP 和 WebSocket 路径结果一致
- [ ] scope 内外项目在列表、详情、文件、诊断四类入口一致
- [ ] 撤销/过期后的生效延迟在可接受范围内

## 8. 建议发版顺序

1. 先发 relay-server 内部验证版
2. 再发桌面端带授权管理 UI 的内部版
3. 再发 Android 带 scope 裁切的内部版
4. 三端联调完成后发 `R-project-scope-access`

## 9. 发版节点记录模板

建议后续真正发版时，至少补这些记录：

- 发布日期
- relay-server 版本
- desktop 版本
- Android 版本 / build
- 更新中心 release id
- GitHub Release tag
- 覆盖范围：授权模型 / UI / scope 裁切 / 文件限制 / 诊断限制

## 10. 当前结论

这份清单的作用不是增加文档数量，而是把 `R-project-scope-access` 变成可以直接排期、分工、测试和发版的执行入口。

下一步如果继续做文档优化，配套材料已经补齐：

- 服务端接口返回 schema：[`docs/project-scope-access-api-schema.md`](./project-scope-access-api-schema.md)
- 桌面端授权 UI 草图：[`docs/project-scope-access-desktop-ui-sketch.md`](./project-scope-access-desktop-ui-sketch.md)
- Android scope 收缩与缓存清理时序图：[`docs/project-scope-access-android-scope-sequence.md`](./project-scope-access-android-scope-sequence.md)

当前进度：

- [x] 服务端接口返回 schema
- [x] 桌面端授权 UI 草图
- [x] Android scope 收缩与缓存清理时序图
