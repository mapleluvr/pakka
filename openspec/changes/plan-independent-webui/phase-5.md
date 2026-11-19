# 阶段 5：默认交付与旧前端退出

用户授权继续到阶段 5 结束的端到端交付。起点为 Pakka `c3da462` / pakka-webui `639397d`，继续两仓所属工作分支。默认产品切换、固定安装、部署/回退、旧 UI/SDK/重复构建清理及交付文档进入本轮。原 Session、权限、持久请求和已接纳工作继续按现行契约；Provider `/login` 延期，真实录音沿用户无设备的跳过决定。分支集成和公共发布分别按项目交付工作流记录。

## 默认产品装配

Pakka 构建消费独立前端固定 tgz；构建期先核对归档/manifest 摘要和完整成员，再通过生产 `loadWebUiAssets` 校验全部静态资产。已验证字节随 `@pakka/webui` 包进入 `dist/frontend`。消费者安装和启动无需独立前端源码、npm 下载或前端编译。

`startPocket` 未指定 frontend 时载入随包固定产物；可信装配仍可显式选择另一个完整目录和 manifest 摘要。所有选择均在 Session 打开前校验兼容性与字节。CLI、直接 executable 和私密恢复链接使用前端接收的 `#session`。默认构建的产物选择由 `src/default-frontend.ts` 声明；配对与用户安装方式由 integrations/webui 维护。

当前默认应用归档为 `97c5bcd821a91b3a4c7ab4f80a7fffdd3b2172b84c77572c874f6f0dd71ce1ad`，manifest 为 `a4ea8a221f173c4ac4c3e5d0f81c8019bb42d057fc7c91f2c7ef290c02631941`，713 个资产。固定安装与默认装配已通过端到端核对；阶段 4 的 services 4 归档作为兼容回退对象验证了 A → B → A，详情见[最终结果](../../../docs/verification/INDEPENDENT-WEBUI-PHASE-5.md)。

## 检查接续与分类

逐项核对旧测试的契约，再按职责接续。现有授权、真实效果和持久恢复风险保留在原生/HTTP 检查；已退出的 DOM、内部状态结构与视觉实现由新页面真实路径证据承接。逐组映射在 [覆盖接续记录](../../../docs/verification/WEBUI-COVERAGE-TRANSITION.md)。原阶段 4 失败记录保留，不改写历史结果。

默认产物和登录链接扩展现有 `product`、`main`、`launcher` 检查。文件/Git 的公开 HTTP 接线合并到 `files-http`，原生 `pocket-files` 保留。上述文件使用真实 Runtime、进程、文件系统或 HTTP，保持 heavy；自动进入 release 和 webui affected 范围。没有新增长期 props/DOM/CSS 形状测试。

## 当前结果与剩余路径

- 默认产物的缺失先由 product 检查复现；接线后 HTML、声明模块、worker、真实输入与同一 Session 重开通过。公开新 RPC 需要 Person/Server 身份头，首轮测试遗漏后按现有契约补齐。
- main 检查先复现旧登录 fragment，修正后 main/product/launcher 三文件全部通过。全量类型检查通过，改动源码和 CLI 测试主动 LSP 四文件确认 clean。
- 命令覆盖核对修正了普通 slash 文本、Conversation 发现与 Backend action 入口。write/model 的原请求按 App/Conversation 作用域保留并只读恢复；read 沿原生短期读取语义。两轮真实页面通过响应丢失、原 Session 重开、facet 停用、跨页、新草稿、unknown、关闭/晚到读取、撤权和只读隔离；详情及探针反例见覆盖接续记录。
- 旧消费者按逐项覆盖退出，旧 UI/SDK 与重复资产构建已删除。最终归档的完整 smoke、空目录/headless/公开 SDK 消费、PC/390px 默认登录与输入、原请求跨兼容回退恢复、Files 插件与退出清理、TLS 代理同源边界均通过。
- release 274 文件全部完成；首轮 271 文件通过，三文件修正旧登录断言并在短隔离目录复验 15 项全通过。两轮合并覆盖 878 项通过、3 项平台跳过。Windows 深目录 ACL 限制、真实录音跳过和旧 worker 仍收到正文的未覆盖分支继续保留。
- tasks 6/7 按当前所选范围完成；两仓交付文档、固定配对与本地证据封存随最终提交收口。工作分支 PR、集成、公共发行和 OpenSpec 归档分别登记。
