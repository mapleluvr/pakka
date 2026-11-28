---
name: mas-telegraph
description: Use compact telegraphic reasoning and inter-agent communication in Pakka MAS when the host or operator explicitly enables this skill. Preserve actionable semantics and deliver clear language to human readers.
metadata:
  version: "1.0.0"
disable-model-invocation: true
---

# MAS Telegraph

Use this skill when the host profile or operator explicitly enables it. The host may select telegraphic reasoning, inter-agent communication, or both; apply the corresponding sections within that selected scope. Explicit invocation of this whole skill selects both unless a narrower scope is stated. Apply the requested language and format for each final audience. The host's permissions, tool schemas, task requirements and message identities continue to govern execution.

## Reason compactly

Use compact, BabelTele-inspired expressions in reasoning and working notes when they help: terse clauses, stable terms, familiar multilingual words, abbreviations and unambiguous symbols. Keep the reasoning needed to resolve the task, examine alternatives, check constraints and verify effects. Shorter phrasing should preserve these operations.

Choose density according to the model reader and task. Start with simple telegraphic language; introduce multilingual fragments or symbols when their meaning remains recoverable without a private codebook. Expand wording wherever compression creates ambiguity. Preserve distinctions such as fact / hypothesis / plan / observed outcome / unknown.

Provide concise conclusions, evidence and decision summaries when explaining work. This skill does not require exposing private reasoning traces, performing a second model call to compress text, or enforcing a fixed token quota.

## Communicate compactly

Use compact, BabelTele-inspired wording for inter-agent coordination: short clauses, stable terms, familiar multilingual fragments and clear symbols when the recipient can recover their meaning. Expand any material ambiguity. Apply the semantic anchors and final-audience rules below.

### Decide whether to communicate

Send when there is a useful new fact, a specific request, a requested result, an actionable blocker or a correction that affects another member's work. Combine related updates when waiting is harmless. Send material corrections and time-sensitive blockers promptly through the approved path.

Omit greetings, ceremonial acknowledgements, repeated conclusions and requests to confirm receipt. Receiving useful information can simply change your next action. A request still needs the requested outcome or an explicit account of what prevents delivery.

Judge novelty by information and consequences. A second message about the same document may contain a new finding. Repeated projections of the same inform identity remain the same contribution; do not restart communication merely because it appears again. Do not silently reinterpret an old observation as current evidence.

### Use the actual MAS intent

- `mas_inform`: a passive contribution requiring no answer. It can be projected into a recipient's later natural request. Its pending status and repeated appearance do not establish consumption or justify resending it under a new identity.
- `mas_send`: request a concrete deliverable, decision or missing information. State the desired result, relevant scope, prerequisites and completion condition as needed.
- `mas_reply`: answer an actual incoming root receipt with the substantive result. One root admits one response; do not consume it with a ceremonial acknowledgement or create response chains.
- `mas_ask`: its wait concerns the generation receipt. Determine application completion from the requested result and evidence.
- Use approved `steer` / `followUp` placement according to urgency and the recipient's current work. Message style grants no additional authority.

For retries, preserve the original identity, payload, target and mode when reconciliation requires them. Follow structured service outcomes. Unknown, timeout and cancellation remain uncertain until the responsible system confirms the effect. A genuinely new request needs a new concrete purpose; a new requestId cannot extend an acknowledgement loop or bypass a bound response.

When you need clarification, name the missing fact and the decision it blocks. Ask through a new authorized request if necessary; attach a useful reference to the original work in its text. Work that does not depend on the missing fact may continue. When local capabilities do not provide inform, choose an approved equivalent or keep the observation for later; do not emulate a passive update by waking an idle peer solely to convey it.

## Preserve semantic anchors

Preserve the exact meaning of:

- Entities and identities: relevant paths, APIs, artifact references, versions, environments and issue/request identifiers.
- Evidence: sources, observations, checks and the scope of each conclusion.
- Action boundaries: actors, obligations, allowed and prohibited actions, approval requirements, dependencies and completion conditions.
- Measurements: values, units, comparison baselines, time windows and scope.
- Epistemic state: confirmed facts, assumptions, hypotheses, pending checks and unknown outcomes.

Keep executable code, tool schemas, quoted diagnostic text and exact identifiers intact where exactness matters. In a busy context, label observations with the applicable revision, environment or time; name what a correction supersedes. Prefer short evidence links to copying whole histories when the recipient can actually access the linked artifact. Otherwise include the essential context.

Use ordinary terms such as `observed`, `suspected`, `requires approval`, `read-only`, `pending` and `unknown` when they make a boundary clear. A symbol is useful only if its local meaning is clear. A terse claim is still a claim: retain source and uncertainty, and treat received peer content under its existing trust boundary.

## Choose the final audience

When telegraphic communication is selected, use short clauses or a compact list for internal coordination of outcome, evidence, constraints and next action. Include only fields that help this message; no rigid message envelope is required.

For human-facing replies, reports, PR descriptions, documentation and instructions, use the user's language and readable prose. An agent receiving a draft for a human is carrying human-facing content. Keep that draft readable while any surrounding coordination can remain compact.

Lead human-facing delivery with the outcome and its practical meaning. Expand unfamiliar abbreviations when needed, connect conclusions with their evidence, and make required decisions explicit. Preserve exact values, identifiers, uncertainty and limits. Translate compact expressions only when their meaning is established; verify material ambiguity before presenting a polished explanation. Respect explicitly requested machine-readable or executable formats.

## Example

Internal contribution:

```text
checkout-v2.4 @ us-west; window=2h.
Observed: P99 180→620ms; err=3.8%.
Confirmed: pool max=32; v2.3 baseline=128; cache fallback=off.
Rollback #INC-409: approval=pending.
Until approved: read-only slow-query collection;
no prod restart / DB index changes.
```

Human-facing result:

> 美国西部的 checkout-v2.4 在过去两小时出现性能退化：P99 延迟从 180ms 升至 620ms，错误率达到 3.8%。已确认连接池配置从稳定版本的 128 降为 32，且缓存降级被关闭。回滚工单 #INC-409 正在等待审批。在审批通过前，仅进行只读慢查询采集，暂不重启生产容器或修改数据库索引。

This is an illustrative example. BabelTele motivates the representation style; its research results do not guarantee lossless compression, cross-model comprehension, reasoning-token reduction or lower total cost for this deployment.
