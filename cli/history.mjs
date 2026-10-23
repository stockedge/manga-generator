import {runtimeFiles} from '../src/runtime-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {checkpoint,listStates,extractState} from '../src/state-history.mjs';
import {pack} from '../src/archive.mjs';
import {root} from '../src/workspace.mjs';
const [mode,arg,...rest]=process.argv.slice(2);
const selected=process.env.MANGA_PROJECT;
const work=selected && path.dirname(path.resolve(root,selected));
if(mode==='checkpoint-all'){
  for(const item of fs.readdirSync(path.join(root,'works'),{withFileTypes:true}))if(item.isDirectory() && fs.existsSync(path.join(root,'works',item.name,'workflow.json'))){
    const state=checkpoint(root,path.join(root,'works',item.name),arg||'all works checkpoint');console.log(item.name+' '+state.id);
  }
}else{
  assert.ok(selected,'Set MANGA_PROJECT explicitly');
  if(mode==='checkpoint')console.log(JSON.stringify(checkpoint(root,work,arg||'manual'),null,2));
  else if(mode==='list')console.log(JSON.stringify(listStates(root,work),null,2));
  else if(mode==='extract'){
    assert.ok(rest[0],'Use extract STATE_ID NEW_DIRECTORY');console.log(JSON.stringify(extractState(root,work,arg,rest[0]),null,2));
  }else if(mode==='run'){
    assert.ok(arg,'Use run EXECUTABLE [ARGS...]');checkpoint(root,work,'before external: '+[arg,...rest].join(' '));
    const result=spawnSync(arg,rest,{cwd:root,stdio:'inherit',windowsHide:true,shell:false});
    checkpoint(root,work,'after external: '+[arg,...rest].join(' '));
    if(result.error)throw result.error;process.exitCode=result.status??1;
  }else if(mode==='bundle'){
    assert.ok(arg,'Use bundle NEW_ARCHIVE.tar.gz');
    checkpoint(root,work,'history export');
    const folder=path.join(root,'.manga-history','states',path.basename(work));
    const entries={};
    const add=file=>{const name=path.relative(root,file).replaceAll('\\','/');entries[name]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');};
    for(const state of listStates(root,work)){
      const file=path.join(folder,state.id+'.json');add(file);
      const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
      for(const item of Object.values(manifest.entries))add(path.join(root,'.manga-history','objects',item.hash.slice(0,2),item.hash));
    }
    for(const name of [...runtimeFiles(root),'LICENSE'])add(path.join(root,name));
    process.chdir(root);await pack(path.resolve(arg),entries);console.log('Saved portable intermediate history: '+path.resolve(arg));
  }else throw new Error('Use checkpoint [LABEL] | checkpoint-all [LABEL] | list | extract ID NEW_DIRECTORY | run EXECUTABLE [ARGS...] | bundle NEW_ARCHIVE.tar.gz');
}
