# 独立 WebUI 固定制品

## 完整应用

当前显式候选记录在 [app-bc3c6f49f4e6e11b.json](pairings/app-bc3c6f49f4e6e11b.json)。归档为 `app/pakka-webui-app-0.1.0-bc3c6f49f4e6e11b.tgz`，1,184,383 字节，完整 SHA-256：

`bc3c6f49f4e6e11b2ffbc947e35df1b0504f552726e715c752d4fba345f68482`

manifest SHA-256：

`418033338b02ad0f6dec8ab24dcbbf3278b9d71b8f8454197418f9669d396e15`

应用源码对应独立前端提交 `977b138c074fcc17a16ba4ad00bfc7ca76b3332b`；阶段 3 新增的 `npm run pack:app` 使用 npm pack 形成标准静态归档，重建后与原验收应用字节一致。配对记录列出实际安装后端的固定包 hash；不使用 `0.1.0` 版本名替代内容身份。

从获准配对记录取得预期摘要，核对归档后解包至新的空目录，例如在本目录执行：

```powershell
$archive = 'app/pakka-webui-app-0.1.0-bc3c6f49f4e6e11b.tgz'
$expected = 'bc3c6f49f4e6e11b2ffbc947e35df1b0504f552726e715c752d4fba345f68482'
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Frontend archive identity mismatch'
}
$destination = '../../dist/webui-candidate'
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
tar -xzf $archive -C $destination
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed' }
```

可信 Node 启动显式传入 `frontend: { directory: '<absolute>/dist/webui-candidate/package', manifestSha256: '<above manifest SHA-256>' }`。`startPocket` 使用公开 `loadWebUiAssets` 在 Session 打开前校验全部资产与服务兼容性；需要 `/` HTML entry。独立前端的 [交付说明](https://github.com/mapleluvr/pakka-webui/blob/pakka/independent-webui-seams/docs/development/DELIVERY.md)说明构建和更新，服务接口见[公共接缝](../../docs/reference/WEBUI-SERVICES.md)。

归档含 637 项声明资产及两项 npm/manifest 元数据，包括上游许可；没有 Node runtime 依赖、源码、原始验证材料或凭据。它是显式装配候选，不自动进入现有 `pakka` 默认启动，不是 npm 发行。

## UI SDK

`@pakka/rsi` 的 React/Astryx browser facet 消费独立 `pakka-webui` 仓库拥有的 `@pakka/webui-sdk`。本仓固定实际 SDK 归档，不复制公共类型或 React context。

SDK 归档为 `sdk/pakka-webui-sdk-c1f99cd939aa0ffc.tgz`，版本 `0.1.0`，SDK 源码与前端阶段 1 提交 `48adf83` 一致，归档元数据来自阶段 2；SDK 字节已与最终构建核对。完整 SHA-256：

`c1f99cd939aa0ffc88400939bf5639fe42c36929d523e45f1197eedd3901dca7`

SDK 是构建期依赖；RSI 将 React、SDK 和 Astryx external 到前端共享 runtime。SDK 归档不能代替完整网页。

## 验证范围

[阶段 3 验证](../../docs/verification/INDEPENDENT-WEBUI-PHASE-3.md)记录干净 checkout、归档边界、同一安装版后端的 A → B → A、原资源身份和启动前拒绝。候选 B 是隔离 checkout 中普通 GUI-only 插件的受控变体，未作为第二个公开版本发布。模型和 RSI 功能验收保留在[阶段 2](../../docs/verification/INDEPENDENT-WEBUI-PHASE-2.md)。阶段 4–5 的功能、默认切换、发布和合并分别推进。
