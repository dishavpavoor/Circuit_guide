// Hosted adapter. The build prepends shared Groq validation and HTML/CSS/JS assets.
class StoreError extends Error{constructor(status,message){super(message);this.status=status;}}
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/.{2}/g)||[],s=>parseInt(s,16));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async text=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256));}
function equal(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
const cookie=(token,seconds)=>`cg_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${seconds}`;
const publicUser=u=>u?{id:u.id,name:u.name,email:u.email}:null;
async function limit(db,key,max,seconds){const now=Date.now(),window=Math.floor(now/(seconds*1000)),id=key+':'+window;const row=await db.prepare('INSERT INTO request_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(id,(window+1)*seconds*1000).first();if(row.count>max)throw new StoreError(429,'Request limit reached. Please try again later.');}
async function bodyJSON(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new StoreError(415,'Send JSON content.');const reader=request.body?.getReader();if(!reader)throw new StoreError(400,'Request body required.');let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>250000){await reader.cancel();throw new StoreError(413,'Request too large.');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new StoreError(400,'Invalid JSON request.');}}
export default {async fetch(request,env){
 const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
 const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...security,'Content-Type':'application/json','Cache-Control':'no-store',...extra}});
 try{
 const url=new URL(request.url);const method=request.method;
 const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new StoreError(403,'Origin rejected.');
 if(!url.pathname.startsWith('/api/')){const asset=ASSETS[url.pathname==='/'?'/index.html':url.pathname];if(!asset)return json({error:'Not found.'},404);if(!['GET','HEAD'].includes(method))throw new StoreError(405,'Method not allowed.');return new Response(method==='HEAD'?null:asset.body,{headers:{...security,'Content-Type':asset.type,'Cache-Control':'no-cache'}});}
 if(url.pathname==='/api/status'&&method==='GET')return json({configured:!!env.GROQ_API_KEY,provider:'Groq',model:env.GROQ_MODEL||'llama-3.3-70b-versatile',authenticationRequired:true});
 const db=env.DB;if(!db)throw new StoreError(503,'Database binding is not available.');
 const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cg_session='))?.slice(11);
 const tokenDigest=token&&/^[a-f0-9]{64}$/.test(token)?await digest(token):null;
 const user=tokenDigest?await db.prepare('SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenDigest,Date.now()).first():null;
 if(url.pathname==='/api/auth/me'&&method==='GET')return json({user:publicUser(user)});
 if(['/api/auth/register','/api/auth/login'].includes(url.pathname)&&method==='POST'){
 const ip=request.headers.get('cf-connecting-ip')||'unknown';await limit(db,'auth:'+await digest(ip),15,900);
 const body=await bodyJSON(request);const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';const password=body?.password;
 if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)throw new StoreError(400,'Enter a valid email address.');
 if(typeof password!=='string'||password.length<8||password.length>128)throw new StoreError(400,'Use a password between 8 and 128 characters.');
 let account;
 if(url.pathname.endsWith('/register')){const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>60)throw new StoreError(400,'Enter a name between 1 and 60 characters.');const salt=random();const hash=await passwordHash(password,salt);try{account=await db.prepare('INSERT INTO users(name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?) RETURNING id,name,email').bind(name,email,hash,salt,new Date().toISOString()).first();}catch(error){if(String(error.message).includes('UNIQUE'))throw new StoreError(409,'This email is already registered. Try logging in.');throw error;}}
 else{const found=await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();const computed=await passwordHash(password,found?.salt||'00'.repeat(32));if(!found||!equal(found.password_hash,computed))throw new StoreError(401,'Email or password is incorrect.');account=publicUser(found);}
 const nextToken=random();await db.batch([db.prepare('DELETE FROM sessions WHERE expires_at<? OR token_hash=?').bind(Date.now(),tokenDigest||''),db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(nextToken),account.id,Date.now()+604800000)]);
 return json({user:account},200,{'Set-Cookie':cookie(nextToken,604800)});
 }
 if(url.pathname==='/api/auth/logout'&&method==='POST'){await bodyJSON(request);if(tokenDigest)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenDigest).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
 if(url.pathname==='/api/projects'){
 if(!user)throw new StoreError(401,'Log in to save or load your projects.');
 if(method==='GET'){const result=await db.prepare('SELECT data FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').bind(user.id).all();return json({projects:result.results.map(r=>JSON.parse(r.data))});}
 if(method==='PUT'){const project=validateProject(await bodyJSON(request));const count=await db.prepare('SELECT count(*) AS n FROM projects WHERE user_id=? AND id<>?').bind(user.id,project.id).first();if(count.n>=100)throw new StoreError(400,'You have 100 projects. Clear old history before adding more.');await db.prepare('INSERT INTO projects(user_id,id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(user.id,project.id,JSON.stringify(project),new Date().toISOString()).run();return json({ok:true});}
 if(method==='DELETE'){await bodyJSON(request);await db.prepare('DELETE FROM projects WHERE user_id=?').bind(user.id).run();return json({ok:true});}
 }
 if(url.pathname==='/api/chat'&&method==='POST'){
 if(!user)throw new StoreError(401,'Please log in before using the live AI assistant.');
 await limit(db,'ai-minute:'+user.id,5,60);await limit(db,'ai-day:'+user.id,50,86400);
 return json(await askGroq(await bodyJSON(request),{apiKey:env.GROQ_API_KEY,model:env.GROQ_MODEL||'llama-3.3-70b-versatile'}));
 }
 return json({error:'Not found.'},404);
 }catch(error){return json({error:error.status?error.message:'The server could not complete this request. Please retry.'},error.status||500);}
}};
