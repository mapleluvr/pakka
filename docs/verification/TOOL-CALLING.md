# Tool Calling 与共享图标验证

2026-11-28，Windows / Node 24.15.0。WebUI 基线 `847521e` 加本地 Tool Calling、既有浮窗及 Thinking 菜单改动；Pakka 基线 `e475795` 加配对前端和 SDK 归档。服务契约仍为 services 6 / workbench 3 / extensions 3。

应用归档 SHA-256：`c29244d6531bb5e5440b36787bb3f026b73a529fbb2a94c1b958e0170cc8b342`；manifest：`8d8fbf398457b19dffa37e6e4351fa43e9b6925a03ad3b7ffaa8a752a2b449a5`，716 项资产。138 项源码输入清单摘要：`52e839cea9be445b32b3bd5ee1d7500d8757e390a0fc52c0eaac5327dd063728`。SDK 归档 SHA-256：`48b6768eef31747adbdf9fcc6fed6b2516d2225f188c8f6a50eed2cf1b73b5bc`。

两仓类型检查、标准构建、WebUI 打包、9 项已有阅读与错误回归、改动文件格式检查通过。主动 TypeScript LSP 检查覆盖 11 个相关 TS/TSX 文件，无错误或警告。独立 SDK 安装消费渲染全部 15 个 SVG，示例 extension 类型检查与打包通过；浏览器通过 import map 成功导入公开入口。

安装态浏览器检查覆盖：调用目录、逐次详情、运行转完成后保留手动展开、参数/输出分区、codemode 结果及脚本展开、长原文搜索、重复工具错误 ×2 后逐条查看。桌面与 390px/320px 无横向溢出；手机操作命中区 44×44px。隔离服务使用本地确定性 provider，共 5 次请求；文件读取和修改发生在隔离目录，codemode 多段输出使用受控 fixture。组件渲染探针另覆盖实际记录形状的耗时、Console、图片、失败和空 Thinking，不据此宣称真实模型质量或内部子调用执行已验收。

8854 正常停止、writer 释放后沿用原目录重开，716 项线上资产与候选一致，浏览器公开图标模块可用。原浏览器已处于退出登录状态，本轮未签发或撤销凭据；登录后的交互在独立主机 `localhost:8868` 的同一归档验收。未向 8854 发送模型消息。探针过程中纠正了元素定位和原文搜索游标假设，无产品修订。

完整本地证据：`tool-calling-evidence.zip`，363860 字节，SHA-256 `5c5c03e192ddb234ffc3df519dd01a7c623d0fc108cfcb33f4329500dedfc9c8`。证据包仅本地保存，不提交或上传。
