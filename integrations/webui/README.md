# 独立 WebUI 固定制品

## 默认完整应用

默认 `pakka` 启动消费 `app/pakka-webui-app-0.1.0-97c5bcd821a91b3a.tgz`。完整 SHA-256：

`97c5bcd821a91b3a4c7ab4f80a7fffdd3b2172b84c77572c874f6f0dd71ce1ad`

归档为 1,304,838 字节，manifest SHA-256：

`a4ea8a221f173c4ac4c3e5d0f81c8019bb42d057fc7c91f2c7ef290c02631941`

它包含 713 项声明资产及 npm/manifest 元数据，要求 services 4 / workbench 2 / extensions 3、资产 schema 2 和 `react19-astryx0.7.15` runtime。应用源码与安装后端的固定包身份见 [配对记录](pairings/app-97c5bcd821a91b3a.json)。版本名 `0.1.0` 之外，实际交付以归档与 manifest 摘要定位。

Pakka 构建先核对固定归档摘要、完整成员及每项资产，再把已验证字节放入 `@pakka/webui/dist/frontend`。包的安装和启动无需独立前端源码、前端编译或额外下载。`startPocket` 未指定 `frontend` 时使用随包产物，并在打开 Session 前重新验证资产与服务兼容性。选择常量由 `apps/webui/src/default-frontend.ts` 维护。

## 显式替换与兼容回退

从受信配对记录取得预期摘要，核对完整归档后解包到新的空目录。例如在本目录执行：

```powershell
$archive = 'app/pakka-webui-app-0.1.0-97c5bcd821a91b3a.tgz'
$expected = '97c5bcd821a91b3a4c7ab4f80a7fffdd3b2172b84c77572c874f6f0dd71ce1ad'
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Frontend archive identity mismatch'
}
$destination = '../../dist/webui-candidate'
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
tar -xzf $archive -C $destination
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed' }
```

可信 Node 或 ESM 装配可传入 `frontend: { directory: '<absolute>/dist/webui-candidate/package', manifestSha256: '<approved manifest SHA-256>' }`。JSON 配置保持其闭合字段。后端校验失败时停止启动，不下载替代内容。`entry: null` 的共享 runtime 不能代替完整网页。

切换需要正常停止服务，并以原 Session 定位和服务配置重新启动。回退使用兼容的完整前端归档，保留数据库、身份、已接纳工作与待核对请求。阶段 5 在同一安装版后端验证当前默认归档 → 阶段 4 services 4 归档 → 当前默认归档；两笔输入各只执行一次，丢响应的原请求只查询一次。旧阶段 3 的 services 3 归档没有当前构建消费者，已从当前树退出；[历史配对](pairings/app-bc3c6f49f4e6e11b.json)与 [Git 中的原归档](https://github.com/mapleluvr/pakka/blob/c3da4628df8114aa341b9c0718536dbaba435349/integrations/webui/app/pakka-webui-app-0.1.0-bc3c6f49f4e6e11b.tgz)保留来源。它不能用于当前默认服务组合。

独立前端的[交付说明](https://github.com/mapleluvr/pakka-webui/blob/pakka/independent-webui-seams/docs/development/DELIVERY.md)维护构建方式，服务接口见[公共接缝](../../docs/reference/WEBUI-SERVICES.md)。本目录固定的是产品所需的静态归档；registry 发布与分支集成分别记录。

## UI SDK

`@pakka/webui-sdk` 由独立 `pakka-webui` 仓库维护。本仓固定 `sdk/pakka-webui-sdk-c1f99cd939aa0ffc.tgz`，完整 SHA-256：

`c1f99cd939aa0ffc88400939bf5639fe42c36929d523e45f1197eedd3901dca7`

SDK 版本为 `0.1.0`，源码与前端阶段 1 提交 `48adf83` 一致，归档元数据来自阶段 2。业务插件将 React、SDK 和 Astryx external 到共享 runtime；SDK 是独立的构建期依赖。headless 消费方无需安装静态网页或 React/Astryx。

## 实际核对

[阶段 5 验证](../../docs/verification/INDEPENDENT-WEBUI-PHASE-5.md)记录最终安装、默认启动、兼容回退和部署边界。历史 [阶段 3](../../docs/verification/INDEPENDENT-WEBUI-PHASE-3.md)保留原 services 3 组合、GUI-only 变体和启动前拒绝；原始结果保持各自候选范围。
