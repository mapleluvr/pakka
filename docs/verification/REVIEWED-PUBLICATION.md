# 2026-11-13：按对象授权整改的固定验证

## 候选与范围

Windows x64，Node 24.15.0、npm 11.12.1。源码候选分别基于 Pakka `cc1cdd8aead42cd0afe018c75973f09fd369184d`、Dynamite `e074c14c15b423f4b094d11c1e94a297fa99c116` 和 EI `8cdd69aadb1459ded79d02dd0e5b65ef49a5af71`；均为验证时的未提交工作树，不把基线 SHA 当成候选提交号。后续分支保存不倒写本次候选/安装身份，见[参考分支](../changes/history-reference-branches.md)。

本记录覆盖全仓审查台账中的 A-1 至 A-5、B-2：Book 自身授权，Memo 完成工具、HTTP issuer、RSI mutation 的最终发布，历史只读接口，以及 EI 原始证据移出正式目录。MAS Board 的 B-1 留待重构，未修改；不包含 Historian 执行层重构或整体 release。

最终复审冻结清单为 2,289 个文件，manifest SHA-256 `771d7659ddb8ee441f07d1b33aeb4b1b29e185830b5d87797d35d72ca9686e52`。复审和补测结束时逐项无漂移；之后只整理形成记录、任务和验证摘要，产品实现与测试源码保持审查字节。

## 实际结果

| 范围                       | 结果与时点                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首批核心＋Memo/RSI/History | 86 文件，270/270；格式整理前固定候选，不计作最终全量 release。                                                                                                                                     |
| HTTP issuer                | 4 文件，20/20。                                                                                                                                                                                    |
| Dynamite                   | 格式整理前完整回归 417/417；格式后定向 11 文件 31/31。两个结果分别保留，不用局部结果替代新的全量。                                                                                                 |
| 最终 RSI                   | 定向 8/8，核心＋RSI 56 文件 150/150，0 失败/跳过；后者 98.781 秒。与前述集合重叠，不累计测试总数。                                                                                                 |
| 固定归档外部消费           | 独立 Book 不安装 Memo；实际 Compresser→Historian→Book→Patchouli 分别写入 Book 补注和 Memo Wiki；来源契约 12/12；原 Session 重开新增模型请求 0。                                                    |
| 最终 RSI 安装消费          | 标准 pack/install 后 4/4；另在同一安装包补测 writer 先在途、reader 后登记，以及 denied／真实 CAS 冲突／受控异常后的合法报告，6/6，0 模型请求。                                                     |
| EI 保全                    | 原始 23 项已逐项读回；移出 21 项原始交付文件，保留两份摘要；产品文件字节不变。                                                                                                                     |
| 静态检查                   | 两仓 build、Pakka strict check、Dynamite typecheck、选用格式／文档链接／OpenSpec 检查通过；最终三个 RSI TS 文件主动 LSP 0 diagnostics，无超时项。自动 style cache 不计作新缺陷，也未据此扩写风格。 |

原目标反例在修正前实际失败，原回执、唯一效果、提交前 denied／提交后 unknown 与健康 Runtime 对照保留。六项补测首轮 5/6 是临时探针错误地将作者读权当作新的 handler 写权；产品正确拒绝。保留拒绝断言、显式恢复 handler 归属后重跑 6/6，未改产品源码。

所有自动推理只访问本地确定性 provider，不读取用户凭据或调用付费模型。独立 Book 消费使用 6 次本地请求，图书馆链路 13 次；这不是自由模型的史学／研究质量评估。

## 独立审查

原八阶段流程保留历次实际结论：首批整改的双方 BLOCK 指出 RSI 两项 P1；`0f8197d5` 确认这两项修正，但因归属快照窗口继续 BLOCK。最终 `4f134eb3` 使用指定 `AgentRouter/gpt-6-astra:high`，八阶段完整结束，双方均 **OK with notes**、`disputed=none`，本轮六文件 mutation 修正无剩余合格 finding。

其余五组整改的认可对应它们字节未变的候选；此次局部 verdict 不重写旧 BLOCK，也不等于对 RSI 所有边界或 release 的许可。Reviewer 只读源码及主会话原始输出，未自行执行测试。

保留事项：独立安装副本之间的协调和新增临时结构的专项 heap 压测未执行；既有 RSI `lookup`／工具外层同类窗口只有源码迹象，尚未实跑或修复，另留待补查。原无关 Windows 全量 Node 子进程崩溃、GUI 和完整 release 未在本轮重试。

## 安装产物身份

下列是产品归档 SHA-256，与证据包身份分开；新 RSI 沿用字节已核验的原 Agent/MAS 输入。

| 包             | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| Agent 0.7.0    | `ce2c97aee1e42e59ee519059477486878eee131773ba26a150a052003e17af0d` |
| Dynamite 0.5.0 | `861bba3b496d0ad5578e199de6481006df56005b075e3701fdba1369ca5373ba` |
| Memo 0.1.0     | `43719f5ce8052cb45bc516cfa2b4510cc0f57d3b759f5790f112530ecc732270` |
| MAS 0.4.0      | `5fc391912f8ed917b25c1fdc7e6ef24ba5b3f3f0d903b0519d3831edd8674850` |
| RSI 0.1.0      | `7dd2b82077f7d7c92c7fa51d8f6893970bdd1ebd48faacbcd978a56e6647aa81` |

## 本地证据

证据包 `non-board-remediation-evidence-final.zip`，74,548,331 字节，SHA-256 **`3d187fb5530346435233a53764cbeaa8a525f1dc28f26b7f04a614f597bead05`**。内包 11,821 项原文件、外包 9 项封装/文档收尾材料及各 manifest 均逐项读回一致。

恢复入口：工作区 `.backups/2026-11-13-non-board-remediation/README.md`。原 EI 与问题收集的独立恢复入口继续保留。包保留候选、红／绿回归、安装消费、独立意见与中断记录；排除临时执行／浏览器 profile、数据库和 claim。不把数据库主文件冷复制当作保全验证。

原始日志、TAP、逐文件清单、截图和归档只在受限本地目录保存，未进入 Git 或上传 GitHub；云端由用户处理。验证收尾时工作树完整差异已核对、暂存区为空，尚未提交或推送。后续按用户授权保存开发分支，不创建 PR/合并；这不改变上述固定结果或扩展其验收范围。

相关契约与取舍见[形成记录](../changes/reviewed-publication.md)和[所属任务](../../openspec/changes/fix-reviewed-publication/tasks.md)。
