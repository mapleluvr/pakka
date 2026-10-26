import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd();
const {runtimeFixture}=await import(pathToFileURL(join(root,'packages/agent/test/runtime-fixture.ts')));
const {startPocket}=await import('@pakka/webui');
const {ownedBrowser}=await import(pathToFileURL(join(root,'apps/webui/test/browser.ts')));
const m=await runtimeFixture();
let app,browser;
try {
  await m.runtime.close();
  app=await startPocket({runtime:{...m.config,dataDir:join(m.f.root,'session-entry-positive')},owner:'Owner'});
  assert.ok(app.initialOwner);
  browser=await ownedBrowser(join(m.f.root,'session-entry-browser'));
  const page=await browser.page(app.http.origin+'/#signin='+app.initialOwner.token);
  await page.wait('document.querySelector("[data-action=signin]")'); await page.click('[data-action=signin]');
  await page.wait('document.querySelector(".home-create-card")');
  const rpc=async command=>{
    const response=await page.evaluate(`fetch('/pocket/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Pakka-CSRF':document.cookie.match(/(?:^|; )pakka_csrf=([^;]+)/)[1]},body:JSON.stringify({version:2,requestId:crypto.randomUUID(),command:${JSON.stringify(command)}})}).then(async r=>({status:r.status,body:await r.json()}))`);
    assert.equal(response.status,200,JSON.stringify(response.body));return response.body.result;
  };
  async function open(){await page.click('.home-create-card [data-action=new-session]');await page.wait('document.querySelector("[data-creation-form] input[name=sessionName]")');}
  async function first(enabled){const checked=await page.evaluate('document.querySelector("input[name=withConversation]").checked');if(checked!==enabled)await page.click('input[name=withConversation]');}
  await open(); await first(false);
  await page.type('input[name=sessionName]','Parent Without First',{replace:true});
  assert.equal(await page.evaluate('Boolean(document.querySelector("[data-creation-form] input[name=name]"))'),false);
  await page.click('[data-create-confirm]');
  await page.wait('document.querySelector(".creation-body")?.textContent.includes("Session created. It has no Conversations yet.")');
  const alone=await rpc({op:'session.list'});
  assert.equal(alone.kind,'sessions');assert.equal(alone.sessions.length,1);assert.equal(alone.sessions[0].name,'Parent Without First');assert.equal(alone.sessions[0].status,'ready');
  const empty=await rpc({op:'list'});assert.equal(empty.conversations.length,0);assert.equal(m.f.requests.length,0);
  await page.click('[aria-label="Close creation"]');await page.wait('!document.querySelector(".creation-body")');
  await open();await first(true);
  await page.type('input[name=sessionName]','Parent With First',{replace:true});
  await page.type('input[name=name]','First from New Session',{replace:true});
  await page.click('[data-create-confirm]');
  await page.wait('document.querySelector(".pocket-title")?.textContent==="First from New Session" && document.querySelector(".pocket-status")?.textContent==="Ready"');
  const both=await rpc({op:'session.list'}),list=await rpc({op:'list'});
  assert.equal(both.sessions.length,2);assert.equal(list.conversations.length,1);
  const parent=both.sessions.find(row=>row.name==='Parent With First');assert.ok(parent);assert.equal(list.conversations[0].sessionId,parent.id);assert.notEqual(parent.id,alone.sessions[0].id);assert.equal(m.f.requests.length,0);
  console.log(JSON.stringify({newSessionWithoutConversation:'PASS',newSessionWithFirstConversation:'PASS',independentParents:2,conversations:1,modelRequests:0}));
} finally { await browser?.close();await app?.close();await m.close(); }
