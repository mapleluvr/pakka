# 整改已核实的对象发布与交付问题

## Why

2026-11-12 全仓问题收集核实了 Book 引用连带授权、完成/HTTP/RSI/历史读取的异步最终发布遗漏，以及 EI 原始证据仍在正式树的问题。用户批准立即整改，明确暂缓 MAS Board 容量适配。

## What Changes

- Dynamite 分开 Book 自身与真正回源，保持独立产物和固定索引；保存来源键的有界摘要与空快照。
- Memo、HTTP、RSI、Agent 和 Historian 各自在实际发布层重验自身对象或调用权；提交后失权保留 unknown、原效果与核对身份。
- Memo 完成结果提供同服务、原结果绑定的同步发布校验供实际消费者使用，不向 MAS 注入馆员模型。
- EI 文档独立保全原始字节并精简正式记录；产品源码不变。

## Impact

既有公开事务、issuer、invocation 和执行身份能力足够；不新增 Dynamite 的 Memo 专属接口，不改数据库所有权、MAS 消息容量或 Historian 执行机制。独立故障回归进入相应影响域，RSI 复用已有 fixture，原始证据只本地保全。详见[形成记录](../../../docs/changes/reviewed-publication.md)。
