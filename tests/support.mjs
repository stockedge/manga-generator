import fs from 'node:fs';
import path from 'node:path';
import {runtimeFiles} from '../src/runtime-files.mjs';

export function copyRuntime(root,destination,files){
 const names=files||runtimeFiles(root);
 for(const name of names){const target=path.join(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,name),target);}
}
