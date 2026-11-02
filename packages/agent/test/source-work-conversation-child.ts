import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHost, createCompresserSession } from "../src/index.ts";
import { readNativeDocument } from "./native-storage.ts";

const config=JSON.parse(await readFile(process.argv[2]!,"utf8"));
const c=await createCompresserSession({storageDir:config.compresserDir,toolCallingTolerance:2,unresolvedErrorTolerance:2});
const host=await createHost({...config.host,inference:{...config.host.inference,compresserSession:c}});
assert.equal(host.view().phase,"ready");
const owner=host.connect("owner",["context_artifacts.write","model.infer"]);
owner.activateStrategy({id:"strategy",hooks:["context_artifacts.write"]});
const b=owner.bindStrategy("strategy"),frame=b.readFrame();
const target=frame.projection.find(e=>e.messages.some(m=>m.role==="assistant"))!.sourceEntryId;
const job=b.createJob(frame.basis,{planId:"cross-store-fixed",targetEntryIds:[target],maxCalls:8,requireArtifactReceipt:true});
await job.prepare();const address=b.pendingWork()[0]!.address,file=host.view().sessionFile;
// This real SQLite write rejection selects only the source-side final seal.
// Compresser storage can finish first; no production adapter is monkey-patched.
const blocker=new DatabaseSync(file);
blocker.exec(`CREATE TRIGGER controlled_source_seal BEFORE INSERT ON document_revisions
 WHEN instr(NEW.content, '"kind":"work-result"')>0
 BEGIN SELECT RAISE(ABORT, 'CONTROLLED_SOURCE_SEAL_FAILURE'); END`);
blocker.close();
await assert.rejects(job.converse(config.request),/seal|unconfirmed|unknown|persist/i);
const snapshot=await c.snapshot(),saved=(await readNativeDocument(file,"pakka.source-work",address)).value as any;
assert.equal(snapshot.conversations.find(row=>row.jobId===job.id)!.status,"completed");
assert.equal(saved.state.stage,"resultStored");assert.equal(saved.state.sealed,false);assert.equal(saved.state.pendingAttempt,null);
process.send?.({jobId:job.id,address,file,compresserSessionId:snapshot.sessionId,result:saved.state.result});
process.on("message",()=>{});
await new Promise(()=>{});
