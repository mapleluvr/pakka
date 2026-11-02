import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, deferred } from "./fixture.ts";
import { inferencePolicy } from "./strategy-fixture.ts";
import { readNativeDocument } from "./native-storage.ts";

for (const mode of ["failed", "unknown-usage", "revoked"] as const) {
 test(`SQLite completion preserves absent optional fields for ${mode} inference`, async () => {
  const entered=deferred(),release=deferred();
  const f=await fixture({},async payload=>{
   if(payload.model!=="summary-model")return {text:"MAIN"};
   if(mode==="failed")return {error:503};
   if(mode==="revoked"){entered.resolve();await release.promise;}
   return {text:"CANDIDATE",usage:null};
  });
  try {
   const host=await f.start(inferencePolicy(f.endpoint));
   await host.connect("ui",["input.submit"]).submit({key:"seed",text:"SOURCE"});await host.waitForIdle();
   const owner=host.connect("owner",["context_artifacts.write","model.infer"]);
   owner.activateStrategy({id:"strategy",hooks:["context_artifacts.write"]});
   const b=owner.bindStrategy("strategy"),frame=b.readFrame();
   const target=frame.projection.find(row=>row.messages.some(message=>message.role==="assistant"))!.sourceEntryId;
   const job=b.createJob(frame.basis,{planId:`optional-${mode}`,targetEntryIds:[target],maxCalls:2,requireArtifactReceipt:true});
   await job.prepare();const address=b.pendingWork()[0]!.address;
   const pending=job.infer({modelKey:"summary",prompt:"FIXED",maxOutputTokens:32});
   if(mode==="revoked"){await entered.promise;owner.deactivateStrategy("strategy");release.resolve();}
   const result=await pending;
   assert.equal(host.view().phase,"ready",host.view().lastError ?? "Completion changed the host phase");
   assert.equal(result.status,mode==="failed"?"failed":mode==="revoked"?"quarantined":"completed");
   assert.equal(result.usageStatus,"unknown");assert.equal(Object.hasOwn(result,"usage"),false);
   const document=await readNativeDocument(host.view().sessionFile,"pakka.source-work",address),saved=document.value as any;
   assert.equal(saved.state.attemptIds.length,1);assert.equal(saved.state.maxCalls,2);assert.equal(saved.state.pendingAttempt,null);
   assert.deepEqual(saved.state.result,result,"the returned and persisted completion have the same finite representation");
   assert.equal(f.requests.filter(row=>row.model==="summary-model").length,1);
  } finally {release.resolve();await f.close();}
 });
}
