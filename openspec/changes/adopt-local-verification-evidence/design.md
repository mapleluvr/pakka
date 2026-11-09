# Local evidence and review boundaries

## Recorded information

Git carries concise results tied to the candidate, environment, scope and actual status. The local evidence bundle is identified by filename, byte size and the SHA-256 of its final bytes. A checksum identifies bytes, not correctness; FAIL/BLOCKED/cancelled/missing results retain their actual meanings. Product installation archives keep their separate provenance.

## Local custody

Collect evidence in isolated run directories, exclude credentials and separately governed live data, then publish a uniquely named bundle in a restricted local preservation directory. Verify it can be listed/read and compute the final checksum. Keep a local recovery/checksum README; changes produce a new bundle identity. The agent does not upload evidence to GitHub repositories, attachments, Releases or Actions artifacts, and does not substitute a supposed cloud URL. The operator owns cloud storage and subsequent custody.

## Artifact review

Before commits, inspect all staged paths, numstat/stat, sizes, contents and sensitive data. Before PR creation/update, repeat the review for the complete actual base range, including inherited commits. Raw evidence, verbose generated inventories and bundles are excluded regardless of extension or force-add capability. This is mandatory submission hygiene even when runtime Verification is not selected. Documentation and the PR checklist implement the workflow rule; this change does not claim an installed automatic CI/hook gate.

## Existing materials

Existing tracked evidence is not removed by ignore rules. Published hashes and results remain unchanged. Historical cleanup and remote/history modifications need their own scoped work. Product-required source patches, reproducible locks, vendor archives, licenses and executable tests remain deliverables, not disposable verification output.
