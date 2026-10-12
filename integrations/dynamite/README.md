# Durable × Dynamite 配对门禁（M0）

此目录消费外部 [`pakka-dynamite`](https://github.com/mapleluvr/pakka-dynamite) 的固定源码，**不是** Dynamite 算法或 adapter 的复制品。`@pakka/agent` 保留现名；MAS 和多 Conversation 迁移必须保留这个跨仓门禁。

## 运行

在已完成 `npm ci --ignore-scripts` 的 Pakka checkout 中运行：

```sh
npm run test:dynamite
```

需要 Node 24+、npm 11、Git 和访问 GitHub/npm registry 的网络。模型请求只访问 fixture 的 `127.0.0.1` HTTP provider；profile、模型配置、字面量测试 key 和数据目录均独立，不使用用户模型凭据或付费 endpoint。消费者在仓库外创建，不安装根 workspace overrides，也不允许 lifecycle install scripts。

`pairing.json` 固定外部 repo/完整 commit、双方 package version、Durable patch SHA-256 和 compiler 身份。脚本按以下顺序验证：

1. 校验当前 agent version 和已审计 Durable artifact identity；记录宿主 commit、tracked source diff、Node/npm 与门禁源码 hash。
2. 构建并通过现有 staged packer 打包 agent，克隆并 checkout 固定 Dynamite commit。源 checkout 必须保持干净。
3. 在隔离 build 目录中，用这次 agent tarball 编译外部 Dynamite；仅替换构建用 dev dependencies，pack 前恢复固定源码的 package manifest，runtime/peer dependencies 不变。不执行外部 npm scripts，也不修改 sibling checkout。
4. 将实际两个 tarball 安装进仓库外消费者；记录 tarball SHA-256/integrity 和依赖树；确认依赖不是 workspace link。
5. 编译公开声明，运行现有 installed host smoke，再运行本目录的 Dynamite 行为回归。

## 证据与结果

每次运行在 `artifacts/dynamite/run-*/` 写入 `summary.json`、逐命令日志、tarball 副本和 fixture HTTP/frame/view/raw-history/journal 副本。仓库外 build/consumer 保留供失败调查；其位置记录在 summary 中，不是可提交的源码。完整新运行是复核入口，不把旧日志当作新配对的放行结果。

`summary.status` 为 `passed`、`blocked` 或运行中的 `running`；任何安装、声明、host smoke 或行为断言失败都返回非零 exit。门禁自身有 8 项失败先行回归，要求完整 6 项行为检查全部通过，拒绝 missing/duplicate TAP counts、减少用例、todo/skip/cancelled 或不一致的 pass 总数。**不能通过删除失败断言、标记 todo/skip 或把已知失败改成 expected success 来放行 M0。**

当前第一组回归覆盖编号、reduce/flush、64/128 cap 的压缩候选与 wire adoption、reload/reopen 和缺失权限的零 dispatch。源 edit/ABA、unknown-storage 及其他组合回归仍是 [M0 退出条件](../../docs/MONOREPO-MIGRATION-PLAN.md)，本目录初始回归不代表完整 M0 已通过。

## 当前固定配对：blocked

- Pakka 生产基线：`6c77632`；本轮宿主 checkout：`84bffb141bc610ed0c322e081c192a0e39508c4b`（相同生产代码，加仓库规范）。
- Dynamite：`5ff775aee041fe63a82a7fcd1d108d17c206da4e`，`@pakka/dynamite@0.1.0`。
- Durable：`1.0.3-pakka.1`，identity 见 `pairing.json`。
- 原始失败运行：`artifacts/dynamite/run-JVQkFr/summary.json`；最终门禁复跑：`artifacts/dynamite/run-pANLhY/summary.json`（保留两个实际 tarball）。两次 installed host smoke 均通过，7 次本地 HTTP、64/128 cap、block 零额外 dispatch、oracle absent 和 private subpath rejection 均验证。
- Dynamite 初始 6 项回归：1 通过、5 失败，无跳过。下一次 HTTP 未出现编号，`reduce("#1")` 未接受目标，两个 compression cap 用例没有发出摘要请求，恢复用例在初始 reduce 处被阻断。

具体外部 seam 是该 commit 的 `src/pakka-adapter.ts:31–51`：`toRuntimeFrame()` 将 Durable `pi.*` raw records 原样作为旧 `EntryLike`，并只从 `message/custom_message` 提取 raw messages。Durable frame 的 `pi.user`、`pi.assistant` 和 `model[]` 因而不能形成算法所需的 numbering/step/source inputs。编译和相同的 `0.1.0` peer version 不足以证明行为兼容。

修复应在明确的、版本化的 producer DTO 或外部 adapter 映射契约中完成；本目录不伪造旧 raw records、不直接解析 Pi storage、不内嵌外部算法修补。用户已明确授权此专项延期、不阻塞 M1–M6 核心迁移；[未处理问题、兼容性功能目标和恢复条件](../../docs/DEFERRED-DYNAMITE-COMPATIBILITY.md) 已单独留档。迁移期间不装配或宣称 Dynamite 兼容，保留本门禁的失败语义；核心迁移完成后再修复外部组件、更新固定配对并补齐 M0 矩阵。
