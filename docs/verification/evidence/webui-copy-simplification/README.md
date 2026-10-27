# 版本与重现

- 产品：`04fcf4ad2e35442738e15f3399b0290d3ad21d8c`；最终测试补正：`59ff46550105367d0ae94736b1529a01837360c0`，仅四个测试文件，产品零 diff。
- `source-snapshot.json` / `final-checkout.json` 记录实际 Windows checkout 的原始 bytes/SHA-256 及 canonical Git blob；Git 的 CRLF→LF 与 HTTP 的原始 bytes 检查分开，不能用前者代替后者。`preview/` 绑定旧产品 SHA，资源与新测试候选的产品完全相同。
- `manifest.json` 给每份原始日志、JSON、PNG 标注阶段和内容身份；首轮全量六项失败与旧消费者测试适配保留，不重写为通过。最终结果以 `gate-summary.json` 与 `logs/final-shell-result.log` 为准。
- 此处不含登录 token、真实密钥、cookies、profile 或产品数据。`preview/status.json` 的绝对路径只定位本机隔离环境，不是可移植的数据备份。

在确切候选或之后纯文档提交上，用 Node/npm 按根 README 安装构建；所有测试均为本地确定性 provider，不读取用户配置：

```powershell
npm ci
npm run build
npm run check
node docs/verification/evidence/webui-copy-simplification/reproduce.mjs
node docs/verification/evidence/webui-copy-simplification/reproduce.mjs --full
```

默认运行两个新增界面文件和四个补正消费者（共 17 项），已实跑 17/17、exit 0。完整 664 项结果来自该候选的原 `npm test`；`--full` 只是转发仓库原入口，没有另跑第三次全量；若生产代码或测试相对封存候选改变，入口拒绝启动，不能把后来版本的结果当成此版本。浏览器使用独立 profile；默认小矩阵结果位于忽略的 `artifacts/ui-copy-reproduce/`，全量沿用 `artifacts/integration/`。语音是受控 SpeechRecognition 生命周期测试，不证明远端识别服务能力。普通浏览器截图与几何检查不等于指定独立 GUI 验收；指定 desktop 不可用仍为 BLOCKED。
