import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Controlled external CDP peer for a real, observed Chromium cancellation response.
 * It deterministically orders that response before Page.navigate completes; real
 * Chromium/origin isolation remains covered by pocket-browser.test.ts's other cases.
 */
export async function interceptionExecutable(
	root: string,
	origin: string,
	outsideOrigin: string,
	error: { readonly code: number; readonly message: string },
): Promise<string> {
	const path = join(root, "controlled-cdp-browser");
	await writeFile(
		path,
		`#!${process.execPath}
const fs=require('node:fs');
const input=fs.createReadStream(null,{fd:3}),output=fs.createWriteStream(null,{fd:4});
const error=${JSON.stringify(error)},origin=${JSON.stringify(origin)};
let buffer='',navigation;
const emit=value=>output.write(JSON.stringify(value)+'\\0');
const reply=(id,result={})=>emit({id,result});
input.setEncoding('utf8');
input.on('data',chunk=>{
 buffer+=chunk;
 for(let boundary=buffer.indexOf('\\0');boundary!==-1;boundary=buffer.indexOf('\\0')){
  const command=JSON.parse(buffer.slice(0,boundary));buffer=buffer.slice(boundary+1);
  const id=command.id;
  switch(command.method){
   case 'Browser.close':reply(id);output.end(()=>process.exit(0));break;
   case 'Target.createBrowserContext':reply(id,{browserContextId:'controlled-context'});break;
   case 'Target.createTarget':reply(id,{targetId:'controlled-target'});break;
   case 'Target.attachToTarget':reply(id,{sessionId:'controlled-session'});break;
   case 'Page.navigate':
    navigation=id;
    emit({method:'Fetch.requestPaused',sessionId:'controlled-session',params:{requestId:'expired-request',request:{url:${JSON.stringify(outsideOrigin + "/cancelled")}}}});
    break;
   case 'Fetch.failRequest':
    emit({id,error});reply(navigation);break;
   case 'Runtime.evaluate':reply(id,{result:{value:{url:origin,title:'Approved page',text:'APPROVED-PAGE-AFTER-CANCEL'}}});break;
   default:reply(id);
  }
 }
});
`,
		{ mode: 0o700 },
	);
	return path;
}
