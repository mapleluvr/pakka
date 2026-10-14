# M6 Acceptance — Integrated MAS product

状态：**M6 accepted with documented notes**。基线为已验收 M5 `bd6781f5701d1b4c4f794f609c09d30b6c751708`，分支 `feat/monorepo-mas-migration`；最终提交以本文件所在 Git commit 为准。第一轮完整指定对抗复审的两份结构化 opinion 与 closing verdict 均为 **OK with notes**，A 的候选 P2 经 B 反驳后撤回，没有造成实际影响的 P0/P1/P2 或未解析 verdict。复审后未修改生产实现、测试、消费者或 package manifests；不为凑满两轮重复复审。

M1–M6 核心迁移在下述受支持范围内完成，**不是全部 Pi/Kappa 兼容性完成**。Dynamite 的原始失败和 DC-01–DC-12 仍 [deferred](DEFERRED-DYNAMITE-COMPATIBILITY.md)，未装配、未标记兼容；后续以本阶段核心产物为目标重新固定跨仓配对。GUI 本轮不创建。

## 交付及用户入口

- private `@pakka/server@0.4.0` 从真实 `pakka-server` executable 显式 bootstrap。操作员可在受信任 JSON 中批准 instruction-only profiles 与可选 `devpack.profiles`；不接受函数、插件路径、任意 tools 或 RPC 提权配置。
- product 和 private worker 共用 `apps/server/src/profile-devpack.ts`：每次绑定真实 native invocation；子成员有效 grants 是其 profile 与完整 capability-owner 祖先链的交集，缺失/循环祖先 fail closed。未选择 profile 不广告或继承默认 DevPack tools。
- 实际 server/client/CLI 组合完成批准 A2A/reply、成员发现、receipt 和管理权限分离。启用 DevPack 时，RPC role 的 `spawn/configure/fork` grants 在打开 storage 前拒绝；未启用时保留 M5 的批准 persistent RPC 路径。
- persistent、temporary/task-bound 与 background 分别使用原生 lifetime。temporary/task-bound 随**创建它的 tool task**结束，不跨到下一 prompt；background 可跨该边界，授权退役排空 anchor，历史不物理删除。
- 正常排空关闭后，显式 reopen 同 storage 保留 refs/incarnations、原 admission、指纹、已消费 quota 和动态成员，不创建替代 Session 或复活 ended/retired 成员。trusted bootstrap 保留 distinct 初始 roots；严格 MAS 库 bootstrap 没有放宽。

启动和配置见 [MAS-APPLICATION-API.md](MAS-APPLICATION-API.md)，组合、默认策略、恢复前提和 GUI 决策见 [MAS-PRODUCT-SUPPORT.md](MAS-PRODUCT-SUPPORT.md)。程序化多 Session、固定 worker 与批准 Session templates 不因此变成公开 JSON/RPC 命令。

## 执行证据

Windows / Node **24.18.0** / npm **11.16.0**。测试仅使用真实 production import、本地确定性 HTTP、独立 dataDir 和原始 Durable storage；没有用户 credential 读取或付费测试 provider。Reviewer 模型调用不是被测能力证据。

| Gate                                      | 结果                                                                      | 本地证据：`artifacts/migration-m6/`                                              |
| ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 无 node_modules/dist 的离线 clean staging | install/build/check/format passed                                         | `clean-result.log`、`clean-{install,build,check,format}.log`                     |
| source build/check/format                 | passed；固定 Durable hash verified                                        | `build-selection.log`、`check-final.log`、`format-final.log`                     |
| 全量串行 suite                            | **251/251**；0 fail/skip/todo/cancel                                      | `tests-first.log`                                                                |
| M6 product/worker 定向                    | **17/17**；0 fail/skip/todo/cancel                                        | `targeted-first.log`                                                             |
| 隔离安装真实 tarballs                     | legacy/runtime/MAS/broker/DevPack/apps/product **7/3/3/3/8/2/18 次 HTTP** | `package-third.log`、`package-first/`                                            |
| 新 product consumer                       | **18 HTTP，7 个 native tool-call/result pair**，两个不同 server PID       | `package-first/product-{evidence,requests}.json`、`product.log`、`product-data/` |
| declarations/browser/原有边界             | DOM-only 声明、owned Chrome、同进程多 Session、real-worker 消费保留通过   | full/focused suite、各 installed consumer 的独立日志                             |
| 指定 adversarial-review                   | 两份 opinion 和 closing 均 **OK with notes**；无未解析 verdict            | `review/completed-pass1/`、`review/disposition.md`                               |

计数属于各自实际执行，不把此前 M1–M5 数字相加当作 M6 结果。product 消费者从仓库外安装编译产物，通过 server/CLI 提交模型工具，独立保存实际 HTTP、原生 tool result、11 个 terminal receipts、关闭重开前后的 snapshot 与 storage。重复 admission/reopen 无额外 dispatch，18 次预算耗尽后没有额外 HTTP。`effects: not-assessed` 不代表任意外部副作用已经回滚或 exactly-once。

## 固定产物

搭配为 agent `0.5.0`、mas `0.4.0`、mas-devpack `0.2.0`、protocol/client/cli `0.1.0`、private server `0.4.0`；仍不发布。

