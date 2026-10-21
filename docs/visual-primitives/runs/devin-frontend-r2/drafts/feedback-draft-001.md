# R2 反馈草案 001：完成扩展管理的元素级接入

## 来源

保留 `adoption-001.md` 的全部已确认事实；读取 `../oracles/oracle-manifest.json`、`../verdict/inline-verdict-001.md` 及其中的固定提交图片。Extensions 没有新的上游页面 oracle；它必须使用既有 Settings 的 card/row 组件，而非伪造新参考图。

## 保留

参考的 300px 侧栏、688×154 首页卡片、原始 CSS 的 Git-blob 身份、真实 API 状态、权限、requestId/receipt/unknown 恢复都不改变；Team 的 Graph/Activity/Agents 与 contextual inspector 也不改变。

## 本轮目标

- Extensions 注册项：360px 图 x=12–230/y=185–300，状态与操作当前挤在裸文本流内。将每项接入 `.settings-card-row`，外层使用 `.settings-card`；让标题、状态和动作组互不挤压。
- 操作目标最小高 28px，按钮间至少 8px；窄屏必要时整组换行，不出现横向滚动。已有 Settings native 按钮规则可以复用，不能加一套旧布局覆盖。
- 浏览器回归先在旧图对应实现失败，再验证桌面与手机按钮矩形、间距、卡片、焦点返回以及零新增模型请求。直接检查新截图，不能仅用几何断言宣布视觉通过。

## 排除与验证边界

不新增排除框。指定独立 GUI 与 masked-diff 工具不可用仍保持 BLOCKED；本轮回归和直接检查只是本机确定性证据。

## 执行路线

inline-replication。仅改扩展注册行的元素 class/分组和必要的原生元素 CSS。保留所有控制回调及身份判断；同时把安装消费者的旧入口迁移到真实新入口，再固定下一源码候选重跑。
