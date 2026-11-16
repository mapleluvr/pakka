# 独立 WebUI SDK 开发制品

`@pakka/rsi` 的 React/Astryx browser facet 消费独立 `pakka-webui` 仓库拥有的 `@pakka/webui-sdk`。本仓仅固定实际 SDK 归档，不复制公共类型或 React context。

当前归档为 `sdk/pakka-webui-sdk-c1f99cd939aa0ffc.tgz`，版本 `0.1.0`，SDK 源码与前端阶段 1 已验收提交 `48adf83` 一致，归档的 package 元数据来自阶段 2 工作树；其 SDK 字节已与本轮最终构建核对一致。内容身份由包文件名、npm 锁文件 integrity 和下列完整 SHA-256 固定：

`c1f99cd939aa0ffc88400939bf5639fe42c36929d523e45f1197eedd3901dca7`。

该归档是构建期依赖；RSI 的 UI 模块将 React、SDK 和 Astryx external 到前端共享 runtime。Node 产品仍由本仓装配。应用运行需要完整前端 `dist/app` 及固定 manifest digest，不能把 SDK 归档当作网页。

服务版本与资产契约见[公共接缝](../../docs/reference/WEBUI-SERVICES.md)，真实安装、读写与回执核对见[阶段 2 验证](../../docs/verification/INDEPENDENT-WEBUI-PHASE-2.md)。当前包为开发候选，未发布 npm，也未切换默认入口。
