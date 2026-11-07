# 本机维护与交付

2026-11-07，操作者采用 P0-1 原身份登录/异常占用恢复与 P1-2 冷备份、原位置恢复和固定版本升级方案，并授权追加到未合并的 PR #4。WebUI 与多 Runtime 的 OOM 抑制进入近期任务，不以累计历史次数代替内存治理。

形成的共同机制是停服维护面：公开 Session 内核而非 Harness，私密凭据预备及原子发行回执，完整存储清单、一致快照与流式保全，操作日志核对发布，以及恢复后的身份失效和执行停机确认。Runtime、持久 Session 与 Conversation 不新增用户层级。

## 实现与检查

本轮完成公开的无 Harness 维护内核、原 owner 私密登录恢复、精确异常占用处理、声明存储域冷备份、原位置恢复/停机确认，以及可信固定归档升级/数据回退。损坏/缺失来源、死亡 claim、私密交付失败和发布中断均有真实进程回归。外部配置和产品启动定位需另行保全，不把数据域备份称为全机灾备。

实现保存为 `3a1d08816d3cc3723c1e6c6db613e30649c13b1e`，已推送并追加到原 PR #4，未合入 dev/main。提交身份与下述构建时源码、固定归档身份分别记录。

最终冻结源码全量 838 项中 836 通过、0 失败、2 项原有平台跳过；构建与类型通过，8 个归档的 34 个安装消费步骤全部通过。固定候选、失败/修正、哈希与适用边界见[验证记录](../verification/LOCAL-MAINTENANCE-DELIVERY.md)。OOM 治理和设置路由没有改记为完成。

## 完整记录

- [Change 目录](../../openspec/changes/add-local-maintenance-and-delivery/)
- [Proposal](../../openspec/changes/add-local-maintenance-and-delivery/proposal.md)
- [Design](../../openspec/changes/add-local-maintenance-and-delivery/design.md)
- [Tasks / OOM 后续](../../openspec/changes/add-local-maintenance-and-delivery/tasks.md)
- [Conversation Runtime delta](../../openspec/changes/add-local-maintenance-and-delivery/specs/conversation-runtime/spec.md)
- [Authenticated MAS Apps delta](../../openspec/changes/add-local-maintenance-and-delivery/specs/authenticated-mas-apps/spec.md)
- [Product Delivery delta](../../openspec/changes/add-local-maintenance-and-delivery/specs/product-delivery/spec.md)

相关主 specs：[conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)、[authenticated-mas-apps](../../openspec/specs/authenticated-mas-apps/spec.md)。product-delivery 是本次新增能力，尚无独立主 spec；活动 delta 不冒充已归档。

前序[设置路由与本机恢复](webui-navigation-and-local-recovery.md)中的维护/登录部分由本 change 接续，路由和逐页 UI 调优不因维护实现而完成。当前声明见[本机维护](../state/local-maintenance.md)，操作见[指南](../guides/LOCAL-MAINTENANCE.md)；实际范围、失败和未覆盖条件由所属 tasks/固定验证记录承接。
