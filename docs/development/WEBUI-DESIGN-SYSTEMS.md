# WebUI 开源设计系统调研

调研日期：2026-11-13。目标是为 Pakka 工作台与默认 extension 提供**好用的共同起点，又不把页面、组合方式和实现技术锁死**。这不是按 star 数排名，也不是所有 UI 库的穷举。

**建议：优先验证 React 19 + TypeScript/TSX + Astryx 的直接采用路径。** 用户已明确允许更换技术栈，不应为保住 Preact 而先投入兼容层。采用 Astryx 的默认视觉与开放部件，不等于复制它的全部工程制度，也不等于把所有上游 props 永久变成 Pakka 契约。

本报告的比较依据是官方文档、固定源码及 package 声明。组件无障碍、性能、agent-ready 等上游主张不视为 Pakka 实测结果；本轮没有安装运行候选库、执行跨库 benchmark，或证明生产接入已通过。开发规则见[前端规范](FRONTEND-GUIDELINES.md)，当前接口与推荐目录见[架构说明](WEBUI-ARCHITECTURE.md)。

## 1. 先分清比较对象

| 层次              | 解决什么问题                                   | 本次样本                                          |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| 成套设计系统      | 视觉语言、主题、成品组件与常见页面组合         | Astryx、Radix Themes、Carbon、Fluent UI           |
| Open-code 分发    | 将可修改的组件源码交给应用，而非只交一个黑盒包 | shadcn/ui；Astryx 的 swizzle 是另一种源码接管入口 |
| Headless 行为部件 | 可访问交互、焦点与状态，外观由应用决定         | Base UI、Radix Primitives、React Aria、Ark UI     |
| Web Components    | 借浏览器组件边界跨渲染框架使用                 | Web Awesome                                       |

Headless 并不天然比成套系统开放：它减少视觉约束，但让产品承担更多样式与组合工作。源码归自己也不等于维护免费；应分别比较**修改自由、共享运行时、升级责任和分发方式**。

## 2. 对比与适用条件

版本取自所读源码中的 package 声明；除 Astryx 固定 release tag 外，其余是固定 commit 的源码快照，不把它们统称为 npm 最新稳定版。