| 产物                            | Tarball SHA-256                                                    |
| ------------------------------- | ------------------------------------------------------------------ |
| `@pakka/agent@0.5.0`            | `c5a7e7e1d2c9206baa67c0e0b3cbb479b991582b8e9a64803352d9efd8df3036` |
| `@pakka/mas@0.4.0`              | `83b7a3873aa1f634ac1b4e5b86c7f4482f051c305897dc54dd85369e44899584` |
| `@pakka/mas-devpack@0.2.0`      | `5a70dba1aa22255d820270343ffd2cb8dea6d0f2dc87fb498ca2eefe4ffa8e01` |
| `@pakka/protocol@0.1.0`         | `1d384eb8e1471d16a1e45c5ac59f65e24ac87651b80486e7c042df15427f821c` |
| `@pakka/client@0.1.0`           | `264ebf3f7cf448617bf6db7e723e79cf7c041334e5b4f04b13fae09f19f13bdd` |
| `@pakka/cli@0.1.0`              | `06965702518dc3a33f15c0ade1164c3e053ef0ac8b042e399e34dd1eacaf796b` |
| private `@pakka/server@0.4.0`   | `79214b3956da525579e8b5f66436f217b1870c8dea4dd3b3a97995b5f07c7517` |
| bundled Durable `1.0.3-pakka.1` | `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7` |

`identity-first.json` 保留执行阶段的源码/产物/integrity、HTTP/tool/count、patch identity 和 pending-review 原始状态，不改它制造放行。后续 acceptance index 单独关联最终 commit、状态文档和复审。提交前 19 个冻结文件 SHA 与复审 packet 一致；之后仅补状态文档/归档。Pi SDK/source patch/build lock 未变，复验 hash 和受影响矩阵，不把历史 patch 105/105 冒充本轮重建。

## 失败先行、复审和更正

1. 实际 product server 最初缺 DevPack 启动配置，model tool 红；批准配置通过现有公共 extension path 装配，无 Pi mutable handle 外泄。
2. persistent model child 创建后，原初始 roots 配置无法正常 reopen（`Bootstrap membership conflict`）。product 的显式 reopen 验 distinct 初始 roots、已存 descendants 和 native readiness 后接回原 roster；没有将动态 roster 写回用户配置、重写 owner 或放宽 MAS 库 bootstrap。改 root owner 仍拒绝。
3. 隔离 consumer 暴露 plain profile 继承默认 DevPack tools；product 和真实 worker 都先有独立红例，再显式空工具集，下一实际 HTTP 不再广告这些 tools。仅“工具执行被挡住”不是可选安装验收。
4. 早期 product reopen 测试缺 observe grant，仅改 fixture 授权，未放宽 production；consumer 的启动链曾缺 npm_execpath，由真实 `npm run smoke:package` 入口验证，不伪造通过。
5. 首次复审 `d2dbb96e` 受 pi-subagents 0.76.1 旧 Chord 校验阻断，A/B 都未启动，无有效报告。宿主 Pi 1.2.0 已移除 Chord；operator 更新 pi-subagents 至 0.78.0 后，同一指定工作流 `5679c5de` 完成全部八个 child。没有补装宿主 Chord、修改 installed dependencies 或换 CLI/model 协议；Pakka pinned cohort 仍是 1.0.3。
6. A 报 duplicate-root 可跳过 retained-roster 分支；B 确认机制但证伪影响：fallback `mas.bootstrap/activate` 仍核验 roots 与全部成员实际 readiness，模型授权仍受完整祖先交集。A 撤回 P2；两份原始意见、反驳、更正和 closing 都保留。该判断依据源码及已有产品 evidence，不冒称 reviewer 跑过 duplicate-roots reopen。
7. Reviewer 引用不准处已在 disposition 更正：grant Set 为 MAS `:163`，adapter tool enumeration 为 `:857`，shared profile helper 位于 `apps/server/src/profile-devpack.ts`。Reviewer 未自行执行 gates；独立机械报告、实际执行与 parent 最终判断分开。

## Report-only notes 和剩余边界

- **Trusted root config hardening**：decoder 未提前拒绝 duplicate root keys，reopen 的 length predicate 也可因显式 full roster 路由到严格 baseline bootstrap。当前没有造成权限扩张/未确认 readiness 的证据；不以可选 hardening 扩大本轮代码。支持路径要求 distinct 初始 roots，不承诺 malformed trusted root 配置选择哪条恢复分支。
- **Persistent membership ≠ live task**：temporary/task-bound 在持久 membership 中可能仍显示 active；inspection/native admission 才确定 ended。不得仅凭 snapshot membership phase 继续投递。
- **Complexity/report quality**：parent 测量 production 为 `+205/-78`，net **127** physical lines；三个 app 文件共 **506** lines，没有新 workspace/framework/storage engine。Reviewers核验了 bounded owner walk 并反对无需求 benchmark，但没有给出要求的独立数值统计；parent 数字不冒充独立量化。
- 继承 M5 的严格关联/pre-body capacity unknown、opaque callback effects unknown、保留 error codes、issuer 实例内 revoke、trusted-only broker provenance/config 和平台相关超限连接限制。
- 没有 public broker/template provisioning、任意策略/工具模块加载、物理 delete、共享 storage 多 writer、lock theft、forced-crash 自动恢复、sandbox 或 exactly-once effects。新 Harness 不提供进程隔离；实际隔离 worker 仍由可信 manager 管理。
- GUI 没有新增：真实 browser-safe client/protocol 已有消费者和验证，本轮没有 UI 使用/视觉验收需求。未来 GUI 消费这些端口，其 repo 决策随真实维护边界决定。

核心完成后的顺序为：固定本阶段 Pakka commit/artifacts → 独立 `pakka-dynamite` 版本化 frame adapter 与 DC-01–DC-12 → 宿主批准、按 Conversation 的可选策略产品配对。通过兼容验收才将该配对标为 accepted；不会静默改默认 native 策略或覆盖历史失败。
