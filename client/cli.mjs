import {mkdir,open,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {startPairing,pollPairing,ScopedReadClient,platformOrigin} from './read-client.mjs';
const kind=process.env.FREEDOM_CLIENT_KIND??'storefront';
if(!['storefront','supplier'].includes(kind))throw Error('FREEDOM_CLIENT_KIND must be storefront or supplier.');
const file=process.env.FREEDOM_CREDENTIAL_FILE??join(homedir(),'.config/freedom-clients',kind+'.json');
const origin=platformOrigin(process.env.FREEDOM_PLATFORM_ORIGIN??'https://freetwai.com');
const mode=process.argv[2]??'help';
if(mode==='connect'){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 // Reserve a private non-overwriting file before requesting a one-time credential.
 const destination=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
 let stored=false;
 try{
  const pairing=await startPairing({origin,kind,clientName:process.env.FREEDOM_CLIENT_NAME??'我的自由工坊客戶端'});
  console.log('請在自己的瀏覽器登入：'+pairing.verification_uri+'\n連線代碼：'+pairing.user_code+'\n確認客戶端名稱與讀取範圍；不需把密碼提供给客戶端。');
  const until=Date.now()+pairing.expires_in*1000;let granted;
  while(Date.now()<until){await new Promise(resolve=>setTimeout(resolve,pairing.interval*1000));const state=await pollPairing({origin,deviceSecret:pairing.device_secret});if(state.status==='authorized'){granted=state;break;}}
  if(!granted||granted.scope!==kind+':read')throw Error('Pairing expired or scope changed.');
  await destination.writeFile(JSON.stringify({format:'freedom.read-connection/v1',origin,...granted},null,2)+'\n');
  stored=true;
  console.log('已保存私人讀取連線：'+file+'\n可在平台隨時撤銷；不會把 token 放進 repo。');
 }finally{await destination.close();if(!stored)await unlink(file);}
}else if(mode==='read'){
 const source=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 let saved;try{const stat=await source.stat();if(!stat.isFile()||(stat.mode&0o077)||stat.size>65536)throw Error('Credential must be a small private regular file (chmod600).');const text=await source.readFile('utf8');try{saved=JSON.parse(text);}catch{throw Error('Private credential file contains invalid JSON. Reconnect in the platform.');}}finally{await source.close();}
 if(saved.format!=='freedom.read-connection/v1'||saved.origin!==origin||saved.scope!==kind+':read'||!Number.isFinite(Date.parse(saved.expires_at))||Date.parse(saved.expires_at)<=Date.now())throw Error('Credential origin/scope mismatch or expired. Reconnect in the platform.');
 const client=new ScopedReadClient({origin,token:saved.access_token});
 console.log(JSON.stringify(await client.read(process.argv[3]??'connection'),null,2));
}else{console.log('FREEDOM_CLIENT_KIND=storefront|supplier node client/cli.mjs connect\nnode client/cli.mjs read connection|catalog|stores|listings|products|requests\n資料修改請在 https://freetwai.com/ 操作。');}
