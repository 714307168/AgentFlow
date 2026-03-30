# 定时任务功能设计

## 1. 目标

为 AgentFlow 增加一套可远程管理、由桌面端本地执行的定时任务能力，用来自动向指定项目、指定会话或指定协作组投递任务。

设计目标：

- 支持一次性、延时、每日、每周、Cron 任务
- 任务真实执行始终发生在桌面端，不把核心调度数据放到服务端
- Android 端可以远程创建、查看、启停、立即执行定时任务
- 执行结果直接进入现有聊天、活动、队列链路，而不是另起一套不可见系统
- 与现有项目队列、运行态、协作组、远程控制链路兼容
- 允许后续扩展到“协作组定时编排”和“计划巡检任务”

## 2. 非目标

本期不做：

- 服务端集中调度
- 服务端持久化保存完整任务配置或执行日志
- 跨桌面端迁移任务执行权
- 复杂工作流编排器
- 图形化 Cron 编辑器的高级版

## 3. 核心原则

### 3.1 本地调度，本地执行

定时任务本质上是桌面端上的计划调度器。任务配置、下一次执行时间、重试状态、最近执行记录应保存在桌面端数据目录，由本地进程负责实际触发。

### 3.2 服务端只转发，不托管业务状态

Relay Server 只负责：

- 转发“创建任务 / 编辑任务 / 启停任务 / 立即执行”指令
- 转发“任务已触发 / 已跳过 / 执行中 / 已完成 / 失败”事件
- 为离线手机保留短期事件投递能力

Relay Server 不负责：

- 计算下次触发时间
- 决定任务是否可运行
- 保存完整 prompt、附件模板、运行日志

### 3.3 结果进入现有对话链路

定时任务执行后产生的消息、活动、附件、失败说明，应进入项目原有会话和活动流。用户不需要额外进入一个“黑盒任务页”才能知道执行了什么。

### 3.4 调度策略必须显式

项目可能正忙、队列里可能已有任务、协作组可能正在运行。定时任务不能隐式打断当前工作，必须明确配置冲突策略。

## 4. 用户场景

### 4.1 项目巡检

每天早上 9 点让某个项目自动执行“检查昨晚构建结果、读取日志、输出异常摘要”。

### 4.2 定时报表

每周一早上 10 点自动汇总某项目最近一周提交、测试结果、待上线项，并输出到协作组。

### 4.3 延时提醒

10 分钟后自动给当前项目追加一条 prompt，例如“继续处理上一个未完成问题，并补充最终结论”。

### 4.4 夜间部署检查

绑定到远程项目，每晚定时检查服务状态、磁盘空间、日志关键字，并在失败时发消息提醒手机端。

### 4.5 协作组例行任务

每天固定时间由协作组中的 PM Agent 发起例行任务，@开发 Agent、测试 Agent、部署 Agent 按角色输出进展。

## 5. 调度模型

### 5.1 任务类型

- `once_at`：指定绝对时间执行一次
- `delay`：从创建时刻开始延迟执行一次
- `daily`：每日指定时间执行
- `weekly`：每周指定星期和时间执行
- `cron`：高级 Cron 表达式

### 5.2 执行目标

每个定时任务必须绑定一个执行目标：

- `project`
- `remote_project`
- `workgroup`

其中：

- `project` 表示本机项目
- `remote_project` 表示通过主控桌面镜像出来的远程项目
- `workgroup` 表示协作组对话

### 5.3 执行内容

每个任务至少包含：

- 一段 prompt
- 可选附件模板
- 会话策略
- 队列冲突策略
- 失败重试策略

### 5.4 会话策略

- `continue_current_session`：继续当前会话
- `continue_last_active_session`：继续最近活跃会话
- `new_session`：创建新会话

推荐默认值：

- 项目日常巡检使用 `new_session`
- 连续性任务使用 `continue_current_session`
- 协作组例行任务使用 `new_session`

### 5.5 队列冲突策略

- `enqueue`：如果正在运行，则排到队列尾部
- `skip_if_busy`：如果正在运行，则本次跳过
- `replace_pending_scheduled_only`：替换尚未执行的定时类待办任务，但不影响手动任务
- `run_immediately_if_idle`：仅在空闲时立即执行，否则跳过

