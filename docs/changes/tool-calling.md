# Tool Calling 与共享 SVG 图标

默认前端采用已确认的轻量调用目录：命令和路径成为调用行的主要信息，逐次展开参数与输出，codemode 先展示结果并可展开脚本。调用身份、原文读取和搜索继续使用原服务契约。

图标由独立 WebUI SDK 的 `@pakka/webui-sdk/icons` 提供。WebUI extension 可通过公开入口复用同一组 SVG；宿主固定前端的 import map 提供对应模块。名称与使用规则由独立 WebUI 的 UI-SDK 开发文档维护。

服务仍为 services 6 / workbench 3 / extensions 3。采用来源为用户确认的 Tool Calling 视觉稿与图标复用要求，属于[独立 WebUI](independent-webui.md)下的前端持续演进；相关任务见[阶段任务](../../openspec/changes/plan-independent-webui/tasks.md)，能力契约见[独立前端场景](../../openspec/changes/plan-independent-webui/specs/independent-webui/spec.md)。本次未新增服务协议或授权能力。
