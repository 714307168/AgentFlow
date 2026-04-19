# 消息、同步与更新故障排查清单

更新时间：2026-04-20

这份文档用于把当前最常见的三类线上问题收口到一份可直接执行的排查入口：

- 消息发出后没有执行，或者执行顺序异常
- 执行结果已经产生，但手机端没有及时看到
- 更新中心反复提示升级、下载失败或安装后仍提示旧版本

它不替代详细设计文档，而是给日常排查提供一个“先看哪里、怎么缩小范围、最后回写什么”的统一入口。

## 1. 排查原则

遇到问题时先分层，不要一上来全仓库搜索：

1. 先确认是哪一段链路断了
2. 再确认断点发生在 Android、relay-server，还是 local-agent
3. 最后才去看具体实现文件

建议始终按下面顺序缩小范围：

~~~text
用户界面现象
  -> 客户端本地状态
  -> relay-server 路由与鉴权
  -> local-agent 执行与历史写入
  -> 回传同步与更新接口返回
~~~

## 2. 常用定位入口

### Android

- `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt`
- `android-app/app/src/main/java/com/claudecode/remote/domain/SessionRepository.kt`
- `android-app/app/src/main/java/com/claudecode/remote/update/AppUpdateManager.kt`

重点关注：

- 发送态是否已落本地
- `after_seq` 是否推进
- 当前项目 / 当前对话是否一致
- 更新接口返回的版本号和 build 是否被正确缓存

### local-agent

- `local-agent/src/message-router.ts`
- `local-agent/src/runtime-manager.ts`
- `local-agent/src/remote-session-store.ts`
- `local-agent/src/update-manager.ts`

重点关注：

- 远端消息是否被路由到正确项目
- 是否进入队列
- 是否真正写入本地历史
- 更新检查后是否正确记录已安装版本

### relay-server

重点关注：

- 项目级权限是否允许
- agent / device 是否在线
- `/api/device/sync/meta` 与 `/api/device/sync/delta` 是否返回预期
- `/api/update/check` 是否还在返回旧版本或错误 build

## 3. 症状一：手机发了消息，电脑没执行

### 先确认的现象

- 聊天页是否已经出现本地发送态
- 是否只是不进入运行中，还是连 accepted / 已送达都没有
- 同项目里后发消息是否插队执行

### 排查顺序

1. Android 是否真的发出请求
2. relay-server 是否通过鉴权并路由到对应 agent
3. local-agent 是否收到项目消息事件
4. 该消息是否进入正确项目与正确对话
5. 是否被项目内已有队列阻塞

### 常见断点

- Android 只写了本地发送态，但网络请求失败
- relay-server 因项目级权限裁切拒绝路由
- local-agent 离线或 agent 绑定错账号
- 消息进入了错误对话，所以看起来像“没执行”
- 项目内串行队列失效，导致顺序混乱或后发先执行

### 最小核对清单

- [ ] Android 发送请求成功
- [ ] relay-server 找到正确用户、设备、项目权限
- [ ] local-agent 收到远端项目消息
- [ ] 消息进入当前项目队列
- [ ] 队列仍遵守先进先执行

关联文档：

- [手机消息到桌面执行链路说明](./mobile-to-desktop-execution-chain.md)

## 4. 症状二：电脑执行了，但手机看不到结果

### 先确认的现象

- 桌面端本地历史里是否已经有输出
- 只有消息页没刷新，还是活动页、队列页也都没刷新
- 重新进入项目后能否看到结果

### 排查顺序

1. local-agent 是否已经把输出写进本地历史
2. relay-server 是否发出项目变更广播
3. Android 当前项目是否仍在活跃同步窗口
4. `after_seq`、`snapshot_revision`、项目壳签名是否推进
5. 是否只是 UI 仍停留在旧对话或旧锚点

### 常见断点

- 执行结果只存在内存态，没有成功写回历史
- WS 事件到了，但恢复后没有 follow-up catch-up
- Android 当前项目是冷项目，未被及时提升为 `hot`
- 详情页还停留在旧 `conversationId`
- 列表刷了，但详情页没有触发单项目增量补拉

### 最小核对清单

