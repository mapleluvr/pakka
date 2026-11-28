# 个人模式验证

候选：Pakka 基线 db5c34bf0e0e0a6dc0dac915e42fc8f1376a0383 与 WebUI 基线 2f62b84c5f0ea8ac307f73083dc433b1fe088745 上的 personal-mode 工作树。前端完整源码输入 SHA-256 为 305984573e03fde05ed2354136269a6991bb4df33192da66dcd2658d8e43bbed；固定应用 4c5779bdd179bf65，services 6 / workbench 3 / extensions 3。环境 Windows、Node 24.15.0、Ego Lite；自动验证使用隔离配置，未发送真实推理。

- 两仓完整构建与 TypeScript 检查通过。
- 296 个测试文件扩大回归及修正复跑合并统计：946 项，943 通过、2 平台跳过、1 基线失败。原轮次与复跑均保存，未写成单次全量通过。
- 初轮旧格式样例混入 schema 3 字段，按真实 schema 1 投影修正；四个文件受同时更新构建影响。构建完成后的六文件复跑全部通过。
- 剩余 packages/mas/test/unknown.test.ts 的 deliver 锁库场景抛 database is locked；本候选单独复跑及未修改 pakka-session-budget 基线均复现。独立待办，未改变 MAS 实现或削弱测试。
- 仓库外安装 8 个发布归档，通过同 Person 的两个登录、独立撤销、模式原请求核对、空备注保存与原 Session 重开。首轮消费者错误改变 bootstrap initial 被正确拒绝；保留相同初始化定义后通过。
- 桌面和390px实屏检查完成，安装态手机无横向溢出；可选姓名登录、模式切换、设备入口与可选预算备注可用。
- 8854 正常停止、冷备份、重开原 Session；713项服务资产逐项核对通过。个人模式已启用。Proj 的19条历史及模型用量逐字节一致，预算0/0/0和已用主要推理6保留。恢复登录替换旧 owner 登录，浏览器已重新连入原身份。
- LSP 活动检查未返回新的类型错误，部分 clean 回应不充分；完整编译为实际类型验证依据。复杂度与既有风格提示未作为全面重构范围。

完整本地证据包 personal-mode-evidence.zip，625468字节，SHA-256：

`37cbaa0200c820945331b2756cf159ed94e931c2b07352f0a48707833b670ef1`

证据和冷备份位于工作区 .backups/2026-11-27-personal-mode，仅本地保存。原始日志、截图、依赖树和证据包不进入 Git 或 GitHub。两仓通过独立 pakka/personal-mode 分支向 dev 提交配对 PR。

PR 收口证据包 personal-mode-pr-evidence.zip（3676232 字节）包含原证据包、完整候选差异与新增文件、产物检查和本轮类型检查输出。整体 SHA-256：`8fae2b13cc5ba151cbb533c9611e77c914e9891cb6eb81e55563981e372f1ae8`。该包仅本地保留。

PR 准备时重新 fetch，Pakka dev 为 c2178c23f20e99ce182e3becf5ad2f396da6d9a1，WebUI dev 为 a566b112ee2f0faf2a6b1121ceee6dcb87a49bf6；两者已包含上轮预算和界面候选，其文件树分别与本轮开发基线一致。本次完整 PR 范围只增加个人模式。两仓 npm run check 再次通过，产品源码及固定前端归档与上述验收身份一致。

diagnostics 核对：本地 finalize.py 的 Ruff 检查通过；选定七个路径的活动 LSP 检查没有返回错误，其中两个未确认 clean，完整 TypeScript 编译已通过。缓存中的旧模块声明错误不能作为当前编译结论。临时探针的输出、异常断言与复杂度提示保留在本地；未声称整个工作区 diagnostics 已清零。
