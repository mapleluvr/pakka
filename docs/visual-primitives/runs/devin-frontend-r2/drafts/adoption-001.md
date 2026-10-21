# R2 接入草案：展开已先行记录的产品映射

本草案整理 [R2 设计案](../../../../plans/DEVIN-FRONTEND-ADOPTION-R2.md)的图像证据及检查点。它不是补写一场未发生的事前比较，也不将 R1 误迁移包装成正确起点。

## 基准与约束

- Oracle manifest: ../oracles/oracle-manifest.json
- 主体来自 clean-room/current 的 DOM 分层、CSS 和交互；保留后端的权限、身份、requestId、receipt 与 unknown 恢复。
- pocket.css、workbench.css、devin.css 不再进入生产页面样式链。
- Pakka 专属的认证、真实字段、消息、工具结果和扩展元素在 elements.css 中适配，不修改 reference.css。

## 元素与坐标

以下为 1440×900、DPR 1 的图像坐标，pixel / top-left / left-top-right-bottom：

| 元素            | 区域             | 作用                                                       |
| --------------- | ---------------- | ---------------------------------------------------------- |
| Sidebar         | 0,0,300,900      | 保留原始 header、nav、sessions、footer；绑定真实身份和资源 |
| Hero            | 520,322,1220,538 | 原始中心列，不塞回旧新建表单                               |
| Composer        | 526,374,1214,528 | 688×154，保留 notice、editor、toolbar 与 send-group        |
| Main background | 300,0,1440,900   | 保留参考背景和空间，不用旧 window/pane 容器                |

宽度核对：1214−526 = 688px；高度核对：528−374 = 154px。实际 DOM 几何另由浏览器断言保存，标注框不是测量真值的替代。

## 检查点

1. 参考 CSS 原始字节身份；真实生产 HTML 不加载旧三层覆盖。
2. 首页、真实 Send、palette 键盘、侧栏折叠与窄屏抽屉；等待实际 pointer hit，不能移除参考动画来迎合测试。
3. Appearance、配置／使用量／私有凭据、通知、人员都进入 settings-view 与 settings-rail。
4. Team 是新设计：单层页头和三视图；成员打开／返回保留选择；个人视图不启动模型；退休先确认。
5. 分别核对功能、视觉、安装消费者和独立 GUI；不以一种结果代替另一种。

## 差异解释

不设排除框。真实账号、动态会话、入口数量、提示文案、模型及缺失服务造成的差异需要直接判读，不能假装逐像素相同。MAS 的新设计不与首页 oracle 做假比较。
