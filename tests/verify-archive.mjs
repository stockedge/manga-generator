import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pack,inspect} from '../src/archive.mjs';
const root=process.cwd();fs.mkdirSync(path.join(root,'tmp'),{recursive:true});const folder=fs.mkdtempSync(path.join(root,'tmp','archive-'));
try{
 const long=path.relative(root,folder).replaceAll('\\','/')+'/nested/'+'x'.repeat(90)+'.txt';fs.mkdirSync(path.dirname(long),{recursive:true});fs.writeFileSync(long,'日本語とUTF-8の保存\n');
 const empty=path.relative(root,folder).replaceAll('\\','/')+'/empty.txt';fs.writeFileSync(empty,'');
 const entries=Object.fromEntries([long,empty].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
 const archive=folder+'/test.tar.gz';await pack(archive,entries);await assert.rejects(()=>pack(archive,entries));
 const extracted=folder+'/extracted';await inspect(archive,entries,name=>path.join(extracted,name));
 assert.equal(fs.readFileSync(path.join(extracted,long),'utf8'),'日本語とUTF-8の保存\n');
 const wrong={...entries,[long]:'0'.repeat(64)};await assert.rejects(()=>inspect(archive,wrong),/hash mismatch/);
 const truncated=folder+'/truncated.tar.gz';fs.writeFileSync(truncated,fs.readFileSync(archive).subarray(0,30));await assert.rejects(()=>inspect(truncated,entries));
 console.log('PASS: streaming portable archive, UTF-8, long paths, empty files, preserved releases, corrupt/truncated archive rejection');
}finally{assert.ok(folder.startsWith(path.join(root,'tmp','archive-')));fs.rmSync(folder,{recursive:true,force:true});}
