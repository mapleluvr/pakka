## Why

WebUI 与 Node 产品启动、后端依赖和旧浏览器 SDK 混在一个包内，只有目录分层不足以支持独立开发与交付。用户已采用独立 pakka-webui、React 19 / TSX / Astryx 和清晰的插件职责，需要把这些决定与通用插件需求落实为一致的预期及分阶段工作，而不是继续保留互相冲突的候选路线。

## What Changes

- **BREAKING**：采用独立前端仓库和浏览器 SDK；旧 Preact 插件不迁移，旧 WebUI/SDK 按没有用户处理，不为兼容保留 facade、双 renderer 或旧默认入口。仍需的产品功能按用途重新接入。
- **BREAKING**：WebUI 服务采用 `/pakka-webui` 命名空间；模型设置不继承 `/pocket/models/rpc`。保留服务端授权、Cookie/CSRF、原请求、持久化与 unknown 语义。
- 明确前端宿主、Pakka 接入层、业务插件与后端服务的职责；RSI/MAS/Memo 的可视化、控制和管线由插件维护。
- 采用 Conversation 当前模型/Thinking、Person 跨设备默认、实例级提供商/端点/模型定义三种作用域；采用模型双入口与 Thinking 并列入口，Provider `/login` 交互继续延期。
- 吸纳通用插件 G1–G6 要求及按稳定引用进入另一已知 Session 原 Conversation 的浏览能力；已有多 Session 基础不误列为从零建设项目。
- 明确固定制品交付、共享 UI runtime、独立安装/图验证和阶段 0–5 的退出条件。当前交付为规划、规范与阶段 0 消费盘点，产品实施任务保持未完成。

## Capabilities

### New Capabilities

- `independent-webui`：独立前端交付、通用插件宿主、资源导航、共享 UI 与模型访问作用域的目标契约。

### Modified Capabilities

无既有主 spec 被直接重写。WebUI 旧声明仍由活动 `pakka-webui` change 管理；本 change 把独立前端边界作为新能力记录，并明确其替代单一产品包/Preact 约束的范围。后端服务、恢复、权限和原请求契约继续引用原声明，不复制或削弱。

## Impact

- 采用的预期维护在 `docs/state/webui.md`、`docs/state/product.md`，职责/目录维护在 `docs/development/WEBUI-ARCHITECTURE.md`，相关开发入口同步。
- 来源为用户的分仓与模型访问决定，以及固定 `pakka/history-book@170aa153e7dad0cda8f6172665d709407dfa703a` 的 `docs/requirements/WEBUI-PLUGIN-CAPABILITIES.md`。参考分支不是强制迁移、合并或发布基线。
- 现有公开消费路径按 `dev@cc1cdd8aead42cd0afe018c75973f09fd369184d` 核对；源码/声明证据与运行、独立安装证据分别记录。
- 本轮不改产品代码、依赖、测试或生产接口，不创建远端仓库、不发布包或合并参考分支。接口命名、制品渠道及未解决的能力缺口按阶段 0 盘点接续阶段 1；不实施 Provider 登录、多 Session 全局搜索或领域插件功能。