推荐默认值：

- 普通项目任务默认 `enqueue`
- 高频巡检默认 `replace_pending_scheduled_only`
- 强时效检查默认 `skip_if_busy`

### 5.6 并发策略

默认不允许同一目标下多个定时任务并发运行。

可选策略：

- `single_flight`：同一目标始终单飞
- `allow_parallel`：允许并发

默认使用 `single_flight`，避免干扰现有 CLI 会话和项目上下文。

## 6. 数据模型

### 6.1 任务定义

建议新增桌面端本地模型：

```ts
type ScheduledTaskTargetType = "project" | "remote_project" | "workgroup";
type ScheduledTaskMode = "once_at" | "delay" | "daily" | "weekly" | "cron";
type ScheduledTaskQueuePolicy =
  | "enqueue"
  | "skip_if_busy"
  | "replace_pending_scheduled_only"
  | "run_immediately_if_idle";
type ScheduledTaskConversationPolicy =
  | "continue_current_session"
  | "continue_last_active_session"
  | "new_session";
type ScheduledTaskParallelPolicy = "single_flight" | "allow_parallel";

interface ScheduledTaskDefinition {
  id: string;
  name: string;
  enabled: boolean;
  targetType: ScheduledTaskTargetType;
  targetId: string;
  targetProjectId?: string;
  mode: ScheduledTaskMode;
  timezone: string;
  schedule: {
    runAt?: string;
    delayMs?: number;
    timeOfDay?: string;
    weekdays?: number[];
    cronExpr?: string;
  };
  promptTemplate: string;
  attachmentTemplateIds: string[];
  queuePolicy: ScheduledTaskQueuePolicy;
  conversationPolicy: ScheduledTaskConversationPolicy;
  parallelPolicy: ScheduledTaskParallelPolicy;
  maxRetries: number;
  retryBackoffSeconds: number[];
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus?: "idle" | "queued" | "running" | "success" | "failed" | "skipped";
  lastError?: string;
  runCount: number;
  consecutiveFailures: number;
}
```

### 6.2 执行记录

```ts
interface ScheduledTaskRunRecord {
  id: string;
  taskId: string;
  targetType: ScheduledTaskTargetType;
  targetId: string;
  triggerType: "schedule" | "manual";
  plannedAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: "queued" | "running" | "success" | "failed" | "skipped" | "canceled";
  queuePolicy: ScheduledTaskQueuePolicy;
  conversationPolicy: ScheduledTaskConversationPolicy;
  resolvedSessionId?: string;
  resolvedRunId?: string;
  errorMessage?: string;
  summary?: string;
}
```

### 6.3 本地存储建议

放在桌面端统一数据目录下新增目录：

```text
data/
  scheduled-tasks/
    tasks.json
    run-history/
      <taskId>.json
```

说明：

- `tasks.json` 保存任务定义和调度元信息
- `run-history/<taskId>.json` 保存最近 N 条执行记录
- 执行结果的正文仍以项目聊天记录、活动记录为准，不重复存完整消息体

### 6.4 保留策略

- 任务定义长期保留
- 每个任务默认只保留最近 200 条运行记录
- 可在系统设置里加入“定时任务历史保留天数”

## 7. 执行链路

### 7.1 本地创建

1. 用户在桌面端项目页或项目设置中创建定时任务
2. UI 调用主进程 IPC
3. 主进程写入 `scheduled-tasks/tasks.json`
4. 调度器重新计算目标项目的最近触发时间
5. UI 和 Android 端收到任务清单同步事件

### 7.2 手机端创建

1. Android 端发起“创建定时任务”请求
2. Relay 转发到目标桌面端
3. 桌面端校验权限和目标存在性
4. 桌面端落本地配置并返回结果
5. Android 刷新任务列表

### 7.3 到点触发

1. 本地调度器 tick 到某任务到期
2. 调度器校验：
   - 任务是否启用
   - 目标是否存在
   - 目标是否在线
   - 当前运行态是否允许执行
