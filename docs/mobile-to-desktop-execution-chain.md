# 手机消息到桌面执行链路说明

更新时间：2026-04-19

这份文档用于把“Android 发一条消息，最后如何在电脑端真正执行起来”这条主链路单独拆出来。

它的目标不是讲所有实现细节，而是回答四个问题：

- 消息从手机发出后，先到哪里
- relay-server 负责什么，不负责什么
- local-agent 什么时候真的开始执行
- 执行结果如何再回到手机

## 1. 一句话链路

~~~text
Android Chat -> relay-server -> local-agent -> CLI runtime -> local-agent history -> relay-server -> Android sync
~~~

更具体一点：

~~~text
Android 输入消息
  -> MessageRepository 发送项目消息
  -> relay-server 校验账号、设备、项目权限
  -> local-agent 收到项目消息事件
  -> runtime-manager / remote-session-store 决定目标会话与执行上下文
  -> Claude Code CLI / Codex CLI 真正执行
  -> 输出被写回本地项目历史
  -> local-agent 通过 relay-server 把消息、活动、状态同步给 Android
~~~

## 2. 参与角色

### Android

职责：

- 收集用户输入、附件和当前项目上下文
- 本地先落发送态
- 把消息按项目串行发送，避免后发先到
- 收执行结果、活动、附件回传

当前高频入口：

- `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt`
- `android-app/app/src/main/java/com/claudecode/remote/ui/chat/ChatScreen.kt`

### relay-server

职责：

- 做认证、鉴权、设备路由和在线分发
- 保证只有有权限的设备能看到对应项目
- 承担消息中转、同步接口、更新中心

不负责：

- 不直接执行 CLI
- 不保存桌面端完整运行时上下文作为主真相源

### local-agent

职责：

- 作为桌面端真实执行入口
- 持有项目历史、会话状态、队列状态
- 决定这条消息进入哪个项目、哪个对话、哪个 CLI 运行上下文
- 把执行过程中的消息、活动、附件、运行状态再同步出去

当前高频入口：

- `local-agent/src/message-router.ts`
- `local-agent/src/runtime-manager.ts`
- `local-agent/src/remote-session-store.ts`

## 3. 标准时序

### 3.1 Android 侧发送

1. 用户在聊天页输入消息，可附带图片或文件。
2. Android 先把消息写入本地发送态，保证界面立刻可见。
3. `MessageRepository` 以“项目级串行”的方式发送消息，避免同一项目后发先执行。
4. 如有附件，先按既定传输链路上传，再把消息和附件元信息一并送出。

### 3.2 relay-server 中转

1. 校验登录态、设备身份、项目级权限。
2. 将消息路由给对应桌面端 agent。
3. 记录必要同步元信息，让手机后续能通过 `meta / delta / after_seq` 补齐状态。

### 3.3 local-agent 接收并准备执行

1. `message-router` 收到远端项目消息。
2. 根据 `projectId / conversationId / remote session` 找到目标项目和对话。
3. `runtime-manager` 或 `remote-session-store` 决定：
   - 是继续当前对话
   - 还是切到指定对话
   - 还是创建新的运行上下文
4. 项目进入排队或运行状态。

### 3.4 CLI 真正执行

1. local-agent 组装项目 guidance、provider 配置、当前对话上下文。
2. 调用本机 CLI runtime。
3. 运行过程中把输出拆成消息、活动、状态变化。
4. 所有输出先写回桌面端本地历史。

### 3.5 结果回传手机

1. local-agent 通过 relay-server 广播项目变更。
2. Android 收到 WS 事件或在恢复时走增量同步。
3. Android 按 `after_seq` 拉取新增消息、活动和附件状态。
4. 聊天页、活动页、队列页更新到最新位置。

## 4. 为什么桌面端才是真正执行端

关键原因有三个：

1. CLI 环境在桌面端
   - Claude Code CLI / Codex CLI、代码仓库、SSH、构建工具都在本机。
2. 项目真相源在桌面端
   - 项目历史、运行中状态、队列、当前对话都由 local-agent 持有。
3. 手机是协作端，不是直接执行宿主
   - 手机负责发指令、看结果、轻量协作，不直接承载完整 CLI runtime。

## 5. 流量为什么还能压缩

这条链路里真正耗流量的不是“发一条消息”本身，而是后续同步。

当前设计重点是：

- Android 发消息只发必要输入，不回传整段历史
- 结果同步只走增量，不整包重刷
- 冷项目默认降频，不因为大量旧项目一起参与同步
- 附件走消息时间线元信息 + 按需下载，不在列表阶段直接回传正文

对应文档：

- [Project Sync Signature 设计](./project-sync-signature-design.md)
- [跨端文件传输协议与回执验收清单](./transfer-protocol-and-receipt-checklist.md)

## 6. 常见问题定位

### 手机发了，但电脑没执行

优先检查：

- Android 是否真的发送成功
- relay-server 是否鉴权通过
- local-agent 是否在线
- 项目权限是否包含该项目
- 消息是否被放进项目队列但尚未开始执行

### 电脑执行了，但手机没看到结果

优先检查：

- local-agent 本地历史是否已经写入输出
- relay-server WS 广播是否发出
- Android 当前项目是否还在活跃同步窗口
- `after_seq` 是否推进
- 当前会话是否切错导致看的是旧对话

### 顺序乱了

优先检查：

- Android 是否仍按项目串行发送
- local-agent 是否在同一项目里被错误并发执行
- 附件上传是否打断了项目内消息顺序

## 7. 验收清单

- [ ] Android 发出的项目消息能稳定到达 relay-server
- [ ] relay-server 能按项目权限路由到正确桌面端
- [ ] local-agent 收到后进入正确项目和正确对话
- [ ] 项目内消息保持先进先执行
- [ ] CLI 输出先写本地历史，再同步到手机
- [ ] Android 聊天页能在进入时快速定位到底部并看到最新结果
- [ ] 附件发送和文本发送共用同一条消息入口

## 8. 当前结论

这条链路的本质是“手机发指令，桌面端执行，relay-server 做受控中转，同步再把结果带回手机”。后续无论是做性能优化、排查消息缺口，还是做新端接入，都应继续围绕这条链路拆分，而不是把执行责任往服务端或手机端挪。
