import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";

// A personal device must reuse the owner while retaining independent, persistently revocable login authority.
test("personal mode: devices share one person and revoking one survives reopen without revoking the others", async () => {
 const m = await runtimeFixture();
 let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
 try {
  let people = await createPocketPeople({runtime:m.runtime, namespace:"personal-test"});
  const login = await people.initializeOwner("Owner");
  let owner = await people.authenticate(login.token);
  const settings = await people.settings(owner);
  const original = {requestId:"personal",action:{op:"mode.set" as const,mode:"personal" as const,expectedVersion:settings.version}};
  const receipt = await people.change(owner,original);
  assert.deepEqual(await people.change(owner,original),receipt);
  assert.equal((await people.settings(owner)).mode,"personal");
  await assert.rejects(people.invite(owner,{requestId:"new-person",role:"admin",resources:"*",ttlMs:60000}),/denied/i);
  const paired = [];
  for (const key of ["phone","terminal"]) {
   const invitation=await people.invite(owner,{requestId:key,personId:login.person.id,role:"admin",resources:"*",ttlMs:60000});
   assert.ok(invitation.token);
   const session=await people.redeem(invitation.token);
   assert.equal(session.person.id,login.person.id);
   paired.push(session);
  }
  assert.equal((await people.list(owner)).people.length,1);
  const phone=await people.authenticate(paired[0]!.token);
  const lease=people.lease(phone,"extensions.install");
  const phoneDevice=(await people.settings(phone)).devices.find(row=>row.current)!;
  const revoke={requestId:"revoke-phone",action:{op:"device.revoke" as const,id:phoneDevice.id}};
  await people.change(owner,revoke);
  assert.equal(lease.signal.aborted,true);
  assert.throws(()=>people.current(phone),/denied/i);
  await assert.rejects(people.authenticate(paired[0]!.token),/denied/i);
  assert.equal((await people.authenticate(paired[1]!.token)).person.id,login.person.id);
  const file=m.runtime.view().sessionFile;
  await m.runtime.close();
  reopened=await createRuntime({...m.config,reopenSessionFile:file});
  people=await createPocketPeople({runtime:reopened,namespace:"personal-test"});
  owner=await people.authenticate(login.token);
  assert.equal((await people.settings(owner)).mode,"personal");
  assert.deepEqual(await people.lookupChange(owner,original),receipt);
  await assert.rejects(people.authenticate(paired[0]!.token),/denied/i);
  assert.equal((await people.authenticate(paired[1]!.token)).person.id,login.person.id);
  assert.equal(m.f.requests.length,0);
 } finally { await reopened?.close(); await m.close(); }
});

// Switching modes must not promote another person's existing login or resurrect outstanding member invitations.
test("personal mode: concurrent mode writes conflict and existing members prevent entry", async()=>{
 const m=await runtimeFixture();
 try {
  const people=await createPocketPeople({runtime:m.runtime,namespace:"personal-test"});
  const login=await people.initializeOwner("Owner"), owner=await people.authenticate(login.token);
  const link=await people.invite(owner,{requestId:"visitor",role:"viewer",resources:"*",ttlMs:60000});
  const before=await people.settings(owner);
  await people.change(owner,{requestId:"enter",action:{op:"mode.set",mode:"personal",expectedVersion:before.version}});
  await assert.rejects(people.redeem(link.token!,"Visitor"),/denied/i);
  await assert.rejects(people.change(owner,{requestId:"stale",action:{op:"mode.set",mode:"collaboration",expectedVersion:before.version}}),/conflict/i);
  await people.change(owner,{requestId:"leave",action:{op:"mode.set",mode:"collaboration",expectedVersion:(await people.settings(owner)).version}});
  const other=await people.invite(owner,{requestId:"member",role:"viewer",resources:"*",ttlMs:60000});
  const visitor=await people.redeem(other.token!,"Visitor");
  await assert.rejects(people.change(owner,{requestId:"unsafe-enter",action:{op:"mode.set",mode:"personal",expectedVersion:(await people.settings(owner)).version}}),/conflict/i);
  const auth=await people.authenticate(visitor.token);
  assert.throws(()=>auth.check("extensions.install"),/denied/i);
  assert.equal((await people.settings(auth)).devices.length,0);
 } finally {await m.close();}
});
