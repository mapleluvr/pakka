## Intent

说明具体问题、触发条件或目标，以及用户可见的结果。

## Mechanism

说明核心逻辑、状态流、结构或文档关系的变化；文件清单仅作补充。

## Verification

仅列实际检查的候选、环境、范围、结果、必要限制与本地完整证据包的整体 SHA-256；准确记录失败、受阻或未选用项。原始证据及证据包本地保留，不上传 GitHub；云端存储由用户处理。

## Artifact review

- [ ] 已审查暂存产物及相对实际 base 的完整 PR 文件清单、diff 规模和大文件。
- [ ] 未混入原始日志/TAP、截图、pack 逐文件清单、完整依赖树、重复中间证据、本地证据包或敏感数据；未 force-add 绕过。
- [ ] 验证目录仅含关键信息与证据包整体 hash；产品必需的 vendor/补丁/锁文件按其交付契约核对。

<!-- 日常工作 PR 的 base 为 dev。只有明确要求“PR 到 main”时，才创建 dev → main PR；届时将前两节改为“阶段概览”和“吸纳的 PR 清单”，每条列出 PR 链接 (#ID) 和一句语义说明，并保留 Verification。完整规则见 CONTRIBUTING.md 与 docs/development/GIT-WORKFLOW.md。 -->
