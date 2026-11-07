# 设计：历史与接纳分离

## 形成条件

旧 Catalog 把成员和所有投递放入同一 LiveDoc。新输入遍历目标历史并逐笔读取原生 submission，maxDeliveries 同时作为存储身份与容量。直接删除拒绝分支会让历史继续扩大每次接纳的读写工作量。因此选择 Pi 公开 document family/transaction/submission API，沿用原生 SQLite 与单 writer，不另建第二份提交域。

## 数据与热路径

Catalog v2 保存成员、最新顺序与全局/收件人链表头、每个收件人的待核对 ID。每笔 pakka.catalog-delivery 文档保存 namespace、原 StoredDelivery、递增顺序、前一全局 ID 与前一同收件人 ID。投递 ID 继续由 namespace/principal/source incarnation/requestId 确定。

接纳只查询确定 ID、当前收件人 pending 集合和原生 live/inbox。pending 中已终结项在下次该收件人新接纳的同一事务移出；其历史和原请求记录仍保留。未知或缺失原生 provenance 封闭所属 Session。相同 ID 重试优先核对原记录，不重新发送。

新投递文档、索引、native submission/UserEntry/GenerationTask 与 live/inbox 在同一受授权原生事务提交。接纳工作量依赖成员与每名收件人的 maxPending，不遍历已完成历史。

## 读取与兼容

按 ID 查询使用独立文档，普通历史沿全局链最近优先读取一页；cursor 沿用原回执 ID，核对 namespace、顺序和当前 scope。自定义过滤可能扫描多页才能凑齐输出；received/inbox 的兼容集合接口仍可读取该收件人的全部历史。它们不参与新输入接纳，后续有界查询优化需要自己的接口场景。

SDK 的 maxDeliveries 改为 deprecated optional 字段，值不影响接纳或重开。server/worker 仍验证旧字段的基本数字形状，然后由 Runtime 忽略；namespace 与 maxPending 保持持久配置约束。

## 原格式迁移

Catalog Doc version 从 1 升为 2；只读载入保留 v1 值，不伪造迁移提交。首次受授权变更逐笔核对 fingerprint、确定 ID 与 native request/submission 关系，按原顺序提取独立文档并建立 pending 链。确认全部记录后移除内嵌 deliveries/maxDeliveries 并原子提交。

迁移期间写锁、存储失败或 provenance 不一致保持 unknown；不能发布半份索引或 dispatch 新工作。原格式升级需要一次历史扫描，这是一次性迁移代价。旧版本不支持 v2 Catalog；回退需迁移前的一致备份。历史不做 TTL 淘汰，归档标记不授权删除去重身份。

## 验证与限制

测试覆盖 520 次完成后跨重开继续、原请求不重放、payload 冲突、带权限游标、热索引大小、旧归档版本不变、旧格式正常迁移、真实写锁及坏 fingerprint/provenance。既有 pending/concurrency/unknown/authority 与 server/worker 回归继续执行。

这证明累计次数门槛解除及投递路径重构，不等于任意规模全文读取、半 GB 活跃历史或完整 Dynamite 产品链已完成性能验收。完整存储还包括 native entries、工具结果、展示、协作 outbox；各自保留真实资源与故障边界。
