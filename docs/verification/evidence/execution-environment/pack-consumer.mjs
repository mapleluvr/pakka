import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = process.cwd();
const temp = realpathSync.native(tmpdir());
const consumer = mkdtempSync(join(temp, 'pakka-env-consumer-install-'));
const env = {};
for (const key of ['PATH','PATHEXT','SystemRoot','WINDIR','COMSPEC']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { TEMP: temp, TMP: temp, HOME: consumer, USERPROFILE: consumer, PI_CODING_AGENT_DIR: join(consumer,'pi'), PI_OFFLINE: '1', DO_NOT_TRACK: '1', NO_COLOR: '1' });
const npm = 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
function run(args, cwd, capture = false) {
 const result = spawnSync(process.execPath, args, {cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: capture ? ['ignore','pipe','inherit'] : 'inherit'});
 if (capture) writeFileSync(join(root,'docs/.temp/execution-pack-detail.log'), result.stdout ?? '');
 if (result.status !== 0) throw new Error('Exit '+result.status+': '+args[0]);
}
run([npm,'run','pack:agent','--',consumer], root, true);
writeFileSync(join(consumer,'package.json'), JSON.stringify({name:'execution-consumer',private:true,type:'module'}));
run([npm,'install','--ignore-scripts','--no-audit','--no-fund','--offline','./pakka-agent-0.7.0.tgz'],consumer);
copyFileSync(join(root,'scripts/consumer-execution.mjs'),join(consumer,'execution.mjs'));
writeFileSync(join(root,'docs/.temp/execution-consumer-path.txt'), consumer+'\n');
run([join(consumer,'execution.mjs')],consumer);
