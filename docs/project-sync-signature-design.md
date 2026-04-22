# Project Sync Signature 设计

更新时间：2026-04-22

## Progress Update

- Android background session-shell sync now applies local TTL gating on top of `hot / warm / cold / dormant`.
- `cold` projects are sampled at most once every 30 minutes during background shell sync rounds.
- `dormant` projects are sampled at most once every 4 hours during background shell sync rounds.
- Forced or manual sync paths still bypass this gate so explicit refresh stays immediate.
- Android session cache now persists `nextBackgroundCheckAfter` per project, so cold/dormant TTL gating survives process restarts instead of living only in memory.
- Background session-shell sync now writes the next scheduled check timestamp back into Room after each selected project is queued.
- Planner coverage now explicitly verifies that persisted `nextBackgroundCheckAfter` blocks cold projects until due while still allowing hot projects through immediately.

## 1. 背景

当前项目同步已经有这几层优化：

- 设备级 `revision / meta / delta`
- 会话级 `snapshot_revision`
- 消息级 `after_seq / known_items / content_md5 / attachments_md5`
- 活跃项目优先同步，后台项目降频

但还有一个明显浪费点：

- 很多项目长时间不发新消息，也没有运行中任务
- Android / 桌面端恢复连接、回前台、刷新列表时，仍然会反复触发这些项目的会话壳同步
- 即使 payload 已经变轻，这些“冷项目”仍然在消耗请求次数、JSON 体积和本地事务

问题的本质不是“摘要不够轻”，而是“冷项目根本不该每轮都参与同步判断”。

## 2. 目标

新增“项目级签名 + 冷热分层”机制，达到这几个目标：

1. 给每个项目生成稳定的 `project_signature`，用于表示“这个项目的会话壳是否发生了实质变化”
2. 日常前后台恢复和列表刷新时，不再要求所有项目都参与高频比对
3. 只有热项目、最近活跃项目、刚发生状态变化的项目才进入高频同步窗口
4. 冷项目和休眠项目默认跳过逐项比对，只在低频轮询、手动刷新或显式打开时再核对

## 3. 核心设计

### 3.1 项目级签名

在本地 agent 为每个项目维护一个轻量 `project_signature`，推荐由这些字段稳定组合后再做哈希：

- `project_id`
- `snapshot_revision`
- `latest_message_seq`
- `latest_activity_at`
- `active_conversation_id`
- `is_running`
- `queued_count`
- `current_prompt_preview`
- `latest_message_preview`
- `latest_message_role`
- `last_error_code` 或等价错误态字段

这个签名只代表“项目会话壳”，不代表完整消息正文。

不要把完整消息内容、大附件元数据、完整活动列表直接并进项目签名，否则签名计算本身又会变重。

### 3.2 项目冷热分层

每个项目再增加一个同步热度桶：

- `hot`
  - 当前打开中的项目
  - 运行中或排队中的项目
  - 最近几分钟内有新消息或新活动的项目
- `warm`
  - 最近一段时间打开过，但当前不在前台
  - 最近一小时内有变化
- `cold`
  - 长时间无变化，但最近一天内仍然被访问过
- `dormant`
  - 很久没有新消息、没有运行状态、没有前台访问

建议默认策略：

- `hot`：每轮正常参与会话壳同步
- `warm`：低频参与，只在 foreground 恢复、手动刷新或服务端 revision 变化时检查
- `cold`：不走逐项比对，只在较长 TTL 到期后抽样检查
- `dormant`：默认跳过，只有显式打开项目、手动全量刷新、收到服务端变更通知时再重新激活

## 4. 协议设计

### 4.1 设备级 revision 继续保留

现有 `/api/device/sync/meta` 和 `/api/device/sync/delta` 继续保留，负责“设备可见项目集合是否变化”。

但它们后续应继续向“目录变更通知”靠拢，而不是承载所有项目逐个会话判断。

### 4.2 新增项目壳签名摘要

建议增加一个“项目壳摘要”概念，可以复用现有项目列表 / 会话壳接口返回：

- `project_id`
- `project_signature`
- `sync_bucket`
- `last_changed_at`
- `next_background_check_after`

客户端本地持久化这几个字段。

### 4.3 客户端请求不再上报所有项目 md5

后续不要让 Android 每次都带所有项目的 `known md5` 或 `known signature`。

