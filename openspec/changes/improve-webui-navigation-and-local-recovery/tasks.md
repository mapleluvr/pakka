# Tasks

## 0. 提案与采用

- [x] 核对现场认证状态、只读 401、当前 CLI/people 边界和设置 Sheet 生命周期。
- [x] 直接复核 Devin 生产设置 Link、分类 href 与权限过滤，保留静态证据强度。
- [x] 建立 proposal/design 与两个能力 delta，明确现有行为、拟采用默认值和待试做条件。
- [x] 完成新提案及前序任务交接的 strict 检查、682 项本地引用和格式/diff 检查。
- [ ] 用户确认方案，采用后同步 frontend/webui/runtime state 及对应开发/操作契约。

## 1. 维护能力试做

- [ ] 用隔离的真实 Pi 存储验证维护模式：已存在 Session、物理来源、独占 writer、限定命名空间及零 provider/tool/Job/扩展效果。
- [ ] 验证 POSIX 权限与 Windows ACL、现有文件、链接/reparse 与输出目录条件；定稿可支持的平台交付方式。
- [ ] 试做私有文件预备、认证 CAS 与发布的故障协议，明确 recoveryId 核对和容量上限。
- [ ] 定稿 CLI 的预览、确认目标、发行与核对参数；若公开 API 不能满足边界，先修订设计。

## 2. 登录恢复闭环

- [ ] 先补原 owner 注销后的失败用例；覆盖数据/角色保留、唯一兑换、过期与再次发行。
- [ ] 在 adapter 内提供最小维护端口，共用 people codec/原子变换；保持当前 Pi cohort。
- [ ] 实现原 owner 确认、10 分钟凭证、目标旧会话撤销与同次发行记录，兼容原认证 schema。
- [ ] 实现私有恢复文件与只读核对，覆盖提交前后中断、响应/发布丢失、重复命令及未知结果。
- [ ] 改善登录/操作错误：输入问题、401、403、冲突、容量和 unknown；保留允许的目的地与原请求身份。
- [ ] 使用隔离产品走完初始化 → 登录 → 退出 → 停服恢复 → 原数据登录；完成后再按明确目标恢复本机预览。

## 3. 设置路由

- [ ] 先补深链接、刷新、Back/Forward、Ctrl/Meta/中键与分类权限的失败用例。
- [ ] 实现允许页面的 HTTP shell 路由及浏览器路由表；保留现有 Conversation 链接。
- [ ] 分类改为真实 href，以路由确定当前页面；将设置从模态 Sheet 的历史/焦点生命周期分离。
- [ ] 恢复登录后的合法分类/会话目的地，覆盖越权 URL、撤权、stale incarnation 和未知路由。
- [ ] 单页导航保留消息草稿、会话、滚动与适用焦点；说明整页刷新和身份变化各自的保存范围。

## 4. 逐页调优

- [ ] Login、Appearance、Conversation/凭据：字段语义、就近错误、首次错误焦点、加载布局与敏感输入处理。
- [ ] People/邀请、Notifications、Extensions：按实际权限与能力完成同类修订。
- [ ] 页面 main/nav、标题层级、跳转及长标题/目录/模型名的完整读取。
- [ ] 对照生产 renderer 与实际服务打磨 transcript/composer 的排队、停止、拒绝和待核对反馈。
- [ ] 调查拒绝后第二次 Send 的偶发不可点击：比较 main 与候选的 disabled、布局命中和更新边界，再决定产品或驱动修复。
- [ ] 覆盖实际桌面、360×600、390×650、390×844 与大字号的布局和操作可达性。

### 4.1 Conversation/composer 状态可观测性 P0（2026-10-24）

- [x] 实检授权 DTO 的 live/entries/receipt 可观察字段，固定状态语义与产品文案；Sessions 行运行状态因协议缺口独立排除。
- [x] 为 Send 禁用原因、Stop 主位和 stopping latch 保存等价性、可访问性及真实命中区证据。
- [x] 用真实浏览器覆盖 live 消息、Streaming 和不可内联图片的实际可见占位。
- [x] 用阻塞工具证明 live/持久声明共存，覆盖工具卡跨转换归一、结果/非文本保留、孤儿及节点连续性。
- [x] 覆盖 unanswered 的 blocked 指引及 unknown 的 needs review 指引；不更改 receipt 清除和权限语义。
- [x] 复核后以真实 RED/GREEN 修正非 blocked 的回执徽标、流式 toolCall 初次落盘的展开态、折叠工具错误辨识；保留 A-2 可达性反驳和 A-5 维护性意见。
- [x] 保留 d966f7f 全量的 1 fail 与独立 flake 证据，仅为 A3 新增真实 DOM 输出等待；不放宽断言，不改 receipt 或原生调度语义。
- [ ] 固定精确候选，完成受影响回归、全量检查、独立渲染/a11y 复核和指定 adversarial review，保留失败及未覆盖项。737f2f3 隔离全量 618/616 pass/0 fail/2 skip、独立定向复核已通过；指定双评 B 模型缺失、独立桌面 GUI 工具缺失仍阻塞最终验收。
- [x] 同步 state/design/delta/changes/OVERVIEW 与固定验证记录；删除临时 HANDOFF 和探针，保持工作树整洁。

## 5. 交付与接续

- [ ] 实际执行的开发检查按版本、范围和结果记录；Verification 在选用时安排，跳过只记录一次。
- [ ] 维护完整来源、CLI 使用与恢复失败处理说明；检查明文令牌在日志、URL history、广播和通用存储中的边界。
- [ ] 完成采用后的 state/开发契约/changes/OVERVIEW 接续与链接、格式、strict 检查。
- [x] 按用户要求将当前提案随工作前沿保存并汇入 main；方案采用与实现状态仍由前述任务承接。
- [ ] 归档按能力依赖顺序合并主 specs。

## 本轮进度

本轮只准备方案与文档，尚未实现恢复或路由，也未修改 45001 的认证状态。新提案与指南变更 strict 检查通过；682 项本地引用无新增或继承错误，格式与 diff 检查通过。12 个路径的 active LSP probe 确认 10 个无诊断，2 个超时未确认；这不代表完整诊断通过。原始输出在 docs/.temp/navigation-recovery-plan。
