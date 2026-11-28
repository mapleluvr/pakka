# Pi Durable 1.4.0-pakka.3

## 固定输入

本补丁在 Pi `1.4.0` / `4a080252f06caf63a525d7873c5d94d3c23887e0` 上保留 generation block/check/settlement，并增加可选的公开字节档案读取接口。

- [baseline](baseline.json)固定上游、版本、源码回归与独立安装消费者范围。
- [source.patch](source.patch)是完整的下游源差异；[build-lock](build-lock.json)固定构建依赖。
- [artifact](artifact.json)固定上述输入和[可安装归档](../../../packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.3.tgz)的 SHA-256。

## 档案接口

支持该能力的 `Storage` 提供可选 `entryArchive`：

- `header(conversationId, id, context)` 返回原 Entry 的身份、head、commitSeq 和持久 JSON 的 UTF-8 字节数。
- `scan(query, limit, cursor, context)` 按原分叉可见范围分页读取小 header，不返回 model/data 正文。
- `read(conversationId, id, { offset, length, commitSeq }, context)` 返回原档案的连续字节；单次范围最多 64 KiB，并校验不可变提交身份。

这些接口与既有 Entry 读取遵守同一分叉来源范围，但属于可信存储能力，不替代应用 ACL。Pakka 在适配器内持有原生对象，并在每次预览/详情读取及等待后检查原 Session、Conversation、来源、正文版本和有效 read 权限。

范围位置是持久 JSON 编码后的 UTF-8 字节位置，不是解码后正文的字符位置。消费者重建正文时必须处理 JSON 转义和跨块 Unicode，不把解码字符串长度用作下一个档案偏移。

SQLite 在 JavaScript 中维护最多 32 MiB 的编码字节 LRU 和有界 header 缓存，串行取得一个额外行；更大的记录继续使用范围读取。它不为这些接口全量解码完整 JSON。单条记录的后端原生编码/查询临时工作仍可能依赖该记录大小，因此此预算不表示所有后端工作都仅为 64 KiB。

既有 `entry`/`scanEntries`、Conversation/context、generation 和持久回执语义保持原接口。未提供 `entryArchive` 的后端继续使用自己的完整接口；需要有界档案读取的宿主应明确检查能力，不能以全量读取后裁剪冒充该能力。

## 重建与校验

从 Pakka 仓库根目录运行，显式指定 HEAD 与 baseline 相符的上游 checkout：

```powershell
npm run build:durable-patch -- /absolute/pi-checkout 1.4.0-pakka.3
node scripts/verify-durable-patch.mjs
```

构建脚本在独立 staging 应用补丁，按锁文件安装、编译、运行 baseline 所列源码测试，再在独立安装项目运行公开消费者。原上游 checkout 和已安装依赖保持各自内容，不手工修改 `node_modules`。

生产选择、完整构建流程与行为契约见[补丁 state](../../../docs/state/durable-patch.md)；固定版本的检查结果与原始证据由[兼容性账本](../../../docs/PI-DURABLE-COMPATIBILITY.md)及其关联验证记录承接。
