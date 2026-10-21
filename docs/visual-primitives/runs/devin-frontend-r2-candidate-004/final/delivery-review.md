# Devin 前端 R2：候选 004 交付复核

## 状态

**候选可评审，完整验收未通过；未推送、未合并 main。** 产品提交 `6d359b13d1b81c29f47495d303c1ed6afe4d0bb2`，固定运行前后干净。证据／指南提交仅更新文档与产物，不改变产品代码。

- 类型、JS 语法、构建：PASS。
- 扩大：121 pass / 3 fail / 1 cancelled / 0 skipped。
- 全量：542 pass / 5 fail / 6 cancelled / 2 skipped。
- 安装：真实产品、Team、workflows 等通过；Project browser 的 exit=null 阻塞整套；同安装副本之后五项独立补测 5/5 pass。
- 指定独立 GUI 与双边审查：BLOCKED，不以本机截图替代。

详细失败身份、基线范围、安装包 SHA-256 与复跑命令见 [R2 验证记录](../../../../verification/DEVIN-FRONTEND-R2.md)。

## 直接检查与判读

本轮实际打开桌面／手机首页、Team、Commands、Extensions，以及注释图、同坐标卡片裁剪、热图和面积前五个 component 的点裁剪。完整观察与保留边界见 [verdict](../verdict/inline-verdict-003.md)，不是只读脚本计数。

[差图 summary](../diffs/home-desktop/summary.json)对 1440×900 全图计分，无排除框；mean 0.007233，自动状态保持 feedback-required。不换算“相似率”。账号、真实导航、命名 Conversation、Sessions 和删除无后端服务构成主要差异；没有为分数恢复演示入口。没有 Team oracle，不伪造等价比较。

本机直接检查没发现新的 fix-now 布局项，但不能宣布用户已认可全部适配或独立验收完成。此前 Extensions card/row 和这次 Team 样式门禁均已保留。

## 当前图像

- [桌面首页](../rendered/home-desktop.png)／[360px 首页](../rendered/home-360.png)
- [桌面 Team](../rendered/team-desktop.png)／[手机 Team inspector](../rendered/team-mobile.png)
- [手机 Commands](../rendered/commands-360.png)／[手机 Extensions](../rendered/extensions-360.png)
- [带坐标图](../annots/rendered-layout.png)／[全图热图](../diffs/home-desktop/diff.heatmap.png)
- [捕获来源与截图哈希](../scripts/capture-manifest.json)／[DOM 几何](../scripts/home-desktop-geometry.json)

## 复跑差图

在仓库根目录，以实际安装的 visual-primitives skill 路径运行：

```powershell
node D:/Projects/PiAgent/plugins/pi-visual-primitives/skills/frontend-replication/scripts/run-masked-oracle-diff.mjs --manifest docs/visual-primitives/runs/devin-frontend-r2-candidate-004/scripts/diff-manifest.json
```

命令中的本机 skill 路径需由复核者按安装位置替换；原始 normalized manifest 保留运行时绝对路径，输入 PNG、相对 manifest 与矩阵均随分支归档。整组文件的 SHA-256 见 [files.json](../files.json)。

## 下一门禁

保持 Browser／清理／符号链接失败记录；补足进程停点证据，在指定 Linux desktop 和审查环境可用后执行独立验收。新验收出现具体视觉问题时再写反馈草案；不要通过删失败、加跳过或扩大 mask 获得“完成”。
