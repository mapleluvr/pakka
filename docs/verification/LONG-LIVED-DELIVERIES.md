# 长期投递持久化验证

## 候选与结果

- 原基线：`e7c938ef3b7c2005ef9db319bd84598c25ab8b23`；原实现 `278fceb69c727a7a367ccc3e237c122c1b331b1b`。Windows x64 / Node `24.15.0`。
- 原冻结源码摘要：`911f6cb8d5e8df7634e18934bfa965ae7e5f99b466f01826c161a44a9adef26b`；保留其检查身份，不倒写为重组后的提交。
- 构建、严格类型及八归档仓库外消费通过；最终全量 **816 项：814 通过、0 失败、2 平台跳过**。首次 Fetch 禁用端口失败及修正后的结果分别保存在本地证据包。
- 跨两条 Conversation 完成 520 笔、重开原 Session 后继续接纳；旧请求与回执保持，重复核对不新增模型请求。
- 接纳索引小于 16 KiB，新增投递不改写首笔归档；v1 原子迁移、真实 SQLite 写锁失败、权限过滤分页及 unknown/队列保护通过。
- 同 Session Catalog 的累计门槛解除不代表无限存储性能；跨 Session broker、稀疏权限历史扫描和模型上下文治理各有独立范围。

## 本地证据

原始日志、清单、固定归档身份及原报告只在本地包保留：`pr4-pr6-verification-evidence.zip`，1,257,613 B，整体 SHA-256 `15a4f9057e658d4c866ede588b3d535be697e0ee37050fdcb1a800863131562b`。包内分别保存原 #4/#6 的实际文件字节，259 个条目全部读取并与来源 SHA-256 核对。未上传 GitHub；云端由用户处理。

契约与后续见[形成记录](../changes/long-lived-deliveries.md)及[任务](../../openspec/changes/retain-long-lived-deliveries/tasks.md)。