3. 根据 `queuePolicy` 决定入队、跳过、替换或立即执行
4. 生成 `ScheduledTaskRunRecord`
5. 进入现有 `runtime-manager` 或 `workgroup-collaboration-service`
6. 聊天、活动、队列照常产出
7. 执行完成后回写 `lastRunAt`、`lastStatus`、`nextRunAt`
8. 向 Android 推送一条任务状态更新

### 7.4 失败重试

如果任务触发失败，调度器根据 `retryBackoffSeconds` 生成一次临时重试计划。

规则：

- 只对本次执行失败重试，不改写长期 schedule
- 重试次数超过 `maxRetries` 后记为失败
- `skip_if_busy` 产生的跳过不计入失败次数

## 8. 桌面端职责

桌面端需要新增一个独立领域模块，建议：

- `src/scheduled-task-store.ts`
- `src/scheduled-task-scheduler.ts`
- `src/scheduled-task-service.ts`
- `src/scheduled-task-types.ts`

职责划分：

- `scheduled-task-store.ts`
  - 任务定义读写
  - 运行记录读写
  - 数据迁移
- `scheduled-task-scheduler.ts`
  - 计算 `nextRunAt`
  - 维护本地 timer
  - 触发到期任务
- `scheduled-task-service.ts`
  - 校验目标
  - 应用冲突策略
  - 调用 `runtime-manager` / `remote-session-store` / `workgroup-collaboration-service`
  - 汇总状态并广播给 UI 和手机端

与现有架构的结合建议：

- 项目执行入口仍走 `runtime-manager.ts`
- 远程项目任务通过 `remote-session-store.ts` 镜像和转发
- 协作组任务通过 `workgroup-collaboration-service.ts`
- `main.ts` 只负责组装 IPC 和 relay 消息绑定

## 9. Android 端职责

Android 端不是调度器，只是远程管理面板。

建议能力：

- 查看任务列表
- 按项目或协作组筛选
- 新建任务
- 编辑任务
- 启用 / 停用
- 立即执行一次
- 查看最近执行记录
- 查看下次执行时间
- 查看最近失败原因

推荐 UI 入口：

- 项目聊天页右上角增加“定时任务”
- 项目设置页增加“定时任务”
- 协作组详情页增加“定时任务”

推荐列表字段：

- 任务名
- 目标
- 下次执行时间
- 状态
- 最近结果
- 启停开关

推荐详情字段：

- prompt
- 调度规则
- 冲突策略
- 会话策略
- 重试策略
- 最近执行记录

## 10. Relay Server 职责

Relay 只需要新增轻量消息类型，不新增调度存储。

建议增加事件类型：

- `scheduled_task_list_request`
- `scheduled_task_list_response`
- `scheduled_task_upsert`
- `scheduled_task_delete`
- `scheduled_task_toggle`
- `scheduled_task_run_now`
- `scheduled_task_status_event`

约束：

- Relay 不保存完整任务正文
- 可记录事件流量统计
- 可保留短期离线消息，但不长期托管任务定义

后台管理可新增的能力仅限：

- 定时任务事件流量统计
- 当前在线桌面端的调度器状态概览
- 最近错误数

不建议在后台直接编辑任务正文，避免服务端越权。

## 11. 权限与安全

### 11.1 权限边界

- 只有当前账号可管理自己名下桌面端的定时任务
- 主控桌面操作远程项目时，任务最终仍保存在被控桌面端
- 协作组任务需要校验当前用户对该协作组有管理权限

### 11.2 风险控制

- 限制单用户任务数量，例如默认最多 200 个
- 限制单任务 prompt 长度
- 限制最小调度间隔，例如 Cron 最短 1 分钟
- 限制失败重试风暴
- 记录任务来源与最近编辑人

### 11.3 数据隐私

- 任务 prompt、附件模板、运行记录正文保存在桌面端
- 服务端只看到元事件和必要路由字段
- 若端到端加密链路继续增强，定时任务控制消息也应沿用同一套加密包装

## 12. 冲突与异常策略

### 12.1 项目忙碌

