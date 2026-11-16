# 独立 WebUI 阶段 3 核对

## 对象与结论

阶段 2 基线为 Pakka `ed05a2f202df5fd77b7c919b5eb8e545fde06e99` 与独立前端 `977b138c074fcc17a16ba4ad00bfc7ca76b3332b`。本轮补齐静态应用归档命令和 [固定配对](../../integrations/webui/README.md)，完成 [phase-3](../../openspec/changes/plan-independent-webui/phase-3.md) 的独立构建、两个前端候选及启动前不兼容拒绝。阶段 3 的 5.1–5.2 已通过；这不表示阶段 4–5、默认交付或发行已完成。

当前完整应用：`pakka-webui-app-0.1.0-bc3c6f49f4e6e11b.tgz`，1,184,383 字节，SHA-256 `bc3c6f49f4e6e11b2ffbc947e35df1b0504f552726e715c752d4fba345f68482`；manifest 为 `418033338b02ad0f6dec8ab24dcbbf3278b9d71b8f8454197418f9669d396e15`。共 637 声明资产、639 归档成员，包含六项上游许可文件。内容、成员集合和全部资产 hash 已核对；SDK 仍单独交付。

## 真实路径检查

- 从 public 前端仓库 checkout 阶段 2 源码，加入本轮 pack 命令后形成干净独立候选；安装、类型检查、完整构建与 npm pack 通过。安装图的 Pakka 包只有 protocol/client，不含 Node/Agent/Pi 后端执行包，无 sibling 源码和根 overrides。最终 pack 命令再次重建得到完全相同的归档与 manifest。
- A 的应用字节来自阶段 2；B 在隔离 checkout 仅把普通 GUI-only 插件版本改为 0.1.1，并将计数从 0/+1 改为 10/+2。B 是受控候选，不是另一公开发行。两者服务需求及共享 runtime 完全相同，B manifest 为 `1db10e04519cc990d12d1f13cdeb1fd93b52408d19ba94bd0a1754ac197bbff6`。
- 一次仓库外安装使用九份固定后端归档，完整安装清单留在本地证据，仓库配对记录仅保留所需的公开服务包身份。Node v24.18.0，独立 HOME/agent directory、合成本地认证源。A → B → A 全程使用相同 package/lock，未修改后端源码或 node_modules；启动时通过公开 `startPocket`/`loadWebUiAssets` 消费解包产物。每次按现有固定资产语义正常关闭并显式重开原 SQLite，不宣称进程内热替换。
- Ego 浏览器从独占回环 origin 真实登录、读取原 Conversation。A 点击计数 0 → 1，B 10 → 12，恢复 A 后为 0；实际模块 URL 随候选切换并恢复。三次保持同一 Session/Conversation 和原路由，已登录状态及模型配置可读，未建立替代 Session；本样例为空历史，长正文/分叉证据仍属于阶段 2。
- A、B 与恢复 A 的同轮浏览器监测均无脚本错误和 CSP 违规。原 Session 重开保持资源身份；隔离 provider 捕获的模型请求共 **0**。服务和任务空间正常关闭。

## 拒绝检查与修正

| 输入/操作                      | 真实结果                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| 错误 manifest pin              | `Frontend manifest identity mismatch`，未创建数据目录              |
| services 4 候选                | `Frontend requires an unsupported service version`，未创建数据目录 |
| 资产 schema 1                  | `Invalid frontend asset manifest`，未创建数据目录                  |
| manifest 不变、HTML 被篡改     | `Frontend asset identity mismatch`，未创建数据目录                 |
| 兼容但 entry:null 的 runtime   | 产品拒绝缺少 `/` HTML，未创建数据目录                              |
| 打包前资产字节改变             | pack 非零退出，不生成归档                                          |
| manifest 资产与 npm 元数据同名 | 首次复现覆盖且命令误成功；加入保留名拒绝后非零退出、不生成归档     |
| 交付目标已存在                 | 拒绝覆盖，原文件保持不变                                           |

原失败保留：第一次安装路径检查混用了 Windows 路径分隔符；核对真实公开 import 位置后修正探针，从新隔离数据目录重跑。一次浏览器 reload 未保留跨 CLI 轮次的监测注入，未当作 CSP 通过；改为同一轮注入/导航后复验。npm CLI 路径查询误用 npm exec node 导致临时缓存下载 Node 27；该调用未用于构建/服务验收，实际 Node 24.18.0 和产品 lock 另行核对，未改全局 Node 或项目依赖。

## 检查选择与边界

本轮后端只增加固定应用归档、配对和说明，不修改服务实现/协议/依赖。使用真实归档/公开 loader/安装版/浏览器及边界探针，不新增固化 DOM 或私有结构的长期测试；这些是有界专项检查。阶段 2 的 336 文件回归、长路径 ACL 原失败/短目录复验、上游 43 条声明错误与六项旧依赖告警保留各自记录，本轮不将它们改写为重新全量通过。

前端 pack 脚本、隔离 B 源码主动 LSP 无错误；格式、OpenSpec strict、链接与完整交付清单按本轮最终文档核对。默认启动仍未改用此归档，未发布 npm、未合并；普通输入公共回执查询和完整功能继续按阶段 4 推进，Provider /login 仍延期。

## 本地证据

归档和源补丁、固定 manifest、各轮输出及原失败留在本地受限目录；不包含登录凭据、数据库、用户配置或 node_modules。Git 只提交关键结果及整体证据包摘要，产品需要的固定应用归档按 integrations 契约另行保留。

本地证据包：`pakka-webui-phase-3-evidence.zip`，19,724,383 字节，整体 SHA-256 为 `92c7da5c972fdbfafb4970394da4e302c142b7fc6b855ea2b00a84c717f9ef93`。保全目录为工作区 `.backups/webui-phase-3-544acfeb-bc8b-44bf-b730-0cc74978752a/`，111 个归档成员已逐项读取并核对 hash。
