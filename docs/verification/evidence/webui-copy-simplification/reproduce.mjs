import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
let snapshot;
try {snapshot=JSON.parse(readFileSync(new URL('./source-snapshot.json',import.meta.url),'utf8'));}
catch {throw Error('A valid sealed source snapshot is required before running this reproduction');}
if(!snapshot.candidate||process.argv.slice(2).some(arg=>arg!=='--full'))throw Error('Expected a sealed candidate and optional --full');
execFileSync('git',['diff','--exit-code',snapshot.candidate,'--','apps','packages','scripts'],{cwd:root,stdio:'inherit'});
const profile=mkdtempSync(join(tmpdir(),'pakka-ui-copy-reproduce-')),artifacts=join(root,'artifacts','ui-copy-reproduce');
mkdirSync(artifacts,{recursive:true});
const env={};
for(const name of ['PATH','PATHEXT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','PAKKA_TEST_CHROME'])if(process.env[name])env[name]=process.env[name];
Object.assign(env,{HOME:profile,USERPROFILE:profile,PI_CODING_AGENT_DIR:profile,PAKKA_TEST_ARTIFACTS:artifacts,DO_NOT_TRACK:'1',PI_OFFLINE:'1',NO_COLOR:'1'});
const tests=['navigation-controls-browser.test.ts','copy-presentation-browser.test.ts','conversation-creation-browser.test.ts','devin-shell-browser.test.ts','schedules-recovery.test.ts','transcript-parts-browser.test.ts'].map(name=>'apps/webui/test/'+name);
const args=process.argv.includes('--full')?['scripts/test.mjs']:['--experimental-strip-types','--expose-gc','--test','--test-concurrency=1',...tests];
const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
