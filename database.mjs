import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
const scrypt=promisify(scryptCallback);
export class StoreError extends Error{constructor(status,message){super(message);this.status=status;}}
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
const publicUser=u=>u?{id:u.id,name:u.name,email:u.email}:null;
export function openStore(filename){
 if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,id TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,id));`);
 async function credentials(email,password){if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email.trim()))throw new StoreError(400,'Enter a valid email address.');if(typeof password!=='string'||password.length<8||password.length>128)throw new StoreError(400,'Use a password between 8 and 128 characters.');return{email:email.trim().toLowerCase(),password};}
 const hash=async(password,salt)=>Buffer.from(await scrypt(password,salt,64,{N:16384,r:8,p:1}));
 function session(user){const token=randomBytes(32).toString('hex');const maxAge=7*24*60*60;db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),user.id,Date.now()+maxAge*1000);return{user:publicUser(user),token,maxAge};}
 return {db,
 async register(body){const {email,password}=await credentials(body?.email,body?.password);const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>60)throw new StoreError(400,'Enter a name between 1 and 60 characters.');const salt=randomBytes(16).toString('hex');const passwordHash=(await hash(password,salt)).toString('hex');let result;try{result=db.prepare('INSERT INTO users(name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)').run(name,email,passwordHash,salt,new Date().toISOString());}catch(error){if(error.code?.includes('CONSTRAINT')||String(error.message).includes('UNIQUE'))throw new StoreError(409,'An account with this email already exists. Try logging in.');throw error;}return session(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid));},
 async login(body){const {email,password}=await credentials(body?.email,body?.password);const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);const computed=await hash(password,user?.salt||'00000000000000000000000000000000');if(!user||!timingSafeEqual(computed,Buffer.from(user.password_hash,'hex')))throw new StoreError(401,'Email or password is incorrect.');return session(user);},
 user(token){if(!token||!/^[a-f0-9]{64}$/.test(token))return null;return publicUser(db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(token),Date.now()));},
 logout(token){if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));},
 projects(userId){return db.prepare('SELECT data FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(userId).map(r=>JSON.parse(r.data));},
 save(userId,project){const exists=db.prepare('SELECT 1 FROM projects WHERE user_id=? AND id=?').get(userId,project.id);if(!exists&&db.prepare('SELECT count(*) AS n FROM projects WHERE user_id=?').get(userId).n>=100)throw new StoreError(400,'You have 100 saved projects. Clear old history before adding more.');db.prepare('INSERT INTO projects(user_id,id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(userId,project.id,JSON.stringify(project),new Date().toISOString());},
 clear(userId){db.prepare('DELETE FROM projects WHERE user_id=?').run(userId);},
 close(){db.close();}
 };
}
export function validateProject(p){
 const fail=()=>{throw new StoreError(400,'Invalid project data.');};
 const string=(v,n=10000)=>typeof v==='string'&&v.length<=n;
 if(!p||!string(p.id,80)||!/^[a-zA-Z0-9-]{1,80}$/.test(p.id)||!['plant','light','climate','ai'].includes(p.key)||!['idea','budget','level','complete'].includes(p.stage)||!(p.budget===null||Number.isFinite(p.budget)&&p.budget>0&&p.budget<=10000000)||!(p.level===null||['Beginner','Intermediate'].includes(p.level))||!Array.isArray(p.messages)||p.messages.length<1||p.messages.length>200||!p.messages.every(m=>m&&['user','assistant'].includes(m.role)&&string(m.text)))fail();
 const clean={id:p.id,key:p.key,stage:p.stage,budget:p.budget,level:p.level,messages:p.messages.map(m=>({role:m.role,text:m.text})),date:typeof p.date==='string'&&!Number.isNaN(Date.parse(p.date))?p.date:new Date().toISOString()};
 if(p.aiPlan){const a=p.aiPlan;const arr=(v,max,predicate)=>Array.isArray(v)&&v.length<=max&&v.every(predicate);
 if(!string(a.title,180)||!string(a.summary,4000)||!['Beginner','Intermediate'].includes(a.level)||!Number.isFinite(a.budget)||a.budget<=0||!arr(a.blocks,12,v=>string(v,180))||!arr(a.bom,20,r=>Array.isArray(r)&&r.length===4&&string(r[0],180)&&Number.isInteger(r[1])&&r[1]>0&&r[1]<=1000&&Number.isFinite(r[2])&&r[2]>=0&&r[2]<=1000000&&string(r[3],1200))||!arr(a.steps,12,r=>Array.isArray(r)&&r.length===2&&string(r[0],180)&&string(r[1],4000))||!arr(a.tests,12,v=>string(v,1200))||!arr(a.refs,7,r=>Array.isArray(r)&&r.length===3&&r.every(v=>string(v,1200))))fail();
 const allowed=new Set(['docs.arduino.cc','learn.adafruit.com','documentation.espressif.com','github.com']);
 const refs=a.refs.filter(r=>{try{const u=new URL(r[1]);return u.protocol==='https:'&&allowed.has(u.hostname)&&!u.username&&!u.password;}catch{return false;}});
 const total=Math.round(a.bom.reduce((sum,r)=>sum+r[1]*r[2],0)*100)/100;
 clean.aiPlan={title:a.title,summary:a.summary,level:a.level,budget:a.budget,blocks:a.blocks,bom:a.bom,steps:a.steps,tests:a.tests,refs,advanced:string(a.advanced,3000)?a.advanced:'',total,over:total>a.budget};
 }
 if(clean.stage==='complete'&&clean.key==='ai'&&!clean.aiPlan)fail();
 return clean;
}