根据 `queuePolicy`：

- 入队
- 跳过
- 替换待执行的定时任务
- 空闲才运行

### 12.2 目标离线

- 本机项目：视为可运行
- 远程项目：记为 `skipped` 或 `failed`，取决于是否允许等待恢复
- 协作组：如果核心成员离线，仅发起消息，由在线成员继续处理

### 12.3 会话已失效

- `continue_current_session` 找不到会话时，自动降级到 `new_session`
- 降级行为写入执行记录

### 12.4 应用重启

桌面端重启后应：

1. 重新加载本地任务配置
2. 重新计算所有 `nextRunAt`
3. 对已经错过的任务按策略处理：
   - `catch_up_once`
   - `skip_missed`

建议默认 `skip_missed`，避免启动风暴。

## 13. UI 设计建议

### 13.1 桌面端

推荐在项目页右上角增加一个“定时任务”按钮，打开独立抽屉或弹层。

列表项建议展示：

- 名称
- 下次执行时间
- 启用状态
- 最近结果
- 冲突策略缩写

支持操作：

- 新建
- 编辑
- 启停
- 立即执行
- 删除
- 查看运行记录

### 13.2 Android 端

推荐延续现有移动端思路，做成轻量管理页，不把表单做得太重。

新建任务流程建议：

1. 选择类型
2. 选择时间规则
3. 输入任务名与 prompt
4. 选择会话策略与冲突策略
5. 保存

任务详情页顶部应直接显示：

- 启用中 / 已停用
- 下次执行时间
- 最近成功或失败时间

## 14. 与现有功能的兼容关系

### 14.1 与项目队列

定时任务不替代项目队列，而是新的入队来源。

### 14.2 与协作组

协作组定时任务的执行结果应只进入协作组会话，不应混入成员私聊。

### 14.3 与附件

本期附件建议只支持引用已知模板或固定文件路径，不做复杂动态采集。

后续可扩展：

- 定时截图
- 定时日志打包
- 定时上传报告文件

### 14.4 与远程控制

主控端创建远程任务时，UI 上要明确标记：

- 当前是在本机创建
- 还是在远程桌面创建

避免用户误以为任务保存在主控机。

## 15. 分阶段实施方案

## Phase 1：本地项目定时任务

范围：

- 桌面端本地调度器
- 本地项目任务
- 桌面端 UI
- Android 查看与基本管理

不做：

- 协作组定时任务
- 远程项目定时任务
- 附件模板

## Phase 2：远程项目定时任务

范围：

- 主控端创建远程任务
- 被控桌面持久化任务定义
- 远程任务状态同步

## Phase 3：协作组定时任务

范围：

- 协作组例行任务
- PM Agent 例行编排
- @成员定时提醒

## Phase 4：高级能力

范围：

- Cron 高级编辑器
- 附件模板
- 漏跑补偿策略
- 统计分析面板

## 16. 推荐的首版落地范围

如果下一步直接开发，推荐首版只做下面这组最小闭环：

- 本地项目任务
- `once_at` / `delay` / `daily`
- `enqueue` / `skip_if_busy`
- `continue_current_session` / `new_session`
- Android 可查看、启停、立即执行
- 执行结果进入现有聊天和活动流

这样可以最小成本验证：

- 调度器稳定性
- 与当前队列模型是否冲突
- 手机端远程管理体验

## 17. 后续扩展点

- 定时任务模板库
- 项目级“例行巡检预设”
- 成员值班日历
- 任务依赖关系
- 批量启停
- 失败升级通知
- 执行结果结构化摘要
- 与未来语音输入、记忆系统联动

## 18. 结论

定时任务功能应被定义为：

“桌面端本地调度器 + 远程控制接口 + 接入现有聊天/活动/队列链路的一类任务来源”

这样可以保持当前系统边界清晰：

- 桌面端负责调度与执行
- Android 端负责远程管理与通知
- Relay 负责转发与事件统计
- 服务端不保存核心任务数据

这套方案和当前 AgentFlow 的项目队列、远程项目、协作组设计是兼容的，适合作为下一阶段正式开发的基线。
