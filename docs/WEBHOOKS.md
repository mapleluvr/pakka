# Pakka-Pocket Webhooks

Webhook 是可选的普通 Backend/Client/WebUI 贡献。人类在明确的 Conversation 中创建入口，外部 POST 通过签名或专用 URL secret 验证后，再以创建人的当前权限进入原生 `followUp`。安装界面、创建和轮换均不会触发模型。阶段证据见 [P5 记录](PAKKA-POCKET-P5.md)。

## 宿主组装

从 `@pakka/webui/workflows` 导入公开 root 与 service，把下面字段合入宿主选定的 ESM 配置；运行入口仍是本地 `--config-module`，浏览器不能选择模块或任意目录。完整可运行组装见 [仓库外 CLI 消费者](../scripts/consumer-pocket-hooks.mjs)。

```js
import { workspaceHooksExtensionRoot, workspaceHooksService } from "@pakka/webui/workflows";

export default {
  // 此处还需宿主批准的 runtime、owner、initial 和可选 transport 配置。
  extensions: [
    { root: workspaceHooksExtensionRoot, facets: ["backend", "client", "webui"] },
  ],
  extensionServices: async context => ({
    hooks: await workspaceHooksService(context, {
      namespace: "project.webhooks",
      githubWriters: ["host-approved-writer"],
    }),
  }),
};
```

`githubWriters` 是宿主固定的 GitHub 作者允许项，不是凭据或仓库轮询配置。底层服务还可由 `@pakka/server/pocket` 的 `createPocketHooks` 直接消费。当前只有明确 Conversation 目标，没有 PiP、隐含控制 Conversation 或旧 repository-watch 权限。

## 人类操作与密钥

导航、command palette 与 `/webhooks` 打开同一公开界面。创建、轮换、移除要求当前 `steer` 权限；creator 与精确 reference 由服务端绑定。viewer 不取得私密设置；全局管理员可管理当前可见资源中的 hook，外部投递仍按原创建人的权限与 driver 状态复查。

已声明的动作是 `read`、`create`、`rotate`、`remove`、`credentials`、`deliveries` 和 `operation`。列表和持久 mutation/operation 结果不返回 secret。只有显式授权的 `credentials` 只读操作取得当前设置，它不写入普通操作结果，迟到响应不能显示到替换后的面板实例。创建或轮换响应不明时，面板保留原请求，提供只读核对；不自动重发创建或轮换。

GitHub 设置展示 endpoint 和 HMAC secret，generic 设置展示带专用 secret 的地址供明确复制。这是此入口自己的认证材料，与 provider key 分开；它不会进入普通列表、协作内容或模型输入。受控服务会持久保留 hook secret，旧日志/备份也可能保留轮换前的值；不承诺加密或清除历史字节。部署时将 generic secret 地址按凭据处理，代理日志应避免记录其私密路径。

## 外部 POST 与原生回执

- GitHub：`POST /pocket/ingress/workspace-hooks/hooks/{id}`，使用 `X-Hub-Signature-256: sha256=...` 对完整原始 body 做 HMAC-SHA256。
- Generic：相同路径后追加 `/{secret}`，重试时使用固定 `Idempotency-Key`。

HTTP 层保留原始字节并限制大小，不将解析再编码后的 JSON 用于验签。GitHub 的 event/delivery header 未被 HMAC 覆盖，不能单独用于信任或去重：默认保守检查 signed body 的作者关系/宿主允许作者；同一已记录 signed body 即使更改 delivery header 也不会再次准入。允许外部作者须由有权限的人明确选择。

原投递记录绑定 hook、创建人、精确 reference 和稳定 native request ID；同一 source ID 换 body 返回冲突。准入中断或效果未知保持 `unknown`，原请求重试和正常重开不会再执行。`202 / accepted` 表示原生输入已准入，可能仍在队列中；模型完成须查看 Conversation 中对应原生回执，不能用 HTTP 成功替代。

轮换、移除、撤权、driver 交接或 Backend generation 失效会在原生准入前再次检查。已经确认排入原生队列的工作不会因 HTTP 结束或关闭扩展而被取消。仅移除 WebUI facet 保留 Backend 入口和记录；移除/禁用 Backend 拒绝新 ingress，不删除历史或假称撤回已准入输入。产品既有 host/Origin/受信任代理边界继续适用；创建 hook 不自动启用远程监听。

## 有限容量

名称最多 60 个 code units，instructions 最多 2000；每人最多 20 个活动 hook，每 hook 每小时最多 30 个新的非忽略投递。body 最大 5 MiB，投递文本适配原生 8192 code-unit 输入上限。Store 最大 2 MiB，累计 hook/mutation/delivery 记录分别最多 256/512/512；容量耗尽拒绝新记录，不自动删除去重证据。

## 公共扩展 ingress

[Backend SDK](../apps/webui/src/backend.ts) 的可选 `ExtensionService.ingress` 允许受信任服务声明原始 body 上限、执行截止时间、封闭输出 schema 和 handler。公开路线仅属于已安装 Backend 的 manifest-declared service namespace。handler 得到复制的 body、有限且过滤后的 header DTO、已验证 path segments、`AbortSignal` 和同步 live `check`；不取得 socket、Cookie/CSRF authority、模块选择或任意响应 header。

服务必须先认证外部身份，再调用受控效果端口，并把 live check 传至效果边界。超时/失联属于未知结果，不证明零效果，不提供自动重放许可。Webhooks 是该通用接口的真实消费者；通用 HTTP shell 没有 Webhook 或 MAS 调度分支。接口约束见 [扩展开发规范](WEBUI-DEVELOPMENT.md)。
