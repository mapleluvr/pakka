# 剩余限制与继续工作的入口

当前产品源码 `fe02dd2` 是视觉迁移候选，**NOT_FULLY_ACCEPTED**。不合并／推送 main，不以局部通过替代项目门禁。

## 当前失败

| 项目                              | 已有证据                                                                               | 下一步如何判别                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 四项 symlink EPERM        | 候选全量与原 main 同名测试、同系统调用失败；见 `full-test-r5.log`／`main-baseline.log` | 在具备相应能力的获准环境跑原断言；不要靠新增 skip 或放宽批准目录解决                                                                             |
| failed-input 第二次 Send 不可交互 | 全量与专项均失败于 `input-failure.test.ts:114`；原 main 同位置相同失败                 | 固定快照分别观察 receipt、busy、按钮 disabled 与后续资源状态，区分驱动时序与产品语义；不放宽 unknown／原生 admission                             |
| product 单次 bad port             | 全量 `product.test.ts:23` 报 fetch 的 `cause: bad port`；原始日志没有保存实际 origin   | 先带只读 origin／监听端口证据复现，做原 main 对照；没有等价 main 失败之前不归为基线                                                              |
| 安装 Project browser unknown      | 最新安装与原 main 的独立安装场景均未得到 frame；原 requestId 保留                      | 检查原 browser operation／服务与真实 Chrome 启动；未知结果只核对，不自动重发。失败后安装 notifications、schedules、memory、hooks、voice 尚未运行 |

全量为 **541 pass／6 fail／2 skipped**，专项为 **42 pass／1 fail／0 skipped**。两项 skip 为原测试在 Windows 无 POSIX CDP executable 的明确条件，不计入通过。历史 Node/libuv native 诊断另有记录，不混入本轮失败数。

## 验收阻塞

- `agent-workspace-linux` 独立 GUI 实操工具不可用；程序化本地 Chrome 只覆盖脚本化产品路径，不能替代规范要求的独立 GUI 检查。
- 指定 `D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js` 不存在，未运行指定两方审查，未私自换工作流或模型。
- 未做 Linux、真实手机或远程部署验收；未测付费 provider，也未读取个人凭据。

具备工具后按 [验证记录第 6 节](../../../../verification/DEVIN-LIKE-FRONTEND-R1.md#6-后续正式验收交接)建立固定候选工作树、独立桌面、隔离数据与新安装归档。只接受对应新快照的证据。

## 视觉范围

- 已采纳视觉语言，不承诺静态原型逐像素一致；真实身份、权限／归档／扩展和至少 44px 点击区有意不同。
- 参考没有后端，会话页为推测布局；不据此虚构 Devin 生产行为。
- 没有伪造 mask、diff heatmap／stripes 或独立审查结论。直接截图检查和 DOM／像素采样的证据范围见 [final-inspection.md](final-inspection.md)。
- 字体许可随包保留；测试默认 Inter 不代表覆盖所有用户自定义字体、系统字体回退与真实手机字号。

## 工作树与产物

- 迁移工作树：`D:\Projects\kappa\migration-worktrees\pakka-devin-ui`，分支 `feat/devin-like-frontend`。
- 基线只读对照：`D:\Projects\kappa\migration-worktrees\pakka-main-probe`，固定 `df76ea4`，只为基线浏览器启动规范化了未提交的 HTML 换行；不能拿它当迁移候选。
- 其他已存在工作树不属于本轮清理范围。不要为了得到干净状态 reset／删除用户原有工作。
- 本目录保留少量截图、原始日志、JSON 测量／归档身份；大体积可重建目录和安装消费者在 `artifacts/` 或隔离 TEMP 下，不承诺上传全部中间产物。

继续前先读 [reproduce.md](reproduce.md)。后续修复若涉及产品或驱动，必须重跑相应场景并更新候选身份，不能仅改本表结果。
