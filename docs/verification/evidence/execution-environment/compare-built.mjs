import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [root, output] = process.argv.slice(2);
const temp=realpathSync.native(tmpdir()), profile=mkdtempSync(join(temp,'pakka-built-compare-'));
const env={...process.env, TEMP:temp,TMP:temp,HOME:profile,USERPROFILE:profile,PI_CODING_AGENT_DIR:join(profile,'pi'),PI_OFFLINE:'1',DO_NOT_TRACK:'1'};
const cases=[
 ['apps/server/test/pocket-directories.test.ts','authorized browsing'],
 ['apps/server/test/pocket-hooks-boundaries.test.ts','WebUI hooks (unknown|finite rate|finite bytes):'],
 ['apps/server/test/pocket-people-boundaries.test.ts','uncertain native storage'],
 ['apps/webui/test/transcript-parts-browser.test.ts','WebUI transcript: (valid image|inherited tool)'],
 ['packages/agent/test/strategy-omission.test.ts','explicit null range'],
 ['packages/mas/test/mas.test.ts','readiness barrier'],
 ['packages/mas/test/unknown.test.ts','unknown'],
 ['apps/webui/test/extension-client.test.ts',''],
 ['apps/webui/test/browser-input.test.ts','Browser input driver:'],
 ['apps/webui/test/browser-launch.test.ts','Browser discovery:'],
 ['apps/webui/test/browser-contribution.test.ts','browser contribution: actual UI'],
 ['apps/server/test/pocket-browser.test.ts','real isolated page controls'],
];
const summary=[];
for(const [file,pattern] of cases){
 const result=spawnSync(process.execPath,['--experimental-strip-types','--disable-warning=ExperimentalWarning','--test','--test-reporter=tap',...(pattern?['--test-name-pattern='+pattern]:[]),file],{cwd:root,env,encoding:'utf8',maxBuffer:4*1024*1024,timeout:45000});
 console.log('\nFILE '+file+'\n'+result.stdout+'\n'+result.stderr+'\nEXIT '+result.status+' '+(result.error?.code??''));
 summary.push({file,status:result.status,error:result.error?.code??null,passed:(result.stdout.match(/^ok \d+/gm)??[]).length,failed:(result.stdout.match(/^not ok \d+/gm)??[]).length});
 writeFileSync(output,JSON.stringify({root,profile,summary},null,2));
}
process.exitCode=summary.some(r=>r.status!==0)?1:0;
