# WebUI 模型目录与权限精简

日期：2026-10-25。基线 `d6199a38371446a912abe315f3d2da366cb3ed01`。本轮是用户明确否定“获准模型”并要求审计同类过度配置后的实现者自检；完整 Session 创建、设置路由和 sidebar 文件夹并未在本轮实现。

## 采用与代码

- [change / proposal](../../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)、[design §6.5](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#65-2026-10-25-模型与相关权限精简)、[tasks §4.5](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#45-模型与相关权限精简2026-10-25)、[模型目录 delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#requirement-model-selection-uses-a-configured-catalogue-rather-than-per-model-grants)。
- [形成摘要与全部 spec 链接](../changes/webui-navigation-and-local-recovery.md)、[frontend state](../state/frontend.md)、[开发契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录)。
- 实际效果修改仅为 [workspace](../../apps/server/src/pocket-workspace.ts) 和 [有限协议](../../packages/protocol/src/pocket.ts)；前端模块只有一行注释修正。没有新增 ACL、角色、授权开关、API 或生产依赖。

模型目录来自当前 provider 的 `runtime.model` 与 `runtime.profiles[].model`，不是远端自动发现。模型-only 选择、模型继承和候选列表不再叠加完整 Agent 预设 ceiling；目录按 model ID 去重并保留首个标识，只发布 id/model。完整预设仍按其工具、指令与 cwd 效果独立约束。未知模型、原资源权限、busy、旧 incarnation、撤权、额度与 unknown 恢复未取消。canConfigure 按真实 manage 权限表达，不再对无配置权的 driver 给出 true；人在异步读取结束后重新取值。

相关审计包括 cwdRoots/symlink、多人身份与 driver lease、凭据/扩展可信代码、持久 writer、Session 创建和文件夹草案。真实隔离各保留其用途；创建草案改为普通初始模型选择，个人文件夹不增加 ACL 或多层继承。完整处置矩阵在上述 design §6.5，不以“精简”为由扩大现有角色写权限。

## 有限协议边界

JSON 启动允许 64 个附加预设，加默认模型可形成 65 个不同模型。去掉旧名单后，旧 64 项配置响应验证器在真实已认证 HTTP 上返回 500 / unknown，且公共 decoder 拒绝真实合法数量。上限已对齐为 65，第 66 项仍拒绝，不截断列表或重新制造权限名单。

Envelope 维持 v2。server/client 一起构建；旧的 64 项客户端读取 65 项时需更新，不宣称对该旧构建完全兼容。更大 headless/programmatic 模型目录不在当前有限 WebUI 承诺内。

## 真实失败与回归

所有 provider 为本地确定性 HTTP；测试使用隔离 HOME/PI_CODING_AGENT_DIR，不读取用户凭据或调用付费模型。新 [产品回归](../../apps/webui/test/model-catalog-permissions.test.ts) 经 JSON 配置、真实 startPocket、公共 workspace、原生提交/存储/重开和真实 cookie/CSRF HTTP；[协议回归](../../packages/protocol/test/pocket-configuration.test.ts) 单独证明 65 接受、66 拒绝。既有手机浏览器用例已去掉 alternate 完整预设 grant，仍通过真实 UI 选择、provider、继承和刷新。

| 证据                                                                   | 结果与解释                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [原基线 RED](evidence/webui-model-permissions/red-d6199a3.log)         | 3 个目标断言失败：候选被 ceiling 隐藏并带 cwd、model-only 被拒绝、driver 错误 canConfigure。原命令过滤了全仓测试，其余 209 个文件级通过占位不称作 209 个功能回归。 |
| [第一轮 GREEN](evidence/webui-model-permissions/green.log)             | 3/3；真实下一请求使用所选模型，无另一个预设的指令/cwd，继承/正常重开保留模型、回执和已花额度。                                                                     |
| [重复项 RED](evidence/webui-model-permissions/dedup-red.log)           | 1 fail / 2 pass；同模型的两个预设被误作两项。最终按 model ID 去重。                                                                                                |
| [容量 RED](evidence/webui-model-permissions/capacity-red.log)          | 2 fail / 5 pass；真实 HTTP 500 和 decoder 拒绝 65 项。其余 5 项通过；没有用伪造 HTTP DTO 代替出口。                                                                |
| [旧断言差异](evidence/webui-model-permissions/legacy-expectations.log) | 2 个旧契约断言仍要求候选带 cwd 或模型按预设隐藏；按用户采用状态同步，凭据/指令/资源/全局额度的禁止读取断言保留。                                                   |
| [受影响首轮](evidence/webui-model-permissions/affected.log)            | 23 tests / 22 pass / 1 fail；浏览器仍按旧名单要求隐藏配置模型。改用公开配置模型及独立私有指令 canary，不删除秘密隔离断言。                                         |
| [中间回归](evidence/webui-model-permissions/affected-r2.log)           | 23/23。                                                                                                                                                            |
| [最终受影响回归](evidence/webui-model-permissions/affected-r3.log)     | 27/27，含目录边界、资源写权限、整组预设、配置恢复、原生模型请求、手机独立配置与模型索引。                                                                          |

## 固定候选与全量

产品/测试固定于 `f4ed91c057ec375d53b61aa53628b42623fef3fd`。同 SHA 执行 `npm test -- --test-reporter=tap`，由仓库自带 runner 隔离环境；[全量原日志](evidence/webui-model-permissions/full.log)为 **650 tests / 648 pass / 0 fail / 2 skip，exit 0**。两项跳过均为既有 Windows 不运行的 POSIX CDP 控制程序用例，没有跳过本轮模型功能。

[证据 manifest](evidence/webui-model-permissions/manifest.json)绑定固定候选的 9 个产品/测试 Git blob 和 15 个原始证据文件，逐项记录字节数及 SHA-256；raw bytes 按仓库 `.gitattributes` 保留。最终文档/证据提交相对该候选的 `apps/`、`packages/` 为零 diff，不用文档提交冒充另一份未经测试的实现。

- [build](evidence/webui-model-permissions/build-r3.log)、[check](evidence/webui-model-permissions/check-r3.log)、[格式](evidence/webui-model-permissions/format-check-r3.log)、[OpenSpec strict](evidence/webui-model-permissions/strict-r3.log) 均通过；另有 whitespace 检查。
- 主动 LSP 首轮 6 路径为 3 clean / 2 findings / 1 inconclusive，41 项辅助风格提示见[原输出](evidence/webui-model-permissions/lsp.txt)；最终 4 路径为 1 clean / 3 inconclusive，见[最终输出](evidence/webui-model-permissions/lsp-r3.txt)。silent-on-clean 不等于全路径干净，不能宣称零 LSP 错误门禁；TypeScript 全仓 check 的通过单独记录。
- 按操作者本会话 note48 不安排独立复核。浏览器功能回归不是独立桌面 GUI 验收，既有受阻记录不改为通过。
- 旧 `45005` 预览、认证状态与数据未改动；本轮未合并 main。预先存在的 `docs/verification/README.md` 修改未纳入本轮提交。
