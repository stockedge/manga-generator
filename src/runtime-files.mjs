import fs from 'node:fs';
import path from 'node:path';

// These directories contain code and templates needed by restored copies.
export function runtimeFiles(root){
 const result=[];
 function walk(relative){
  const full=path.join(root,relative);if(!fs.existsSync(full))return;
  for(const entry of fs.readdirSync(full,{withFileTypes:true})){
   const file=path.posix.join(relative,entry.name);
   if(entry.isDirectory())walk(file);else if(entry.isFile())result.push(file);
  }
 }
 for(const dir of ['cli','src','scripts','templates','tests'])walk(dir);
 return result.sort();
}
