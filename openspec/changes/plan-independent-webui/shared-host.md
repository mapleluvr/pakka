# 共用产品宿主与跨宿主材料验收计划

依据 Pakka #16、WebUI #2 与 Adversarial Review 661bdfec。两仓阶段 4 以未提交工作树继续。语音、外观、固定制品安装和 worker 替换仍由阶段 4 清单跟踪。

## 工作分野

| 负责会话 | 唯一写入范围 | 交付 |
| --- | --- | --- |
| 01a1d2fb | Pakka independent-webui-seams、pakka-webui、共享验收样例 | HTTP 接口与恢复、计划管理、浏览器导航与输入、隔离宿主、发布材料及第一份消费证据 |
| 01a1eddb | pakka-tui | connected CLI、独立登录、真实终端接续与断开、本机 owner 消费同一材料的证据 |

## 对接与顺序

1. **同一宿主。** 显式启动一个 Pakka，workbench 2 / services 4。终端以指向既有 Person 的一次性凭据兑换独立登录。RPC 客户端接受实例级 `fetch`，由终端维护同源 Cookie 与 CSRF。两端用 Session 和 Conversation 身份解析到原 writer。登录材料交给本机私有文件，证据只登记资源身份、计数与结果。
2. **输入及模型。** 发起端发送前保留完整 target、requestId、text、mode。第二端使用当前 ref 读取 input.history、模型候选及配置。第一笔输入完成后，第二端调整模型。原端通过 input.lookup 查旧绑定的原请求，服务在当前权限下核对原意。另验处理期间退出一端、旧 ref 新输入被拒、另一 Person 及撤权。以真实模型请求次数和两端看到的原记录验收。
3. **已登记计划。** 当前有权者从原 Conversation 找回旧运行绑定登记的计划与 job，能取消仍等待的计划。投递按登记时的运行引用复查。分别记录取消意图、任务终态与输入回执。新增 follow 调度需另有实际需求。
4. **WebUI #2。** 日常按可见标题浏览，当前加载清单的范围明确。高级定位按稳定身份受权读取。发送消息、调整当前工作和本轮后执行沿原生三种输入，输入回执和队列使用同一套用户可见用语。用固定前端和受控模型分别核对手机操作、丢响应及后台继续。
5. **跨宿主。** 作者通过现有 Git 发布一次 checklist，交接 commit、仓内路径、内容 SHA-256 及本次允许的用途。第一 owner 与本机 TUI owner 在不同隔离根独立取得修订，记录实际进入模型的输入或读取的内容。用同名异内容、同内容异修订与未获准来源区分内容和出处。观察到长期绑定或共同发现需求后再评估材料服务。

## 实施记录

| 交付 | 固定入口与观察 |
| --- | --- |
| 共享宿主 | 两个登录属于同一 Person。真实 Windows ConPTY 与浏览器打开同一原 Session 的 Conversation 14。终端将模型由 `shared/main` 改为 `shared/alternate`，浏览器重开读到新值，下一笔真实 Provider 请求使用 `alternate`。终端注销后浏览器仍能受权读取原记录。 |
| 输入恢复 | 第一笔浏览器响应在接纳后被切断。Provider 在等待验收脚本时超时，终端和浏览器都读到相同 `unanswered` 回执。第二笔 `placed` 后浏览器离开，再释放 Provider 完成工作，终端和 390px 浏览器都读到相同 `done` 回执。每笔各一次模型请求，发起端各一次原请求查询。另有真实 HTTP 回归覆盖 `done` 后换模型、重开 Session、旧绑定新写被拒与撤权。 |
| 已登记计划 | 当前绑定能发现旧计划并取消原 job。创建者可查看逐次投递。原生反例在换绑前实际投递两次，换绑后读到两个不同的 `done` 回执。外层扩展 HTTP 路径覆盖到期投递与他人读取被拒。真实浏览器从换绑后的原对话打开「定时输入 → 查看逐次投递」，看到配置已变更提示与两条已完成记录。两条回执 ID 分别与服务记录一致，读取后 Provider 请求总数仍为二。页面证据在本机 `verification/shared-host/schedule-screen.json`。 |
| WebUI #2 | 独立工作树 `pakka-webui-wt/input-actions` 从远端 `f1275d8` 提交 `615005d`。固定 services API 3 后端装载其制品。实测 390px 标题筛选、高级定位默认折叠以及三种中文操作对应的 wire mode。独立分支的固定结果见该仓 `docs/verification/INPUT-ACTIONS.md`。 |
| 跨宿主材料 | Pakka 在独立临时根加载 Git 修订 `3dc4505:prompts/review.md`。只读 profile 通过真实工具读取正文，Provider 第二次请求的工具结果 SHA-256 与发布字节一致。本机 TUI 使用另一根和独立 Session，通过模板展开和工具读取分别验证 `3dc4505` 与同内容修订 `5a2a62d`。TUI 的同名替换反例在发给 Provider 前被拒。 |

两个宿主共用的交付物是 Git 修订、相对路径和清单字节。每个宿主选择授权目录、装载入口及执行方式。Pakka 侧本次的修订关联为隔离装配记录。材料发布、发现和逐请求审计服务仍属后续设计。活动挂载的复用需要保留同一活动实例的实际用例。执行环境、facet 和预算沿现有契约。Durable adapter 的重试记在备忘录 #79，原生自动压缩默认关闭，由 Dynamite 等插件承接上下文管理。

服务与客户端共 8 文件、29 项回归通过。WebUI #2 独立分支与阶段 4 服务的类型、构建分别通过。共享宿主原始证据包为本机 `verification/shared-host/evidence-public-paths.zip`，SHA-256 `c13bc01d0a078ba01615061dbec56fe028d47908d9414557045bc11053830d14`。TUI 分支 `feat/connected-workbench` 的提交为 `576f0fb`，29 项回归通过。从提交构建的归档已在空项目安装，SHA-256 为 `cc799df11ab0f1a2fa1a0c47c50fbede0704305901973f93229dc10339cff904`。终端和第二个 owner 的证据见 TUI 仓 `docs/changes/0005-connected-workbench.md`。浏览器作为发起端的断响应恢复已有双端实测。TUI 自己发起写入并在断响应后重连的流程目前由本地请求记录测试覆盖。
