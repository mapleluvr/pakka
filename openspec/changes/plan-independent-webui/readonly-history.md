# 原历史只读接缝

用户在阶段 1 两项缺口中授权先实施只读历史 SDK：独立 reader 生命周期、复用原生记录/分叉/字节档案、显式 schema 拒绝及真实安装消费。独立 facet 控制继续留在 3.2；完整 UI、Provider /login、默认切换、合并和公共发布不进入本轮。

## 采用的边界

Chord 提供真正 readOnly 的 Node SQLite 连接、短读事务与释放；Durable 提供只读 Conversation、EntryArchive 和必要的已存 document 物化。reader 返回对象没有写能力，也不创建 Harness、Registry 或 Models。原 writer 的初始化、迁移及恢复语义保持不变。

打开仅验证现存且受支持的 schema。缺文件、需要迁移、较新 schema、错误格式/损坏、忙和原身份不符分别失败；不创建或修复源库。close 不执行 checkpoint/truncate；取消读不取消原工作。只读连接可能参与 SQLite WAL 协调文件操作，零业务/恢复修改与零文件系统 I/O 不混称；不把变化中的源当 immutable。

同一次快照内的 ancestry、header、document record/base/delta 一致。快照在回调结束后释放，借出的读视图失效；跨请求按范围与 Entry/commitSeq 固定原文，不让浏览器持有长事务，也不承诺任意历史 seq 的 mutable 状态重建。长历史复用有界档案读取，不先全量加载后裁切。

## Pakka 接入

已知来源由可信后端定位。已加载对象走已有 owner；未加载对象可用原生 reader。Pakka 验证持久 Session/Conversation 身份和当前 read 权限、等待后重验，再输出 DTO/原文范围。浏览器不传任意 SQLite 路径，reader 不取得 writer 或注册替代 Runtime。未加载来源的保存状态不是实时执行状态。

原生 mutable 对象留在 durable-adapter.ts。既有 profile、permission、incarnation 相关标识逐项核对，不能把 archive 对象伪装成可执行 AgentRef；历史使用稳定 Session/Conversation 地址，执行仍必须取得当前合法 binding。

本轮公开消费只增加来源解析、有限历史页和原文范围。未加载来源由 adapter 每请求打开、短快照、关闭，不对外泄露 native reader。历史页的保存状态显式为 saved，不声称实时 busy；已加载来源沿原 owner 与现有受权预览/正文入口。复用既有 Entry JSON 索引、显示投影与字节解码，原生 data/configuration 不成为任意正文端点。保存的 Runtime 身份和原 Conversation 必须在同一快照中相符；等待与关闭之后仍复核来源和授权。未加载原 Session 是否已知由 confirmed registration 判定，不能因为旧列表未列出它就将特定资源权限错误地视为没有来源。

resource.resolve 的新只读结果形状与新增历史命令使用 WebUI service API 2；尚未合并的 API 1 客户端显式不兼容，成对更新固定客户端制品。不修改 workbench v2、extension v2 或 UI SDK/renderer 版本，也不增加旧 API 兼容层。

## 源与制品

继续从 Pi 1.4.0 commit 4a080252f06caf63a525d7873c5d94d3c23887e0 构造新下游版本，保留 .3 的 generation 与 EntryArchive 接缝。Chord 源改动作为同基线、同补丁的 SQLite-only 编译组件随 Durable 交付；公开 Chord 主运行时保持 1.4.0。公开探针确认两个完整 Chord 副本混用会丢失 Context 的取消信号，因此不嵌套第二个完整运行时，也不为此扩大升级全部 Pi cohort。源码条件解析到该 Chord 源模块，制品默认解析到随包编译的 SQLite 模块，Context/错误类仍由原公共依赖提供。不修改已安装依赖，不覆盖已有版本身份。构建锁、源码差异、配对依赖与归档 hash 一起固定；真实独立安装验证不得由 workspace alias 或根 overrides 代替。

## 验证选择

新增 SDK 回归只保护此次新增的持久性/一致性/能力边界：现存库只读生命周期；缺文件/不兼容 schema 无创建/迁移；残留 running/restarts 不改变；真实 WAL writer 并存且快照一致；fork 与原 Entry 范围；取消/失效视图/关闭。低层断言使用真实 SQLite 和公开 SDK，无 provider、用户配置或付费调用。

Pakka 增补原资源身份、跨 Session 同号隔离、无权/撤权/错源、长正文与读取不恢复工作的受权服务回归；已有写方/回执/恢复测试复用。新文件默认 heavy，完成分类后按 distinct risk 进入 affected/release；不新增 DOM/CSS/私有组件测试。主会话自查，不委派。

固定结果与未验证部分单列记录。原生 reader 或服务路径通过不等于阶段 2 的整页跨 Session 浏览已验收。
