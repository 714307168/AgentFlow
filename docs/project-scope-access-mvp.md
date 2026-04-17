# 项目级授权 MVP 实施方案

更新时间：2026-04-17
关联设计：[`docs/controlled-remote-authorization.md`](./controlled-remote-authorization.md)

## 1. 目标

这一版不是把完整权限系统一次做完，而是先补一个最小可上线闭环：

- 授权某个账号访问某台桌面节点时，可以同时勾选允许访问的项目
- 被授权人登录后，只能看到授权范围内的项目
- 进入项目后，只能执行授权能力允许的动作
- 撤销授权、授权过期后，客户端范围自动收缩

这一版的核心价值不是“权限更复杂”，而是解决当前最明显的问题：

> 一个桌面节点下有很多长期项目时，不能因为给了协作者节点访问权，就默认把全部项目都暴露给他。

## 2. 首期范围

### 2.1 必做

- 授权记录支持项目范围
- 项目列表按 scope 裁切
- 项目详情和会话入口按 scope 校验
- 文件下载能力受授权能力限制
- 诊断查看/导出能力受授权能力限制
- 撤销授权和过期授权生效

### 2.2 暂不做

- 复杂多角色编辑器
- 协作组单独权限矩阵
- 每条消息级别的细粒度可见性
- 单个按钮几十个权限开关
- 企业级审批流

## 3. 用户故事

### 3.1 授权人

作为桌面节点所有者，我希望：

- 选择某个账号作为协作者
- 只授权它访问指定项目
- 指定它只能看、能回复，还是还能操作
- 需要时撤销授权或设置过期时间

### 3.2 被授权人

作为协作者，我希望：

- 登录后直接看到我能协作的项目
- 看不到不属于我的项目
- 在有权限的项目里正常查看消息、状态和文件
- 遇到被限制的动作时有明确提示，而不是报错或空白

## 4. 授权模型收口

首期沿用上一份设计文档的轻量模型：

- 节点：桌面设备本身是否可访问
- 项目范围：本次授权允许访问哪些项目
- 能力包：`observe / collaborate / operate / admin`

首期不拆更多角色，只做能力包和项目范围组合。

### 4.1 能力包首期映射

- `observe`
  - 可见项目列表
  - 可看聊天、活动、运行状态
  - 不可发消息
  - 不可下载受限附件
  - 不可导出诊断
- `collaborate`
  - 包含 `observe`
  - 可发消息
  - 可接收和下载授权范围内文件
  - 不可操作重连/补拉/预设动作
- `operate`
  - 包含 `collaborate`
  - 可触发重连、补拉、重试等低风险运维动作
  - 可看更多诊断摘要
- `admin`
  - 包含 `operate`
  - 可管理授权和高风险系统动作

## 5. 数据模型建议

建议基于 `node_access_grants` 落第一版，不额外铺太多表。

### 5.1 建议字段

- `grant_id`
- `desktop_device_id`
- `owner_account_id`
- `target_account_id`
- `target_device_id` 可空
- `scope_type`
- `scope_project_ids_json`
- `capability_bundle`
- `allow_file_download`
- `allow_diagnostics`
- `expires_at`
- `revoked_at`
- `created_at`
- `updated_at`
- `note`

### 5.2 字段约束建议

- `scope_type` 首期只支持 `all_projects` 和 `selected_projects`
- 当 `scope_type = selected_projects` 时，`scope_project_ids_json` 必填
- `expires_at` 允许为空，表示长期有效
- `target_device_id` 为空表示该账号下所有设备都生效

## 6. API 方案

首期建议补 5 类接口。

### 6.1 查询授权列表

`GET /api/access/grants?desktop_device_id=...`

用途：

- 节点拥有者查看当前授权关系
- 桌面端设置页渲染授权管理列表

### 6.2 创建授权

`POST /api/access/grants`

请求体建议：

```json
{
  "desktopDeviceId": "desktop-1",
  "targetAccountId": "user-2",
  "targetDeviceId": null,
  "scopeType": "selected_projects",
  "scopeProjectIds": ["project-a", "project-b"],
  "capabilityBundle": "collaborate",
  "allowFileDownload": true,
  "allowDiagnostics": false,
  "expiresAt": null,
  "note": "现场部署协作"
}
```

### 6.3 更新授权

`PATCH /api/access/grants/:id`

允许修改：

- 项目范围
- 能力包
- 文件/诊断开关
- 过期时间
- 备注

### 6.4 撤销授权

`POST /api/access/grants/:id/revoke`

要求：

- 幂等
- 返回撤销后的最新有效状态

### 6.5 查询当前有效 scope

`GET /api/access/effective-scope`

建议返回：

