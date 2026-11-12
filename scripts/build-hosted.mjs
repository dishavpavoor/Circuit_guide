import {readFile,writeFile,mkdir} from 'node:fs/promises';
const assets={};for(const [name,type] of [['index.html','text/html; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['engine.js','text/javascript; charset=utf-8']])assets['/'+name]={body:await readFile('dist/'+name,'utf8'),type};
const server=await readFile('server.mjs','utf8'),database=await readFile('database.mjs','utf8');
const shared=server.slice(server.indexOf('export const references='),server.indexOf('const mime='));
const validator=database.slice(database.indexOf('export function validateProject('));
await mkdir('dist/server',{recursive:true});await writeFile('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+shared+'\n'+validator+'\n'+await readFile('hosted/worker.mjs','utf8'));
console.log('Hosted Worker built with embedded assets; local Node app preserved.');
