# Maintenance design

The approved local-recovery and upgrade design is implemented as one trusted offline control plane. Runtime is a live controller of one durable Session; backup inventory includes the control Session, child Sessions and explicitly registered service/broker/Dynamite stores. Conversations are not independent backup domains.

## Offline storage access

Use public createSession over the owned SQLite adapter, never Harness.open. Require existing physical identity, original provenance and exclusive writer. Only approved coordinator namespaces are exposed as frozen snapshots and version-bound mutations. Authentication and its per-operation receipt commit together. Storage uncertainty retains the writer claim.

## Login and writer

Preview identifies the original owner and Session; mutation requires matching confirmation. Owner must remain active/global admin. A private prepared file owns the 10-minute token; durable receipt records only its hash. Repeating the operation reconciles receipt and exact prepared bytes, never reactivates a used token. Issuance revokes the owner's previous sessions; other people/grants remain. Writer recovery uses exact pid+nonce and known exited process only.

## Backup, restore and release

Acquire product gate and every declared storage domain. Use SQLite backup with integrity/identity checks and bounded streaming file copying; validate all hashes before publishing the final backup directory. Exclude ephemeral locks; external cwd/model/auth dependencies are listed, not silently followed. Original-location restore first preserves current data, validates staging, journals publication and keeps normal startup gated across interruption. Restored authentication is revoked and execution remains held pending explicit review. Releases have fixed package identity and hash, are installed in a versioned directory, and become selected only after offline health and pre-upgrade backup; data downgrade uses a compatible release or explicit restore.

## OOM follow-up

Persistent history size and model context are separate. Resource controls apply to resident observation data, open runtimes, in-flight work and actual storage/CPU. OOM work is scheduled in tasks with measurement before selecting limits; no lifetime interaction quota substitutes for memory governance.
