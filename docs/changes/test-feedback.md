# 测试反馈成本

采用显式测试集合、独立运行产物、有限轻型并发及维护用例去重；当前契约见[交付声明](../state/delivery.md)，执行方法见[验证指南](../development/VERIFICATION.md)。

完整形成记录：[change](../../openspec/changes/reduce-test-feedback-cost/)、[proposal](../../openspec/changes/reduce-test-feedback-cost/proposal.md)、[design与断言映射](../../openspec/changes/reduce-test-feedback-cost/design.md)、[tasks](../../openspec/changes/reduce-test-feedback-cost/tasks.md)、[全部delta spec](../../openspec/changes/reduce-test-feedback-cost/specs/test-feedback/spec.md)。test-feedback为新增能力，尚无已归档主spec。

## 2026-11-28：区分 MAS 读取失败与投递事务失败

阶段发布回归发现 `unknown.test.ts` 在成员状态读取前锁库，使发送停在准入之前，未进入需要核对 unknown 回执的投递事务。对照探针分别在读取前、recipient admission 通过后持有 SQLite 写锁，确认前者拒绝发送，后者返回原请求的 unknown 回执；两者均封闭 Session、让 MAS view 显示 unknown，且模型请求为 0。

投递故障测试改用公开的 `setAdmission` 在读取完成后注入写锁，保留原请求身份与 Session 封闭断言；独立用例保留读取前拒绝的覆盖。产品实现与既有持久化契约保持原版本。发布初跑的失败和后续定向复验分别记录，不覆盖原始结果。
