# PR #4/#6 干净交付重组

## 范围与身份

操作者在合并 #7 后授权新建替代 PR，再清理远端旧分支；#5 留待后续。[PR #8 → dev](https://github.com/mapleluvr/pakka/pull/8)以 `2f84881ba21b5a464ab3f7f3f8017efcdc6bcf58` 为基线，功能提交为 `2d23aeafd2785138fbaf17e36405c46b9436a0dd`（长期投递与维护）和 `52146c2a7729c8c984476690e465cfd96b606d01`（有界观察）；不继承原证据提交链，不合并 dev/main。

原 #4 head `aa83eedecc92ec3d7b0f46010814344da721b0c6`、原 #6 head `37e13dd4e3d46a5971d22437fe1b1e08e46b16ba` 及原 #7 head `bda6df8697bb2b3929609a60030682d774846a83` 在本地 refs/worktrees 和独立 Git bundle 中保留。Git bundle 经独立 bare clone、全量 fsck 和逐 ref 核对。

## 本次实际检查

- Windows x64 / Node `24.15.0`。两个阶段分别核对原候选；最终 623 个产品、测试、脚本、补丁/构建锁及必要元数据的 Git blob/mode 与原 #6 完全一致。vendor、source.patch 和 build-lock 的实际文件 SHA-256 也匹配。
- 原 #6 的 189 个本轮原始证据文件、244,626 行新增不进入新 PR；保留摘要及本地完整包 hash。必要的 811,400 B vendor、1,145 行源码补丁及 4,628 行构建锁按产品交付核对，不作为日志删除。
- #7 规范/模板保持；逐项审查完整 staged 与实际 dev base diff、文件清单、numstat/stat、大文件及远端 PR 文件清单；新增原始证据为 0。
- 本轮编辑文件格式、全变更文档的有效本地引用/锚点，以及持久化、维护、观察和证据规范四项 OpenSpec strict 检查通过。账本中原 dev 的 M3/M4/M5 三条历史失链保持并单列，原账本前缀未改写。
- 本次选用重组覆盖、字节/归档、文档与远端身份检查；未重跑产品构建、893 项完整回归、安装或浏览器/模型矩阵。原检查仍按[持久化](LONG-LIVED-DELIVERIES.md)、[维护](LOCAL-MAINTENANCE-DELIVERY.md)、[观察](BOUNDED-LAZY-OBSERVATION.md)的固定身份解释，不倒写成新提交的实跑结果。

## 本地包

所有包及原始证据仅本地保留，不提交 Git、不上传 GitHub；云端由用户处理。位置：工作区 `.backups/2026-11-09-125732-pr4-pr6-reorganization/`，受限 ACL，恢复步骤在其 README。

| 包                                         |      字节 | 整体 SHA-256                                                       |
| ------------------------------------------ | --------: | ------------------------------------------------------------------ |
| `pr4-pr6-verification-evidence.zip`        | 1,257,613 | `15a4f9057e658d4c866ede588b3d535be697e0ee37050fdcb1a800863131562b` |
| `clean-delivery-reorganization-checks.zip` | 2,240,404 | `83b717ba36a692408b0d58fd9c7411623909754523871d4404178da15f6bb881` |

原证据包的 259 个条目全部打开并与原文件 SHA-256 比较；原文件字节与 Git 规范字节分别由证据包和 Git bundle 保留。早期因 `core.autocrlf` 改写换行的试包已拒绝，不用其 hash 代表最终保全。

本次检查包封存功能候选与文档关闭记录的审查输出，包内以实际快照身份为准。写入本表的包大小/hash 属于封存后的收据元数据；之后不改变产品字节，最终提交前再次核对覆盖及引用。原固定 release 归档、私密实验历史和数据库仍各自在原位置保全，不混入普通检查包。

## 远端关闭与保留

- #4/#6 已关闭并指向 #8；三个对应旧远端分支（包括已合并 #7 的 policy 分支）已删除并经实际远端 refs 核对。
- #5 保持 OPEN，`feat/rsi-ticket-layer` 保持 `cb6eea9dbe284b78c302476f435e4b4663d631da`；其他远端 heads 未变，原本地工作树/分支未删除。
- #8 未自动合并。删除远端分支不代表 GitHub 历史对象与旧 PR 中曾上传的证据已被彻底擦除，也没有执行强推或历史改写。
