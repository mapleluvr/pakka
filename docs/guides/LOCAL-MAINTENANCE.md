# 本机恢复、备份与升级

本指南针对 `pakka` 启动器管理的原工作区。命令在本机执行，需要原数据的文件权限；它们不是远程管理员接口。维护前正常停止相关 Pakka 进程及外部数据写入。活跃 writer 不会被强制抢占。

`PAKKA_HOME` 选择原产品定位，默认 `~/.pakka`。命令先预览；只有传入原 Session ID 的 `--confirm` 才执行变更。定位不完整时可以明确 `--data-dir <原目录>`，不能以猜测的新目录代替。可信宿主模块不会因维护命令被执行。

## 恢复登录

PowerShell 示例：

```powershell
$target = pakka recover login | ConvertFrom-Json
$issued = pakka recover login --confirm $target.sessionId | ConvertFrom-Json
pakka --login-file $issued.file
```

启动器为实际监听地址生成私密浏览器链接并打开浏览器；加 `--no-open` 可只交付文件。令牌不通过终端、shell 参数或通用日志交付。文件与备份需要按凭据资料保护。

凭据 10 分钟有效、只能兑换一次。发行撤销原 owner 的旧登录，但不变更其余人员角色或业务历史。过期后明确新发行；同 recovery ID 只核对原结果，不续期。

需要在失败后精确核对时，先指定并记下操作 ID：

```powershell
$id = [guid]::NewGuid().ToString()
pakka recover login --confirm $target.sessionId --recovery-id $id
# 响应或文件交付不确定：仍使用上面的原 ID
pakka recover login --confirm $target.sessionId --recovery-id $id
```

预备凭据、认证回执与发布文件分阶段核对；未确认结果时不要直接换 ID 重做。

## 异常退出后的占用

```text
pakka recover writer
pakka recover writer --confirm <原控制 Session ID>
pakka --recover
```

writer 是某份 Session 数据库的独占写入者，不是 Agent 角色。`--session <子 Session ID>` 选择已登记/声明的目标；以实际预览结果为准。确认只处理该原 claim，其他已退出域可分别核对。活跃进程、无法确认进程或身份变化都会拒绝。

`pakka --recover` 只重开原存储，不能替代上述占用核对，也不重放未确认的工作。

## 冷备份

```text
pakka backup --out <新的私密备份目录>
pakka backup --out <同一目录> --confirm <原 Session ID>
pakka backup --from <已发布备份目录>
```

目标必须不存在且位于所有纳管存储根之外，不覆盖/合并已有目录。失败的 `.partial` 材料保留待查，不算成功备份。

备份包括控制 Session、登记的子 Session、根内服务存储与纳管文件。独立 broker/Compresser 等存储根须由可信宿主在 `dataDir/maintenance-stores.json` 声明：

```json
{ "schema": 1, "roots": ["/absolute/other-owned-storage-root"] }
```

各根不能重叠，声明域须存在并可核对。应在停服前由宿主保存声明，不能把未声明的外部服务默认为已备份。外部项目 cwd、Pi 的 models/auth 配置及宿主模块由清单注明在范围外，需要另行一致保全。启动定位 `PAKKA_HOME/launch.json`、`maintenance-target.json`（存在时）及外部宿主配置也须另行保全；本入口依赖原产品定位，不提供整个 `PAKKA_HOME` 丢失后的自动重建。

`manifest.json` 记录程序/格式身份与纳管域，`files.jsonl` 逐文件记录大小与 SHA-256。源数据库按 SQLite 一致快照复制，文件流式处理。正常备份不包含临时 writer claim；已有文件校验通过后才发布最终目录。哈希只能核对字节，不能证明来源可信；首版不提供备份加密。

## 原位置恢复

```text
pakka restore --from <备份目录>
pakka restore --from <同一备份目录> --confirm <原 Session ID>
```

流程为：验证备份 → 原样保全当前数据 → 隔离验证 → 按原操作日志发布 → 保持停机。

当前数据库损坏或缺失时仍可恢复已验证备份。保全副本明确标注为原始字节资料，不冒充健康备份；原目录的停写状态仍须可确认。原 Session/Conversation 身份不变。跨机器搬迁或改变存储位置不属于此入口。

发生发布中断时，重跑原 `restore --from` 命令；不要删除门禁、临时目录或操作记录。普通启动在目录缺失窗口也会拒绝，不会补建空工作区。

恢复撤销备份中的旧登录和待兑换邀请。先重新发行登录凭据，再查看执行恢复预览：

```text
pakka recover login --confirm <原 Session ID>
pakka restore --resume <restore ID>
```

预览给出各域未完成任务/输入数量、有限样本及工作集指纹。必须先独立核对备份之后可能已经发生的外部效果。没有待处理工作时，显式确认即可：

```text
pakka restore --resume <restore ID> --confirm <原 Session ID>
```

若有未完成工作，再带上刚预览的精确指纹：

```text
pakka restore --resume <restore ID> --confirm <原 Session ID> --review-work <精确指纹>
pakka --login-file <刚发行的私密 credential.json>
```

确认记录被持久保存，工作集变化时拒绝旧指纹。解除停机不等于重置原生任务、补发旧请求或证明未知效果不存在。样本截断时需继续独立检查相关任务及外部系统，不能把截断当作已完整核对。

## 固定版本升级与回退

可信构建方先完成标准构建，再运行 `npm run pack:release -- <新的发行目录>` 生成 8 个 Pakka 包及 `release.json`；发行清单固定各包版本、长度、哈希和维护协议。操作者须独立确认来源，不能仅因哈希匹配就信任陌生程序。

```text
pakka upgrade --to <本地 release.json>
pakka upgrade --to <同一 release.json> --confirm <原 Session ID>
```

升级校验归档、在独立版本目录按标准 npm 安装且禁用安装脚本，保留安装锁文件；依赖可从正常配置的 registry/cache 获取。不会接受 `latest` 或更新当前依赖树。

在冷备份和候选离线健康检查通过后，`PAKKA_HOME/active-release.json` 选择固定入口；之后原 `pakka` 命令转交给该入口。升级失败不等于数据已回滚，按原 release ID 核对操作记录。离线检查不运行模型、工具、任务或可信宿主模块；它不保证任意旧格式的迁移兼容。

```text
pakka upgrade --rollback <原 release ID>
pakka upgrade --rollback <原 release ID> --confirm <原 Session ID>
```

回退先保全升级后的数据，再恢复该升级自己的备份与先前程序选择，随后进入恢复停机流程。需重新登录并显式核对执行。重复已完成回退只查询原回执，不再覆盖之后的新工作。旧备份、原归档、保全目录与操作日志不会被自动删除。

## 故障处理边界

- writer、权限、身份或字节校验不明时停止，不使用强制清锁或新数据库继续。
- 凭据发行中断按原 recovery ID 核对；恢复/升级发布中断按原操作续完。
- 可独立核对的死亡 login/backup 维护门有 `pakka recover maintenance` 预览，确认值是该门的 nonce，不是 Session ID。restore/upgrade 的门只能由原操作核对，不接受通用清除。
- 不跟随检测到的 symlink/junction 递归复制；Windows ACL 和 POSIX 私密权限都属于交付检查。
- 数据恢复与外部效果恢复分开：备份不是撤销已发送邮件、文件修改或第三方请求的机制。

预期与 API 见[维护声明](../state/local-maintenance.md)、[Runtime API](../reference/RUNTIME-API.md#离线存储维护)。固定候选的检查范围由验证记录描述，不把同版本演练外推为任意版本升级保证。
