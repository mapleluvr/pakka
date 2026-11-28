# 独立 WebUI 固定制品

## 默认完整应用

默认 `pakka` 启动消费 `app/pakka-webui-app-0.1.0-65f598476697a145.tgz`。完整 SHA-256：

`65f598476697a1452cbdcd9518213908890ae6c52d143b69b7c97bcab9375079`

归档为 1,359,402 字节，manifest SHA-256：

`b40dd56a35657806decd04208cb0fd4506ff84a3f06a126dcc71e24e1c64b898`

它包含 716 项声明资产及 npm/manifest 元数据，要求 services 7 / workbench 3 / extensions 3、资产 schema 2 和 `react19-astryx0.7.15` runtime。应用源码与安装后端的固定包身份见 [配对记录](pairings/app-65f598476697a145.json)。版本名 `0.1.0` 之外，实际交付以归档与 manifest 摘要定位。

Pakka 构建先核对固定归档摘要、完整成员及每项资产，再把已验证字节放入 `@pakka/webui/dist/frontend`。包的安装和启动无需独立前端源码、前端编译或额外下载。`startPocket` 未指定 `frontend` 时使用随包产物，并在打开 Session 前重新验证资产与服务兼容性。选择常量由 `apps/webui/src/default-frontend.ts` 维护。

## 显式替换与兼容回退

从受信配对记录取得预期摘要，核对完整归档后解包到新的空目录。例如在本目录执行：

```powershell
$archive = 'app/pakka-webui-app-0.1.0-65f598476697a145.tgz'
$expected = '65f598476697a1452cbdcd9518213908890ae6c52d143b69b7c97bcab9375079'
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Frontend archive identity mismatch'
}
$destination = '../../dist/webui-candidate'
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
tar -xzf $archive -C $destination
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed' }
```

可信 Node 或 ESM 装配可传入 `frontend: { directory: '<absolute>/dist/webui-candidate/package', manifestSha256: '<approved manifest SHA-256>' }`。JSON 配置保持其闭合字段。后端校验失败时停止启动，不下载替代内容。`entry: null` 的共享 runtime 不能代替完整网页。

切换需要正常停止服务，并以原 Session 定位和服务配置重新启动。配对记录中的 `workingTreeInputsSha256` 针对前端基线加本轮源码，按相对路径升序，对 `src/`、`scripts/`、`licenses/`、`vendor/*.tgz`、`tsconfig*.json`、`package{,-lock}.json` 的普通文件拼接 `sha256(原始字节)␠␠相对路径\n` 再取 SHA-256；不是未产生的提交号。前端与后端公开包须核对实际摘要，不凭相同 npm 版本混装。

services 7 的 Note/Pin 不与 services 6 的单笔记客户端配用；升级先正常关闭原 writer，再用原 Session 和兼容归档重开。

旧 workbench 2 和 services 4 不支持 Session 零额度，即使只有一个新开的 Session，旧客户端也可能无法读回配置。新旧归档组合在加载前拒绝；TUI 等独立 Pocket 消费者须升级到 v3。保留旧数据库和有用的备份，不在有零额度或相应历史回执的新数据库上直接降级旧后端。旧归档的[历史配对](pairings/app-97c5bcd821a91b3a.json)与阶段 5 验证仍描述原候选。

独立前端的[交付说明](https://github.com/mapleluvr/pakka-webui/blob/pakka/independent-webui-seams/docs/development/DELIVERY.md)维护构建方式，服务接口见[公共接缝](../../docs/reference/WEBUI-SERVICES.md)。本目录固定的是产品所需的静态归档；registry 发布与分支集成分别记录。

## UI SDK

`@pakka/webui-sdk` 由独立 `pakka-webui` 仓库维护。本仓固定 `sdk/pakka-webui-sdk-3f669b8af0d7af4c.tgz`，完整 SHA-256：

`3f669b8af0d7af4cc0093a7c6a4261fa13786f8250e3744c1d3129a72ca361c2`

SDK 版本为 `0.1.0`，实际版本以固定归档摘要为准。`@pakka/webui-sdk/icons` 提供 `UiIcon` / `UiIconName`；其他 WebUI extension 可复用这组 SVG，无须导入 Conversation 内部源码。图标列表、尺寸、颜色和可访问性说明见独立前端的 [UI SDK 文档](https://github.com/mapleluvr/pakka-webui/blob/pakka/personal-mode/docs/development/UI-SDK.md)。目标宿主 import map 必须提供该子入口。业务插件将 React、SDK 和 Astryx external 到共享 runtime；SDK 是独立的构建期依赖。headless 消费方无需安装静态网页或 React/Astryx。

## 实际核对

[阶段 5 验证](../../docs/verification/INDEPENDENT-WEBUI-PHASE-5.md)记录最终安装、默认启动、兼容回退和部署边界。历史 [阶段 3](../../docs/verification/INDEPENDENT-WEBUI-PHASE-3.md)保留原 services 3 组合、GUI-only 变体和启动前拒绝；原始结果保持各自候选范围。
