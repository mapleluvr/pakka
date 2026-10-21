# Pakka-Pocket 实施状态与阅读入口

本页记录实现与验证，不定义产品目标。目标从 [state](state/README.md)读取，当前工作从 [OVERVIEW](OVERVIEW.md)进入。文档分工前的完整状态已保存在[历史快照](archive/status/PAKKA-POCKET-PRE-STATE-EVO.md)，原阶段和用户确认仍保留各自身份。

## 1. 当前产品候选

| 对象         | 状态与范围                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 产品源码     | `6d359b1`，Devin 原型接口接入、真实 Conversation、Settings/palette、Team 三视图和样式就绪门禁                                                                          |
| 产品证据     | `e7b7d7c` 归档；[R2 验证记录](verification/DEVIN-FRONTEND-R2.md)及[候选 004 交付复核](visual-primitives/runs/devin-frontend-r2-candidate-004/final/delivery-review.md) |
| 本轮文档整理 | 只改变文档组织/使用指引；不是新产品候选，检查结果单列于[文档验证](verification/DOCUMENTATION-SYSTEM.md)                                                                |
| 使用         | [WebUI 指南](guides/WEBUI-GUIDE.md)、[Team 指南](guides/MAS-BOARD.md)                                                                                                  |
| 完整交付     | **未通过**；未据本轮文档变化合并 main                                                                                                                                  |

固定候选 004 的实际结果：

| 门禁                      | 结果                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| 类型/patch、JS 语法、构建 | PASS                                                                                            |
| 扩大回归                  | 121 pass、3 fail、1 cancel、0 skip                                                              |
| 全量                      | 542 pass、5 fail、6 cancel、2 skip                                                              |
| 整套安装                  | FAIL；实际产品、Team 创建/通信/退休、workflows 已通过，Project browser 停在 `exit=null`         |
| 同安装副本后续补测        | 通知、schedules、Memory、Webhooks、语音 5/5 通过；不覆盖整套安装失败                            |
| 视觉                      | 直接检查当前桌面/手机截图；全图无排除框差图仍为 `feedback-required`，不是百分比还原率或独立验收 |
| 指定独立 GUI/审查         | BLOCKED，缺相应环境/原工作流                                                                    |

原始日志、精确身份、主树部分对照和每项失败范围在 R2 记录中。Team 样式门禁修复已有红/绿与连续复跑证据，不再当待实现项；Windows/Browser/未知清理问题不因此被归为产品已通过。

## 2. 用户已经确认的本机验收

文档分工前保留的五项人工确认是：Webhook 创建/删除、干净项目分支创建/切换、Memory 提议/审批、面板关闭/刷新/重开，以及手机/键盘操作。用户还在 2026-10-18 的 r8 原数据恢复实例确认了独立控制弹层与退役节点隐藏/恢复。

这些确认继续保留**当时版本与环境**的结论；详细来路见[原状态快照](archive/status/PAKKA-POCKET-PRE-STATE-EVO.md#2-用户已经确认的本机验收)和 [MAS 实施记录](verification/MAS-BOARD-R1.md)。它们不是用户已确认新 R2 界面的证据，也不替代当前独立 GUI 门禁。

独立模型/cwd、通知 r4、导航 r3、MAS r1–r8 等历史工程数字和外置证据位置保留在同一快照及原报告，不与候选 004 相加。

## 3. 下一项实际工作

1. 先补足安装消费者的进程失败诊断：候选 004 的 Project browser 只有 `exit=null`，不能沿用旧 unknown/Send 停点。保留原日志，再在相同隔离环境核对实际子进程和原生操作。
2. 分开处理 Windows symlink EPERM 与 Chrome profile/lockfile EBUSY。对照只支持所跑的子集；不杀宿主输入法、不删 case、不将清理故障写成按键失效。
3. 逐项核对前端声明与当前候选，包括 44×44 独立图标触达与紧凑视觉的关系；尚未测量不作为符合声明。
4. 指定环境具备后，按开发契约第 10 节准备同候选独立 GUI；指定审查仍用原工作流，不自建替代。
5. 修复后冻结新候选，补做相应扩大/全量/安装/视觉门禁，保留旧轮，不将一次通过覆盖先前失败。

本地安排维护在 `docs/.temp/active-plan.md`；该文件不随 Git 交付。缺失时以上清单、相关 state 和原始报告足以恢复工作。

## 4. 仍有的工程与环境工作

| 项目                   | 差距/条件                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 远程与跨设备           | LAN 第二设备、tailnet、真实公网通知、tunnel 全路径与跨平台测量仍按原记录补齐；本轮未复测                                      |
| 普通 Conversation 删除 | 有归档/恢复和 MAS 退休；删除契约、保留策略及实现需单列，不以按钮改名完成                                                      |
| 原范围闭合             | 多人、所有已采用服务和公共扩展仍在目标内；不因 R2 布局删除未核销能力                                                          |
| OpenSpec 维护          | 旧基础规范告警有[历史记录](verification/DOCUMENTATION-REORGANIZATION-R0.md)；本轮工具可用性与检查结果见文档验证，不沿用旧通过 |
| 最终交付               | 当前候选失败/阻塞需处理；所需证据、规范生命周期和同一交付身份仍须完成                                                         |

## 5. 阅读与形成记录

- [当前预期](state/README.md)、[采用来路](changes/README.md)。
- [R2 接入记录](changes/devin-frontend-adoption.md)与 [MAS 设计旧稿](MAS-BOARD-DESIGN.md)。
- [验证方法](development/VERIFICATION.md)、[固定证据导航](verification/README.md)。
