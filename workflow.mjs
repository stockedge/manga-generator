import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

import {root,config,configFile,local} from './project.mjs';
import {qualityInstructions,qualityGate} from './quality.mjs';
import {validateFaceDesign,referenceInstructions} from './face-design.mjs';
import {readingFlow,flowOverlay,narrativePlan} from './reading-flow.mjs';
import {requireReview} from './stage-reviews.mjs';
import {renderStoryboardSketch} from './storyboard-sketch.mjs';
validateFaceDesign(config,local);
const drawingInstructions=qualityInstructions(config);
const cast=config.cast;
assert.ok(cast && Object.keys(cast).length,'Define the work cast');
for(const id of Object.keys(cast))assert.match(id,/^[a-zA-Z][a-zA-Z0-9_-]*$/,'Invalid cast ID');
const caption=id=>cast[id]?.kind==='caption';
for(const p of [config.workflowDir||'workflow',config.assetDir||'assets/v2',config.outputDir||'output-v2',...(config.references||[])])local(p);
const workflowDir = config.workflowDir || 'workflow';
const assetDir = config.assetDir || 'assets/v2';
const dir = path.join(root,workflowDir);
const output = path.join(root,config.outputDir || 'output-v2');
const panelsOnly=config.renderMode==='panels';
assert.ok(config.renderMode===undefined || ['page','panels'].includes(config.renderMode),'Unknown renderMode');
const layoutReference=file=>[workflowDir+'/storyboards',workflowDir+'/panels'].includes(path.posix.dirname(file)) && /^page-[a-zA-Z0-9_-]+\.png$/.test(path.posix.basename(file));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function imageFile(file,page=false){const bytes=fs.readFileSync(file);assert.ok(bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Expected a PNG image');if(page){assert.equal(bytes.readUInt32BE(16),1024,'Page PNG must be 1024x1536');assert.equal(bytes.readUInt32BE(20),1536,'Page PNG must be 1024x1536');}return bytes;}
const xml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const overlap = (a,b) => a[0]<b[0]+b[2] && b[0]<a[0]+a[2] && a[1]<b[1]+b[3] && b[1]<a[1]+a[3];
function columns(text, count=10) {
  const result=[]; let line='';
  for(const c of text.replace(/\n/g,'')) {
    // Closing punctuation stays with the preceding column even at the capacity boundary.
    if([...line].length>=count && !'。、！？）」』…'.includes(c)){result.push(line);line='';}
    line+=c;
  }
  if(line) result.push(line);
  return result;
}
function speechColumns(speech){
  if(speech.textColumns===undefined)return columns(speech.text,speech.capacity??10);
  assert.ok(Array.isArray(speech.textColumns)&&speech.textColumns.length>0&&speech.textColumns.every(s=>typeof s==='string'&&s.trim().length>0),'textColumns must be a nonempty array of nonempty strings');
  assert.equal(speech.textColumns.join(''),speech.text.replace(/\n/g,''),'textColumns must preserve the complete dialogue text');
  return speech.textColumns;
}
function box(panel, speech) {
  const lines=speechColumns(speech);
  assert.ok(speech.textDirection===undefined || ['vertical','horizontal'].includes(speech.textDirection),'Invalid textDirection');
  const horizontal=speech.textDirection==='horizontal';
  const longest=Math.max(...lines.map(s=>[...s].length));
  const width=horizontal?longest*26+36:lines.length*28+36;
  const height=horizontal?lines.length*32+42:longest*27+42;
  const [x,y,w]=panel.rect;
  return [speech.x===undefined?(speech.side==='right'?x+w-width-18:x+18):x+speech.x,y+(speech.dy??18),width,height];
}
function tailGeometry(panel,d) {
  const speaker=panel.speakers?.[d.speaker];
  if(caption(d.speaker) || speaker?.kind==='offscreen')return null;
  assert.ok(speaker?.anchor,'Missing speaker anchor: '+panel.id+'/'+d.speaker);
  const [x,y,w,h]=box(panel,d),cx=x+w/2,cy=y+h/2;
  const [tx,ty]=speaker.anchor,dx=tx-cx,dy=ty-cy;
  const scale=Math.min(dx===0?Infinity:w/2/Math.abs(dx),dy===0?Infinity:h/2/Math.abs(dy));
  assert.ok(scale<1,'Speaker anchor inside balloon: '+panel.id);
  const bx=cx+dx*scale,by=cy+dy*scale;
  const length=Math.hypot(tx-bx,ty-by),ux=(tx-bx)/length,uy=(ty-by)/length;
  const faceEntry=speaker.face?segmentEntry([bx,by],[tx,ty],speaker.face):null;
  const reach=Math.max(0,Math.min(d.tailLength??160,length-28,faceEntry===null?Infinity:length*faceEntry-6));
  const tip=[bx+ux*reach,by+uy*reach];
  const horizontal=Math.abs(bx-x)<1 || Math.abs(bx-x-w)<1;
  return {base:[bx,by],tip,a:[bx-(horizontal?0:7)-ux*4,by-(horizontal?7:0)-uy*4],b:[bx+(horizontal?0:7)-ux*4,by+(horizontal?7:0)-uy*4]};
}
function segmentEntry(a,b,rect){
  let low=0,high=1;
  for(let axis=0;axis<2;axis++){const delta=b[axis]-a[axis],min=rect[axis],max=min+rect[axis+2];if(delta===0){if(a[axis]<min||a[axis]>max)return null;continue;}const t1=(min-a[axis])/delta,t2=(max-a[axis])/delta;low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));if(low>high)return null;}
  return low;
}
function stateFor(page,p){
  const id=p?.section??page.section;
  if(id)assert.ok(Object.hasOwn(config.sections||{},id),'Unknown story section: '+id);
  const base=id?config.sections[id]:{},change=p?.state||{};
  for(const value of [base,change])assert.ok(value && typeof value==='object' && !Array.isArray(value),'Section state must be an object');
  const state={...base,...change};
  for(const field of ['costumes','objects']){
    for(const value of [base[field],change[field]])if(value!==undefined)assert.ok(value && typeof value==='object' && !Array.isArray(value) && Object.values(value).every(v=>typeof v==='string'),'State '+field+' must map IDs to descriptions');
    if(base[field]||change[field])state[field]={...base[field],...change[field]};
  }
  for(const actor of Object.keys(state.costumes||{}))assert.ok(Object.hasOwn(cast,actor),'Unknown costume actor: '+actor);
  if(state.references!==undefined)assert.ok(Array.isArray(state.references),'State references must be an array');
  for(const file of state.references||[])local(file);
  return state;
}
const stateText=(page,p)=>{const s=stateFor(page,p);return Object.keys(s).length?'\nSECTION STATE: '+JSON.stringify(s):'';};
function validate(data=config) {
  assert.ok(Array.isArray(data.pages) && data.pages.length,'No pages');
  const panelIds=new Set();
  const ids=new Set();
  for(const page of data.pages) {
    if(data.version>=3){assert.ok(page.expectation?.length,'Missing reader expectation');page.panels.forEach(p=>assert.ok(['提示','始動','反応','期待','転換','決定','余韻','笑い'].includes(p.role),'Missing narrative role'));}
    if(page.showcase!==undefined && page.showcase!==null && page.showcase!=='')assert.ok(page.panels.some(p=>p.id===page.showcase),'Unknown showcase panel: '+page.id);
    assert.match(page.id,/^\d{2}$/); assert.ok(!ids.has(page.id));ids.add(page.id);
    assert.ok(page.panels.length>=2 && page.panels.length<=6);
    page.panels.forEach((p,i)=>{
      stateFor(page,p);
      assert.match(p.id,/^[a-zA-Z0-9_-]+$/);assert.ok(!panelIds.has(p.id),'Duplicate panel ID');panelIds.add(p.id);
      const [x,y,w,h]=p.rect;
      if(p.storyboardSketch!==undefined)renderStoryboardSketch(p.storyboardSketch,p.rect,'validate-sketch',{rough:true});
      for(const [id,a] of Object.entries(p.speakers||{})){assert.ok(Object.hasOwn(cast,id),'Unknown actor');if(a.kind!=='offscreen'){assert.ok(a.anchor?.length===2 && a.anchor.every(Number.isFinite),'Invalid anchor');assert.ok(a.anchor[0]>=x && a.anchor[0]<=x+w && a.anchor[1]>=y && a.anchor[1]<=y+h,'Speaker anchor outside panel');assert.ok(a.kind==='head' || a.face?.length===4 && a.face.every(Number.isFinite) && a.face[2]>0 && a.face[3]>0,'Visible speaker needs face bounds');if(a.face)assert.ok(a.face[0]>=x && a.face[1]>=y && a.face[0]+a.face[2]<=x+w && a.face[1]+a.face[3]<=y+h,'Face outside panel');}}
      assert.ok([x,y,w,h].every(Number.isFinite) && x>=16 && y>=16 && w>0 && h>0 && x+w<=1008 && y+h<=1464,'Panel outside safe area');
      assert.equal(p.order,i+1);
      for(const q of page.panels.slice(0,i))assert.ok(!overlap(p.rect,q.rect),'Panels overlap');
      if(i){const prev=page.panels[i-1].rect;assert.ok(y>prev[1] || (y===prev[1] && x<prev[0]),'Reading order must be top to bottom, right to left');}
      for(const r of p.protected||[])assert.ok(r.length===4 && r.every(Number.isFinite) && r[2]>0 && r[3]>0 && r[0]>=x && r[1]>=y && r[0]+r[2]<=x+w && r[1]+r[3]<=y+h,'Invalid protected area: '+p.id);
      const bounds=p.dialogue.map(d=>{
        if(d.tailLength!==undefined)assert.ok(Number.isInteger(d.tailLength)&&d.tailLength>=24&&d.tailLength<=160,'tailLength must be an integer from 24 to 160');
        assert.ok(Object.hasOwn(cast,d.speaker),'Unknown speaker: '+d.speaker);
        assert.ok(d.text.length && ['right','left'].includes(d.side));
        if(caption(d.speaker))assert.ok(!/^(?:お読みいただき|ご(?:愛読|読了))ありがとうございます[。！!]*$/.test(d.text.replace(/[\s、,]/g,'')),'Reader acknowledgement belongs in source records, not manga dialogue: '+p.id);
        assert.ok(Number.isInteger(d.capacity??10) && (d.capacity??10)>=4 && (d.capacity??10)<=14);
        const b=box(p,d);
        assert.ok(b[0]>=x && b[1]>=y && b[0]+b[2]<=x+w && b[1]+b[3]<=y+h,`Balloon outside panel ${p.id}: ${JSON.stringify(b)} within ${JSON.stringify(p.rect)}`);
        if(data.version>=4){
          assert.ok(caption(d.speaker)||p.speakers?.[d.speaker],'Missing speaker anchor');
          for(const s of Object.values(p.speakers||{})){if(s.face)assert.ok(!overlap(b,s.face),'Balloon covers face: '+p.id);if(s.anchor)assert.ok(s.anchor[0]>=x && s.anchor[0]<=x+w && s.anchor[1]>=y && s.anchor[1]<=y+h,'Speaker anchor outside panel');}
          const t=tailGeometry(p,d);
          if(t)for(const s of Object.values(p.speakers||{}))if(s.face)assert.equal(segmentEntry(t.base,t.tip,s.face),null,'Tail crosses face: '+p.id);
        }
        for(const r of p.protected||[]){assert.ok(r.length===4 && r.every(Number.isFinite) && r[2]>0 && r[3]>0,'Invalid protected area');assert.ok(!overlap(b,r),'Balloon covers protected area: '+p.id);}
        return b;
      });
      if(data.version>=5)bounds.forEach((b,j)=>{if(j){const a=bounds[j-1];assert.ok(b[1]>=a[1] && (b[0]<=a[0] || b[1]>=a[1]+80),'Ambiguous dialogue reading order: '+p.id);}const t=tailGeometry(p,p.dialogue[j]);if(t){for(const [k,r] of bounds.entries())if(k!==j)assert.equal(segmentEntry(t.base,t.tip,r),null,'Tail crosses another balloon: '+p.id);for(const r of p.protected||[])assert.equal(segmentEntry(t.base,t.tip,r),null,'Tail crosses protected area: '+p.id);}});
      bounds.forEach((b,j)=>bounds.slice(0,j).forEach(c=>assert.ok(!overlap(b,c),'Balloons overlap: '+p.id)));
    });
  }
}
function balloon(panel,d) {
  const [x,y,w,h]=box(panel,d), lines=speechColumns(d);
  const isCaption=caption(d.speaker);
  const t=tailGeometry(panel,d);
  const tail=t?`<path data-speaker="${d.speaker}" d="M ${t.a.join(' ')} L ${t.tip.join(' ')} L ${t.b.join(' ')}" fill="white" stroke="black" stroke-width="2"/>`:'';
  const shape=`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${isCaption?'':`rx="${Math.min(34,w/3)}"`} fill="white" stroke="black" stroke-width="2"/>`;
  if(d.textDirection==='horizontal')return tail+shape+lines.map((text,i)=>`<text x="${x+18}" y="${y+34+i*32}" font-family="Meiryo,MS Gothic,sans-serif" font-size="26" fill="black">${xml(text)}</text>`).join('');
  return tail+shape+lines.map((text,i)=>`<text x="${x+w-24-i*28}" y="${y+22}" font-family="Meiryo,MS Gothic,sans-serif" font-size="26" fill="black" style="writing-mode:vertical-rl;text-orientation:upright">${xml(text)}</text>`).join('');
}
function balloonMask(panel,d) {
  const [x,y,w,h]=box(panel,d), radius=Math.min(34,w/3);
  const t=tailGeometry(panel,d);
  const tail=t?`<path d="M ${t.a.join(' ')} L ${t.tip.join(' ')} L ${t.b.join(' ')} Z" fill="white" stroke="white" stroke-width="6" stroke-linejoin="round"/>`:'';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="white" stroke="white" stroke-width="6"/>${tail}`;
}
function svg(page, art, rough=false, layer='all', guides=true) {
  const provenance=art?JSON.parse(fs.readFileSync(path.join(root,assetDir,`page-${page.id}.json`),'utf8')):null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">${layer==='all'?'<rect width="1024" height="1536" fill="white"/>':''}${art && layer!=='lettering'?`<defs><image id="page-source" href="data:image/png;base64,${art}" width="1024" height="1536" preserveAspectRatio="none"/></defs>`:''}${page.panels.map((p,i)=>{
    const [x,y,w,h]=p.rect;
    const [sx,sy,sw,sh]=provenance?.sourceRects?.[i]??p.rect;
    // ponytail: contain keeps anatomy undistorted; draw a new panel when the aspect mismatch wastes too much space.
    const picture=art?`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sx} ${sy} ${sw} ${sh}" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="p${i}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}"/></clipPath></defs><use href="#page-source" clip-path="url(#p${i})"/></svg>`:Object.entries(p.speakers||{}).map(([id,s])=>s.kind==='offscreen'?'':`${s.face?`<rect x="${s.face[0]}" y="${s.face[1]}" width="${s.face[2]}" height="${s.face[3]}" fill="${rough && !art && p.storyboardSketch ? "none" : "#f5f5f5"}" stroke="#bbb"/>`:''}<circle cx="${s.anchor[0]}" cy="${s.anchor[1]}" r="5" fill="#999"/><text x="${s.anchor[0]+10}" y="${s.anchor[1]}" font-size="18">${xml(id)}</text>`).join('');
    const override=path.join(root,assetDir,'panels',`${p.id}.png`);
    const record=path.join(root,assetDir,'panels',`${p.id}.json`);
    let material=picture;
    if((art || panelsOnly && !rough) && fs.existsSync(override)) {
      assert.ok(fs.existsSync(record),'Panel override has no review record');
      const r=JSON.parse(fs.readFileSync(record,'utf8'));
      assert.equal(r.fingerprint,panelJob(page,p).fingerprint,'Stale panel override');
      assert.equal(r.imageHash,hash(fs.readFileSync(override)),'Panel image modified after review');
      material=`<image href="data:image/png;base64,${fs.readFileSync(override).toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    if(rough && !art && p.storyboardSketch)material=renderStoryboardSketch(p.storyboardSketch,p.rect,'rough-sketch-'+i,{rough:true})+material;
    if(panelsOnly && !rough)assert.ok(fs.existsSync(override),'Missing panel artwork: '+p.id);
    const lettering=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="black" stroke-width="3"/>`+(layer==='artwork'?'':p.dialogue.map(d=>balloonMask(p,d)).join(''))+p.dialogue.map(d=>balloon(p,d)).join('');
    return (layer==='lettering'?'':material)+(layer==='artwork'?'':lettering)+(rough && guides?`<text x="${x+12}" y="${y+h-14}" font-size="18" fill="#666">${p.order} / ${xml(p.beat)}</text>`:'');
  }).join('')}${layer==='artwork'?'':`<text x="512" y="1500" text-anchor="middle" font-family="sans-serif" font-size="20">${Number(page.id)}</text>`}</svg>`;
}
function promptBase(page,baked=false) {
  return `Use case: illustration-story. Produce ONE finished monochrome manga page, 1024x1536 portrait, Japanese RIGHT-TO-LEFT reading. Use the supplied canonical references. The storyboard is the exact layout: preserve ALL panel rectangle positions and sizes and white balloon footprints. Gray face rectangles and labeled mouth anchors are exact reserved character positions, not final artwork. Preserve them; balloon tails must point to those actors. Additional artwork references preserve identity; their old layouts do not override this plan.\nSTYLE: ${config.style}\nPAGE PURPOSE: ${page.purpose}.\n${page.panels.map(p=>`Panel ${p.order}, rectangle [x,y,width,height]=${JSON.stringify(p.rect)}: ${p.scene}${stateText(page,p)}\nDialogue in reading order: ${p.dialogue.map(d=>`${d.speaker}: "${d.text.replace(/\n/g,'')}" at ${JSON.stringify(box(p,d))}`).join('; ')}`).join('\n')}\n${baked?'Render the quoted Japanese dialogue verbatim in vertical columns inside exactly the indicated balloons. No extra words.':'Do NOT render any text, letters, page number or storyboard labels. Keep white EMPTY balloons in precisely the supplied positions; typography will be added separately. Do not draw faces, hands, receipts or rings underneath those balloon footprints.'}\nNo extra panels. No top dialogue strips. Integrate balloons into each composition with natural white space. Economical ink, white backgrounds in closeups, only a few simple location contours in establishing shots. NO wood grain, grass texture, wall texture, excessive strands, fabric micro-hatching, photorealism or glossy gradients. Clear purposeful acting, different shot sizes, coherent hands. CAST: ${JSON.stringify(cast)}. CONTINUITY: ${config.continuity||'Preserve reference identities and props.'}`;
}
function prompt(page,baked=false){return promptBase(page,baked)+drawingInstructions;}
function job(page) {
  const references=[...new Set([...(config.references||[]),`${workflowDir}/storyboards/page-${page.id}.png`,...(page.references||[]),...page.panels.flatMap(p=>stateFor(page,p).references||[])])];
  const spec={page:page.id,prompt:prompt(page)+referenceInstructions(config,references),references,rectangles:page.panels.map(p=>p.rect)};
  const fingerprint=hash(JSON.stringify(spec)+hash(svg(page,null,true))+references.filter(r=>!layoutReference(r)).map(r=>fs.existsSync(local(r))?hash(fs.readFileSync(local(r))):'missing:'+r).join('')+(config.sourceFile?hash(fs.readFileSync(local(config.sourceFile))):''));
  return {...spec,fingerprint,asset:`${assetDir}/page-${page.id}.png`,record:`${assetDir}/page-${page.id}.json`};
}
function materialJobs(page){return [...(panelsOnly?[]:[job(page)]),...page.panels.filter(p=>panelsOnly || fs.existsSync(path.join(root,assetDir,'panels',p.id+'.png'))).map(p=>panelJob(page,p))];}
function assetStatus(j){
  if(!fs.existsSync(local(j.asset))||!fs.existsSync(local(j.record)))return 'pending';
  const r=JSON.parse(fs.readFileSync(local(j.record),'utf8'));
  if(j.references.filter(f=>!layoutReference(f)).some(f=>!fs.existsSync(local(f))))return 'pending';
  return r.reviewed && r.fingerprint===j.fingerprint && r.imageHash===hash(fs.readFileSync(local(j.asset)))?'ready':'stale';
}
function materialStatus(page){const statuses=materialJobs(page).map(assetStatus);return statuses.includes('pending')?'pending':statuses.includes('stale')?'stale':'ready';}
function reviewFingerprint(page){
  if(!panelsOnly)return hash(JSON.stringify(page)+hash(fs.readFileSync(local(job(page).asset)))+hash(fs.readFileSync(local(job(page).record)))+page.panels.map(p=>{const f=path.join(root,assetDir,'panels',p.id+'.png');return fs.existsSync(f)?hash(fs.readFileSync(f)):'';}).join(''));
  return hash(JSON.stringify(page)+materialJobs(page).map(j=>hash(fs.readFileSync(local(j.asset)))+hash(fs.readFileSync(local(j.record)))).join(''));
}
function status(page) {
  const materials=materialStatus(page);if(materials!=='ready')return materials;
  const reviewFile=path.join(root,assetDir,`page-${page.id}.review.json`);
  const aligned=config.version<5 || (fs.existsSync(reviewFile) && JSON.parse(fs.readFileSync(reviewFile)).fingerprint===reviewFingerprint(page));
  return aligned && quality.ready(page)?'ready':'stale';
}
function panelJobBase(page,p) {
  if(panelsOnly){
    const [x,y,w,h]=p.rect;
    const instructions=`Use case: illustration-story. Draw ONE monochrome manga panel, aspect ${w}:${h}. No page layout, borders, speech bubbles, captions, letters or watermark. Leave the storyboard balloon footprints WHITE and EMPTY; typography and balloon shapes will be added by the compositor. Preserve the marked character positions.\nSTYLE: ${config.style}\nCAST: ${JSON.stringify(cast)}\nCONTINUITY: ${config.continuity||'Preserve reference identities.'}\nSCENE: ${p.scene}${stateText(page,p)}\nACTING/SHOT: ${JSON.stringify({action:p.action,emotion:p.emotion,camera:p.camera})}\nLocal mouth/face positions: ${JSON.stringify(Object.fromEntries(Object.entries(p.speakers||{}).map(([id,s])=>[id,{...s,anchor:s.anchor?.map((v,i)=>v-[x,y][i]),face:s.face?.map((v,i)=>i<2?v-[x,y][i]:v)}])))}\nReserved white rectangles [x,y,width,height]: ${JSON.stringify(p.dialogue.map(d=>box(p,d).map((v,i)=>i<2?v-[x,y][i]:v)))}\nUse sparse background contours, purposeful expressions, varied ink pressure. Avoid glossy gradients, microtexture, extra people and redundant decorations.`;
    const references=[...new Set([...(config.references||[]),`${workflowDir}/panels/page-${p.id}.png`,...(page.references||[]),...(stateFor(page,p).references||[]),...(p.references||[])])];
    references.forEach(local);
    const fingerprint=hash(instructions+(p.storyboardSketch===undefined?'':JSON.stringify(p.storyboardSketch))+JSON.stringify({rect:p.rect,dialogue:p.dialogue,role:p.role,purpose:page.purpose,expectation:page.expectation,references})+references.filter(f=>!layoutReference(f)).map(f=>fs.existsSync(local(f))?hash(fs.readFileSync(local(f))):'missing:'+f).join('')+(config.sourceFile?hash(fs.readFileSync(local(config.sourceFile))):''));
    return {id:p.id,parentPage:page.id,prompt:instructions,references,asset:`${assetDir}/panels/${p.id}.png`,record:`${assetDir}/panels/${p.id}.json`,fingerprint};
  }
  const one={...page,panels:[p]};
  const [x,y,w,h]=p.rect;
  const instructions=prompt(one).replace('1024x1536 portrait',`${w}x${h} single panel, aspect ${w}:${h}`)+`\nOutput only panel ${p.id}, no page layout or surrounding panels. Subtract [${x},${y}] from the supplied balloon coordinates to place them in this local panel. Reference 2 already shows the isolated panel. No text.`;
  const refs=[...(config.references||['assets/characters.png']),`${workflowDir}/panels/page-${p.id}.png`,...(page.references||[])];
  return {id:p.id,parentPage:page.id,prompt:instructions,references:refs,asset:`${assetDir}/panels/${p.id}.png`,record:`${assetDir}/panels/${p.id}.json`,fingerprint:hash(instructions+job(page).fingerprint)};
}
function panelJob(page,p){let j=panelJobBase(page,p);if(drawingInstructions && panelsOnly)j={...j,prompt:j.prompt+drawingInstructions,fingerprint:hash(j.fingerprint+drawingInstructions)};const roles=referenceInstructions(config,j.references);return roles?{...j,prompt:j.prompt+roles,fingerprint:hash(j.fingerprint+roles)}:j;}
const artFor=page=>panelsOnly?null:fs.readFileSync(local(job(page).asset)).toString('base64');
const quality=qualityGate({config,local,assetDir,dir,material:materialStatus,job:panelJob,compose:(page,folder)=>{
  let result=svg(page,artFor(page));
  for(const j of materialJobs(page))result=result.replaceAll('data:image/png;base64,'+fs.readFileSync(local(j.asset)).toString('base64'),xml(path.relative(folder,local(j.asset)).replaceAll('\\','/')));
  return result;
}});
const option=(name,fallback)=>{const i=process.argv.indexOf('--'+name);if(i<0)return fallback;assert.ok(process.argv[i+1] && !process.argv[i+1].startsWith('--'),'Missing --'+name+' value');return process.argv[i+1];};
function archive(j){
  if(!fs.existsSync(local(j.asset))||!fs.existsSync(local(j.record)))return;
  const record=fs.readFileSync(local(j.record)),image=fs.readFileSync(local(j.asset));
  const base=`${assetDir}/history/${j.id||'page-'+j.page}-${hash(Buffer.concat([image,record]))}`;
  fs.mkdirSync(path.dirname(local(base)),{recursive:true});
  for(const [ext,bytes] of [['png',image],['json',record]]){
    const target=local(base+'.'+ext);
    if(fs.existsSync(target) && fs.statSync(target).size>0){assert.ok(fs.readFileSync(target).equals(bytes),'Corrupt archive: '+target);continue;}
    const temporary=target+'.writing';fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,target);
  }
}
function saveAsset(j,file,record){
  const image=imageFile(file);const candidate=file.replace(/\.png$/,'.json');
  let selected;
  if(file.startsWith(local(assetDir+'/candidates')+path.sep)){
    assert.ok(fs.existsSync(candidate),'Candidate metadata missing');const c=JSON.parse(fs.readFileSync(candidate));selected=c;assert.equal(c.id,j.id,'Candidate belongs to a different panel');
    assert.equal(c.fingerprint,j.fingerprint,'Stale candidate: generate or register a candidate for the current plan');assert.equal(c.imageHash,hash(image),'Candidate image changed');
  }
  archive(j);fs.mkdirSync(path.dirname(local(j.asset)),{recursive:true});
  if(path.resolve(file)!==local(j.asset))fs.copyFileSync(file,local(j.asset));
  const meta={...record,renderer:option('renderer',selected?.renderer||'unspecified'),model:option('model',selected?.model||null),reason:option('reason','not supplied'),sourceFile:file,acceptedAt:new Date().toISOString(),acceptedJob:{prompt:j.prompt,references:j.references.map(f=>({path:f,imageHash:fs.existsSync(local(f))?hash(fs.readFileSync(local(f))):null,origin:config.assetSources?.[f]||null}))}};
  fs.writeFileSync(local(j.record),JSON.stringify(meta,null,2));archive(j);
  fs.appendFileSync(local(assetDir+'/history.jsonl'),JSON.stringify({event:'accept',target:j.id||j.page,imageHash:meta.imageHash,fingerprint:j.fingerprint,reason:meta.reason,renderer:meta.renderer,model:meta.model,time:meta.acceptedAt})+'\n');
}
const command=process.argv[2]||'plan';
if(command!=='layout')validate();
if(command==='layout') {
  const selectedPages=process.argv[3]==='all'?config.pages:config.pages.filter(p=>p.id===process.argv[3]);assert.ok(selectedPages.length,'Unknown page');
  const changes=[];
  for(const page of selectedPages)for(const p of page.panels){
    const original=structuredClone(p.dialogue),bounds=[];
    const pools=original.map(d=>{
      const start=box(p,d),items=[];
      for(const capacity of d.textColumns!==undefined?[d.capacity??10]:[...new Set([d.capacity??10,7,8,6,9,5,10,4,11,12,13,14])]){
        const test={...d,capacity},b=box(p,test),maxX=p.rect[2]-b[2]-12,maxY=p.rect[3]-b[3]-12;
        const xs=new Set([start[0]-p.rect[0],12,maxX]),ys=new Set([start[1]-p.rect[1],12,maxY]);
        for(let x=12;x<=maxX;x+=24)xs.add(x);for(let y=12;y<=maxY;y+=24)ys.add(y);
        for(const x of xs)for(const dy of ys){const c={...test,x,dy},r=box(p,c);
          if(x<0 || dy<0 || x+b[2]>p.rect[2] || dy+b[3]>p.rect[3])continue;
          if(Object.values(p.speakers||{}).some(s=>s.face && overlap(r,s.face)) || (p.protected||[]).some(a=>overlap(r,a)))continue;
          let tail;try{tail=tailGeometry(p,c);}catch{continue;}
          if(tail && [...Object.values(p.speakers||{}).filter(s=>s.face).map(s=>s.face),...(p.protected||[])].some(a=>segmentEntry(tail.base,tail.tip,a)!==null))continue;
          items.push({d:c,b:r,tail,score:Math.abs(r[0]-start[0])+1.2*Math.abs(r[1]-start[1])+80*Math.abs(capacity-(d.capacity??10))});
        }
      }
      return items.sort((a,b)=>a.score-b.score);
    });
    let attempts=0;
    const solve=i=>{if(i===pools.length){const candidate={...p,dialogue:bounds.map(v=>v.d)};return !readingFlow({...page,panels:[candidate]},box).panels[0].warnings.some(w=>w.code==='nonconsecutive-cluster');}
      for(const item of pools[i]){if(++attempts>100000)return false;const previous=bounds.at(-1)?.b;
        if(previous && !(item.b[1]>=previous[1] && (item.b[0]<=previous[0] || item.b[1]>=previous[1]+80)))continue;
        if(bounds.some(v=>overlap(item.b,v.b) || item.tail && segmentEntry(item.tail.base,item.tail.tip,v.b)!==null || v.tail && segmentEntry(v.tail.base,v.tail.tip,item.b)!==null))continue;
        bounds.push(item);if(solve(i+1))return true;bounds.pop();
      }return false;
    };
    assert.ok(solve(0),'No safe dialogue placement found: '+p.id+'; revise shot or lettering manually');
    p.dialogue=bounds.map(v=>v.d);changes.push({panel:p.id,dialogue:p.dialogue.map(d=>({x:d.x,dy:d.dy,capacity:d.capacity}))});
  }
  validate();if(process.argv.includes('--apply'))fs.writeFileSync(local(configFile),JSON.stringify(config,null,2));
  console.log(JSON.stringify({applied:process.argv.includes('--apply'),changes},null,2));
} else if(command==='check') {
  assert.equal(xml('<&'), '&lt;&amp;');
  assert.deepEqual(columns('あいうえお。',5),['あいうえお。']);
  assert.deepEqual(columns('あいうえおか',5),['あいうえお','か']);
  console.log(`OK: ${config.pages.length} pages, ${config.pages.reduce((n,p)=>n+p.panels.length,0)} panels; geometry, speakers and typography`);
} else if(command==='plan') {
  fs.mkdirSync(path.join(dir,'reading-flow'),{recursive:true});
  const flow=config.pages.map(page=>readingFlow(page,box));
  fs.writeFileSync(path.join(dir,'narrative-plan.json'),JSON.stringify(narrativePlan(config),null,2));
  fs.writeFileSync(path.join(dir,'reading-flow','plan.json'),JSON.stringify(flow,null,2));
  for(const page of config.pages){
    const currentFlow=flow.find(item=>item.page===page.id);
    fs.writeFileSync(path.join(dir,'reading-flow',`page-${page.id}.svg`),flowOverlay(svg(page,null,true),currentFlow));
    fs.writeFileSync(path.join(dir,'reading-flow',`page-${page.id}.json`),JSON.stringify(currentFlow,null,2));
  }
  fs.writeFileSync(path.join(dir,'reading-flow','index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>セリフの視線誘導計画</title><style>body{font-family:Meiryo;background:#ddd}img{display:block;width:min(90vw,800px);margin:20px auto}</style><p>青線・番号はセリフの順番、橙線は脚本に記録した視線の計画。自動診断は目視確認の代わりではありません。</p>${config.pages.map(page=>`<img src="page-${page.id}.svg" alt="${page.id}">`).join('')}</html>`);
  fs.mkdirSync(path.join(dir,'storyboards'),{recursive:true});fs.mkdirSync(path.join(dir,'storyboards-unnumbered'),{recursive:true});fs.mkdirSync(path.join(dir,'prompts'),{recursive:true});fs.mkdirSync(path.join(dir,'panels'),{recursive:true});
  for(const page of config.pages)fs.writeFileSync(path.join(dir,'storyboards-unnumbered',`page-${page.id}.svg`),svg(page,null,true,'all',false));
  fs.writeFileSync(path.join(dir,'storyboards-unnumbered','index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>読順確認用ネーム</title><style>body{background:#ddd}img{display:block;width:min(90vw,800px);margin:20px auto}</style>${config.pages.map(p=>`<img src="page-${p.id}.svg" alt="ページ ${xml(p.id)}">`).join('')}</html>`);
  for(const page of config.pages){fs.writeFileSync(path.join(dir,'storyboards',`page-${page.id}.svg`),svg(page,null,true));fs.writeFileSync(path.join(dir,'prompts',`page-${page.id}.txt`),prompt(page));fs.writeFileSync(path.join(dir,'prompts',`page-${page.id}-baked.txt`),prompt(page,true));}
  for(const page of config.pages)for(const p of page.panels){const [x,y,w,h]=p.rect;fs.writeFileSync(path.join(dir,'panels',`page-${p.id}.svg`),svg({...page,panels:[p]},null,true).replace('width="1024" height="1536" viewBox="0 0 1024 1536"',`width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`));}
  fs.writeFileSync(path.join(dir,'jobs.json'),JSON.stringify(config.pages.map(job),null,2));
  fs.writeFileSync(path.join(dir,'panel-jobs.json'),JSON.stringify(config.pages.flatMap(page=>page.panels.map(p=>panelJob(page,p))),null,2));
  fs.writeFileSync(path.join(dir,'story-memory.json'),JSON.stringify({cast,sections:config.sections||{},panels:config.pages.flatMap(page=>page.panels.map(p=>({id:p.id,section:p.section??page.section??null,state:stateFor(page,p)})))},null,2));
  fs.writeFileSync(path.join(dir,'storyboards','index.html'),`<html lang="ja"><meta charset="utf-8"><title>ネーム</title><style>body{background:#ddd}img{display:block;width:min(90vw,800px);margin:20px auto}</style>${config.pages.map(p=>`<img src="page-${p.id}.svg" alt="${xml(p.purpose)}">`).join('')}</html>`);
  console.log('Saved storyboards, exact dialogue, both prompt modes, render jobs');
} else if(command==='candidate-panel') {
  const page=config.pages.find(page=>page.panels.some(p=>p.id===process.argv[3]));assert.ok(page,'Unknown panel');
  const p=page.panels.find(p=>p.id===process.argv[3]),j=panelJob(page,p),file=path.resolve(process.argv[4]),image=imageFile(file);
  const base=`${assetDir}/candidates/${p.id}/${hash(image)}-${j.fingerprint.slice(0,12)}`;fs.mkdirSync(path.dirname(local(base)),{recursive:true});
  if(!fs.existsSync(local(base+'.png'))){fs.writeFileSync(local(base+'.png'),image);fs.writeFileSync(local(base+'.json'),JSON.stringify({id:p.id,fingerprint:j.fingerprint,imageHash:hash(image),note:option('note',''),renderer:option('renderer','unspecified'),model:option('model',null),references:j.references,prompt:j.prompt,sourceFile:file,registeredAt:new Date().toISOString()},null,2));}
  const folder=path.dirname(local(base));
  const entries=fs.readdirSync(folder).filter(f=>f.endsWith('.json')).map(f=>({file:f,record:JSON.parse(fs.readFileSync(path.join(folder,f)))}));
  fs.writeFileSync(path.join(folder,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>${xml(p.id)} 候補</title><style>body{font-family:Meiryo,sans-serif}article{display:inline-block;width:45%;margin:2%}img{max-width:100%}</style>${entries.map(({file,record:r})=>`<article><img src="${xml(file.replace(/\.json$/,'.png'))}" alt="${xml(r.note)}"><p>${xml(r.note)} / ${r.fingerprint===j.fingerprint?'現在の計画':'古い計画'}</p><code>${xml(file.replace(/\.json$/,'.png'))}</code></article>`).join('')}</html>`);
  console.log('Registered candidate: '+base+'.png');
} else if(command==='accept-panel') {
  const page=config.pages.find(page=>page.panels.some(p=>p.id===process.argv[3]));assert.ok(page,'Unknown panel');
  const p=page.panels.find(p=>p.id===process.argv[3]);const j=panelJob(page,p);
  const file=path.resolve(process.argv[4]);imageFile(file);assert.ok(process.argv.includes('--reviewed'),'Inspect panel before --reviewed');
  saveAsset(j,file,{fingerprint:j.fingerprint,imageHash:hash(fs.readFileSync(file)),reviewed:true});
  console.log(`Accepted panel ${p.id}`);
} else if(command==='accept') {
  assert.ok(!panelsOnly,'This work uses panel assets; use accept-panel for each panel');
  const page=config.pages.find(p=>p.id===process.argv[3]);assert.ok(page,'Unknown page');
  const file=path.resolve(process.argv[4]);assert.ok(fs.existsSync(file),'Generated file missing');imageFile(file,true);
  assert.ok(process.argv.includes('--reviewed'),'Inspect image before using --reviewed');
  const sourceArg=process.argv.indexOf('--source-rects');
  const sourceRects=sourceArg<0?page.panels.map(p=>p.rect):JSON.parse(process.argv[sourceArg+1]);
  assert.equal(sourceRects.length,page.panels.length,'Source panel count does not match plan');
  sourceRects.forEach(b=>{assert.ok(b.length===4 && b.every(Number.isFinite));const [x,y,w,h]=b;assert.ok(x>=0 && y>=0 && w>0 && h>0 && x+w<=1024 && y+h<=1536,'Source rectangle out of bounds');});
  const j=job(page);saveAsset(j,file,{fingerprint:j.fingerprint,imageHash:hash(fs.readFileSync(file)),sourceRects,reviewed:true});
  console.log(`Accepted ${page.id}`);
} else if(command==='use-page') {
  assert.ok(!panelsOnly,'use-page requires page render mode');
  const page=config.pages.find(page=>page.panels.some(p=>p.id===process.argv[3]));assert.ok(page,'Unknown panel');
  const p=page.panels.find(p=>p.id===process.argv[3]),j=panelJob(page,p);
  assert.ok(process.argv.includes('--reviewed'),'Inspect replacement page before removing override');
  assert.equal(assetStatus(job(page)),'ready','Accept replacement page first');
  assert.ok(fs.existsSync(local(j.asset)) && fs.existsSync(local(j.record)),'No override to archive');
  assert.equal(JSON.parse(fs.readFileSync(local(j.record))).imageHash,hash(fs.readFileSync(local(j.asset))),'Override changed before archiving');
  const reason=option('reason','');assert.ok(reason.trim(),'Record replacement reason');
  archive(j);fs.unlinkSync(local(j.asset));fs.unlinkSync(local(j.record));
  fs.appendFileSync(local(assetDir+'/history.jsonl'),JSON.stringify({event:'use-page',target:p.id,reason,time:new Date().toISOString()})+'\n');
  console.log('Archived override; using reviewed page artwork: '+p.id);
} else if(command==='review') {
  const page=config.pages.find(p=>p.id===process.argv[3]);assert.ok(page,'Unknown page');
  for(const flag of ['--speakers','--faces','--order','--continuity'])assert.ok(process.argv.includes(flag),'Inspect actual composed page and confirm '+flag);
  assert.equal(materialStatus(page),'ready','Changed or missing artwork: accept current materials before review');
  fs.writeFileSync(path.join(root,assetDir,`page-${page.id}.review.json`),JSON.stringify({fingerprint:reviewFingerprint(page),checks:['speakers','faces','order','continuity'],reviewedAt:new Date().toISOString()},null,2));console.log('Alignment review saved: '+page.id);
} else if(command==='preview') {
  const pages=process.argv[3]?config.pages.filter(p=>p.id===process.argv[3]):config.pages;assert.ok(pages.length,'Unknown preview page');
  for(const p of pages)assert.equal(materialStatus(p),'ready','Changed or missing preview material: '+p.id);
  const preview=path.join(dir,'review');fs.mkdirSync(preview,{recursive:true});for(const p of pages)fs.writeFileSync(path.join(preview,`page-${p.id}.svg`),svg(p,artFor(p)));console.log('Review composed SVGs in '+preview);
} else if(command==='quality-plan') {
  quality.plan();console.log('Inspect thumbnail/native/detail views in '+dir+'/quality/index.html');
} else if(command==='quality-review' || command==='quality-repair') {
  const page=config.pages.find(page=>page.panels.some(p=>p.id===process.argv[3]));assert.ok(page,'Unknown panel');
  const p=page.panels.find(p=>p.id===process.argv[3]);
  if(command==='quality-review')quality.review(page,p,path.resolve(process.argv[4]));else quality.repair(page,p);
} else if(command==='layers') {
  for(const p of config.pages)assert.equal(status(p),'ready','Review before layer export: '+p.id);
  const layers=path.join(output,'layers');fs.mkdirSync(layers,{recursive:true});
  for(const p of config.pages)for(const layer of ['artwork','lettering'])fs.writeFileSync(path.join(layers,`page-${p.id}-${layer}.svg`),svg(p,artFor(p),false,layer));
  console.log('Saved aligned, transparent artwork/lettering SVG layers in '+layers);
} else if(command==='status') {
  console.log(config.pages.map(p=>`${p.id}: ${status(p)}`).join('\n'));
} else if(command==='build') {
  requireReview(root,config,configFile,'source');requireReview(root,config,configFile,'script');
  for(const page of config.pages){
    requireReview(root,config,configFile,'storyboard',page.id);
    for(const panel of page.panels)requireReview(root,config,configFile,'artwork',panel.id);
    requireReview(root,config,configFile,'lettering',page.id);
  }
  for(const page of config.pages) assert.equal(status(page),'ready',`Page ${page.id} pending or changed: regenerate/review before build`);
  fs.mkdirSync(output,{recursive:true});
  for(const page of config.pages){assert.equal(status(page),'ready',`Page ${page.id} pending or changed: regenerate/review before build`);fs.writeFileSync(path.join(output,`page-${page.id}.svg`),svg(page,artFor(page)));}
  const manifest=config.pages.map(p=>({id:p.id,materials:materialJobs(p).map(j=>({asset:j.asset,fingerprint:j.fingerprint,imageHash:hash(fs.readFileSync(local(j.asset))),placementHash:hash(fs.readFileSync(local(j.record)))})),svgHash:hash(fs.readFileSync(path.join(output,`page-${p.id}.svg`)))}));
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(output,'reader.html'),fs.readFileSync(path.join(root,'reader.html'),'utf8').replaceAll('{{TITLE}}',xml(config.title)).replaceAll('{{AUTHOR}}',xml(config.author||'')).replace('{{PAGES}}',JSON.stringify(config.pages.map(p=>({id:p.id,alt:p.panels.flatMap(q=>q.dialogue.map(d=>d.text)).join(' / ')}))).replaceAll('<','\\u003c')));
  fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(config.title)} 改訂版</title><style>body{background:#e7e5e0;margin:0;font-family:Meiryo,sans-serif}header{max-width:850px;margin:28px auto;padding:20px}h1{font-size:24px}main{max-width:950px;margin:auto}img{width:100%;display:block;margin-bottom:26px}@media print{header{display:none}img{height:100vh;object-fit:contain;break-after:page}}</style><header><h1>${xml(config.title)} — 改訂版</h1><p>原作：${xml(config.author||'')} ／ 右から左、上から下へ。セリフとコマ割りを先に確定して制作。</p><a href="${path.relative(output,path.join(dir,'storyboards','index.html')).replaceAll('\\','/')}">制作前のネーム</a> · <a href="reader.html">1ページずつ読む</a></header><main>${config.pages.map(p=>`<img src="page-${p.id}.svg" alt="${xml(p.panels.flatMap(q=>q.dialogue.map(d=>`${d.speaker}: ${d.text.replace(/\n/g,'')}`)).join(' / '))}">`).join('')}</main></html>`);
  console.log(`Built ${config.pages.length} pages and reproducibility manifest`);
} else throw new Error('Use plan | check | layout PAGE [--apply] | candidate-panel ID FILE [--note TEXT] | accept PAGE FILE --reviewed | accept-panel ID FILE --reviewed | use-page ID --reviewed --reason TEXT | preview [PAGE] | review PAGE --speakers --faces --order --continuity | quality-plan | quality-review ID JSON | quality-repair ID | status | build | layers');
