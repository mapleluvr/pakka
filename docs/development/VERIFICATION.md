# 验证工作方式

本页说明当前仓库怎样验证；[产品状态](../PAKKA-POCKET-STATUS.md)记录哪些候选取得了什么结果，历史数字保存在[验证记录归档](../archive/verification/VERIFICATION.md)。

## 源码门禁

使用仓库要求的 Node/npm、显式本地确定性 provider 和隔离测试目录：

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run format:check
git diff --check
```

浏览器检查需要实际 Chrome/Chromium。非标准安装可设置绝对路径 `PAKKA_TEST_CHROME`；测试使用新建 profile，不读取用户浏览器会话、模型凭据或调用付费模型。缺少必要浏览器是环境失败，按失败记录。

手机默认最短目标为宽∶高 **3∶5**，例如 360×600 或 390×650。图标、24px 字体及页面滚动需覆盖相应可用宽度；这些是测试尺寸，产品布局响应真实视口。

## 仓库外安装与产物身份

`npm run smoke:package` 安装八个实际归档，运行公开声明、实际 CLI、浏览器和现有消费者。候选交付还需在 build/install 前运行身份 preflight，并核对：

- 候选源文件及必要的未提交、未跟踪文件；
- 每个归档的身份、安装 lock 和逐文件内容；
- 漏源码、漏包、损坏归档及篡改身份的反例；
- 实际运行消费者与其退出码、provider 计数、回执和原始存储。

执行约定见 [WebUI 开发规范](WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)。若本轮失败，`artifacts/package-smoke/consumer-path.txt` 可能仍指向上次成功目录；从本轮日志的实际 cwd 定位失败消费者并核对退出码。

## OpenSpec 校验范围

活动变更检查使用 `openspec validate pakka-pocket-webui --strict --no-interactive --json`；全量规范检查使用 `openspec validate --all --strict --no-interactive --json`。两者单独记录结果。

本次文档整理中，活动变更通过；全量的 8 项中 4 项通过，4 份基础规范有 5 条既有警告：`authenticated-mas-apps` 的长需求，`integrated-mas-product` 的 Purpose 占位与长需求，`optional-dynamite-product` 的 Purpose 占位，以及 `recoverable-multi-session` 的长需求。迁移前副本复跑得到完全相同的结果，7 份基础规范正文的哈希保持原样。规范维护与本轮目录迁移分别跟踪。

## 实操、审查与记录

用户已经确认的本机项目在[当前状态](../PAKKA-POCKET-STATUS.md#2-用户已经确认的本机验收)核销。新增功能、环境和受影响路径按对应候选验证。真实通知、远程 SSE、不同设备和 Windows 分别保留证据范围。

后台 GUI 验收当前按用户要求暂停。指定的两方 adversarial review 与作者复核分别记录，按照项目选定的原工作流执行。纯文档整理完成本地链接、锚点、格式、差异和 OpenSpec 校验；它本身不产生新的运行验收结论。

原始报告、截图、归档、锁和日志可放在外置 evidence 目录。记录应说明它们与仓库源码、安装候选的对应及可获取位置；Git 中的说明不是原始证据文件的替代。