- [ ] local-agent 历史里已经存在输出
- [ ] relay-server 广播已发出
- [ ] Android `after_seq` 正常推进
- [ ] 当前项目热度正确
- [ ] 聊天页默认定位到底部且指向当前对话

关联文档：

- [Project Sync Signature 设计](./project-sync-signature-design.md)
- [冷项目同步与项目签名验收清单](./cold-project-sync-acceptance.md)

## 5. 症状三：前后台恢复后不同步，或者看起来在线但消息没补齐

### 先确认的现象

- 连接状态是否显示已连接
- catalog 是否刷新了，但消息详情没更新
- 只有项目聊天不刷新，还是协作组也不刷新

### 排查顺序

1. 先看 WS 是否真的重连成功
2. 再看 post-auth / foreground follow-up 是否完整执行
3. 再看 `meta / delta / after_seq` 有没有继续补齐
4. 最后看是否被冷项目 TTL 或活跃窗口规则挡住

### 常见断点

- WebSocket 看起来已连上，但没有 follow-up catch-up
- foreground recovery 只刷新了 catalog，没有请求项目补拉
- `after_seq` 没推进，导致客户端误判“本地已经最新”
- 冷项目没有被激活，所以恢复后没进同步窗口

### 最小核对清单

- [ ] close code / reconnect reason 可追踪
- [ ] auth 后 follow-up refresh 已执行
- [ ] active project sync 已请求
- [ ] changed-project set 或等价结果已返回
- [ ] 当前项目不被冷项目策略错误跳过

关联文档：

- [WebSocket 稳定性与恢复专项](./ws-stability-and-recovery-plan.md)
- [WebSocket 加固联调核查模板](./ws-hardening-joint-verification-template.md)

## 6. 症状四：更新中心反复提示升级，或者更新后还是提示旧版本

### 先确认的现象

- 是 Android 反复提示，还是桌面端反复提示
- 已安装版本号是否真的变化
- 更新接口是否仍返回问题版本

### 排查顺序

1. 先确认本地已安装版本与 build
2. 再确认 `/api/update/check` 返回值
3. 再确认更新中心里的 release 记录是否正确
4. 最后确认 GitHub Release、更新中心与本地版本号是否一致

### 常见断点

- 更新中心还挂着旧版本或错误 build
- Android `versionName` 变了，但 `versionCode` 没变
- 客户端安装成功，但本地记录的已安装 build 没更新
- GitHub Release 和更新中心版本结论不一致

### 最小核对清单

- [ ] `/api/update/check` 返回的 `latestVersion` 正确
- [ ] Android build 正确递增
- [ ] 桌面端本地版本与安装包文件名一致
- [ ] 更新中心 release id 与真实构建产物对应
- [ ] 安装完成后客户端本地版本缓存已刷新

关联文档：

- [更新中心与发布说明](./release-and-update-center.md)
- [发布一致性检查模板](./release-consistency-checklist.md)
- [版本回滚与撤回操作模板](./release-rollback-and-retract-template.md)

## 7. 症状五：附件或图片发出后，消息在但文件状态不对

### 先确认的现象

- 是消息壳存在但文件打不开
- 还是上传没完成却被误显示为已送达
- 还是接收端能看到消息，但无下载入口

### 排查顺序

1. 文件消息是否已进入时间线
2. `transfer_id`、状态和回执是否齐全
3. relay-server 是否保存了文件元信息与定位
4. 接收端是否有项目权限和下载权限

### 最小核对清单

- [ ] 文件消息进入消息时间线
- [ ] `uploaded / delivered / opened / failed` 状态清晰
- [ ] digest 校验通过后才记为 `delivered`
- [ ] 接收端按需下载，不在列表阶段误拉大文件

关联文档：

- [跨端文件传输协议与回执验收清单](./transfer-protocol-and-receipt-checklist.md)

## 8. 回写要求

每次真实排查后，至少回写这些信息：

~~~text
symptom:
layer:
root cause:
fixed by:
tests:
release impact:
follow-up doc update:
~~~

## 9. 当前结论

后续排查高频问题时，先用这份文档定位断点，再进入对应专项文档或代码文件。这样可以减少“每次都从代码开始翻”的低效排查。
