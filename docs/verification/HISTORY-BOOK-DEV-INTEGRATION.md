# 2026-11-28 Memo / History Book dev 安装验证

独立复审 [Pakka #19](https://github.com/mapleluvr/pakka/pull/19)（`dev@45b95a6` 含 #21，工作头 `a3a6921`，本地合并 `f0d1e00`）与 [Dynamite #1](https://github.com/mapleluvr/pakka-dynamite/pull/1)（`dev@e074c14`，工作头 `4c641e3`，本地合并 `92a228b`）。未改候选产品源码；Dynamite 包内的两份说明对应 `9b97719`（树同 `89dbf72`）。

| 在仓库外实际安装的包 | SHA-256 |
| --- | --- |
| Agent 0.7.0 | `8640ba4a2cbe8c9c753d536e8b209f57baa790b1c2ef035b21cd89ff800a24be` |
| Dynamite 0.5.0 | `761192645949ec4261cf9e59110dcfe8ab0b540a7d728c128d4842ff8269b9a6` |
| Memo 0.1.0 | `6bd23fc4d5ac3ed15a7a21c95ad8cee0c575c8345b48138b8da86ec9545af9e8` |
| MAS 0.4.0 | `afdbb9eb85fcc7df949f25c425d329f824cf960e4eee3ca324aec41fe916bcc1` |

Windows、Node 24.15.0、npm 11.12.1、真实 SQLite 与本地确定性 provider。Pakka 构建/类型检查，核心＋History/Memo 50 文件 198/198 通过。Dynamite 构建/类型检查、完整 418/418；其开发锁 Agent 的仓外兼容矩阵 73/73 通过。新 Agent 来自包含 #21 的集成树，不能用[旧配对及其结果](HISTORY-BOOK-MEMO-PAIR.md)指代新归档。

- 同一固定 Book 的安装态对照：只恢复标题直传，Memo 在分页时拒绝整页（`Invalid source search result`）。用候选适配器得到 6 项；520/517 字节的含补充平面字符标题分别裁至 510/511 字节，恰 512 字节的标题不变；升至 v7 后，按 v6 原 ref 仍能读出每项完整标题。
- 先安装 Agent＋Dynamite，无 Memo 也能编辑 v2、读取 v1。随后安装 Memo＋MAS：来源、分页与发布契约 12/12；真实 Compresser→Historian→Book→Patchouli→Memo 共 13 次本地请求、1 次 Wiki 发表、1 个 Book 补注，重开新增 0 次请求。
- 安装态 Historian 8/8，覆盖回源的实际产物/归档身份、初次与纠错请求的当前材料授权，以及真实原生纠错的正向对照。Book 正文与引用仍按 Book 自身权限定界；Memo 只负责图书馆适配，不给上游加标题限制。

范围是显式装配的 headless 契约，未运行 Pakka 全仓 release、GUI 或真实模型质量评测。本地原始证据包 `history-pair-dev-20261128.zip`，216508 字节，SHA-256 `19dfa11a70eb313de79a837f41a693baae0bdb51b59bf8ce71bf7960325b4c0a`；未上传。
