# Tasks

- [x] 初轮固定 main 547c496、1.4.0 cohort 与上游接口依据；保留 `.1` 的 source.patch、构建锁和 vendor 归档。
- [x] 真实 provider/文件/命令的 RED，以及可观察效果的 GREEN。
- [x] 中性环境接口、公开 native env 适配、原生工具与合作工具入口。
- [x] 生命周期、并发目标、恢复指纹、原生 edit 撤销、reader 与未知效果的 RED/GREEN：24/24。
- [x] 执行主动诊断、相邻回归 31/31、build/check、归档安装消费者及广泛回归/基线对照。
- [x] 更新 state/API/指南、追加兼容性账本并保存版本化输出和源码/归档身份。

## 1.4.0-pakka.2 交付

- [x] 保留 `.1`，新增 `.2` baseline/lock/source/归档；两次独立构建归档相同，各通过 SDK 113/113、安装 HTTP 3/3。
- [x] 切换生产依赖及 lock，ExecutionEnv 24/24、相邻与工具选择 36/36、build/check 和独立安装消费者通过。
- [x] 追加兼容性账本、保存 [.2 交付身份和输出](../../../docs/verification/EXECUTION-ENVIRONMENT-PAKKA-2.md)，提交接入与版本化交付。

## 本轮检查范围

[固定检查记录](../../../docs/verification/EXECUTION-ENVIRONMENT.md)保存全部结果：原生工具及合作工具接入可用；安装消费真实 5 次 HTTP。广泛回归没有通过结论，12 文件有界对照的结果模式与未修改基线相同；这不代表全仓产品验收完成。主动 LSP 3 个文件 clean，adapter 超过行数上限；编译检查通过。全仓格式有 17 个存量文件警告，改动代码格式通过。

变更保留在活动目录供后续审阅/合并，不将上述广泛回归边界改写为通过。MXC、1.5.x 升级与补丁缩减属于本次之外的后续决定。
