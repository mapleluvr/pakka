# pakka-webui 来源与原生端口工具

本目录固定外部来源、许可、采用映射和可执行探针。WebUI 的使用、界面与服务契约分别在[使用指南](../../docs/guides/WEBUI-GUIDE.md)、[前端声明](../../docs/state/frontend.md)和[开发规范](../../docs/development/WEBUI-DEVELOPMENT.md)维护。

## 固定来源

[source-lock.json](source-lock.json)分别指定两棵源码树的用途：

- `TannerMidd/pi-pocket@de612d5622cdc66b6b8b4900c650c6f2efdf4c63`：界面与资产来源。
- `mapleluvr/pi-pocket@58a4fdcc88ed755023aea9fac897735fca7396fe`：命令／接口参考，其 parent 为 `2cb652c465f670ba8c66fc3ee639798caca8afbc`。

这些是不同的 Git tree，按 lock 中的用途读取，不能互相替代。来源探针使用各自固定依赖；Pakka 的生产依赖另由 package/lock 及[Durable 补丁契约](../../docs/state/durable-patch.md)绑定。

原始代码和字体 notices 保存在 [licenses/](licenses/)。采用的资产保持对应 source/blob/SHA、许可及 copyright。生产前端的 Devin 参考与原生行为规则见[前端开发规范](../../docs/development/FRONTEND-GUIDELINES.md)。

## 准备源码

从 Pakka 根目录运行，检出完整精确 commit：

```powershell
$root = 'artifacts/pakka-webui/p0'
New-Item -ItemType Directory -Force $root | Out-Null
git init "$root/upstream-source"
git -C "$root/upstream-source" remote add origin https://github.com/mapleluvr/pi-pocket.git
git -C "$root/upstream-source" fetch --no-tags origin de612d5622cdc66b6b8b4900c650c6f2efdf4c63 58a4fdcc88ed755023aea9fac897735fca7396fe 2cb652c465f670ba8c66fc3ee639798caca8afbc
git -C "$root/upstream-source" checkout --detach de612d5622cdc66b6b8b4900c650c6f2efdf4c63
git init "$root/pi-pocket-source"
git -C "$root/pi-pocket-source" remote add origin https://github.com/mapleluvr/pi-pocket.git
git -C "$root/pi-pocket-source" fetch --no-tags origin 58a4fdcc88ed755023aea9fac897735fca7396fe
git -C "$root/pi-pocket-source" checkout --detach 58a4fdcc88ed755023aea9fac897735fca7396fe
```

源码和生成物放在忽略目录中；来源工具不启动上游应用或使用用户凭据。

## 执行与输出

```powershell
node integrations/pocket/upstream-baseline.mjs
node --test integrations/pocket/source.test.mjs
node integrations/pocket/source.mjs "$root/upstream-source" "$root/pi-pocket-source" "$root/source-inventory.json"
node --test --test-concurrency=1 integrations/pocket/native-jobs.test.mjs packages/agent/test/conversation-observation.test.ts packages/agent/test/conversation-observation-safety.test.ts
```

- `upstream-baseline.mjs`：核对 commit/tree/licenses 和干净工作树，在隔离 HOME/AppData/temp/data 中安装、检查和测试上游；环境排除用户凭据与 npm 配置。输出归属于该上游、平台和工具版本。
- `source.mjs`：从 Git blob 生成 mode、blob ID、SHA-256、长度及 AST 调用／路由位置。AST parser 使用上游锁定 TypeScript 6.0.3 的公开 API。
- [adoption-map.json](adoption-map.json)：为源模块关联采用职责、scope、效果策略与执行路径。候选引用位置本身不是已确认功能或漏洞。
- `native-jobs.test.mjs`：直接检查锁定 Durable 的 waiter cancellation、显式 abort receipt 和 checkpoint 重开。应用 job 的权限、有限额度和执行期检查另由 Runtime 公开接口承担。
- Conversation observation 测试：核对冻结 DTO、权限撤销、显示记录去重及零模型贡献。

逐命令 exit、skip 和失败按实际环境记录。来源清单、上游测试与 API 探针分别建立不同证据，不能互相替代。固定结果见 [upstream-baseline.json](upstream-baseline.json)，形成与测量记录见[来源调查](../../docs/archive/webui/PAKKA-WEBUI-P0.md)。
