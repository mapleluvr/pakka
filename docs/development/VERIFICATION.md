# 验证工作方式

验证目标与选用关系见[交付声明](../state/delivery.md)；当前工作见 [OVERVIEW](../OVERVIEW.md)。本页维护可选检查的执行方法，不累计历次通过数字。

## 选用与记录

Verification 是开发中的可选活动，按任务目标和风险选择是否开展、采用哪些方法及覆盖范围。跳过时只在所属任务或变更记录一次；后续历史通过该记录追溯，不逐轮重述，也不自动加入待补验收清单。

实际开展的检查按运行版本、环境、范围和原始结果记录。选用某个流程时，按该流程的条件解释所得结论；方法清单本身不要求每个开发任务执行全部流程。打包工具的身份拒绝、权限与运行时闭锁仍是产物行为，和是否开展开发验证分别描述。

## 源码门禁

选用源码检查时，使用仓库要求的 Node/npm、本地确定性 provider 和隔离目录，按影响面选择对应命令：

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run format:check
git diff --check
```

浏览器检查需要实际 Chrome/Chromium。非标准安装设置绝对路径 `PAKKA_TEST_CHROME`；使用新 profile，不读用户 Cookie、模型凭据或付费服务。已选用浏览器检查而缺少必要浏览器时，将该次检查记录为 BLOCKED；未选用的活动由本任务的选用记录承接。

Windows 独立命令需重新设置隔离 HOME/USERPROFILE/PI_CODING_AGENT_DIR、PI_OFFLINE，并将 TEMP/TMP 规范为 `fs.realpathSync.native(os.tmpdir())`；工具调用间不继承上一条命令的设置。R2 局部浏览器回归可使用已有隔离 runner：

```powershell
./scripts/test-devin-r2.ps1 -EvidencePath artifacts/devin-r2/new-run -TestFiles apps/webui/test/mas-stylesheet-browser.test.ts
```

局部脚本的结果仅覆盖其实际范围；完整检查与独立 GUI 使用各自的执行流程。视口与触达目标见[前端声明](../state/frontend.md#响应式与可访问性)，不要用固定页面比例裁切真实画面。

界面功能取证同时保存实际触发动作、原生结果/拒绝与请求/效果计数；零额外请求只能支持相应无副作用判断，不能单独证明功能已触发。Team 样式回归通过受控挂起和错误响应核对加载边界，不以固定等待时长代替就绪判断。视觉取证保存相同 viewport 的参考/候选直接检查、几何与完整差图；差图指标按实际定义解释，不换算为“还原率”。

## 仓库外安装与产物身份

`npm run smoke:package` 生成并安装八个实际归档，运行公开声明、实际 executable、浏览器与消费者。选用仓库外安装检查时，执行身份 preflight，核对源码/门禁 helper/资产、归档/lock/安装逐文件内容及消费者结果。漏源码、损坏归档和身份篡改反例必须在 build/install 前被拒绝。

完整 R2 候选使用已有 `scripts/verify-devin-r2.ps1`，在固定快照上串行保存 check、syntax、build、扩大、全量和 package 原始结果。失败退出、取消或 NOT_RUN 不覆盖为后续局部通过。

若本轮失败，`artifacts/package-smoke/consumer-path.txt` 可能仍指向上次成功目录；从本轮日志的实际 cwd、进程退出/signal 和原始状态定位，不单凭旧指针或 `exit=null` 推断业务原因。子进程控制台退出也不自动证明 native 效果终态。

## OpenSpec 校验范围

选用 OpenSpec 校验且有可用 CLI 时，按变更范围运行并保存相关或全量结果：

```sh
openspec validate pakka-webui --strict --no-interactive --json
openspec validate mas-board-relationship-workbench --strict --no-interactive --json
openspec validate --all --strict --no-interactive --json
```

本次已选用的 CLI 不可用则记录 BLOCKED，不临时改依赖或把旧通过结果当本轮输出。OpenSpec 已安装；当前 strict 结果及保留的历史长度告警见[整理验证](../verification/DOCUMENTATION-CLEANUP.md)。原整理报告已备份，不以旧数字代替当前执行结果。

## 独立实操与审查

选用本地确定性浏览器或独立实操时，按各自流程及 [WebUI 开发契约第 9/10 节](WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)和 AGENTS 的指定模型/工作流执行。固定候选、独立 worktree、唯一桌面、真实操作和 A/B 证据分别记录；缺环境保持 BLOCKED。

通知的 HTTP 接受、原生系统显示/点击和不同部署设备各自留证。

## 文档修改

只改文档时检查分工是否成立、链接/锚点、格式、差异和规范引用；对比产品树与固定证据字节，确认没有借整理改变被证明对象。记录本次选用范围及实际运行结果；未选用活动的原记录继续承接该决定，不机械重跑无变化的 Pi/模型矩阵。

当前预期不写候选结果，变更记录不冒充原始输出。需要长期支撑结论的日志、截图、源码/安装身份应在可持续访问位置保存，不能仅在 `docs/.temp/` 留一条本机路径。
