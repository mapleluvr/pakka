# 测试取舍与执行方式

## 第一批维护审计

| 原用例/组                                    | 失效模式                                          | 处置与剩余证明                                                   |
| -------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| recover login；active writer/foreign confirm | 存活进程被抢占、身份误认、明文泄露、回执重发      | 合并为同一CLI fixture，保留各拒绝/兑换断言                       |
| exited writer                                | 死亡占用恢复错误、新建替代Session                 | 保留真实强杀与原Session重开                                      |
| trusted module hold                          | 停机期间执行可信模块                              | 并入真实restore fixture，仍启动真实CLI并检查副作用文件不存在     |
| cold backup；missing registered child        | 文件分类错误、遗漏登记Session、哈希或覆盖保护缺失 | 合并fixture；仍创建真实子Session并移走其数据库                   |
| restore+resume                               | 原字节未保全、旧登录未撤销、恢复自动启动          | 保留真实CLI与HTTP兑换                                            |
| corrupted database                           | 损坏原字节丢失                                    | 删除独立场景，其断言由“损坏且退出writer”覆盖                     |
| missing database/data root                   | 不必要的健康当前库前置条件、缺失未记账            | 下沉真实维护服务、文件和SQLite，独立可变目录                     |
| corrupted + exited writer                    | 活跃拒绝/退出核验/占用记录原字节保全              | 保留真实CLI和强杀                                                |
| publication interruption                     | 目录发布断点丢失护栏、换操作身份                  | 保留原故障注入子进程与原操作续行                                 |
| credential/receipt interruption              | 原发行结果重发或丢失                              | 两个交付断点仍保留，各有不同副作用边界                           |
| records-only fingerprint                     | 单独records未完成时错误解除停机                   | 下沉同一真实fixture，缺/错指纹、审计及原记录保留，负对照必须失败 |
| native task fingerprint                      | 任务效果重放、持久任务被清理                      | 保留真实任务进程退出与CLI核对                                    |
| installed maintenance                        | exports、固定归档升级、入口选择和数据回退         | 保留；确有交付物特有价值，按打包/发布触发                        |

17个CLI顶层场景变为10个；服务层3个（两个缺失条件、一个records-only）；总计13个。保留断言的更低成本接线与有意义的删除分别记录，不将全部历史测试改名为发布测试。其余领域尚未逐项价值审计，release当前涵盖全部剩余源码测试，不能解释为所有用例均已获永久保留。

## 集合与资源

core人工枚举日常核心边界；affected为core加显式领域；release覆盖剩余源码文件；files精确选择。共享协议/Runtime的动态消费者分布广，选用对应领域时扩到release覆盖。特殊专项仍单独选择。

轻型池只允许protocol/client测试；默认一个轻型加一个重型，额外轻型并发只在实测后采用。浏览器及未知新文件均进入单重型池。每文件独立HOME、Pi目录、TEMP、产物；运行锁保护同工作树的测试入口。已有独立脚本和build仍由使用者串行/独立工作树安排。

记录文件开始/结束、code/signal、耗时、Node worker高水位RSS及系统可用内存；RSS不是整个子进程树的合计峰值。CLI维护另记命令阶段。低内存暂停新重型文件，持续低余量则BLOCKED。异常占用保留供核验，不自动抢锁。

## 验证

runner真实子进程检查筛选、失败传播、隔离与旧产物保留。维护同机旧/新四场景对照；records-only临时加载负对照不改产品文件。核心与轻型池1/2/4实测，执行最终改动的维护集合。产品文件字节与基线保持一致。
