import { test } from "node:test";
import assert from "node:assert/strict";
import { WEBUI_SERVICE_API, decodeWebUiResponse, type WebUiCommand } from "@pakka/protocol/webui";
import { startPocket } from "../src/bootstrap.ts";
import { openProductModels } from "../src/product-models.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { loginHttpSession, connectHttpSession } from "./fixtures/http-session.ts";

// Public HTTP boundary: optional-name pairing, cookie/CSRF authority, original receipts and pre-write version refusal.
test("personal mode HTTP: pair a device without a name, recover a mode receipt, revoke only that device, and save an empty budget note", async()=>{
 const {f,agentDir}=await isolated();
 await configuration(agentDir,f.endpoint);
 const source=await openProductModels({agentDir,cwd:f.cwd});
 let app:Awaited<ReturnType<typeof startPocket>>|undefined;
 try {
  app=await startPocket({runtime:{cwd:f.cwd,dataDir:f.dataDir,model:"alpha/reasoner",models:source.models},modelConfiguration:source,owner:"Owner",initial:[{name:"Work",profile:"default"}]});
  const origin=app.http.origin;
  const owner=await loginHttpSession(origin,app.initialOwner!.token);
  async function service(command:WebUiCommand,login=owner,api=WEBUI_SERVICE_API){
   const requestId=crypto.randomUUID();
   const response=await fetch(origin+"/pakka-webui/services",{method:"POST",headers:login.headers,body:JSON.stringify({api,requestId,binding:{personId:login.person.id,serverId:app!.http.serverId},command})});
   const raw=await response.json();
   return {status:response.status,value:api===WEBUI_SERVICE_API?decodeWebUiResponse(raw,requestId):raw};
  }
  const initial=await service({op:"people.settings"});
  assert.equal(initial.status,200);
  const change={requestId:"personal-original",action:{op:"mode.set" as const,mode:"personal" as const,expectedVersion:initial.value.result.settings.version}};
  assert.equal((await service({op:"people.write",change},owner,5)).status,400);
  assert.equal((await service({op:"people.settings"})).value.result.settings.mode,"collaboration");
  await service({op:"people.write",change}); // Simulate losing the successful response in the caller.
  const found=await service({op:"people.lookup",original:change});
  assert.equal(found.value.result.receipt.requestId,change.requestId);
  assert.equal((await service({op:"people.settings"})).value.result.settings.mode,"personal");
  const invitation=await owner.workbench({op:"invite",requestId:"pair",personId:owner.person.id,role:"admin",resources:"*",ttlMs:60000});
  assert.ok("result" in invitation.decoded && invitation.decoded.result.kind==="invite");
  const exchange=await fetch(origin+"/pakka-webui/exchange",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({kind:"invite",token:invitation.decoded.result.token})});
  assert.equal(exchange.status,200);
  const cookies=exchange.headers.getSetCookie().map(row=>row.split(";")[0]).join("; ");
  const phone=await connectHttpSession(origin,cookies);
  assert.equal(phone.person.id,owner.person.id);
  const paired=await service({op:"people.settings"},phone);
  const phoneId=paired.value.result.settings.devices.find((row:{current:boolean})=>row.current).id;
  const budget=await service({op:"session-budget.read",sessionId:app.runtime.view().sessionId});
  const note={requestId:"blank-note",expectedVersion:budget.value.result.policy.version,limits:{maxConversations:0,maxPrimaryAttempts:0,maxAuxiliaryAttempts:0},reason:""};
  const saved=await service({op:"session-budget.write",sessionId:app.runtime.view().sessionId,change:note},phone);
  assert.equal(saved.status,200);
  assert.equal(saved.value.result.receipt.reason,"");
  assert.equal((await service({op:"people.write",change:{requestId:"remove-phone",action:{op:"device.revoke",id:phoneId}}})).status,200);
  assert.equal((await phone.workbench({op:"list"})).response.status,401);
  assert.equal((await owner.workbench({op:"list"})).response.status,200);
  assert.equal(f.requests.length,0);
 } finally {await app?.close();await source.close();await f.close();}
});