| 系统                                                                       | 实现与许可                                                    | 开放性和可借鉴点                                                                                          | 对 Pakka 的代价／适用判断                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Astryx 0.7.15** [S1](#s1-astryx)                                         | React/React DOM >=19；StyleX runtime peer；MIT；官方仍标 Beta | 现成主题与组件；CSS 自定义属性、`className`；公开组成部件；CLI 文档、模板、swizzle                        | 最贴近当前方向。消费预编译包不要求应用写 StyleX 或装编译插件；源码接管则不同。需核对新旧 SDK、portal、样式层叠与实际复杂交互，不把 Meta 内部使用规模当作外部版本成熟度证明 |
| **shadcn/ui** [S2](#s2-shadcnui)                                           | 可复制 React/TSX + CSS/Tailwind 组件；MIT                     | 应用拥有顶层源码；registry/CLI 可分发组件、hooks 等；所读仓库有 Base UI、Radix、React Aria 三类 base      | 最值得借鉴“源码可读可改、默认值不是封闭接口”。复制层的本地变更与上游更新由我们合并；底层依赖仍需升级。Registry 跨框架分发不代表任一 React 组件可直接用于任一框架           |
| **Radix Themes 3.3.0 / Primitives** [S3](#s3-radix)                        | React；MIT；所读 Dialog 为 1.3.1                              | Themes 提供完成度较高的默认外观；Primitives 提供独立 parts、`asChild`、受控／非受控交互                   | 若希望较小的视觉基座，可单独评估 Themes；若自建外观，才选 Primitives。两者不是同一层，也不要只为不同控件外观引入第二套弹层体系                                             |
| **Base UI 1.9.0** [S4](#s4-base-ui)                                        | 无样式 React 部件；MIT                                        | `render` 组合自定义元素；明确 class/style/event/ref 合并规则；行为与样式分离                              | 适合真正需要自有视觉系统时。少了视觉约束，也少了开箱即用的设计语言；不是“把 Astryx 换个包名”的等价替代                                                                     |
| **React Aria Components 1.22.1 / Spectrum** [S5](#s5-react-aria--spectrum) | React；Apache-2.0                                             | Aria 无默认外观，提供 states、render props、slots、复杂输入及国际化交互；Spectrum 是另一层成套 Adobe 视觉 | 复杂选择、键盘、多语言输入值得重点参考。选 Aria 不等于采用 Spectrum 外观；其跨设备质量主张仍须在 Pakka 的组合里核对                                                        |
| **Ark UI 5.40.0** [S6](#s6-ark-ui)                                         | Zag.js 状态机；React/Solid/Vue/Svelte adapters；MIT           | 无样式、细粒度 parts，行为机制与渲染框架分离                                                              | 当多框架消费成为真实需要时有吸引力。当前不值得为了假设中的跨框架 SDK 再维护一层通用渲染抽象；多框架列表不包含 Preact 的兼容承诺                                            |
| **Carbon React 1.120.0** [S7](#s7-carbon)                                  | React、Sass、独立 tokens/themes 包；Apache-2.0                | 企业工作台的完整视觉与组件体系；token 源和生成产物职责明确                                                | 对数据密集界面有参考价值。需要承担 IBM 设计语言、Sass 及依赖面；若改选，应单独审阅其声明的 telemetry 与退出方式，不默认安装就是纯无副作用操作                              |
| **Fluent UI React 9.75.2** [S8](#s8-fluent-ui)                             | React、Griffel；代码 MIT，字体／图标另有条款                  | slots；state/style/render hooks 可重组；provider 管理主题和 portal                                        | 可学“整体主题 → 局部 slot → 深层重组”的渐进定制。源码开放不表示所有实现均为稳定 API：部分 hooks 带 `_unstable`，底层 CSS 变量也不是公开主题接口                            |
| **Web Awesome 3.14.0** [S9](#s9-web-awesome)                               | Lit / Custom Elements；免费代码 MIT，另有 Pro 产品            | CSS tokens、`::part()` 和原生 slot；不要求应用换为 React                                                  | 适合有真实多框架／嵌入需求的场景。Shadow DOM、事件／表单集成和全局 custom-element 注册是另一套成本；不因跨框架就自动适合当前 extension 的 generation 更新／卸载            |

## 3. Astryx：值得直接采用，但不要误读开放性

### 包消费与源码接管是两条不同路径

官方 quick start 直接使用预构建 JS/CSS。依次引入 reset、component CSS、theme CSS，并安装 `@stylexjs/stylex` runtime peer；普通产品 CSS 或 CSS Modules 仍可使用。**不需要因为 Astryx 内部用 StyleX，就让 Pakka 的每个页面也使用 StyleX。**

其 `swizzle` 面向确实需要接管源码的情况：官方契约要求匹配 Core 版本及 StyleX 编译器，特定层叠位置还涉及 `@astryxdesign/build`。接管后的本地修改不会自动跟随 Core 升级。所读 swizzle spec 同时包含目标及 known gaps，不能以该文档的要求代替已运行的验证。

推荐顺序是：**主题／公开 props → 部件组合 → 有明确职责的薄适配 → 必要时源码接管**。每个组件不必四步走齐，更不先批量 eject 整个系统。

### 组件状态不是产品操作状态

所读 `Button.tsx` 的 `clickAction` 使用 `startTransition`，在 callback 的 `finally` 中解除自身 in-flight guard。它回答的是“这次 UI callback 是否仍执行”，不是“Pakka 的写入或模型效果是否已经确认”。

因此 `context.call()` 返回了外层 operation，甚至外层 `state: "done"`，都不能直接驱动“业务完成、清草稿、允许重做”。内层仍 unknown 时，原请求与锁由 feature/client 继续管理，组件只显示收到的状态。不能让一个通用 `AsyncButton` 重新定义所有扩展的恢复语义。

### 借鉴原则，不整套照搬约束

Astryx 的 API Conventions 对正交 props、任意内容的组合、slots、文件与导出同名、行为 hooks 有直接借鉴价值。但它面向自身维护者的组件模板、测试要求、禁止原生元素等规则，不自动成为 Pakka 的要求。Pakka 允许正常 HTML/CSS 和确有用途的自定义组件；本轮测试政策以用户明确的 WebUI 重构指令为准。

## 4. 推荐技术方向

```text
React 19 + TypeScript/TSX
  └─ Astryx 预编译组件 + 一个宿主主题
       ├─ 公开原语：按实际需要具名导出，不缩成万能配置表单
       ├─ Pakka 组合：少量有产品共性的 patterns
       └─ 页面／extension：普通组件 + 局部 CSS + 既有受控 client

现有 Node HTTP / RPC / 权限 / 持久化 / MAS 服务继续各自负责
```

- **React 19 是推荐迁移目标，不是当前运行事实。** 当前 `dev@cc1cdd8` 使用 Preact 11.0.1 / htm 3.1.1；import map、组件类型、默认贡献和外部消费者均与之有关。上游 Button 已直接使用 React `use`、`useTransition`，不能仅凭 alias 就宣称兼容。
- **应用保持 SPA。** 为开发反馈可试用 Vite；既有 esbuild 也可承接构建。构建器选择服从单运行时、静态资产和安装消费的实际结果，不绑定组件架构；本轮不增加 Next.js、SSR、RSC 或另一套服务端。
- **默认复用，不包办。** Astryx 普通组件用明确的共享出口；只在默认主题、兼容现有消费者或实际产品组合需要时增加代码。不要为了“以后换库”重写每一个 prop，也不承诺 React／Preact 或任意设计系统之间无损热切换。
- **一次选择一个主要交互基座。** Base UI / Radix / Aria 是替代与参考，不是要求全部安装。局部能力缺口可以引入新工具，但需说明它怎样接入已有焦点、层级和主题，而不是再立一套全局 provider。
- **默认 extension 与第三方走同一条路。** MAS Board、RSI 等不因内置身份而拥有私有组件、路由或状态权限；源码、示例和文档应该可供人类开发者直接追到。

若 Astryx 在真实试用中出现不可接受的组件／发布缺口：追求快速成套替代时看 Radix Themes；愿意维护自己的视觉层时看 shadcn + 一个 headless 基座。没有实测缺口前，不启动并行维护两套默认系统。

## 5. 下一步用什么证据作决定

这是一份**待执行的有限试用建议**，不是本轮已通过项，也不要求先建一套长期测试矩阵：

1. 在实际 Pakka 构建与 HTTP 资产路径上挂载一个 React/Astryx 页面，核对单一 React、JSX runtime、主题与 SDK module identity；不用独立 demo 的成功代替生产接缝。
2. 同时使用一份 GUI-only extension 和一个实际业务消费者（优先 RSI），确认无需导入宿主 `src/`，也不会捆绑第二份 React／主题 context。
3. 直接操作 button/form、menu→dialog、portal、IME 输入、键盘焦点，以及已有桌面／手机和字体缩放情境。先使用可丢弃的展示例与浏览器记录，不给所有组件生成 snapshot。
4. 碰到业务写入时沿真实 client 检查原请求核对、拒绝、unknown 和关闭／重开的关系；只在已有检查不足且确有独特高风险故障时补最薄的持久测试。
5. 记录本次选用组件、维护改动、构建结果和未解决点，再决定默认切换范围。测试 policy、视觉行为和 renderer/SDK 迁移分别采用，不互相偷渡。

## 6. 来源与核对范围

以下 commit 固定源码读取范围；网页／Wiki 是调研日在线内容，不能冒充同一 commit 的内容。原始页面与源码摘录留在本地证据包，不随报告重复上传。许可证结论覆盖所读代码，不自动覆盖字体、图标、示例素材或付费产品。

### S1 Astryx

- [固定源码 v0.7.15 / af3abc36](https://github.com/meta/astryx/tree/af3abc36f8e66605e769256b08027683c9eef67a)：根 README、`packages/core/README.md`、`packages/core/package.json`；`packages/core/src/Button/Button.tsx` 的 imports、props／action 路径；`docs/specs/AST-110-swizzle-output/spec.md`。
- [官网安装](https://astryx.atmeta.com/docs/getting-started)、[API Conventions](https://github.com/meta/astryx/wiki/API-Conventions)：在线阅读；Wiki 的规则不等于 Pakka 已采用规则。

### S2 shadcn/ui

- [固定源码 dd41d19e](https://github.com/shadcn-ui/ui/tree/dd41d19e2f80ff6891951f7ced74c2c9a650b065)：`apps/v4/content/docs/(root)/index.mdx`、`apps/v4/content/docs/registry/getting-started.mdx`；`apps/v4/registry/bases/base/ui/button.tsx`；base/radix/aria 文件树。
- [官方介绍](https://ui.shadcn.com/docs)、[registry 文档](https://ui.shadcn.com/docs/registry/getting-started)。后者源码明确区分 registry 的分发协议与被分发代码的框架。

### S3 Radix

- [Themes 1faff10a](https://github.com/radix-ui/themes/tree/1faff10ac26ae17f09944d418c6949b93fc6b566)：`packages/radix-ui-themes/{README.md,package.json}` 与 `packages/radix-ui-themes/src/components/theme.tsx`。
- [Primitives eb3a2b70](https://github.com/radix-ui/primitives/tree/eb3a2b7091293e27df8f9ba906632d8daa3d81a3)：Dialog package 声明；[官方介绍](https://www.radix-ui.com/primitives/docs/overview/introduction)核对 parts、`asChild`、受控／非受控与版本去重建议。

### S4 Base UI

- [固定源码 fb9fbbf3](https://github.com/mui/base-ui/tree/fb9fbbf35e72bd4a5494b678c85d2ea0457fed60)：`packages/react/package.json`；`docs/src/app/(docs)/react/handbook/composition/page.mdx`。
- [官方组合说明](https://base-ui.com/react/handbook/composition)：直接核对 `render`、DOM props/ref 转发和合并优先级。

### S5 React Aria / Spectrum

- [固定源码 1bff7d0a](https://github.com/adobe/react-spectrum/tree/1bff7d0a2e27185d317777779d08784da6966113)：`packages/react-aria-components/package.json`；`packages/dev/s2-docs/pages/react-aria/{getting-started,styling}.mdx` 的组件组合、states、slots 和样式说明。
- [React Aria 官网](https://react-aria.adobe.com/)；Spectrum 与 Aria 的层次亦由该仓库根 README 说明，不将二者混为无样式库。

### S6 Ark UI

- [固定源码 d6f517aa](https://github.com/chakra-ui/ark/tree/d6f517aa1e74cff19af7cfc82f4e3f4835d12ee5)：根 README 的框架、Zag 和组合说明；`packages/react/package.json` 的版本、peer 与 Zag 依赖。
- [官方文档](https://ark-ui.com/)。框架一致性、无障碍与 production-ready 是上游主张，本轮未跨框架实测。

### S7 Carbon

- [固定源码 1e17b61f](https://github.com/carbon-design-system/carbon/tree/1e17b61f5dc8873d68eabcc5c3cce2da41c4e5ba)：`packages/react/package.json`；`packages/themes/README.md` 的 Sass/JS 使用、DTCG token 源与生成物、IBM Telemetry 声明。
- [官方系统](https://carbondesignsystem.com/)。仅指出安装审阅事项；本轮未安装，也没有推断或观测其实际网络发送。

### S8 Fluent UI

- [固定源码 f9720c35](https://github.com/microsoft/fluentui/tree/f9720c35ba893c9630f4c0389d07dc6d6fd6068d)：根 `LICENSE`；`packages/react-components/react-components/package.json`；`apps/public-docsite-v9/src/Concepts/Theming.mdx`、`apps/public-docsite-v9/src/Concepts/Slots/Slots.mdx`；`docs/react-v9/contributing/patterns/basic-recomposition.md`。
- [官方 React 文档](https://react.fluentui.dev/)。GitHub API 的许可识别为 NOASSERTION；这里的 MIT 判断来自实际 LICENSE，不是该元数据。文件末尾另列字体／图标使用条款。

### S9 Web Awesome

- [固定源码 1828b399](https://github.com/shoelace-style/webawesome/tree/1828b3992c6fee46182150422fdf4945e6521012)：根 README；`packages/webawesome/{package.json,LICENSE.md}`；`packages/webawesome/scripts/design-skill/references/theming.md` 的 tokens、`::part()` 与免费／Pro 边界。
- [官方主题文档](https://webawesome.com/docs/themes)。根 README 明确说明 custom elements 无法重新注册，因此开发重载与可撤销安装不能混同。

## 7. Pakka 源码依据

基线：[dev@cc1cdd8a](https://github.com/mapleluvr/pakka/tree/cc1cdd8aead42cd0afe018c75973f09fd369184d)。本节 `src/`、`web/` 简写相对 `apps/webui/`，其余为仓库相对路径。直接核对：

- `apps/webui/package.json`、`web/index.html`：Preact/htm、public exports、实际 import map。
- `src/components.ts`、`src/ui.ts`、`src/extension.ts`、`src/backend.ts`：现有公开组件和接口；路径相对 `apps/webui/`。
- `web/app.js` 的 imports／初始化，以及 `web/extensions.js` 的 `HostInterface`：应用装配、generation/open-instance、abort 与实际 content 挂载。
- `apps/webui/examples/hello/web/index.js`、`packages/rsi/src/browser/index.ts`：GUI-only 与实际业务消费者。
- `apps/webui/scripts/build-browser-vendors.mjs` 及 frontend/WebUI state、开发和验证规范：现有构建职责与不能因换 UI 而取消的契约。

这是源代码／文档核对，不是运行新版 WebUI 的验收结论。
