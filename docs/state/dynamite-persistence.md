# Dynamite 持久化

本页声明 Dynamite 工作、结果与产物的预期持久状态。事务与恢复细则映射到 [dynamite-persistence delta](../../openspec/changes/adopt-dynamite-sqlite-persistence/specs/dynamite-persistence/spec.md)。

## 存储与身份

业务 Session 和长期 Compresser Session 使用 SQLite；每个存储域有独立的身份、schema、提交序列和 writer。SQLite 文件以 WAL/FULL 策略提交。宿主集中负责打开、关闭、授权和结果确认，Pi mutable objects 保持在 durable adapter 内。

## 工作与结果

工作计划固定 jobId、planId、来源及指纹、窗口、模型序列和配置版本。attempt 保存预算预占、dispatch、结果身份与 usage 状态。checkpoint 保存当前阶段、已存结果、采纳版本和终结原因。

每条 Compressor Conversation 有自己的 incidents、计数、lastError 和 seal。原文窗口并行生成；产物提交依据当前版本分配独立的 run/block 身份。

## 产物与提交

P1 为 block 的正文；同版 bundle 保存 P2 图、图内 P3 注释、P4 定位线索及来源、校验范围。业务域的产物、精确 adoption receipt 和 checkpoint 原子提交，提交确认后发布可消费结果。

业务 Session 与 Compresser 通过稳定的 job/attempt/submission/result 身份衔接，各自保存确认事实。已封存结果支持本地续行；外部效果未知时保留原 attempt 和预算，等待核对。终结与 seal 在重开后持续有效。

## 读取

历史与产物使用地址、版本和 cursor 读取。运行时维护当前投影和活跃工作所需的冻结 DTO，持久历史独立保存。编号和来源证明使用所属 Conversation 的原始历史与有效投影；游标减少重复扫描，当前 frame 仍物化这部分历史。

采用来路与实施入口：[形成记录](../changes/dynamite-sqlite-persistence.md)。
