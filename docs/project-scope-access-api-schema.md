# 项目级授权 MVP 接口 Schema

更新时间：2026-04-18
关联方案：[`docs/project-scope-access-mvp.md`](./project-scope-access-mvp.md)

## 1. 目标

这份文档只做一件事：把 `R-project-scope-access` 首期需要的 relay-server 接口收成统一 schema，减少后面桌面端、Android 和服务端各自猜字段。

首期覆盖：

- 授权列表
- 创建授权
- 更新授权
- 撤销授权
- 当前有效 scope

## 2. 通用约定

### 2.1 鉴权

- 所有接口都要求已登录
- 创建/编辑/撤销授权要求当前账号是桌面节点拥有者或管理员
- `effective-scope` 返回的是“当前登录账号 + 当前设备”的有效视图

### 2.2 时间字段

- 所有时间统一返回 ISO 8601 UTC 字符串
- 允许为空的时间字段返回 `null`

### 2.3 错误响应

建议统一错误体：

```json
{
  "error": {
    "code": "ACCESS_SCOPE_FORBIDDEN",
    "message": "你没有访问该项目的授权",
    "details": null
  }
}
```

建议首期保留这些错误码：

- `UNAUTHORIZED`
- `FORBIDDEN`
- `ACCESS_GRANT_NOT_FOUND`
- `ACCESS_SCOPE_INVALID`
- `ACCESS_SCOPE_FORBIDDEN`
- `ACCESS_CAPABILITY_FORBIDDEN`
- `VALIDATION_ERROR`

## 3. 枚举定义

### 3.1 `scopeType`

- `all_projects`
- `selected_projects`

### 3.2 `capabilityBundle`

- `observe`
- `collaborate`
- `operate`
- `admin`

### 3.3 `grantStatus`

- `active`
- `expired`
- `revoked`

## 4. 对象 Schema

### 4.1 `AccessGrant`

```json
{
  "id": "grant-1",
  "desktopDeviceId": "desktop-1",
  "desktopDeviceName": "Office-PC",
  "ownerAccountId": "owner-1",
  "targetAccountId": "user-2",
  "targetAccountName": "alice",
  "targetDeviceId": null,
  "scopeType": "selected_projects",
  "scopeProjectIds": ["project-a", "project-b"],
  "scopeProjectSummaries": [
    {
      "id": "project-a",
      "name": "gateway-release"
    },
    {
      "id": "project-b",
      "name": "field-hotfix"
    }
  ],
  "capabilityBundle": "collaborate",
  "allowFileDownload": true,
  "allowDiagnostics": false,
  "expiresAt": null,
  "revokedAt": null,
  "status": "active",
  "note": "现场部署协作",
  "createdAt": "2026-04-18T08:00:00Z",
  "updatedAt": "2026-04-18T08:00:00Z"
}
```

### 4.2 `DesktopEffectiveScope`

```json
{
  "desktopDeviceId": "desktop-1",
  "desktopDeviceName": "Office-PC",
  "scopeType": "selected_projects",
  "projectIds": ["project-a", "project-b"],
  "capabilityBundle": "collaborate",
  "allowFileDownload": true,
  "allowDiagnostics": false,
  "expiresAt": null
}
```

## 5. 接口定义

### 5.1 查询授权列表

`GET /api/access/grants?desktop_device_id={desktopDeviceId}`

用途：

- 桌面端授权管理列表
- 后续后台授权查看

响应：

```json
{
  "items": [
    {
      "id": "grant-1",
      "desktopDeviceId": "desktop-1",
      "desktopDeviceName": "Office-PC",
      "ownerAccountId": "owner-1",
      "targetAccountId": "user-2",
      "targetAccountName": "alice",
      "targetDeviceId": null,
      "scopeType": "selected_projects",
      "scopeProjectIds": ["project-a", "project-b"],
      "scopeProjectSummaries": [
        {
          "id": "project-a",
          "name": "gateway-release"
        }
      ],
      "capabilityBundle": "collaborate",
      "allowFileDownload": true,
      "allowDiagnostics": false,
      "expiresAt": null,
      "revokedAt": null,
      "status": "active",
      "note": "现场部署协作",
      "createdAt": "2026-04-18T08:00:00Z",
      "updatedAt": "2026-04-18T08:00:00Z"
    }
  ]
}
```

校验：

- 缺少 `desktop_device_id` 返回 `VALIDATION_ERROR`
- 非节点拥有者返回 `FORBIDDEN`

### 5.2 创建授权

`POST /api/access/grants`

请求：

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

规则：

- `scopeType = all_projects` 时，`scopeProjectIds` 必须为空或省略
- `scopeType = selected_projects` 时，`scopeProjectIds` 必须非空
- `scopeProjectIds` 中每个项目都必须属于该 `desktopDeviceId`
- `targetAccountId` 不能等于当前授权操作人用于自我扩权的非法场景

