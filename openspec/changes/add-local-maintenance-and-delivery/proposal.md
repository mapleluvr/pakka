# Local recovery and durable delivery

## Intent

A local operator can regain access to the original product, preserve all registered durable domains, and upgrade or restore without implicitly executing stored work. The operator adopted the recovery/upgrade proposal and authorized implementation appended to PR #4 on 2026-11-07.

## Mechanism

A no-Harness maintenance port uses the public Durable Session kernel behind the adapter. Product maintenance owns exact storage gates; authentication changes reuse the people codec. Private staged files and durable operation IDs reconcile issuance and publication. Cold backups enumerate all declared storage roots and carry hashes. Restore publishes only validated original identities, expires authentication and keeps execution held until explicit review. Upgrade separates release selection from data migration and retains its pre-upgrade backup.

## Verification

Use isolated real SQLite, local HTTP providers and child CLI processes. Cover original owner and old token rejection, one-use/expiry, dead versus live writer, exact identity, faulted issuance/publication, backup/restore across Sessions, corruption and interrupted publication, and zero model/tool/job/extension effects. Installed consumers and final checks record actual candidate identities.
