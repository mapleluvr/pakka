# R2 的前端基准

用户要求采用 devin-ui-comparison 的前端主体，不是按其颜色给旧 Pakka WebUI 换皮。此图是此前独立运行 clean-room/current 获得的 1440×900、DPR 1 页面，来自 R1 归档的 reference-desktop.png，**不是 R1 产品候选**。

- Source: mapleluvr/devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current。
- 左侧 300px；右侧静谧主区；hero 外列 700px，输入卡片 688×154px；左侧原始导航行、sessions 和底部齿轮保留相同结构。
- 布局、颜色、圆角、留白和响应式行为以原始 styles.css 为准，生产 reference.css 采用该 commit 的 UTF-8 LF Git blob，原始字节 SHA-256 为 `084adce8bc6e1feab314b301f57ddac0bab5081cfa08d1c911addece9bdb9974`，由回归测试核验，并由 `.gitattributes` 与 `.prettierignore` 保护。此前 Windows 检出自动展开 CRLF 后的 `d9ded3…` 只是本机工作区身份，不是 Git blob 的跨平台身份。
- 账号、会话、模型、目录与页面入口换成实际 API 数据；未实现的 Ask、PR、套餐或仓库服务不伪造。删除对应元素会自然改变局部内容，不据此重排 shell。
- 首页 textarea 适配为真实创建入口，字符串明确是命名 Conversation；模型输入留到进入 Conversation 后由用户显式 Send。
- MAS 没有参考页面，不把旧 Board 当 oracle。新 Team 页面遵循单层页头、Graph / Activity / Agents、紧凑卡片、上下文 inspector 和同款 compact composer。

未掩码像素差异只能定位差异，不能自行判断这些真实数据适配是否符合用户意图。不能通过扩大 mask 来藏掉可绘制区域。