```json
{
  "accountId": "user-2",
  "deviceId": "android-1",
  "desktopScopes": [
    {
      "desktopDeviceId": "desktop-1",
      "scopeType": "selected_projects",
      "projectIds": ["project-a", "project-b"],
      "capabilityBundle": "collaborate",
      "allowFileDownload": true,
      "allowDiagnostics": false,
      "expiresAt": null
    }
  ]
}
```

## 7. 客户端行为

### 7.1 桌面端

授权拥有者侧需要：

- 在设置页看到授权管理入口
- 新增授权时选择账号、项目范围、能力包和过期时间
- 编辑授权时支持调整项目勾选
- 撤销后立即刷新授权列表

### 7.2 Android / 后续移动端

被授权人侧需要：

- 登录后先拿 `effective-scope`
- 项目列表只展示 `scope` 内项目
- 对 scope 外项目，即使本地缓存里有旧记录，也要在同步后剔除
- 进入项目详情前再次做本地 scope 校验，避免越权打开旧缓存页
- 文件下载、诊断入口按能力包置灰或隐藏

### 7.3 缓存与同步

需要特别处理：

- 当 scope 缩小时，本地缓存项目要及时清理或隐藏
- 当授权刚新增时，客户端下次 `meta/delta` 后要能把新项目拉进来
- 当授权撤销或过期时，WebSocket 和 HTTP 补拉都不能继续回传已失效项目

## 8. UI 建议

### 8.1 桌面端授权弹窗

首期建议字段：

- 协作者账号
- 项目多选
- 能力包单选
- 允许下载文件
- 允许看诊断
- 过期时间
- 备注

### 8.2 列表展现

授权列表中至少展示：

- 被授权账号
- 节点
- 项目数或项目摘要
- 能力包
- 过期时间
- 当前状态：生效 / 已过期 / 已撤销

### 8.3 被限制时的提示文案

不要只返回 403 后弹一个通用错误，建议明确区分：

- 你没有访问该项目的授权
- 你当前授权不包含文件下载
- 你当前授权不包含诊断查看
- 授权已过期，请联系节点拥有者

## 9. 服务端校验建议

至少要做这些校验：

- 只有节点拥有者或管理员能创建/编辑/撤销授权
- `scopeProjectIds` 必须属于该节点下真实存在的项目
- 被授权账号不能给自己再次扩权
- 已过期/已撤销授权不参与 `effective-scope` 汇总
- 文件下载、诊断导出、项目详情接口都要走同一套授权检查

## 10. 风险点

### 10.1 缓存残留

最常见风险是：服务端已经撤销，但手机本地还残留旧项目缓存。

应对：

- `effective-scope` 拉取后先做本地裁切
- 被移出的项目不再参与任何 sync 计划
- 必要时在 UI 侧做“已失去授权”占位清理

### 10.2 授权膨胀

如果后续把太多动作都塞进 `operate`，会让能力包失去边界。

应对：

- 首期只放低风险动作进 `operate`
- 高风险动作仍单独确认

### 10.3 接口漏校验

如果只在项目列表做过滤，而文件下载或诊断接口没补校验，授权就形同虚设。

应对：

- 以 `effective-scope` 和服务端统一授权检查为唯一真相
- 列表、详情、文件、诊断统一走同一套校验入口

## 11. 验收标准

- 新建授权时可以明确勾选项目范围
- 被授权账号看不到 scope 外项目
- 撤销授权后，客户端下次刷新后 scope 外项目消失
- 被授权账号无法下载未授权项目的文件
- 被授权账号无法访问未授权项目的诊断内容
- 过期授权自动失效
- 项目列表、项目详情、文件下载、诊断接口都有一致的授权结果

## 12. 测试建议

### 12.1 服务端

- 授权创建/更新/撤销单元测试
- `effective-scope` 汇总测试
- 文件下载与诊断接口越权测试
- 授权过期测试

### 12.2 桌面端

- 授权弹窗表单校验
- 项目多选回填
- 授权列表状态展示

### 12.3 Android

- scope 拉取后本地项目裁切
- 被移除项目的缓存清理或隐藏
- 受限动作入口隐藏/禁用

## 13. 发版节点

- `R-project-scope-access-doc`: 项目级授权 MVP 实施文档完成并挂回 roadmap
- `R-project-scope-access`: 首个项目级授权 MVP 联动版
- 三端实施与发版检查表见：`docs/project-scope-access-checklist.md`

## 14. 当前建议

下一步最稳的落地顺序是：

1. 先补 relay-server 的授权数据模型和 `effective-scope` 接口
2. 再让桌面端授权管理 UI 支持项目多选
3. 再让 Android / 后续移动端按 scope 裁切列表和详情入口
4. 最后补文件与诊断的统一校验

这样能先把最关键的“项目级授权”做实，再决定是否往更细的能力包和审计扩展。
