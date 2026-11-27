# 首页品牌与导航核对

候选为 WebUI `e88a727` 与 Pakka `40b0b5b` 基线加本轮首页变更。源码输入 SHA-256 为 `d6ddc3d37decfe161f428b03a6ffd2f889d6c7733912c66d93e77fb386a9e75b`，算法见 Pakka integrations/webui。固定应用归档 SHA-256 为 `f696e85ed182b9de8f16d4d0f56e719d949849e9de2731d25ae4fdaaad99471c`，manifest 为 `a781ef3a7c8d54ccfbe339cac8593a7468aab3c11362212a0d5cff77cb03652e`；共 715 项资产，要求 services 6 / workbench 3 / extensions 3。

Windows、Node 24、Ego Lite：两仓类型检查、前端 pack:app、Pakka 固定应用构建通过。修改的 TypeScript 文件主动 LSP 检查无诊断。隔离服务验证登录入口、已登录首页、长中文标题、原 Conversation 与工作台/设置入口、明暗和跟随系统主题；320px 与 390px 无横向溢出。两份 SVG 与用户指定源文件逐字节一致。

8854 正常停止并释放 writer，冷备份后重开原 Session；HTTP 全部 715 项资源的字节与 MIME 匹配候选。刷新后的桌面和 390px 未登录首页已实屏核对。测试浏览器没有有效登录，原 owner-link 已过期；未签发恢复登录或撤销现有设备。已登录路径在隔离服务完成。Proj 的 19 条历史与模型用量重启前后逐字节一致，未发送推理输入。

变更属于页面布局与静态物料，选用影响域类型/构建/浏览器验证，不新增永久 DOM/CSS 测试或重复全量后端回归。原始尝试及修正保留于本地；旧页面仅变更 hash 时仍显示旧应用，执行整页刷新后载入新资产。

本地证据包 `homepage-evidence-final.zip`，320,771 字节，SHA-256：

`3461704d8b683e0900d48ca71bac5c26d3e3eed2adf991611297e4c2ac33e27c`

证据包与冷备份仅在本地保管，未上传。

## 位置微调

根据用户反馈，首页顶部留白由桌面的 6dvh 改为 14dvh（56–160px），手机由 30px 改为 7dvh（40–64px）。仅调整两处 CSS，重建应用与固定后端产物通过；隔离已登录首页及 8854 实屏均已核对。测量视口 1164×818 的 Logo 顶部从约 49px 下移到 115px；390px 页面无横向溢出。正常重启后 715 项 HTTP 资产与候选一致，Proj 19 条历史及用量逐字节不变。

本次源码输入 SHA-256：`64eb318a8005314737107d13652300ab5304d2a77b52826c4d152358feba1b5e`。新归档 `60f71a0fdaf387579852ff96d6141242813ac1c62aa57cca4d3854055ce778ce`，manifest `a271859f0e206355f00dd23113dd1fa5d67809183060d8cbe36b882c4d0e50cf`，兼容要求不变。

补充本地证据包 `homepage-spacing-evidence.zip`，444,789 字节，SHA-256：`b8e9d4a228e22bdfd082a8dda79e7efbbd2c0e91163bfdfb88019a8c4d6eeb04`。先前记录继续对应各自固定候选。
