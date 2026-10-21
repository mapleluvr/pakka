# 预期状态

这些文档描述 Pakka 应当形成的产物、条件和边界。实现是否达到预期另见[实施状态](../PAKKA-POCKET-STATUS.md)，采用经过另见[变更记录](../changes/README.md)。

## 按产物关系阅读

| 主题                               | 本目录的职责                                 | 详细契约的维护位置                                                                                               |
| ---------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [产品与范围](product.md)           | 产品组成、用户目标、排除项与支持边界         | 本页所链接的领域契约                                                                                             |
| [Runtime 与 authority](runtime.md) | 模块依赖、身份、调度、持久化关系             | [架构契约](../development/ARCHITECTURE.md)、[公开 API](../reference/README.md)、OpenSpec 领域场景                |
| [MAS](mas.md)                      | 成员、通信、观测及界面贡献的关系             | MAS/Broker/DevPack API 与映射的 OpenSpec 场景                                                                    |
| [WebUI 服务与扩展](webui.md)       | 人类权限、协作、受控服务、可选 facets        | [WebUI 开发契约](../development/WEBUI-DEVELOPMENT.md)及其领域场景                                                |
| [前端交互](frontend.md)            | Devin 主体、页面结构、Team、响应式和加载条件 | [Devin 场景](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)；公开接口仍在开发契约/API |
| [交付与验证](delivery.md)          | 产物身份、证据要求和门禁关系                 | [验证方法](../development/VERIFICATION.md)、WebUI 开发契约第 9/10 节                                             |

## 与已有规范的分工

- `docs/state/` 是整体预期入口，并承载产品范围和前端交互声明。API 字段、权限和细粒度场景沿用上表指向的位置，不建立另一套同名定义。
- `openspec/specs/` 保留核心领域规范；已采用的 WebUI、facet 和关系观测补充仍在相应活动 change 的 `specs/`，各领域页列出具体映射。活动目录中的 proposal、design 和 tasks 是形成材料与工作记录，不能整体视为当前规格。
- 修改跨模块关系时更新对应 state 页；修改 API/场景时更新其细则及引用。若两者不一致，先核对有效要求和采用依据，再修订受影响位置，不按代码、文件日期或 checkbox 自动选一方覆盖另一方。
- 计划、设计旧稿和候选报告不新增隐含要求，也不取消未实现的既有要求。未定解释留在本地计划；获得采用的补充同步进入声明、完整 OpenSpec change、changes 引用摘要和工作安排。

## 继续工作

读取[工作入口](../OVERVIEW.md)、相关领域页及本地 active-plan。进行实现和验证后更新实施状态；只有预期形成或调整时才增加变更记录。具体维护方法见[文档维护](../development/README.md#文档维护)。