改成：

- 常规同步只带 `device revision`
- 活跃页同步只带“当前项目”的 `snapshot_revision + after_seq + known_items`
- 如果需要做项目壳核对，只上报 `hot/warm` 项目的已知签名
- `cold/dormant` 项目默认不在每轮请求体里出现

这样可以避免“为了确认 100 个没变化项目没有变化，反而每次把这 100 个项目都发一遍”。

### 4.4 服务端返回 changed-project set

服务端或 local-agent 侧应该优先维护“自上次 revision 之后哪些项目壳变了”，而不是要求客户端逐个提交签名再比。

也就是：

- 客户端发 `since_revision`
- 服务端回 `changed_project_ids`
- 只有这些项目再进入下一步壳同步或详情补拉

这比“每个项目都发 md5 再逐个比”更省流量，也更接近真正的增量同步。

## 5. 具体同步流程

### 5.1 App 启动 / 回前台 / 自动恢复

1. 先走现有 `device sync meta`
2. 如果设备级 `revision` 未变，直接跳过冷项目和休眠项目
3. 只对 `hot/warm` 项目请求会话壳同步
4. 对 `cold` 项目仅在 TTL 到期时抽样检查
5. 对 `dormant` 项目完全跳过

### 5.2 打开某个项目详情

1. 先用本地缓存渲染
2. 立即把该项目提升到 `hot`
3. 只对这个项目发送 `snapshot_revision + after_seq + known_items`
4. 如果壳未变且 `after_seq` 也没推进，直接保留本地内容，不再重写 Room

### 5.3 远端项目刚发生变化

当 local-agent 发现这些事件时，应直接提升该项目热度并刷新 `project_signature`：

- 新消息
- 新活动
- 运行开始
- 运行完成
- 队列变化
- 切换对话
- 错误状态变化

后续设备侧只要拿到 revision 变化，就能精准知道哪些项目值得同步。

## 6. 建议的数据结构

### 6.1 项目壳摘要

```ts
type ProjectShellSignature = {
  projectId: string;
  signature: string;
  snapshotRevision: string | null;
  latestMessageSeq: number;
  lastChangedAt: number;
  syncBucket: "hot" | "warm" | "cold" | "dormant";
  isRunning: boolean;
  queuedCount: number;
  activeConversationId: string | null;
  latestMessagePreview: string | null;
  nextBackgroundCheckAfter: number | null;
};
```

### 6.2 客户端请求摘要

```ts
type ProjectShellSyncRequest = {
  sinceRevision?: string | null;
  activeProjectIds?: string[];
  knownHotSignatures?: Array<{
    projectId: string;
    signature: string;
  }>;
};
```

注意：

- `knownHotSignatures` 只包含热项目和最近活跃项目
- 不要包含全部项目

## 7. 落地顺序

### P0

1. local-agent 为每个项目生成 `project_signature`
2. Android / 桌面端本地缓存这个签名
3. 当前前后台恢复链路只对活跃项目和运行中项目做壳同步

### P1

1. 给项目增加 `sync_bucket`
2. 引入 `cold / dormant` 项目 TTL
3. foreground 恢复时默认跳过 `dormant`

### P2

1. 让设备级 `revision` 直接返回 `changed_project_ids`
2. 把“逐个项目签名比对”继续压缩成“只对 changed set 再补拉”

## 8. 预期收益

这套设计的收益主要有三层：

- 减少请求体
  - 不再每次上报所有项目的已知签名
- 减少响应体
  - 不再让冷项目和休眠项目反复返回会话壳
- 减少本地事务
  - Android / 桌面端不再反复重写那些长期不变项目的会话缓存

预期适合你的典型场景：

- 项目数量很多
- 常用项目只有少数几个
- 大量项目长期没有新消息
- 用户频繁前后台切换，但不会频繁点开所有项目

## 9. 结论

“给每个项目算 md5”这个方向是对的，但不能停在“所有项目每次都带 md5 去比”。

更合理的做法是：

- 项目级签名只作为壳摘要
- 结合 `hot / warm / cold / dormant` 分层
- 设备级 revision 只负责告诉客户端“哪些项目值得看”
- 只有真正活跃或刚变化的项目才进入高频同步

这样才能把同步流量继续往下压，而不是把“全量同步”变成“全量比对”。