响应：

```json
{
  "item": {
    "id": "grant-1",
    "desktopDeviceId": "desktop-1",
    "desktopDeviceName": "Office-PC",
    "ownerAccountId": "owner-1",
    "targetAccountId": "user-2",
    "targetAccountName": "alice",
    "targetDeviceId": null,
    "scopeType": "selected_projects",
    "scopeProjectIds": ["project-a", "project-b"],
    "scopeProjectSummaries": [
      {
        "id": "project-a",
        "name": "gateway-release"
      },
      {
        "id": "project-b",
        "name": "field-hotfix"
      }
    ],
    "capabilityBundle": "collaborate",
    "allowFileDownload": true,
    "allowDiagnostics": false,
    "expiresAt": null,
    "revokedAt": null,
    "status": "active",
    "note": "现场部署协作",
    "createdAt": "2026-04-18T08:00:00Z",
    "updatedAt": "2026-04-18T08:00:00Z"
  }
}
```

### 5.3 更新授权

`PATCH /api/access/grants/{grantId}`

允许修改字段：

- `scopeType`
- `scopeProjectIds`
- `capabilityBundle`
- `allowFileDownload`
- `allowDiagnostics`
- `expiresAt`
- `note`

请求示例：

```json
{
  "scopeType": "selected_projects",
  "scopeProjectIds": ["project-a"],
  "capabilityBundle": "observe",
  "allowFileDownload": false,
  "allowDiagnostics": false,
  "expiresAt": "2026-04-19T00:00:00Z",
  "note": "缩小授权范围"
}
```

响应：

```json
{
  "item": {
    "id": "grant-1",
    "desktopDeviceId": "desktop-1",
    "desktopDeviceName": "Office-PC",
    "ownerAccountId": "owner-1",
    "targetAccountId": "user-2",
    "targetAccountName": "alice",
    "targetDeviceId": null,
    "scopeType": "selected_projects",
    "scopeProjectIds": ["project-a"],
    "scopeProjectSummaries": [
      {
        "id": "project-a",
        "name": "gateway-release"
      }
    ],
    "capabilityBundle": "observe",
    "allowFileDownload": false,
    "allowDiagnostics": false,
    "expiresAt": "2026-04-19T00:00:00Z",
    "revokedAt": null,
    "status": "active",
    "note": "缩小授权范围",
    "createdAt": "2026-04-18T08:00:00Z",
    "updatedAt": "2026-04-18T09:00:00Z"
  }
}
```

### 5.4 撤销授权

`POST /api/access/grants/{grantId}/revoke`

请求：

```json
{
  "reason": "现场协作结束"
}
```

响应：

```json
{
  "item": {
    "id": "grant-1",
    "status": "revoked",
    "revokedAt": "2026-04-18T10:00:00Z"
  }
}
```

要求：

- 幂等
- 二次撤销返回同样状态，不报错

### 5.5 查询当前有效 scope

`GET /api/access/effective-scope`

用途：

- Android 登录后刷新 scope
- Android 前台恢复后刷新 scope
- 后续 iOS / 小程序共用

响应：

```json
{
  "accountId": "user-2",
  "deviceId": "android-1",
  "generatedAt": "2026-04-18T10:00:00Z",
  "desktopScopes": [
    {
      "desktopDeviceId": "desktop-1",
      "desktopDeviceName": "Office-PC",
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

规则：

- 只返回当前账号当前设备有效的授权
- 过期、撤销、设备不匹配授权不返回
- 同一桌面节点多条授权时，按服务端合并结果输出一条最终 scope

## 6. 越权接口行为建议

### 6.1 项目详情

未授权项目返回：

- HTTP `403`
- `ACCESS_SCOPE_FORBIDDEN`

### 6.2 文件下载

项目在 scope 内，但能力包不允许下载文件时返回：

- HTTP `403`
- `ACCESS_CAPABILITY_FORBIDDEN`

### 6.3 诊断查看/导出

项目在 scope 内，但 `allowDiagnostics = false` 时返回：

- HTTP `403`
- `ACCESS_CAPABILITY_FORBIDDEN`

## 7. 兼容性建议

- 首期字段命名一旦确定，不要让 desktop 和 Android 再分别发明别名
- 若后续要扩 capability 细项，新增字段优先，旧字段保留兼容
- `effective-scope` 应视为客户端的唯一真相源，不要让客户端自己推断权限

## 8. 当前建议

后续真实实现时，建议先按这份 schema 落服务端，再让 desktop 和 Android 直接按同一份字段接入。

这样能先把权限边界收紧，再去补 UI 草图和客户端时序图。
