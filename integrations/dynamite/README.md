# Dynamite 固定配对与执行

本目录维护 Pakka 与独立 [pakka-dynamite](https://github.com/mapleluvr/pakka-dynamite) 仓库的精确配对和检查入口。算法、产物模型与 Dynamite adapter 由外仓维护；本目录负责装配和安装消费者。

## 配对选择

| 使用路径                     | 身份                                                                                               | 契约                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 程序化 SQLite 工作与恢复     | [SQLite 配对](sqlite-persistence-pairing.json)、[源码关联](sqlite-persistence-source-commits.json) | [Dynamite 持久化](../../docs/state/dynamite-persistence.md)与 [Strategy API](../../docs/reference/STRATEGY-API.md) |
| Headless server 显式可选贡献 | [server 配对](core-m6-pairing.json)                                                                | [Dynamite 配置 API](../../docs/reference/DYNAMITE-PRODUCT-API.md)                                                  |
| 固定源码兼容性探针           | [源码配对](pairing.json)                                                                           | [run.mjs](run.mjs)指定的生产包、编译器和外仓 commit                                                                |

配对中的版本、完整 commit、归档 SHA-256 与构建时 workingTree 身份共同描述输入。后续保存的实现提交由源码关联记录承接，不能反写为旧归档的构建身份。选择不同入口时使用各自的配置与归档，不将一个组合的结果推广到另一组合。

## History Book 消费者

固定归档的独立 Book 和可选 Memo 组合由 `npm run smoke:history -- --agent <agent.tgz> --dynamite <dynamite.tgz>` 验证。先安装 Agent＋Dynamite，再安装 Memo＋MAS；完整调用链、完成条件和存储关系见 [Book 与图书馆协作](../../docs/guides/HISTORY-LIBRARY.md)。配对通过原归档 hash 和后续源码关联分别记录，历史 SQLite/server 配对继续保持原身份。

## 程序化 SQLite 消费者

从相应 Dynamite checkout 运行，参数为要构建的 Pakka checkout：

```powershell
npm run bootstrap:host -- <pakka-checkout>
npm ci --ignore-scripts --no-audit --no-fund
npm run smoke:package -- <pakka-checkout>
```

`bootstrap:host` 生成明确标记的本地开发配对；检查锁定归档与依赖后执行标准安装。归档与消费矩阵写入各 runner 指定的忽略目录，固定身份保存在配对 JSON 中。产物、精确采纳回执与 checkpoint 的同库提交及跨库恢复由持久化契约定义。

## Headless server 消费者

在 Pakka 根目录运行，提供与 server 配对 SHA 完全一致的两个归档：

```powershell
npm run test:dynamite:product -- <agent-archive.tgz> <dynamite-archive.tgz>
```

runner 在 build、pack 或安装前核对归档身份，打包真实 server/client/CLI 并在仓库外安装。运行经原生调用的工具、实际本地 HTTP 和存储断言。显式选择服务的成员、角色约束、撤权与重开行为见配置 API。

## 固定源码探针

在完成依赖安装的 Pakka 根目录运行：

```sh
npm run test:dynamite
```

要求 Node 24+、npm 11、Git 和 GitHub/npm registry 网络。脚本核对 agent、Durable patch 和编译器身份，构建并打包宿主，检出精确外仓源码，在隔离 build 中以该宿主编译并打包 Dynamite，再安装两份真实归档到仓库外消费者。外仓 checkout 必须干净；runtime/peer dependencies 按其 manifest 保持。

## 输出与判读

模型请求仅使用 fixture 的 loopback HTTP provider；模型配置、测试 key、profile 和数据目录独立。安装禁止 lifecycle scripts，不使用用户模型凭据、workspace link 或根 overrides。

每次执行生成 summary、命令日志、归档身份、依赖树和原始 HTTP／存储证据；具体路径由 runner 输出。声明检查、Host smoke 和行为用例均以实际 exit 与完整断言判读，缺项、重复计数、skip、todo 或 cancelled 不计通过。读取旧 summary 不能代替新执行。

形成与固定版本结果由[集成来路](../../docs/changes/core-integration-lineage.md)、[持久化变更](../../docs/changes/dynamite-sqlite-persistence.md)及配对所链接的记录维护。
