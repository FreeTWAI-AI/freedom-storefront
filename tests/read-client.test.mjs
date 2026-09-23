import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ScopedReadClient,platformOrigin,startPairing} from '../client/read-client.mjs';
const run=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
const kind='storefront',resource='stores',resourcePath='/retail/stores',token='fw_read_'+'A'.repeat(43);
async function withServer(handler,fn){const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try {const address=server.address();return await fn(`http://127.0.0.1:${address.port}`);} finally {await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}
const credential=(origin)=>({format:'freedom.read-connection/v1',origin,scope:kind+':read',access_token:token,expires_at:new Date(Date.now()+3600000).toISOString()});

test('read transport rejects unsafe origins, prototype resources and non-read operations',async()=>{
 for(const origin of ['https://example.com/path','https://user:password@example.com','http://example.com','https://example.com/'])assert.throws(()=>platformOrigin(origin));
 let calls=0;const client=new ScopedReadClient({token,fetcher:async()=>{calls++;throw Error('must not fetch');}});
 for(const resource of ['constructor','__proto__','../../me/account','createProduct','auth/login'])await assert.rejects(()=>client.read(resource),/Unsupported read resource/);
 assert.equal(calls,0);
 assert.throws(()=>new ScopedReadClient({token:'browser-session'}));
 await assert.rejects(()=>startPairing({kind:'admin',clientName:'Invalid'}),/Unknown client kind/);
});

test('native CLI reads scoped API using private credentials without exposing tokens or browser cookies',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'freedom-read-client-')),file=join(directory,'connection.json');let requests=0;
 try {await withServer((req,res)=>{
   requests++;assert.equal(req.url,'/client-api/v1'+resourcePath);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer '+token);assert.equal(req.headers.cookie,undefined);assert.equal(req.headers['x-csrf-token'],undefined);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[{example:'member-owned-data'}],read_only:true}));
 },async origin=>{
   await writeFile(file,JSON.stringify(credential(origin)),{mode:0o600});
   const {stdout,stderr}=await run(process.execPath,['scripts/run-client.mjs','read',resource],{cwd:root,env:{...process.env,FREEDOM_PLATFORM_ORIGIN:origin,FREEDOM_CREDENTIAL_FILE:file,FREEDOM_CLIENT_KIND:kind==='supplier'?'storefront':'supplier'}});
   assert.deepEqual(JSON.parse(stdout),{items:[{example:'member-owned-data'}],read_only:true});assert.ok(!stdout.includes(token));assert.ok(!stderr.includes(token));
 });assert.equal(requests,1);} finally {await rm(directory,{recursive:true,force:true});}
});

test('CLI refuses readable-by-others credential files, symlinks and wrong resource kind',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'freedom-read-client-')),file=join(directory,'connection.json');
 try {
  await writeFile(file,JSON.stringify(credential('https://freetwai.com')),{mode:0o644});
  const args=['scripts/run-client.mjs','read',resource],options={cwd:root,env:{...process.env,FREEDOM_CREDENTIAL_FILE:file,FREEDOM_PLATFORM_ORIGIN:'https://freetwai.com'}};
  await assert.rejects(()=>run(process.execPath,args,options),error=>{assert.match(error.stderr,/private regular file/);assert.ok(!error.stderr.includes(token));return true;});
  await chmod(file,0o600);const link=join(directory,'linked.json');await symlink(file,link);
  await assert.rejects(()=>run(process.execPath,args,{...options,env:{...options.env,FREEDOM_CREDENTIAL_FILE:link}}));
  await assert.rejects(()=>run(process.execPath,['scripts/run-client.mjs','read',kind==='supplier'?'catalog':'products'],options),error=>{assert.match(error.stderr,/Read resource must be one of/);return true;});
 } finally {await rm(directory,{recursive:true,force:true});}
});

test('native transport refuses credential-bearing redirects',async()=>{
 let redirected=0;
 await withServer((req,res)=>{if(req.url==='/steal'){redirected++;res.end('{}');}else{res.statusCode=302;res.setHeader('Location','/steal');res.end();}},async origin=>{
  const client=new ScopedReadClient({origin,token});await assert.rejects(()=>client.read(resource));
 });assert.equal(redirected,0);
});

test('vendored helper bytes match their declared source digests',async()=>{
 const result=await run(process.execPath,['scripts/verify-client-source.mjs'],{cwd:root});assert.match(result.stdout,/bytes verified/);
});


test('malformed private credential JSON never echoes token material to stderr',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'freedom-read-client-')),file=join(directory,'connection.json');
 try {
  // JSON.parse itself would quote the beginning of this invalid private input.
  await writeFile(file,token,{mode:0o600});
  await assert.rejects(()=>run(process.execPath,['scripts/run-client.mjs','read',resource],{cwd:root,env:{...process.env,FREEDOM_CREDENTIAL_FILE:file,FREEDOM_PLATFORM_ORIGIN:'https://freetwai.com'}}),error=>{
    assert.ok(!error.stdout.includes(token));assert.ok(!error.stderr.includes(token));assert.ok(!error.stderr.includes('fw_read_'));assert.match(error.stderr,/Private credential file contains invalid JSON/);return true;
  });
 } finally {await rm(directory,{recursive:true,force:true});}
});
