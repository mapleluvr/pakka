## Purpose

定义供可信宿主读取原生持久历史的只读能力、生命周期及固定制品消费。

## ADDED Requirements

### Requirement: Read-only native storage lifecycle

SDK SHALL 提供仅含读取能力的公开 reader，使用真正只读的现存 SQLite 连接并验证受支持 schema。reader SHALL 读取原 Conversation、分叉历史、字节档案与必要的已存 document。

#### Scenario: Observe an existing database

- **WHEN** 宿主打开、读取并关闭一个现存来源
- **THEN** reader 不初始化、迁移、checkpoint/truncate 或恢复任务，不取得 writer 所有权
- **AND** 返回对象不提供 commit、mintId 或其他执行入口

#### Scenario: Missing or incompatible source

- **WHEN** 来源不存在、需要迁移、版本过新或结构无效
- **THEN** 读取明确失败，源路径不被创建、升级或替换

### Requirement: Consistent bounded original reads

读取 SHALL 保持原生 ID、fork 可见性与不可变 Entry 提交身份；同次快照的多步读取 SHALL 一致。字节档案 SHALL 沿已有有限分页及范围语义读取。

#### Scenario: Concurrent writer and expired view

- **WHEN** writer 在读快照期间提交，或调用者保留已结束快照的 view
- **THEN** 当前快照不混读不同提交，后续新快照可见已提交更新
- **AND** 失效 view、取消及 close 后的新读取拒绝；关闭等待其拥有的已接纳读取释放

#### Scenario: Large or forked history

- **WHEN** 宿主读取长正文或分叉继承的原 Entry
- **THEN** 使用有界 header/字节范围及原提交身份，不解码整条大记录后裁切
- **AND** 原分叉 cutoff 与记录所属身份保持有效

### Requirement: Reproducible public reader consumption

只读实现 SHALL 由固定上游源码、源补丁、依赖锁及归档身份交付；配套 Chord 与 Durable SHALL 可通过声明的制品消费。

#### Scenario: Isolated installed consumer

- **WHEN** 仓库外消费者安装 SDK 归档并使用公开 exports
- **THEN** 真正的 reader 及其声明可运行，且不需要 sibling 源码、根 overrides 或手改安装依赖
