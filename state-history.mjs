import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const inside=(base,file)=>file.startsWith(base+path.sep);
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function renameHistoryFile(source,destination){
  for(let attempt=0;;attempt++){
    try{return fs.renameSync(source,destination);}
    catch(error){
      if(!['EBUSY','EPERM','EACCES'].includes(error.code)||attempt>=8)throw error;
      // Windows sync/virus scanners can briefly hold cache/latest open. Keep
      // both files intact and retry the same atomic replacement, never delete.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50*(attempt+1));
    }
  }
}
function files(folder){
  const result=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);
    // Windows cloud placeholders can be reported as links by readdir while
    // lstat identifies a regular file. Inspect the path itself; real links
    // remain forbidden rather than following their target.
    const stat=fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink(),'State history refuses symbolic links: '+file);
    if(stat.isDirectory())result.push(...files(file));
    else if(stat.isFile())result.push(file);
  }
  return result;
}
function locations(root,work){
  root=path.resolve(root);work=path.resolve(work);
  assert.ok(inside(path.join(root,'works'),work),'History requires a work directory under works/');
  const store=path.join(root,'.manga-history');
  const key=path.relative(root,work).replaceAll('\\','/');
  return {root,work,store,key,folder:path.join(store,'states',path.basename(work))};
}

// Store immutable bytes separately from manifests: repeated references and images
// occupy one object even when many stages contain the same file.
export function checkpoint(root,work,label='manual'){
  const loc=locations(root,work),{store,folder}=loc;
  fs.mkdirSync(folder,{recursive:true});
  const cacheFile=path.join(folder,'cache.json');
  const cache=fs.existsSync(cacheFile)?readJSON(cacheFile):{};
  const shared=fs.readdirSync(loc.root).filter(name=>/\.(mjs|py|html|md)$/.test(name) || name==='package.json').map(name=>path.join(loc.root,name));
  const sample=path.join(loc.root,'works','sample','workflow.json');
  if(fs.existsSync(sample)&&!inside(loc.work,sample))shared.push(sample);
  if(fs.existsSync(path.join(loc.root,'docs')))shared.push(...files(path.join(loc.root,'docs')));
  const entries={},nextCache={};
  for(const file of [...files(loc.work),...shared].sort()){
    const name=path.relative(loc.root,file).replaceAll('\\','/');
    const stat=fs.statSync(file,{bigint:true});
    const stamp=[stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
    let hash=cache[name]?.stamp===stamp?cache[name].hash:null;
    let object=hash && path.join(store,'objects',hash.slice(0,2),hash);
    if(!hash || !fs.existsSync(object)){
      const bytes=fs.readFileSync(file);hash=digest(bytes);
      object=path.join(store,'objects',hash.slice(0,2),hash);
      fs.mkdirSync(path.dirname(object),{recursive:true});
      if(!fs.existsSync(object)){
        const temporary=object+'.'+crypto.randomUUID()+'.writing';
        fs.writeFileSync(temporary,bytes,{flag:'wx'});
        // Copy, never hard-link: later edits must not alter saved bytes.
        try{fs.linkSync(temporary,object);}catch(error){if(error.code!=='EEXIST')throw error;}
        fs.unlinkSync(temporary);
      }
    }
    assert.equal(fs.statSync(object).size,Number(stat.size),'Damaged history object: '+name);
    entries[name]={hash,size:Number(stat.size)};nextCache[name]={stamp,hash};
  }
  const stateHash=digest(JSON.stringify(entries));
  const latestFile=path.join(folder,'latest.json');
  const latest=fs.existsSync(latestFile)?readJSON(latestFile):null;
  if(latest?.stateHash===stateHash)return latest;
  const id=new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomUUID().slice(0,8);
  const manifest={version:1,id,work:loc.key,label,createdAt:new Date().toISOString(),stateHash,entries};
  fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  for(const [file,value] of [[cacheFile,nextCache],[latestFile,{id,stateHash}]]){
    const temp=file+'.'+crypto.randomUUID()+'.writing';fs.writeFileSync(temp,JSON.stringify(value,null,2));renameHistoryFile(temp,file);
  }
  return {id,stateHash};
}

export function listStates(root,work){
  const {folder}=locations(root,work);
  if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(name=>name.endsWith('.json') && !['latest.json','cache.json'].includes(name)).sort().map(name=>{
    const m=readJSON(path.join(folder,name));return {id:m.id,label:m.label,createdAt:m.createdAt,files:Object.keys(m.entries).length};
  });
}

export function extractState(root,work,id,destination){
  const {folder,store}=locations(root,work);
  assert.match(id,/^[\w.-]+$/,'Unsafe state ID');
  const manifest=readJSON(path.join(folder,id+'.json'));
  assert.equal(digest(JSON.stringify(manifest.entries)),manifest.stateHash,'History manifest changed');
  destination=path.resolve(destination);
  assert.ok(!fs.existsSync(destination),'Extract into a NEW directory; live works and releases are never overwritten');
  // Verify every object before creating any restored files.
  for(const [name,item] of Object.entries(manifest.entries)){
    assert.ok(inside(destination,path.resolve(destination,name)),'Unsafe saved path');
    assert.match(item.hash,/^[a-f0-9]{64}$/);
    const object=path.join(store,'objects',item.hash.slice(0,2),item.hash);
    assert.equal(digest(fs.readFileSync(object)),item.hash,'Damaged history object: '+name);
  }
  fs.mkdirSync(destination,{recursive:true});
  for(const [name,item] of Object.entries(manifest.entries)){
    const target=path.resolve(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(store,'objects',item.hash.slice(0,2),item.hash),target,fs.constants.COPYFILE_EXCL);
  }
  return {id,files:Object.keys(manifest.entries).length,destination};
}

export function trackState(root,configFile){
  const work=path.dirname(path.resolve(root,configFile));
  if(!inside(path.join(root,'works'),work) || process.argv[1]?.endsWith('history.mjs'))return;
  const label=path.basename(process.argv[1]||'node')+' '+process.argv.slice(2).join(' ');
  checkpoint(root,work,'before: '+label);
  process.once('exit',()=>{
    try{checkpoint(root,work,'after: '+label);}
    catch(error){process.stderr.write('Intermediate state could not be saved: '+error.message+'\n');process.exitCode=1;}
  });
}
