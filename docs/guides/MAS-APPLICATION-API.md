# Authenticated MAS applications

本指南说明如何运行 headless `pakka-server`、CLI 和浏览器 client。服务使用显式 IPv4 loopback HTTP、专用 client token 和宿主批准的 role；传输与授权限制见下文。Web 工作台另见 [WebUI 使用指南](WEBUI-GUIDE.md)。

## 1. Package and authority boundaries

- `@pakka/protocol`：闭合 version-1 JSON schema、资源引用、scoped snapshot 和 receipt；无 Pi、Node、storage 或凭据发现依赖。
- `@pakka/client`：供 Node/CLI/browser 使用的 fetch client，校验响应、deadline、cancellation 和 reconnect；mutation 由调用方明确发送。
- `@pakka/cli`：读取显式 connection/command JSON，调用 client 并输出结果。
- `@pakka/server`：受信任 bootstrap、worker manager、HTTP 服务与 `pakka-server` executable。可选模型工具见[支持条件](MAS-PRODUCT-SUPPORT.md)，可选策略见 [Dynamite 产品 API](../reference/DYNAMITE-PRODUCT-API.md)。

安装版本和 peer 关系由 package manifests 与所选归档确定。请求 ref 是受检地址；server 将专用 token 绑定到批准的 principal/source/grants，并重新检查 issuer role 和 MAS 权限。caller、owner、storage path、模型凭据、tools 和预算由宿主配置。client token 必须独立于 provider API key。

## 2. Start the executable

先执行 `npm run build`。操作员**自行准备、选定并保护**两个 JSON 文件；程序不会查找 home credential 文件或隐式读取环境凭据。

Server config 的结构示例（全部值均为占位符，不是可用凭据）：

```json
{
	"schema": "pakka.server.v1",
	"runtime": {
		"cwd": "D:/explicit/workspace",
		"dataDir": "D:/explicit/pakka-data",
		"endpoint": "http://127.0.0.1:18080/v1",
		"model": "host-approved-model",
		"apiKey": "operator-supplied-provider-key",
		"systemPrompt": "Host-approved instructions",
		"maxOutputTokens": 128,
		"limits": {
			"maxConversations": 8,
			"maxPrimaryAttempts": 32,
			"maxAuxiliaryAttempts": 8
		}
	},
	"mas": { "namespace": "product", "maxDeliveries": 128, "maxPending": 8 },
	"members": [
		{ "key": "root", "owner": "operator" },
		{ "key": "peer", "owner": "peer" }
	],
	"roles": [
		{
			"token": "replace-with-dedicated-client-token-at-least-32-characters",
			"principal": "operator",
			"sourceKey": "root",
			"grants": ["discover", "observe", "send", "spawn", "abort", "retire"],
			"canRevoke": true
		}
	],
	"http": { "port": 0, "origins": [], "maxPending": 32 }
}
```

`runtime` 的 JSON bootstrap 接受以上基础字段、`reopenSessionFile`、`reservedSessionId`，以及 `profiles: [{id, systemPrompt}]`。可选 inference 装配接受闭合的 `runtime.inference: {models, policies}`，模型/凭据/endpoint 和有限预算仅由宿主配置；选择方式和限制见 Dynamite 产品 API。profile 默认为 gate 的 `default`；未批准 profile 会由 gate 拒绝。可选 `devpack` 的批准配置、RPC profile-management 组合拒绝和正常恢复范围见 [产品支持矩阵](MAS-PRODUCT-SUPPORT.md)。functions、额外 tools/extensions/config 均不属于该 JSON bootstrap；更复杂的程序化配置仍由可信 composition root 使用 `createMasServer()`，不能从 RPC 传入。

```powershell
node apps/server/dist/main.js --config D:/explicit/server.json
```

第一行 stdout 只返回 `{ "endpoint": "http://127.0.0.1:<port>/rpc", "serverId": "..." }`，不输出 provider key、client token、完整配置或内部错误。`--control-stdin` 是父进程选择启用的本地 pipe 控制；输入 `stop` 或关闭 pipe 会正常关闭。公网 RPC 不含 shutdown 命令。退出/close 请求本身不证明任意外部 effects 已回滚。

