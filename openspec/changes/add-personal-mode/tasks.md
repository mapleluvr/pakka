# 任务与验证边界

- [x] People schema 3、版本化模式、同身份设备登录和独立撤销。
- [x] 空备注及审计恢复；services 6 配对。
- [x] driver 代际与首次笔记旧数据投影。
- [x] 独立前端公开安装、桌面与390px验收。
- [x] 仓库外 8 包安装，HTTP 同身份、单设备撤销、重开与空备注。
- [x] 原实例冷备份后正常重开并上线 8854，启用个人模式。
- [x] 证据包与交接收口；见[验证摘要](../../../docs/verification/PERSONAL-MODE.md)。

新增三个测试文件覆盖不同失败机制，保留 heavy 分类，属于 webui/protocol/runtime affected 与 release 集合；已有规则自动覆盖，无需修改 selection。UI 布局不新增固定 DOM/CSS 测试。全量 296 文件首轮有测试数据与并发构建干扰，修正后 6 文件复跑通过；另一个 MAS 锁库失败在未修改基线复现，独立待办。实际计数见 verification，未声称全量通过。

[提案](proposal.md) · [增量规范](specs/personal-mode/spec.md) · [形成记录](../../../docs/changes/personal-mode.md)
