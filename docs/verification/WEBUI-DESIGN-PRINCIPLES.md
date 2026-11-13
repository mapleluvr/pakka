# WebUI 设计系统与开发原则：文档核对

日期：2026-11-13。对象为 `origin/dev@cc1cdd8aead42cd0afe018c75973f09fd369184d` 上的本项文档差异，工作分支 `pakka/webui-design-principles`。输入文档的精确 Git blobs 与 diff 在本地证据包内；本记录不代表运行时迁移或产品验收。

环境：Windows、PowerShell 7.6.9、Node 24.18.0、Prettier 3.6.2、OpenSpec CLI 1.9.0；使用已有工具，未安装产品依赖。

## 结果

| 核对                                            | 结果                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| 10 个官方仓库固定 commit 与所读 package 版本    | PASS；报告与采集记录对应，许可证按实际声明／文件区分                                |
| 当前 Pakka 入口、公开类型与操作身份             | PASS；逐项源码核对，当前 Preact 与推荐 React/Astryx 分开描述                        |
| 改动文档的本地链接／锚点、Prettier 与 diff 空白 | PASS                                                                                |
| 主动 LSP 文档检查                               | 17 个路径，无 error/warning；7 条既有信息级拼写提示保留，均为项目名称或原源码标识符 |
| OpenSpec 严格校验与文档归档                     | PASS；`skip_specs: true`，零产品 delta，归档未改主 specs                            |
| 完整产物／范围核对                              | PASS；只修改文档与 agent 开发说明，源码、依赖、资产、公共 exports 和测试未变        |

本次没有新增或移除产品测试，未选用产品 build、package smoke、实际 React/Astryx 浏览器接入、Pi／模型矩阵或独立／subagent review。上游无障碍与性能主张不是 Pakka 的实测结论。

## 本地证据

- 包：`webui-design-principles-2026-11-13-053042.tar.gz`
- 字节：`284006`
- SHA-256：`af4a628c9f3e87e244a48451c60fcfb6e96f5836f0bda4bfaf5b54933bb67769`
- 保全目录：`D:/Projects/pakka-works/.backups/2026-11-13-053042-webui-design-principles`，提供恢复 README，限制当前用户与 SYSTEM 访问。
- 归档已列出、解压并逐项核对包内 manifest；源码为固定 commit 的文本采集，采集器的换行归一规则随包保存。

原始材料及证据包不上 GitHub。本摘要在计算包 hash 后补写，不纳入包的输入文档，避免自引用；之后复查本摘要的链接与格式。设计建议及后续试用边界见[变更记录](../changes/webui-design-principles.md)。