Client config 只含 `endpoint`、`token` 和可选 `timeoutMs`（1–60000 ms，默认 10000）：

```json
{
	"endpoint": "http://127.0.0.1:18081/rpc",
	"token": "replace-with-the-approved-dedicated-client-token"
}
```

```powershell
node apps/cli/dist/main.js --connection D:/explicit/client.json hello
node apps/cli/dist/main.js --connection D:/explicit/client.json snapshot
node apps/cli/dist/main.js --connection D:/explicit/client.json call --command D:/explicit/command.json
```

`call` 的 command JSON 就是下一节的一个 command，不含整个 envelope。CLI 会生成 transport `rpcRequestId`，但 **send/reply 的持久 input.requestId 由调用者明确给出并保留**。CLI exit code：0 受检结果；1 本地参数/配置无效；2 受检远端拒绝；3 远端结果 unknown。输出是 JSON，不打印 credentials 或原始错误对象。

## 3. Wire and browser/Node client

HTTP `POST /rpc`，Content-Type `application/json`，Authorization `Bearer <dedicated token>`：

```json
{
	"version": 1,
	"requestId": "transport-request",
	"command": { "op": "snapshot" }
}
```

命令：`hello`、`snapshot`、`spawn`、`send`、`reply`、`receipt`、`wait`、`withdraw`、`inspect`、`abort`、`retire`、`configure`、`fork`、`revoke`。`spawn` 只创建当前 Session 的 persistent 成员，owner 由 server principal 确定；本版 RPC 不开放跨 Session template 申请或 task-bound lifetime。

- `send`：`{op, target: AgentRef, input: {requestId, text, mode?}}`。mode 为 `prompt|steer|followUp`，后两者另需 `steer` grant，保留原生 placement timing。slash command 不属于普通 send。
- `reply`：`{op, receiptId, input}`，目标/来源从原始持久回执推导，不由调用者声明。
- `receipt|wait|withdraw`：`{op, id}`；复制另一身份的 receipt 不会取得访问权。
- `spawn`：`{op, key, profile?}`；`configure` 只选择已批准 profile，`fork` 需要合法 entryId/owner。
- `inspect|abort|retire`：`{op, target}`；通信 grant 不等于目标管理所有权。
- `revoke`：`{op, principal}`，只允许单独的 host role administration（`canRevoke`），不是 `abort/retire` grant。

`Member.key` 是逻辑 roster 名；`Member.ref.key` 是 opaque catalog key，不要求相等。完整 ref 中的 Session/Conversation/incarnation/profile scope 会由 gate 重新检查。

```ts
import { createClient } from "@pakka/client";

const client = createClient({ endpoint, token }); // 无 import/construction I/O
const snapshot = await client.reconnect();
const peer = snapshot.members.find((member) => member.key === "peer");
if (!peer) throw new Error("Missing peer");
const input = { requestId: "caller-retained-message-id", text: "approved input" };
const sent = await client.request({ op: "send", target: peer.ref, input });
if (sent.kind !== "receipt") throw new Error("Missing receipt");
const outcome = await client.request({ op: "wait", id: sent.receipt.id });
```

Response envelope 包含协议 version、transport requestId、serverId 和恰好一个 result/error。共享 client 保留 `serverId`、`rpcRequestId`，其余字段按 result discriminant 读取。`reconnect()` 执行 hello + 新 snapshot，并核对同一 server/Session；不会重放之前的 mutation。显式传入 `requestId` 时，两次顺序读取复用它；它用于单请求关联，不承诺跨 envelope 全局唯一或审计序号。默认调用各自生成 ID。catalog version 是 scoped 描述，不是跨 Session global revision，更不是 authority。

