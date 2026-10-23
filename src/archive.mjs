import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createGzip,createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';

// USTAR + gzip: a portable bundle without a second uncompressed checkout.
const hash=()=>crypto.createHash('sha256');
function header(name,size){
 const b=Buffer.alloc(512),slash=name.lastIndexOf('/');
 const short=Buffer.byteLength(name)<=100?name:name.slice(slash+1),prefix=short===name?'':name.slice(0,slash);
 assert.ok(Buffer.byteLength(short)<=100 && Buffer.byteLength(prefix)<=155,'Archive path too long');
 b.write(short,0,100);b.write('0000644\0',100);b.write('0000000\0',108);b.write('0000000\0',116);
 b.write(size.toString(8).padStart(11,'0')+'\0',124);b.write('00000000000\0',136);b.fill(32,148,156);b[156]=48;b.write('ustar\0',257);b.write('00',263);b.write(prefix,345,155);
 b.write([...b].reduce((n,v)=>n+v,0).toString(8).padStart(6,'0')+'\0 ',148);return b;
}
export async function pack(destination,entries){
 assert.ok(!fs.existsSync(destination),'Release already exists');fs.mkdirSync(path.dirname(destination),{recursive:true});
 const temporary=destination+'.writing',gzip=createGzip({level:6}),complete=pipeline(gzip,fs.createWriteStream(temporary,{flags:'wx'}));
 // Attach early so an ENOSPC cannot become an unhandled rejection.
 complete.catch(()=>{});
 const write=async bytes=>{if(!gzip.write(bytes))await once(gzip,'drain');};
 try{
  for(const [name,expected] of Object.entries(entries)){
   const bytes=fs.readFileSync(name);assert.equal(hash().update(bytes).digest('hex'),expected,'Input changed while packaging: '+name);
   await write(header(name,bytes.length));await write(bytes);if(bytes.length%512)await write(Buffer.alloc(512-bytes.length%512));
  }
  gzip.end(Buffer.alloc(1024));await complete;
  await inspect(temporary,entries);fs.renameSync(temporary,destination);
 }catch(e){gzip.destroy(e);await complete.catch(()=>{});throw e;}
}
export async function inspect(archive,entries,copy){
 const seen=new Set();let buffer=Buffer.alloc(0),current=null,padding=0,ended=false;
 const str=(b,a,n)=>b.subarray(a,a+n).toString().split('\0')[0];
 for await(const chunk of fs.createReadStream(archive).pipe(createGunzip())){
  buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length){
   if(padding){const n=Math.min(padding,buffer.length);assert.ok(buffer.subarray(0,n).every(v=>v===0),'Invalid padding');padding-=n;buffer=buffer.subarray(n);if(padding)break;}
   if(!current){
    if(buffer.length<512)break;const b=buffer.subarray(0,512);buffer=buffer.subarray(512);
    if(b.every(v=>v===0)){ended=true;continue;}assert.ok(!ended,'Data after TAR end');
    assert.equal(b[156],48,'Archive entries must be ordinary files');assert.equal(str(b,257,6),'ustar','Expected USTAR header');
    const sum=parseInt(str(b,148,8),8),check=Buffer.from(b);check.fill(32,148,156);assert.equal([...check].reduce((n,v)=>n+v,0),sum,'Invalid TAR checksum');
    const prefix=str(b,345,155),name=(prefix?prefix+'/':'')+str(b,0,100);
    assert.ok(Object.hasOwn(entries,name) && !seen.has(name),'Unexpected archive entry: '+name);seen.add(name);
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'),'Unsafe archive entry');
    const size=parseInt(str(b,124,12),8);assert.ok(Number.isSafeInteger(size) && size>=0,'Invalid file size');
    current={name,remaining:size,size,digest:hash(),target:copy?.(name)};
    if(current.target){fs.mkdirSync(path.dirname(current.target),{recursive:true});current.fd=fs.openSync(current.target,'wx');}
   }
   const n=Math.min(current.remaining,buffer.length),bytes=buffer.subarray(0,n);current.digest.update(bytes);if(current.fd!==undefined)fs.writeSync(current.fd,bytes);buffer=buffer.subarray(n);current.remaining-=n;
   if(current.remaining)break;
   if(current.fd!==undefined)fs.closeSync(current.fd);
   assert.equal(current.digest.digest('hex'),entries[current.name],'Archive hash mismatch: '+current.name);padding=(512-current.size%512)%512;current=null;
  }
 }
 assert.ok(ended && !current && !padding && !buffer.length,'Truncated archive');assert.equal(seen.size,Object.keys(entries).length,'Missing archive files');
}
