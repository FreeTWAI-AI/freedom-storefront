// Member-approved device pairing; never accepts or sends a browser password/session.
const tokenPattern=/^fw_read_[A-Za-z0-9_-]{43}$/;
export function platformOrigin(raw='https://freetwai.com'){
 const u=new URL(raw);
 if(u.origin!==raw||u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error('Use an exact HTTPS platform origin (HTTP only for local development).');
 return u.origin;
}
async function jsonRequest(origin,path,{method='GET',body,token,fetcher=fetch}={}){
 const headers={Accept:'application/json'};
 if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=origin;}
 if(token)headers.Authorization='Bearer '+token;
 const response=await fetcher(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 const chunks=[];let length=0;
 if(!response.body)throw Error('Platform response body missing.');
 const reader=response.body.getReader();
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>2*1024*1024)throw Error('Platform response too large.');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('Platform returned invalid JSON.');}
 if(!response.ok&&!(response.status===429&&data?.status==='slow_down')){const error=new Error('Platform request failed (HTTP '+response.status+'). Check the connection in your account.');error.status=response.status;throw error;}
 return data;
}
export async function startPairing({origin='https://freetwai.com',kind,clientName,fetcher}={}){
 origin=platformOrigin(origin);
 if(!['storefront','supplier'].includes(kind))throw Error('Unknown client kind.');
 const data=await jsonRequest(origin,'/api/v1/client-connections/start',{method:'POST',body:{kind,client_name:clientName},fetcher});
 if(!/^fw_pair_[A-Za-z0-9_-]{43}$/.test(data?.device_secret)||!/^([A-F0-9]{5}-){3}[A-F0-9]{5}$/.test(data.user_code)||data.verification_uri!==origin+'/#account'||data.scope!==kind+':read'||data.expires_in!==300||data.interval!==5)throw Error('Invalid pairing response.');
 return data;
}
export async function pollPairing({origin='https://freetwai.com',deviceSecret,fetcher}={}){
 origin=platformOrigin(origin);
 if(!/^fw_pair_[A-Za-z0-9_-]{43}$/.test(deviceSecret??''))throw Error('Invalid pairing secret.');
 const data=await jsonRequest(origin,'/api/v1/client-connections/poll',{method:'POST',body:{device_secret:deviceSecret},fetcher});
 if(!['authorization_pending','slow_down','authorized'].includes(data?.status))throw Error('Pairing failed or expired; start a new request.');
 if(data.status==='authorized'&&(!tokenPattern.test(data.access_token??'')||!['storefront:read','supplier:read'].includes(data.scope)||data.read_only!==true||data.api_base_path!=='/client-api/v1'||!Number.isFinite(Date.parse(data.expires_at))))throw Error('Invalid approved connection response.');
 return data;
}
export class ScopedReadClient{
 #origin;#token;#fetcher;
 constructor({origin='https://freetwai.com',token,fetcher}={}){this.#origin=platformOrigin(origin);if(!tokenPattern.test(token??''))throw Error('Invalid read connection token.');this.#token=token;this.#fetcher=fetcher;}
 async read(resource){
 const paths={connection:'/connection',catalog:'/retail/catalog',stores:'/retail/stores',listings:'/retail/listings',products:'/supplier/products',requests:'/supplier/requests'};
 if(!Object.hasOwn(paths,resource))throw Error('Unsupported read resource.');
 const data=await jsonRequest(this.#origin,'/client-api/v1'+paths[resource],{token:this.#token,fetcher:this.#fetcher});
 if(data?.read_only!==true||(resource!=='connection'&&!Array.isArray(data.items)))throw Error('Invalid read connection response.');
 return data;
 }
}
