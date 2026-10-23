import fs from 'node:fs';
import path from 'node:path';
import {runtimeFiles} from '../src/runtime-files.mjs';

export function copyRuntime(root,destination,entrypoints){
 const names=[...(entrypoints||fs.readdirSync(root).filter(name=>name.endsWith('.mjs'))), ...runtimeFiles(root)];
 for(const name of names){const target=path.join(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,name),target);}
}
