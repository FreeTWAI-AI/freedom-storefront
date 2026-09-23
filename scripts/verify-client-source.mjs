import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const lock=JSON.parse(await readFile(new URL('../client-source.lock.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(lock.format!=='freedom.read-client-source/v1'||lock.source_repository!=='FreeTWAI-AI/freedom-platform')throw Error('Invalid read-client source lock');
const remote=process.argv.includes('--remote');
if(remote&&!/^[a-f0-9]{40}$/.test(lock.source_commit??''))throw Error('Pin the final Platform commit before publishing this client');
if(Object.keys(lock.files).sort().join(',')!=='cli.mjs,read-client.mjs')throw Error('Unexpected shared helper file set');
for(const [name,entry] of Object.entries(lock.files)){
 if(entry.source_path!==`packages/client-connections/${name}`)throw Error('Unexpected canonical helper path');
 const path=new URL('../client/'+name,import.meta.url),stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Helper must be a regular file');
 const bytes=await readFile(path);if(hash(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw Error('Shared read client changed: '+name);
 if(remote){const response=await fetch(`https://raw.githubusercontent.com/${lock.source_repository}/${lock.source_commit}/${entry.source_path}`,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Cannot read pinned helper source: '+name);const upstream=new Uint8Array(await response.arrayBuffer());if(upstream.byteLength>65536||hash(upstream)!==entry.sha256)throw Error('Pinned helper source differs: '+name);}
}
console.log('Shared read-client bytes verified'+(remote?' against pinned Platform commit':'; source commit checked separately before publishing')+'.');
