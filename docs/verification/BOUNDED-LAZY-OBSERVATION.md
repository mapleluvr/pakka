# 有界观察与懒加载交付检查

## 固定候选

- 原 PR #6 产品候选：`95e7bdea4c64362be7cc94affd6fb53321ad2d1c`；原保存 head `37e13dd4e3d46a5971d22437fe1b1e08e46b16ba`，承接原 #4 的 `aa83eed`。
- C8 冻结源码共 600 文件，SHA-256 `9d4a86314df2238a7d63421293b89d98654179f249549847dceb246720481bbc`；该身份在全量及安装检查前后相同，不倒写为重组后的提交。
- Windows x64 / Node `24.15.0`；Pi AI/Chord/Telemetry `1.4.0`、Durable `1.4.0-pakka.3`。ego lite `0.6.2.8`；[原生补丁与产物](../../patches/pi-durable/1.4.0-pakka.3/README.md)保留各自构建锁与归档身份。

## 实际结果

- C8 build/check 通过；完整回归 **893 项：891 通过、0 失败、2 项原有平台跳过**；八个归档的 **34 步仓库外安装消费全部通过**。
- 原生 SDK 183 项及独立安装消费者 6 项通过；覆盖 header/range、Unicode、分叉范围、版本拒绝与字节缓存，旧完整 SDK/回执语义保持。
- 普通根/子启动冷浏览、权限与撤权、333 ms 增量/共享观察、全文范围/下载、图片、正文搜索、虚拟窗口、焦点回收及运行态工具交接均有实际回归。
- 原 345.6 MB Pi session 只读导入 7,276 条分支记录；两份独立原图 Session 冷打开约 131 ms、GC 后 heap 27.59 MB。
- 原图连续翻阅 14 页，最多 24 条虚拟行 / 733 DOM；折叠正文及图片节点为 0。原文及 1,958,156 B 原图下载与独立只读来源哈希相符。
- 四个真实页面共用 1 SSE，30 秒空闲 SSE 13 B、约 2.02% 单核 CPU；通知小 RPC 另计，不是所有 HTTP 的总流量或容量认证。
- 实时约 768 KiB 参数仅形成 1,043 B 观察快照；复制/搜索标明 preview-only，不授予未发布原文下载；收起释放正文节点。
- 原长历史与实时 ego 服务均正常关闭，writer 释放，模型请求为 0。显式准备完整 execution frame 后 heap 约 717.55 MB：本结果不代表执行上下文、全局 Runtime 预算或 OOM 隔离已经有界。

C4/C6/C7 的原结果与失败分别保留。C6 的约 302 秒测试输入经真实键盘替换修正；C7 两项强制绑定 `4045` 的 EACCES 经控制首次报告地址消除宿主依赖，真实监听/关闭/重绑/HTTP 及原断言保持。手写虚拟列表、默认 lazy 装配遗漏、预览原文权限文案及 Node 原生异常的原始过程亦留在本地包，不改称首次全部通过。

## 本地保全与边界

原始日志、TAP、逐文件源码/归档身份、脱敏 ego 摘要及原报告：`pr4-pr6-verification-evidence.zip`，1,257,613 B，整体 SHA-256 `15a4f9057e658d4c866ede588b3d535be697e0ee37050fdcb1a800863131562b`。259 个条目全部打开并与原 #4/#6 文件字节核对；原始证据及包不上 GitHub，云端由用户处理。私密历史正文、图片、数据库及凭据仍在原受限本地实验目录，与普通证据包分开。

C8 改动源码格式、22 个 Markdown 范围、278 个本地链接/17 锚点及所属 OpenSpec strict 检查通过；超范围适配器由完整 TypeScript 检查覆盖，不宣称全仓诊断为零。本文保存原检查，不把重组描述为重新运行这套矩阵。

契约见[观察 state](../state/conversation-observation.md)，使用见[WebUI 指南](../guides/WEBUI-GUIDE.md)，资源后续见[所属 tasks](../../openspec/changes/add-local-maintenance-and-delivery/tasks.md#near-term-resource-pressure)。
