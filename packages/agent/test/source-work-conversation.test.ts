import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createCompresserSession } from "../src/index.ts";
import { fixture, seed } from "./fixture.ts";
import { inferencePolicy } from "./strategy-fixture.ts";
const outputTool={name:"submit_candidate",description:"Submit the complete local candidate.",parameters:{type:"object",properties:{text:{type:"string",minLength:3}},required:["text"],additionalProperties:false}};
const request={modelKey:"summary",prompt:"FIXED-CROSS-STORE",outputTool};

test("confirmed Compresser completion repairs the source seal after a real cross-store interruption",{timeout:30000},async()=>{
 const f=await fixture({},p=>p.model==="summary-model"?{tool:"submit_candidate",args:{text:"COMPLETE"}}:{text:"MAIN"});
 const compresserDir=join(f.root,"compresser"),base=inferencePolicy(f.endpoint).inference!;
 const inference={...base,policies:base.policies.map(p=>({...p,maxCalls:50,maxJobCalls:10}))};
 let c=await createCompresserSession({storageDir:compresserDir,toolCallingTolerance:2,unresolvedErrorTolerance:2}),child;
 try {
  let host=await f.start({inference:{...inference,compresserSession:c}});await seed(host);const file=host.view().sessionFile;
  await host.dispose();await c.close();
  const configuration=join(f.root,"cross-store-child.json");
  await writeFile(configuration,JSON.stringify({compresserDir,request,host:{cwd:f.cwd,dataDir:f.dataDir,endpoint:f.endpoint,model:"local-model",apiKey:"local-only",systemPrompt:"PAKKA-SYSTEM",inference,reopenSessionFile:file}}));
  child=fork(fileURLToPath(new URL("./source-work-conversation-child.ts",import.meta.url)),[configuration],{silent:true,execArgv:["--experimental-strip-types"]});
  let stderr="";child.stderr!.on("data",data=>{stderr+=String(data);});
  const [message]=await Promise.race([once(child,"message",{signal:AbortSignal.timeout(15000)}),once(child,"exit").then(()=>{throw new Error("Child exited before the selected gap: "+stderr);})]);
  const exit=once(child,"exit");child.kill("SIGKILL");await exit;
  // Isolated maintenance is allowed only after proof that these exact writers exited.
  for(const dir of [dirname(file),compresserDir]) {
   const path=join(dir,"pakka-writer.json"),bytes=await readFile(path,"utf8"),claim=JSON.parse(bytes);
   assert.equal(claim.schema,"pakka.writer.v1");assert.equal(claim.pid,child.pid);assert.match(claim.nonce,/^[0-9a-f-]{36}$/);assert.equal(await readFile(path,"utf8"),bytes);await unlink(path);
  }
  const maintenance=new DatabaseSync(file);maintenance.exec("DROP TRIGGER controlled_source_seal");maintenance.close();
  c=await createCompresserSession({storageDir:compresserDir,toolCallingTolerance:2,unresolvedErrorTolerance:2});
  host=await f.start({inference:{...inference,compresserSession:c},reopenSessionFile:file});
  const owner=host.connect("owner",["context_artifacts.write","model.infer"]);owner.activateStrategy({id:"strategy",hooks:["context_artifacts.write"]});
  const b=owner.bindStrategy("strategy"),work=b.pendingWork()[0]!;assert.equal(work.jobId,message.jobId);assert.equal(work.hasSealedResult,false);assert.equal(work.budget.reserved,1);
  const restored=await b.restoreJob(message.jobId),count=f.requests.length;
  await assert.rejects(restored.converse({...request,prompt:"CHANGED-REQUEST"}),/digest|request|changed/i);
  assert.equal(f.requests.length,count);
  const result=await restored.converse(request);assert.equal(result.status,"completed");assert.equal(result.toolCall!.arguments.text,"COMPLETE");assert.equal(result.compresser!.sessionId,message.compresserSessionId);
  assert.equal(f.requests.length,count,"a confirmed envelope must be read, not sent again");assert.equal(b.audit().length,1);assert.equal(b.pendingWork()[0]!.budget.reserved,1);assert.equal(b.pendingWork()[0]!.hasSealedResult,true);
  assert.equal((await b.artifacts.append(restored.scope,{expectedVersion:0,records:[{candidate:"COMPLETE"}],attemptIds:[result.attemptId]})).status,"committed");
  assert.equal(b.pendingWork().length,0);assert.equal(f.requests.filter(p=>p.model==="summary-model").length,1);
 } finally {
  if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,"exit");child.kill("SIGKILL");await exit;}
  await f.close();await c.close();
 }
});
