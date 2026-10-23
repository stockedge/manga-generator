import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {root} from '../src/workspace.mjs';
import {runtimeFiles} from '../src/runtime-files.mjs';
import {checkpoint,extractState,listStates} from '../src/state-history.mjs';
import {inspect} from '../src/archive.mjs';
import {copyRuntime} from './support.mjs';

// This exercises packaging with blank fixtures, never a production work or review.
fs.mkdirSync(path.join(root,'tmp'),{recursive:true});
const fixture=fs.mkdtempSync(path.join(root,'tmp','layout-'));
copyRuntime(root,fixture);
for(const file of ['package.json','README.md','REPRODUCE.md','AGENTS.md','LICENSE','works/sample/workflow.json','works/sample/source/original.txt']){
 const target=path.join(fixture,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);
}
fs.cpSync(path.join(root,'docs'),path.join(fixture,'docs'),{recursive:true});
const project='works/layout-check/workflow.json';
const run=(file,args=[],cwd=fixture)=>execFileSync(process.execPath,[path.join(fixture,file),...args],{cwd,env:{...process.env,MANGA_PROJECT:project},encoding:'utf8',stdio:'pipe',windowsHide:true});
// Direct new CLI also resolves its root when invoked from outside the repository.
run('cli/new-work.mjs',['layout-check','Synthetic layout fixture'],path.dirname(fixture));
assert.ok(fs.existsSync(path.join(fixture,project)));
const config=JSON.parse(fs.readFileSync(path.join(root,'works/sample/workflow.json')));
Object.assign(config,{title:'Synthetic layout fixture',references:[],sourceFile:'works/layout-check/source/original.txt',assetDir:'works/layout-check/assets',workflowDir:'works/layout-check/workflow',outputDir:'works/layout-check/output'});
fs.writeFileSync(path.join(fixture,project),JSON.stringify(config));
assert.ok(!fs.readdirSync(fixture).some(file=>file.endsWith('.mjs')||file==='export-pdf.py'),'No root compatibility entry points may be required');
run('cli/workflow.mjs',['check']);
run('cli/workflow.mjs',['plan']);
const jobs=fs.readFileSync(path.join(fixture,config.workflowDir,'panel-jobs.json'));
run('cli/workflow.mjs',['plan']);assert.deepEqual(fs.readFileSync(path.join(fixture,config.workflowDir,'panel-jobs.json')),jobs);
// A small standards-compliant blank RGB PNG for the material gate.
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,body,tail]);}
const header=Buffer.alloc(13);header.writeUInt32BE(1024);header.writeUInt32BE(1536,4);header[8]=8;header[9]=2;
const rows=Buffer.alloc((1024*3+1)*1536,255);for(let y=0;y<1536;y++)rows[y*(1024*3+1)]=0;
fs.writeFileSync(path.join(fixture,'blank.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
for(const panel of config.pages.flatMap(p=>p.panels))run('cli/workflow.mjs',['accept-panel',panel.id,'blank.png','--reviewed','--reason','Synthetic regression fixture only']);
run('cli/workflow.mjs',['preview']);
for(const page of config.pages)run('cli/workflow.mjs',['review',page.id,'--speakers','--faces','--order','--continuity']);
run('cli/workflow.mjs',['build']);run('cli/workflow.mjs',['layers']);
run('tests/verify-workflow.mjs');
run('cli/reproduce.mjs',['freeze']);run('cli/reproduce.mjs');
const lock=JSON.parse(fs.readFileSync(path.join(fixture,project.replace('.json','.lock.json'))));
for(const file of runtimeFiles(fixture))assert.ok(lock.inputs[file],'Missing packaged runtime: '+file);
assert.ok(lock.inputs.LICENSE,'Packaged code must retain its license');
assert.ok(!Object.keys(lock.inputs).some(file=>/^[^/]+\.mjs$/.test(file)),'Package must not depend on root compatibility modules');
const bundleOutput=run('cli/reproduce.mjs',['bundle']);
assert.match(bundleOutput,/Verified portable release/);
const bundle=path.join(fixture,'releases',fs.readdirSync(path.join(fixture,'releases'))[0]);
execFileSync(process.execPath,[path.join(bundle,'cli/reproduce.mjs')],{cwd:path.dirname(fixture),env:{...process.env,MANGA_PROJECT:project},stdio:'pipe',windowsHide:true});
// Changing the relocated implementation must invalidate a frozen input.
const quality=path.join(fixture,'src','quality.mjs'),qualityBefore=fs.readFileSync(quality);
fs.appendFileSync(quality,'\n// synthetic changed runtime\n');assert.throws(()=>run('cli/reproduce.mjs',['check']),/Changed saved input/);fs.writeFileSync(quality,qualityBefore);
run('cli/reproduce.mjs',['check']);
const state=checkpoint(fixture,path.join(fixture,'works','layout-check'),'layout regression');
const restored=path.join(fixture,'restored');extractState(fixture,path.join(fixture,'works','layout-check'),state.id,restored);
for(const file of [...runtimeFiles(fixture),'LICENSE'])assert.deepEqual(fs.readFileSync(path.join(restored,file)),fs.readFileSync(path.join(fixture,file)));
execFileSync(process.execPath,[path.join(restored,'cli/workflow.mjs'),'check'],{cwd:path.dirname(fixture),env:{...process.env,MANGA_PROJECT:project},stdio:'pipe',windowsHide:true});
run('cli/history.mjs',['bundle','history.tar.gz']);
const archive=path.join(fixture,'history.tar.gz'),stored={};
const add=file=>{stored[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture,file))).digest('hex');};
for(const state of listStates(fixture,path.join(fixture,'works','layout-check'))){
 const file='.manga-history/states/layout-check/'+state.id+'.json';add(file);
 const manifest=JSON.parse(fs.readFileSync(path.join(fixture,file)));
 for(const entry of Object.values(manifest.entries))add('.manga-history/objects/'+entry.hash.slice(0,2)+'/'+entry.hash);
}
for(const file of [...runtimeFiles(fixture),'LICENSE'])add(file);
await inspect(archive,stored);
for(const file of ['cli/history.mjs','src/state-history.mjs','src/runtime-files.mjs','src/archive.mjs'])assert.ok(stored[file],'History bundle missing '+file);
assert.deepEqual(fs.readFileSync(path.join(fixture,'templates','reader.html')),fs.readFileSync(path.join(root,'templates','reader.html')));
console.log('PASS: canonical commands without root wrappers, external cwd, frozen runtime tamper rejection, portable rebuild, restored runtime and history bundle');