浏览器 bundler/import map 必须解析 `@pakka/client` 与 `@pakka/protocol` 的公开 ESM；不要把 server/MAS/gate 导入前端。server 的 `origins` 必须显式批准当前页面 origin，不接受 wildcard、cookies 或 URL token。浏览器客户端通过已批准的 origin 使用该 loopback RPC。

## 4. Revocation, cancellation and unknown

- role 可以包含绝对毫秒时间 `expiresAt`；请求入口和实际 native commit 检查都会检验 expiry。
- issuer revoke 会立即封闭该 principal 的现有 role，撤掉等待中的未提交 effects；新的 HTTP connection 不能恢复它。
- issuer role table 是本次显式 server bootstrap 的状态，不是持久账号数据库。没有自动 server crash restart 或跨 bootstrap token revocation 服务；宿主重新 bootstrap 是新发权动作，必须自行保留撤权决定/轮换或移除 token，不能宣称旧撤权跨此动作自动保留。
- `AbortSignal`/deadline/disconnect 停止 client 等待与 request lease，**不等于 target abort、未送达或退还预算**。已 placed input 可继续完成；用原 input.requestId 或已获得 receipt 查询。
- queued withdrawal 只有 native 确认精确移除后才终结；`abort/retire` 是单独 owner 操作。retire 不删除 immutable transcript 或物理 storage。
- 确定发生在当前 native effect 之前的 owner、foreign receipt、inactive recipient 和 non-sender guard 返回 typed denied（HTTP 403、CLI exit 2）。普通 `check/grant`、adapter `MutationDenied`、持久化故障和迟到撤权不依错误字符串改为 denied。opaque admission callback 即使抛 typed denial 或返回 false，也不能证明它之前没有外部 effects，保守 unknown。
- 已有限读取/解析的 JSON 含合法 descriptive requestId 时，schema 拒绝保留该 ID，不授予命令权限。Host/Origin/URL/method/content-type/capacity 等 **body 读取前** 的拒绝没有可信 transport ID，使用 `invalid` sentinel；raw HTTP 可以看到 4xx，但共享 client/CLI 因关联失败保守 unknown（exit 3），包括 capacity。没有按 HTTP status 放宽关联，也没有为了给 overflow 请求取 ID 而增加无界 body parser。
- 超限 body 会在流式读取时拒绝；不承诺坏连接一定能收到 JSON envelope。分片或平台处理可能直接断连；client 依有效关联的 envelope 判定结果，不能仅按连接终止推断无效果。
- wire enum 的 `VERSION_MISMATCH`/`UNSUPPORTED` 是保留代码；本实现的未知版本/不支持命令统一拒绝为 `INVALID_REQUEST`，没有这两个独立 producer。
- JSON bootstrap 严格要求 `canRevoke` 为 boolean。直接调用受信任的 `createMasServer()` 时，该字段仍按 JS truthiness 使用；programmatic caller 必须提供真实 boolean，这不是远端可配置字段。
- dispatch 已开始但结果不能确认时保守 unknown，原内部错误与 paths 不向 client 发布。
- schema 合法、HTTP 成功、native receipt 分别只是各自边界的证据，不能推导 exactly-once provider/tools/external effects。重试 admission 不替换原 ID，不清除 unknown/receipt 来腾容量。

## 5. Transport limits

Body/result 上限 131072 bytes；protocol depth 32；文本上限 65536 UTF-16 code units 且总 bytes 仍受限，不截断输入。最多 512 snapshot members；listener pending 默认 32，允许 1–256。初始部署只绑定 `127.0.0.1`，拒绝非实际 Host、未批准 Origin 和 schema extra fields。client 拒绝非该 loopback `/rpc` URL、userinfo、query、hash 和 redirect。没有本机恶意进程 sandbox 保证。

相关可执行检查位于 `apps/server/test/http.test.ts`、`apps/server/test/product.test.ts` 与 `scripts/consumer-product.mjs`；检查选用和方法见[验证方法](../development/VERIFICATION.md)。

组合与正常重开条件见[产品支持指南](MAS-PRODUCT-SUPPORT.md)。
