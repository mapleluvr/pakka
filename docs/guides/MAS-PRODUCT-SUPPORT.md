# Headless MAS product — support boundary

Headless MAS 产品由 `pakka-server`、`pakka` CLI、共享 client 和可选模型侧 DevPack 组成。默认使用原生 context，显式策略装配见 [Dynamite 产品 API](../reference/DYNAMITE-PRODUCT-API.md)。本页维护 server/CLI 的组合与恢复条件；Web 工作台见[使用指南](WEBUI-GUIDE.md)。

## 1. Operator startup and model authority

按 [应用 API](MAS-APPLICATION-API.md) 准备并保护显式 server/connection JSON，先 `npm run build`，再运行 server 与 CLI。可信启动字段如下；它们在 server config 中，不属于 RPC command：

```json
{
	"runtime": {
		"profiles": [{ "id": "helper", "systemPrompt": "Host-approved helper instructions" }]
	},
	"devpack": {
		"profiles": {
			"default": ["discover", "spawn", "send", "reply", "observe", "retire"],
			"helper": ["send", "reply", "observe"]
		},
		"operationTimeoutMs": 2000
	}
}
```

以上是合并进完整 server config 的片段。需要显式 `systemPrompt` 的 profiles 只接受 `id/systemPrompt`；没有任意 tools、functions、extensions 或插件路径。默认 profile 为 `default`。只有 `devpack.profiles` 选中的 profile 安装 tools/instructions；未选择 profile 的工具集明确为空，不继承 default 的 DevPack。模型本身不会获得 token、runtime、broker、worker manager 或 credential。

- Model principal 由受控 member ref 派生；每次调用重新绑定真实 native invocation，不相信模型声明的 caller/owner。
- 子成员的有效 grants 是自己的批准 profile 与完整 capability-owner 祖先链的交集。选择高权限 profile 不扩大祖先权限；缺失或循环祖先拒绝。
- Capability ownership 和 native task ownership 不同：persistent 可以有能力 owner 而无 task lifetime；temporary/task-bound 的实际 owner 是创建它的 native tool task。
- `devpack` 模式 **禁止任意 RPC role 持有 `spawn/configure/fork`**，配置会在打开 storage 前拒绝。这防止 remote profile selection 成为模型权限放大路径。RPC 仍可按 role 使用 send/observe/owner controls，但通信 grant 不取得管理所有权。
- 未安装 DevPack 时，批准的 RPC role 可使用 persistent spawn/configure/fork；模型工具由 profile 独立装配。
- Tools 注册不证明某 agent 有对应 grant；grant 拒绝、迟到撤权及 effects unknown 的细节见 [DevPack API](../reference/MAS-DEVPack-API.md) 和应用 API。

## 2. Support matrix

| 组合                  | 使用条件与边界                                                                    |
| --------------------- | --------------------------------------------------------------------------------- |
| 同 Session server/CLI | 显式 bootstrap、专用 token、原生投递及有限 Session 配额                           |
| persistent 模型子成员 | 批准 profile、完整 owner grant 交集、正常关闭后的 roster 恢复                     |
| temporary/task-bound  | 创建它的真实 native tool task 结束后停止接收工作；历史保留                        |
| background            | 独立原生 anchor；由获准 owner retire 并排空                                       |
| 跨 Session 申请       | 可信程序装配 `ApprovedSessions` 的固定 templates/slots；JSON/RPC 不提供此配置     |
| 同进程多 Session      | 独立 runtime 与 broker；共享进程退出及 OOM 风险，分别提交                         |
| 独立 worker           | 批准的私有 worker preset、Node IPC 和确切 reserved storage；残留 claim 需受信恢复 |
| 策略                  | 原生 context 默认启用；可选 server Dynamite 限固定配对和初始 persistent 成员      |
| 浏览器 client         | 显式 origin 与 loopback RPC；完整工作台使用独立 WebUI 协议和服务                  |

CLI 使用完整 refs 和稳定 input.requestId。A2A source/reply provenance 来自已提交 receipt。通信授权与管理授权分别检查，模型工具不会向调用方交出 Runtime 控制对象。

## 3. Normal reopen, not forced recovery

可信配置必须使用互不重复的初始 root key。decoder 不单独预检 key 唯一性；启动会尝试严格 bootstrap 或 retained-descendant 恢复，重复／满 roster 配置没有确定的恢复路径。宿主应先验证 roots；readiness、owner ancestry 和有效 grants 仍在装配／执行边界检查。

先排空工作、正常关闭原 server，然后在原配置的 `runtime.reopenSessionFile` 显式指定同 dataDir 的 `sessions/<sessionId>/main.sqlite`，再启动。新 listener 有新的 `serverId`，旧 client token 若被宿主重新声明是新发权，不是旧 lease/撤权的自动恢复。

- 保留 Session/Conversation/incarnation、原 admission ID、消息指纹和已消费 quota；reconnect 不自动重放 mutation。
- 没有动态模型子成员时，使用原有严格 MAS bootstrap。
- DevPack 创建了子成员时，product reopen 核对原始 roots 的 key/owner/profile/lifetime/active phase，以及每个 retained descendant 到这些 roots 的完整 owner 链；active persistent 成员还必须在 native readiness 上实际 ready。
- Product 只接回符合条件的已有 roster，不把原始 roots 改成完整成员列表，不新增、重写 owner、统一 activate 或复活 ended/retired 成员。错误 roots、孤立/cyclic owner、未确认成员状态拒绝。
- 动态 RPC 追加的非模型 owner 成员不属于上述自动 descendant 恢复：未安装 DevPack 时必须在可信配置中明确列出完整 persistent roster。不能通过给 DevPack reopen 混入新 owner 来接管成员。
- 活跃任务的 crash recovery、forced kill 后遗留 writer claim 和不确定启动结果不属于正常关闭恢复；继续 fail closed，不自动删除 claim 或分配替代 Session。
- Retire/tombstone、unknown 和 terminal receipts 继续占用其持久语义；没有物理 delete、容量补位或自动 GC。

## 4. 操作与检查入口

server/CLI 启动见[应用指南](MAS-APPLICATION-API.md)。源码产品检查在 `apps/server/test/product.test.ts`；仓库外消费者在 `scripts/consumer-product.mjs`，由 `npm run smoke:package` 安装实际 tarballs 并运行。它们观察真实工具、A2A/reply、权限、lifetime、重开和配额；选择检查及解释结果见[验证方法](../development/VERIFICATION.md)。
