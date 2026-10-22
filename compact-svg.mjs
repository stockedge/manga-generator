import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root,local} from './project.mjs';

// Consolidate identical embedded page images without editing any image pixels.
export function compactSVG(source){
 const pattern=/<image href="(data:image\/png;base64,[A-Za-z0-9+/=]+)" width="1024" height="1536" preserveAspectRatio="none" clip-path="(url\(#p\d+\))"\/>/g;
 const matches=[...source.matchAll(pattern)];if(matches.length<2)return source;
 assert.ok(!source.includes('id="compacted-page-'),'Already compacted');
 const images=[...new Set(matches.map(m=>m[1]))];
 const body=source.replace(pattern,(_,image,clip)=>`<use href="#compacted-page-${images.indexOf(image)}" clip-path="${clip}"/>`);
 const defs='<defs>'+images.map((href,i)=>`<image id="compacted-page-${i}" href="${href}" width="1024" height="1536" preserveAspectRatio="none"/>`).join('')+'</defs>';
 return body.replace(/(<svg\b[^>]*>)/,'$1'+defs);
}
if(process.argv[1] && path.resolve(process.argv[1])===path.join(root,'compact-svg.mjs')){
 for(const relative of process.argv.slice(2)){
  const file=local(relative);assert.ok(!file.startsWith(path.join(root,'releases')+path.sep),'Preserve immutable releases');
  assert.ok(file.endsWith('.svg'),'Expected SVG');
  const before=fs.readFileSync(file,'utf8'),after=compactSVG(before);
  if(after!==before)fs.writeFileSync(file,after);
  console.log(relative+': '+Math.round((before.length-after.length)/1048576)+' MiB saved');
 }
}
