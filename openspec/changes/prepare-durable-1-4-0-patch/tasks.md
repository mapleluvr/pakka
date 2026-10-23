# Pi Durable 1.4.0 补丁任务

## 1. 来源与基线

- [x] 发布已有 main，并在独立 worktree/分支制备补丁。
- [x] 查询 registry latest 和 GitHub release，固定 tag、源码 commit 与 registry integrity。
- [x] 核对 1.4.0 公共 hook、checkpoint、恢复、provider 与配置变化。

## 2. 补丁与工具

- [x] 移植六项 generation/recovery 目标回归并观察原基线失败。
- [x] 用真实本地 HTTP 对照明确拒绝、payload 撤权与普通 hook throw。
- [x] 实现 1.4.0 源补丁、公开类型与文档，生成构建锁和 vendor 归档。
- [x] 扩展显式版本选择、JSONC 构建及独立安装消费者，默认仍指向生产版本。
- [x] 核对重复构建及旧版本重建身份，保留既有生产补丁与配对字节。
- [x] 通过干净新 cohort 的编译探针区分补丁消费与 Pakka 接入差异。

## 3. 文档与记录

- [x] 同步 optional verification 的 state、方法与 WebUI 选用条件。
- [x] 更新 Durable patch state、构建说明、兼容性账本及导航。
- [x] 检查本轮产物身份、代码/格式、引用及相关 OpenSpec。

本轮 verification 选择：未补丁/补丁 source 与本地 HTTP 对照、独立安装、重建身份、工具反例、当前生产集成、编译兼容探针和文档检查。其余开发验证本轮跳过，选择由此处一次记录承接。

## 4. 后续产品接入

- [x] 处理 StorageRejected 移除后的错误分类与 unknown 闭锁，明确 document checkpoint 策略；显式策略拒绝使用 adapter MutationDenied，其他存储错误保持 unknown。
- [x] 将任务的等待改为持久化 sleeping/timer checkpoint，迁移工具 output 契约；在真实调度、取消和重开回归中检查。
- [x] 更新生产 cohort、依赖锁与打包身份；本次选择新建 JSONL 存储，保留旧归档/配对字节，SQLite schema 2 的既有数据库迁移/回退须由单独方案和实测承接。

本次产品接入与 [Compresser 第一版试行](../../../docs/verification/COMPRESSER-SESSION-TRIAL.md)协调执行；新 cohort 的源码回归、受控错误、真实进程中断和外部安装均由该固定记录承接，不把旧版 SDK 测量改写为新版结果。
