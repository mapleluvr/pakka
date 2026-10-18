# Pakka-Pocket P1 — 受控服务与独立协议

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

本页记录 P1 的受控服务实现与当时的阶段门禁：在 P0 来源／原生证明之上增加人类身份、工作区、有限分页与原生后台任务；HTTP、Cookie 登录、SSE 和浏览器界面随后由 [P2](PAKKA-POCKET-P2.md) 接入。当前能力和验收范围见 [产品状态](../../PAKKA-POCKET-STATUS.md)；下文测试总数属于该阶段版本。[完整范围](../../plans/PAKKA-POCKET-PLAN.md)与 [WebUI 开发规范](../../development/WEBUI-DEVELOPMENT.md)继续有效。

## 公开入口

| 入口                                                           | 用途                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@pakka/agent` → `Runtime.readConversation(ref, check, page?)` | 被动、冻结、当前资源引用绑定的历史页和 live/tool/usage DTO       |
| `@pakka/agent` → `Runtime.writeDisplay(ref, input, check)`     | 人类 chat/card；持久去重、无模型贡献、不替换运行输入             |
| `@pakka/agent` → `Runtime.jobs(options)`                       | 宿主批准定义的后台任务和持久回执，不暴露原生 task/Tx             |
| `@pakka/server/pocket`                                         | `createPocketPeople`、`createPocketWorkspace` 的可信宿主组合入口 |
| `@pakka/protocol/pocket`                                       | 显式 `version: 2` 的有限请求、结果、事件解码器                   |
| `@pakka/client/pocket`                                         | Cookie/CSRF 产品所用的 fetch-only 客户端；导入不连接或发现凭据   |

这些是新增子路径。原有 headless v1 请求/认证、`createClient`、M6 profile-changing guard 与默认监听范围不变。浏览器不能传入 principal、grant、endpoint、credential、storage 路径或 task 定义。

## 人类身份

身份记录通过当前 Runtime 的受控 JSON store 持久化，单 writer/namespace，保存随机 bearer 与 CSRF 的摘要。初始化 owner 只供可信本机宿主组合调用，不是未认证网络路由。邀请一次兑换，重复请求不重新签发邀请 token；同一邀请的并发兑换只有一次提交成功。定向邀请可为既有人类身份重新登录。

| 角色   | 业务操作                                     |
| ------ | -------------------------------------------- |
| viewer | 获准 Conversation 的读取                     |
| sender | 读取与普通输入/显示记录                      |
| driver | 另有 native steer/followUp                   |
| admin  | 另有管理、创建、邀请、角色变更与扩展安装权限 |

管理类的全局动作还要求全资源域。资源读取/操作按服务端当前身份检查；对象复制或自行构造 `check()` 不会获得 authority。过期、退出、撤权、角色/资源变更及轮换会使旧绑定失效。每次网络请求仍需重新认证；操作跨 `await` 时在读取发布、准入和提交处重验。未知或损坏的身份存储拒绝继续授权，不重建默认 owner。

应用身份约束不是 OS 或可信插件沙箱。驱动真实工具的用户具有这些工具在宿主上的实际能力。

## 人工工作区与配置上限

工作区保存人类创建请求到受控 catalog 的对应，不另建 scheduler。创建使用稳定 person/request/payload；正常重开复用原 Conversation。人工输入使用持久原生 submission 回执，人的共享 Conversation 读取权限不允许认领另一个人的 receipt。

宿主的 `profileCeiling(person)` 在 `create/configure/fork` 前和提交时检查。Runtime 批准的强 profile 也不会因此自动对每个人开放。`configure` 更新 incarnation；`fork` 基于真实历史节点创建新资源。工作区管理仅限自己的 catalog；MAS 所有的资源由其扩展服务管理。

普通 `readConversation` 可读取已获准的当前 Runtime 资源，包含后续插件管理的 Conversation；这是读取权限，不隐含通信、管理或完整 MAS 观察权限。没有公开跨 Session broker 回执的新增读取/投递路径。[broker exact provenance 后续工作](../../reference/BROKER-API.md)保持原门槛。

## 分页、显示与后台任务

历史默认至多 256 个 committed entry。`olderBeforeId` 是该精确资源引用内的 exclusive boundary；limit 和 boundary 都有限并校验，foreign/stale boundary 被拒绝。新 append 不使已经取得的更早分页改变顺序。live 工具和 token 用量与 committed entry 分开；没有可信价格来源的费用保持 `null`。

显示记录使用 namespace/actor/request 与内容指纹去重，`kind: chat|card` 不加入模型输入。断线或等待取消不撤回已经准入的工作。通过下一次实际 provider HTTP 验证该隔离，而非只检查界面样式。

后台任务定义由宿主在 Runtime 创建时固定。提交仅指定已批准 definition、actor、target 和有限 JSON payload；任务绑定原生 Conversation owner 及 background boundary。handler 每步重验当前 authority，可以提交 checkpoint、完成结果或受限等待。正常关闭/reopen：

- 已提交 checkpoint 只继续下一步；已完成结果继续可查询。
- 已进入 handler 但无下一 checkpoint 的执行保持 `unknown`，不自动重复外部效果。
- 取消 receipt wait 只取消观察；显式 abort 是另一个操作，不能据此声称外部效果已回滚。
- 缺失定义/不符版本、存储未知或权限失效不会恢复为可执行的默认状态。

未知结果不释放已消费推理额度；这不是任意 HTTP/工具 exactly-once 的保证。业务 handler 在可控效果前必须调用绑定检查。

## 验证入口

- `apps/server/test/pocket-people*.test.ts`：兑换/过期/撤权/轮换、角色/资源、损坏状态与重开。
- `apps/server/test/pocket-workspace*.test.ts`：真实创建/fork/configure、profile ceiling、跨用户回执和 native followUp。
- `packages/agent/test/conversation-pagination.test.ts`、`runtime-backend-*.test.ts`：真实 Durable 分页、任务/checkpoint/abort/reopen。
- `packages/protocol/test/pocket.test.ts`、`packages/client/test/pocket.test.ts`：v1/v2 分离、有限 schema、错误关联、fatal UTF-8、丢响应不重放。
- [隔离消费者](../../../scripts/consumer-pocket-services.mjs)经 `npm run smoke:package` 安装真实 tarballs，校验公开声明与 DOM-only browser 声明、身份/工作区/任务、原 admission 和预算。

精确阶段执行结果记录在 `artifacts/pakka-pocket/p1/`。上游原始失败基线独立保留于 [P0 记录](PAKKA-POCKET-P0.md)，不与新路径的通过数相加。最终产品的真实浏览器、部署、插件和指定独立复审仍属于 P2–P6。
