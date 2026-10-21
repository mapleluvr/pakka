# Devin 前端接入 R2：验证记录

## 范围与状态

R2 按[接入设计](../plans/DEVIN-FRONTEND-ADOPTION-R2.md)采用参考前端的 DOM、原始 CSS 和交互，把 Pakka 的真实接口、权限及原生输入语义接到其中；Team 是参考没有的、使用相同界面语言的新页面。R1 的换皮实现不是 R2 的验收依据。

实现位于 `feat/devin-like-frontend`，worktree 为 `D:/Projects/kappa/migration-worktrees/pakka-devin-ui`，未合并 main。参考固定为 `devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current`；`reference.css` 的 SHA-256 为 `084adce8bc6e1feab314b301f57ddac0bab5081cfa08d1c911addece9bdb9974`，回归保护原始 LF 字节。

**当前不是完整验收通过。** 已提交的基座、Settings、palette 和 Team 接入，与下面列出的每轮验证有各自身份。Windows 本地确定性浏览器回归不能替代[开发约定第 10 节](../development/WEBUI-DEVELOPMENT.md)的独立 Linux GUI 验收；后者仍为 BLOCKED。

## 固定候选 003（修复前，历史结果）

- 源码：`623ae6be57691f714a5ce641ea4c6da20388eef2`；运行前后工作区干净。
- 本机原始证据：`artifacts/devin-r2/candidate-003/run.json` 及同目录日志。
- check、JS 语法、build：PASS。
- WebUI 扩大回归：123 tests，116 pass、6 fail、1 cancelled、0 skipped。
- 全量：553 tests，538 pass、7 fail、6 cancelled、2 skipped。
- 安装：FAIL 于消费者依赖安装，子进程退出状态为 null；未进入消费者验证，不能沿用候选 002 或补测中的通过。

扩大回归失败包括 Windows symlink 权限（两项）、Chrome profile 清理 EBUSY、手机创建按钮命中、Team 返回后视图切换，以及 notifications HTTP 的 unanswered/done 差异；Browser contribution 另有超时取消。全量还包含 hooks busy、MAS busy 和四项 symlink 权限失败。失败不因 main 有同名问题而变成通过。

`artifacts/devin-r2/main-r2-control/run.json` 记录独立干净 `main@df76ea4` 的对照：采用 LF Git blobs 而不打补丁，相同环境下复现 Browser 超时及目录／发现的 symlink 权限失败；hooks recovery 三项通过。此对照不解释新出现的 notifications 差异或 hooks busy 时序，也不证明所有 Browser 停点具有相同深层根因。

## 2026-10-21：创建入口与 Team 样式边界

### 已定位的问题

手机创建探针显示：点击 Home 后，侧栏关闭动画仍在执行，随后创建按钮的原生指针命中了移动中的侧栏。`frontend-controls.ts` 现在等待实际字体／有限动画结束，再操作首页；没有关闭产品动画或使用合成 click。

Team 探针则显示另一种布局变化：成员数据已出现，`board.css` 尚未生效；测量到的按钮位置与随后按下时的位置不同。针对这一条件新增 `mas-stylesheet-browser.test.ts`，代理只挂起真实 CSS 响应，其他请求仍转发到真实 Pocket／MAS 后端。

最初等待整个 body 中的 coordinator 会误命中侧栏，导致“挂起时已无控件”的假通过，不能用于支持修复。正式回归改为观察 Team 内的成员控件或明确的样式加载状态，并确认真实 link 尚无 sheet。

### 红／绿证据

- RED：`artifacts/devin-r2/styles-red-002`。产品 `graph-board.ts` 与 `623ae6b` 完全一致，两项均正确失败：挂起时出现可点击 Team 控件；503 后没有错误提示／闭锁。
- GREEN：`styles-green-001`，受控加载成功／失败、Team 接入、手机配置与创建共 4/4。
- 影响面：`styles-impact-001`，MAS 成员操作／busy／恢复／撤权、创建恢复、hooks 和手机配置共 20/20，零跳过。
- 重复：`styles-repeat-001`、`002`、`003` 各 4/4，零跳过。
- 本组 `npm run check` 通过；更改文件的主动 LSP error 探针没有返回错误。一般维护性／风格警告不等于编译错误，也不据此声明全仓无诊断。

修复在 Team 根组件中持续保留同一个 stylesheet 节点：load 前只显示加载状态，不挂载可操作 Board；error 后显示 alert，继续闭锁；load 后再呈现实际快照。未改动 MAS／模型调用、授权、requestId、receipt、unknown 或 admitted-work 生命周期。

选取的原始红／绿日志、运行身份与 held JSON 随本分支保存在 [styles-boundary](evidence/devin-r2/styles-boundary/)。这些是局部证据，不替代新固定候选的扩大、全量、安装或独立 GUI 门禁。

## 复跑

在仓库根运行，先构建真实扩展资产，再执行：

```powershell
npm run check
npm run build
./scripts/test-devin-r2.ps1 -EvidencePath artifacts/devin-r2/new-styles-run -TestFiles apps/webui/test/mas-stylesheet-browser.test.ts,apps/webui/test/mas-devin-adoption.test.ts,apps/webui/test/independent-configuration-browser.test.ts
```

脚本为每轮设置规范化 TEMP／TMP、隔离 HOME／USERPROFILE／PI_CODING_AGENT_DIR、PI_OFFLINE，并保存版本及日志；使用本地确定性 provider，不读取用户凭据或调用付费模型。

固定候选的全部门禁使用 `scripts/verify-devin-r2.ps1 -EvidencePath artifacts/devin-r2/<new-candidate>`，要求工作区干净，串行构建、扩大回归、全量、打包，运行期间不更改源码。每轮使用新证据路径，保留原失败记录。
