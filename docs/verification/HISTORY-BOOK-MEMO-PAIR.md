# History Book：Memo 消费与安装配对（2026-11-26）

消费端候选 Pakka `624756f185d438a75371c4061e5e670b92cdfc31`，Dynamite 构建候选 `f4fbe90ce40e262fb5fbb580a361a99f92e26143`。Windows x64、Node 24.15.0、npm 11.12.1，干净检出、仓外 tarball 安装。两个包版本相同的历史组合可能有不同的来源授权能力，按实际归档 SHA-256 选择：

| 产品归档 | SHA-256 |
| --- | --- |
| `@pakka/agent@0.7.0` | `8eadbb8c25a65faab3e217b665cbead6fcd2d9ef5f3321f8b59597799d6832e3` |
| `@pakka/dynamite@0.5.0` | `bfe49adbf3e17879af2ed39bb12afbae983c3dc0d07f425b0f0829b81afec66f` |
| `@pakka/memo@0.1.0` | `6bd23fc4d5ac3ed15a7a21c95ad8cee0c575c8345b48138b8da86ec9545af9e8` |
| `@pakka/mas@0.4.0` | `afdbb9eb85fcc7df949f25c425d329f824cf960e4eee3ca324aec41fe916bcc1` |

- 完整构建、`npm run check`、History/Memo affected（含 core，50 文件 **198/198**）通过。本次未选用全仓 release 集。Agent 与上次 `7a32904` 的归档逐字节一致。
- [安装验证](../guides/HISTORY-LIBRARY.md#本地确定性验证)：未装 Memo 的 Book 从 v2 读回 v1；增加 Memo/MAS 后安装态来源测试 **12/12**。真实 `MemoClient.search` 分页读回 6 条命中，517 字节的中文标题展示完整的 511 字节前缀，按返回的固定引用读回完整原题。
- 显式同权示例跑通 Compresser → Historian → Book → Patchouli → Memo：13 次确定性本地模型请求、1 个 Book 补注、1 次图书馆发布；重开原 Session 新增 0 次请求。独立目标授权需上表对应能力的 Dynamite；默认 GUI 与自由模型任务质量另行评估。

本地完整证据包 `history-authorization-f4fbe90-624756f.zip`，257,076 字节，整体 SHA-256 `617d4dcfe8628b3269b47aaf74bc019319a4b9fe354e7daf3e4518e1671345a2`。
