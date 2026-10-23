# Active diagnostics disposition

The [raw 22-path probe](host/lsp-final.log) reports clean=19, findings=2, inconclusive=1. The twelve displayed findings come from the auxiliary ast-grep unchecked-throwing-call-js rule, not a language-server type error. One push-only result is not proof of a clean file, and three existing suppressed findings are not reclassified as clean.

The two flagged files are scripts/consumer-smoke.mjs and pakka-dynamite/scripts/package-smoke.mjs. Each flagged call parses local package, pairing, provenance, dependency-tree, lock or acceptance metadata at the top level of a verification command. Invalid JSON must terminate the command with a nonzero status before accepting that data. The smoke runner itself also aborts on child failure; its installed matrix and public declarations passed. Adding a permissive fallback or ignoring a parse error would weaken this gate.

No runtime request decoder is exempted by this disposition. No rule was globally disabled, no suppression was added to source, and these auxiliary findings remain visible. Compiler/build results and this limited LSP result are recorded separately.
