import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, seed } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { readFile } from "node:fs/promises";
import { readStorageText, blockSqliteWrites } from "./native-storage.ts";

// A sidecar-only write cannot satisfy this oracle: the actual public Storage
// snapshot of the source Session must contain the committed artifact value.
test("strategy artifact commits are readable from source SQLite and survive reopen", async () => {
  const f = await fixture();
  try {
    let host = await f.start();
    await seed(host);
    const writer = () => {
      const owner = host.connect("writer", ["context_artifacts.write"]);
      owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
      return binding(owner);
    };
    let b = writer();
    const frame = b.readFrame();
    const first = await b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ artifact: "SQLITE-ARTIFACT-ONE" }] });
    assert.equal(first.status, "committed");
    const file = host.view().sessionFile;
    assert.match(await readStorageText(file), /SQLITE-ARTIFACT-ONE/);
    const second = await b.artifacts.append(b.readFrame().basis, { expectedVersion: 1, records: [{ artifact: "SQLITE-ARTIFACT-TWO" }] });
    assert.equal(second.status, "committed");
    await host.dispose();
    host = await f.start({ reopenSessionFile: file });
    b = writer();
    assert.deepEqual(b.artifacts.read(b.readFrame().basis), { version: 2, records: [{ artifact: "SQLITE-ARTIFACT-ONE" }, { artifact: "SQLITE-ARTIFACT-TWO" }] });
    assert.equal(f.requests.length, 1);
    assert.equal(f.errors.length, 0);
  } finally {
    await f.close();
  }
});

test("a real SQLite artifact write failure is unknown and never publishes a successful receipt", async () => {
  const f = await fixture();
  let unblock: (() => void) | undefined;
  try {
    const host = await f.start();
    await seed(host);
    const owner = host.connect("writer", ["context_artifacts.write"]);
    owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
    const b = binding(owner), frame = b.readFrame();
    unblock = blockSqliteWrites(host.view().sessionFile);
    const receipt = await b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ artifact: "MUST-NOT-PUBLISH" }] });
    assert.equal(receipt.status, "unknown");
    assert.equal(host.view().phase, "failed");
    unblock();
    unblock = undefined;
    assert.doesNotMatch(await readStorageText(host.view().sessionFile), /MUST-NOT-PUBLISH/);
    assert.equal(f.requests.length, 1);
  } finally {
    unblock?.();
    await f.close();
  }
});

async function walCommits(file: string): Promise<number> {
  const bytes = await readFile(file + "-wal");
  if (bytes.length < 32) return 0;
  const size = bytes.readUInt32BE(8) || 65536;
  let count = 0;
  for (let offset = 32; offset + 24 + size <= bytes.length; offset += 24 + size)
    if (bytes.readUInt32BE(offset + 4) !== 0) count++;
  return count;
}

test("artifact, exact adoption and local checkpoint share one native commit", async () => {
  const f = await fixture();
  try {
    const host = await f.start(inferencePolicy(f.endpoint));
    await seed(host);
    const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
    owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
    const b = binding(owner), frame = b.readFrame();
    const job = b.createJob(frame.basis, { planId: "atomic-adoption", targetEntryIds: [target(frame)], maxCalls: 2, requireArtifactReceipt: true });
    const result = await job.infer({ modelKey: "summary", prompt: "LOCAL-DETERMINISTIC" });
    assert.equal(result.status, "completed");
    const file = host.view().sessionFile, before = await walCommits(file);
    const receipt = await b.artifacts.append(job.scope, { expectedVersion: 0, records: [{ candidate: "ATOMIC-CANDIDATE" }], attemptIds: [result.attemptId] });
    assert.equal(receipt.status, "committed");
    assert.equal(await walCommits(file) - before, 1, "artifact and adoption must be one SQLite transaction");
    const stored = JSON.parse(await readStorageText(file));
    const text = JSON.stringify(stored.documents);
    assert.match(text, /ATOMIC-CANDIDATE/);
    assert.match(text, /adoption/);
    assert.match(text, /checkpoint/);
    assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test("parallel source windows persist reservations and completions without losing either outcome", async () => {
  const f = await fixture();
  try {
    const host = await f.start(inferencePolicy(f.endpoint));
    await seed(host);
    const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
    owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
    const b = binding(owner), frame = b.readFrame();
    const jobs = ["window-A", "window-B"].map(planId => b.createJob(frame.basis, { planId, targetEntryIds: [target(frame)], maxCalls: 2, requireArtifactReceipt: true }));
    const results = await Promise.all(jobs.map((job,i) => job.infer({ modelKey: "summary", prompt: "INDEPENDENT-"+i })));
    assert.deepEqual(results.map(result=>result.status), ["completed", "completed"]);
    assert.equal(new Set(results.map(result=>result.attemptId)).size, 2);
    const rows = b.audit();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row=>row.status), ["completed", "completed"]);
    assert.equal(f.requests.length, 3);
    assert.equal(host.view().phase, "ready");
    jobs.forEach(job=>job.cancel());
  } finally { await f.close(); }
});

test("stable transaction identity supports exact receipt lookup and identical replay", async () => {
  const f = await fixture();
  try {
    let host = await f.start();
    await seed(host);
    function activate() { const owner=host.connect("writer",["context_artifacts.write"]); owner.activateStrategy({id:"strategy",hooks:["context_artifacts.write"]}); return binding(owner); }
    let b=activate();
    const transactionId="stable-artifact-transaction", records=[{value:"EXACT-COMMIT"}];
    const receipt=await b.artifacts.append(b.readFrame().basis,{expectedVersion:0,records,transactionId});
    assert.equal(receipt.status,"committed");
    assert.equal(receipt.transactionId,transactionId);
    assert.deepEqual(b.artifacts.receipt(b.readFrame().basis,transactionId),receipt);
    const file=host.view().sessionFile, before=await walCommits(file);
    const replay=await b.artifacts.append(b.readFrame().basis,{expectedVersion:0,records,transactionId});
    assert.deepEqual(replay,receipt);
    assert.equal(await walCommits(file),before,"receipt replay performs no new commit");
    await assert.rejects(async()=>b.artifacts.append(b.readFrame().basis,{expectedVersion:0,records:[{value:"DIFFERENT"}],transactionId}),/transaction|identity|different|reus/i);
    assert.equal(host.view().phase,"ready");
    await host.dispose();
    host=await f.start({reopenSessionFile:file}); b=activate();
    assert.deepEqual(b.artifacts.receipt(b.readFrame().basis,transactionId),receipt);
    assert.equal(b.artifacts.receipt(b.readFrame().basis,"missing-transaction"),undefined);
    assert.equal(f.requests.length,1);
  } finally { await f.close(); }
});
