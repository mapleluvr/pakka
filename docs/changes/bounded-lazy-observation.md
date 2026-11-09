# 有界观察与 DOM 懒加载

操作者在长历史、333 ms 与工具高频输出对照后采用预览、按需完整阅读、可选全取、空闲预算补取和 DOM 懒加载/虚拟窗口，并要求先实施再细节调优。

原对照在 `aa83eed` 上发现：冷打开保留完整历史与上下文；返回分页前先建立全文 native watch；多观察反复传相同快照；折叠工具仍创建正文/图片。独立样机显示先全读后截断只减少带宽与页面工作，直接读摘要/变化项才减少读取投影 CPU。它们构成本轮实施依据，不是优化后产品结果或容量承诺。

## 形成与实施入口

- [proposal](../../openspec/changes/add-bounded-lazy-observation/proposal.md)
- [design](../../openspec/changes/add-bounded-lazy-observation/design.md)
- [tasks](../../openspec/changes/add-bounded-lazy-observation/tasks.md)
- [Conversation Runtime delta](../../openspec/changes/add-bounded-lazy-observation/specs/conversation-runtime/spec.md)
- [Authenticated Apps delta](../../openspec/changes/add-bounded-lazy-observation/specs/authenticated-mas-apps/spec.md)
- [Frontend delta](../../openspec/changes/add-bounded-lazy-observation/specs/devin-frontend/spec.md)

## 呈现范围校准

后续真实 ego LiveDoc 检查发现，归档摘要没有覆盖实时大参数/错误，且遗漏计数未透传；补上实时投影预算并保留源遗漏后，展开操作又暴露了预览被误称为完整原文的问题。用存在于 native source、在预览中不存在的字面量做负向搜索，确认这不是原文真的缺失。于是明确：无原文引用时复制/搜索仅作用于预览，不据此确认全文不存在；发布后的原文能力仍绑定固定内容身份与权限。失败、修正和各候选身份分别保留在交付检查中。

## 预期与现有领域

[观察与完整内容 state](../state/conversation-observation.md)维护读取/展示/缓存预期；与[Runtime](../state/runtime.md)、[前端](../state/frontend.md)、[Conversation Runtime 主 spec](../../openspec/specs/conversation-runtime/spec.md)、[Authenticated Apps 主 spec](../../openspec/specs/authenticated-mas-apps/spec.md)共同保持身份、权限与持久化语义。前端详细主张也与[Devin 采用 delta](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)关联。

本轮分支从成功 fetch 的 dev 创建，承接未合 PR #4 的固定基线；PR #4 的长期投递和本机维护未被重新定义或更改固定证据。固定候选的源码、SDK、真实浏览器及仓库外安装结果见[交付检查](../verification/BOUNDED-LAZY-OBSERVATION.md)。实施与分支交付由 tasks 接续；worker/OOM 隔离和全局活跃实例预算仍保留为单独工作。
