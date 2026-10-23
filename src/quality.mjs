import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {faceReviewTemplate,validateFaceReview} from './face-design.mjs';

// Human observations are evidence of inspection, not an AI-detection score.
export const categories=['anatomy','contact','objects','faces','linework','background','continuity','lettering'];
export const defaultQuality={required:true,drawing:['Use clear silhouettes and deliberate variation between outer contours and interior lines.','Group hair into readable masses; use only folds that explain the pose.','Make joint structure, grip, contact and object occlusion legible. Repair interacting hands and held objects together.','Use white space in close shots and a few location contours in wide shots.'],avoid:['Uniform microdetail, glossy gradients, dense decorative hatching, random grain and redundant highlights.']};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function qualityInstructions(config){
 if(config.version>=7)assert.equal(config.quality?.required,true,'Version 7 requires panel quality review');
 const q=config.quality;if(!q)return '';
 assert.equal(typeof q.required,'boolean','quality.required must be boolean');
 for(const key of ['drawing','avoid'])assert.ok(Array.isArray(q[key]) && q[key].length && q[key].every(x=>typeof x==='string' && x.trim()),'quality.'+key+' must be nonempty descriptions');
 return '\nDRAWING PRIORITIES: '+q.drawing.join(' ')+'\nAVOID: '+q.avoid.join(' ');
}
export function qualityGate({config,local,assetDir,dir,material,job,compose}){
 const file=p=>local(`${assetDir}/quality/${p.id}.json`);
 const fingerprint=(page,p)=>{
  const override=local(`${assetDir}/panels/${p.id}.png`),j=job(page,p);
  const source=fs.existsSync(override)?override:local(`${assetDir}/page-${page.id}.png`);
  const record=fs.existsSync(override)?null:JSON.parse(fs.readFileSync(local(`${assetDir}/page-${page.id}.json`)));
  return digest(JSON.stringify({panel:p,quality:config.quality,plan:j.fingerprint,sourceRect:record?.sourceRects?.[page.panels.indexOf(p)]||null})+digest(fs.readFileSync(source)));
 };
 function validateReport(r,p){
  validateFaceReview(config,p,r);
  assert.equal(r.panel,p.id,'Quality report belongs to a different panel');
  assert.ok(typeof r.observation==='string' && r.observation.trim().length>=12,'Describe what was actually observed');
  for(const view of ['thumbnail','native','detail'])assert.equal(r.views?.[view],true,'Inspect '+view+' view');
  assert.deepEqual(Object.keys(r.checks||{}).sort(),[...categories].sort(),'Record every quality category');
  for(const [name,c] of Object.entries(r.checks)){
   assert.ok(['pass','fail','na'].includes(c.result),'Invalid result: '+name);
   assert.ok(typeof c.note==='string' && c.note.trim().length>=4,'Record observed evidence or why not applicable: '+name);
  }
  assert.ok(Array.isArray(r.issues),'Record issues as an array');
  for(const issue of r.issues){assert.ok(categories.includes(issue.category),'Unknown issue category');assert.ok(typeof issue.description==='string' && issue.description.trim(),'Describe issue');assert.ok(['open','resolved'].includes(issue.status),'Invalid issue status');}
 }
 const passed=r=>categories.every(k=>r.checks[k].result!=='fail') && !r.issues.some(i=>i.status==='open');
 function ready(page){
  if(!config.quality?.required)return true;
  return page.panels.every(p=>{try{const r=JSON.parse(fs.readFileSync(file(p)));validateReport(r,p);return r.fingerprint===fingerprint(page,p) && passed(r);}catch{return false;}});
 }
 function plan(){
  for(const page of config.pages)assert.equal(material(page),'ready','Accept current material before quality-plan: '+page.id);
  const folder=path.join(dir,'quality');fs.mkdirSync(path.join(folder,'panels'),{recursive:true});
  const cards=[];
  for(const page of config.pages){
   fs.writeFileSync(path.join(folder,`page-${page.id}.svg`),compose(page,folder));
   for(const p of page.panels){
    const template={panel:p.id,fingerprint:fingerprint(page,p),observation:'',views:{thumbnail:false,native:false,detail:false},checks:Object.fromEntries(categories.map(k=>[k,{result:'fail',note:''}])),issues:[],...faceReviewTemplate(config,p)};
    fs.writeFileSync(path.join(folder,p.id+'.template.json'),JSON.stringify(template,null,2));
    const [x,y,w,h]=p.rect;
    let saved,label='未確認';try{saved=JSON.parse(fs.readFileSync(file(p)));validateReport(saved,p);label=saved.fingerprint!==template.fingerprint?'古い記録':passed(saved)?'確認済み':'修正が必要';}catch{saved=null;}
    fs.writeFileSync(path.join(folder,'panels',`page-${p.id}.svg`),compose(page,path.join(folder,'panels')).replace('width="1024" height="1536" viewBox="0 0 1024 1536"',`width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`));
    cards.push(`<article><h2>${p.id} — ${label}</h2><p>${saved?escape(saved.observation):'縮小・100%・200%を切り替え、合成ページと比較。手、接触、顔、小道具、線と余白を確認。'}</p>${saved?'<ul>'+saved.issues.map(i=>'<li>'+escape(i.status+': '+i.description)+'</li>').join('')+'</ul>':''}<div class="viewport"><img src="panels/page-${p.id}.svg" width="${w}" alt="${p.id}"/></div><a href="page-${page.id}.svg">合成ページ</a> · <a href="${p.id}.template.json">検品記録の雛形</a></article>`);
   }
  }
  fs.writeFileSync(path.join(folder,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>漫画の描画検品</title><style>body{font-family:Meiryo,sans-serif;background:#eee}article{background:white;margin:24px;padding:20px}.viewport{overflow:auto;max-height:90vh}img{display:block}button{padding:10px}</style><h1>描画検品</h1><p>目視確認を記録する画面です。AIらしさの消失を判定する検出器ではありません。</p><nav><button data-zoom=".25">縮小</button><button data-zoom="1">100%</button><button data-zoom="2">200%</button></nav>${cards.join('')}<script>document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>document.querySelectorAll('img').forEach(i=>i.style.width=(Number(i.getAttribute('width'))*Number(b.dataset.zoom))+'px'));</script></html>`);
 }
 function review(page,p,input){
  assert.equal(material(page),'ready','Accept current material before quality-review');
  const report=JSON.parse(fs.readFileSync(input));validateReport(report,p);
  assert.equal(report.fingerprint,fingerprint(page,p),'Stale quality template: run quality-plan and inspect current artwork');
  fs.mkdirSync(path.dirname(file(p)),{recursive:true});
  if(fs.existsSync(file(p))){const previous=fs.readFileSync(file(p)),folder=local(assetDir+'/quality/history');fs.mkdirSync(folder,{recursive:true});const saved=path.join(folder,p.id+'-'+digest(previous)+'.json');if(!fs.existsSync(saved))fs.writeFileSync(saved,previous);}
  fs.writeFileSync(file(p),JSON.stringify({...report,reviewedAt:new Date().toISOString()},null,2));
  console.log(`Quality ${p.id}: ${passed(report)?'reviewed':'needs repair'}`);
 }
 function repair(page,p){
  const r=JSON.parse(fs.readFileSync(file(p)));validateReport(r,p);
  assert.equal(r.fingerprint,fingerprint(page,p),'Stale report: inspect current artwork first');
  const findings=[...Object.entries(r.checks).filter(([,v])=>v.result==='fail').map(([k,v])=>k+': '+v.note),...r.issues.filter(i=>i.status==='open').map(i=>i.category+': '+i.description)];
  assert.ok(findings.length,'No recorded repair targets');
  const j=job(page,p),override=local(`${assetDir}/panels/${p.id}.png`);
  const target=fs.existsSync(override)?override:local(`${assetDir}/page-${page.id}.png`);
  const result={panel:p.id,fingerprint:r.fingerprint,target,referenceRoles:{target:'Edit target; preserve identity, scene and established positions.',layout:'Current isolated storyboard; preserve reserved lettering areas.',canonical:'Character and prop identities.'},references:[target,...j.references.map(local)],prompt:j.prompt+'\nLOCAL REPAIR TARGETS: '+findings.join('; ')+'. Repair only these structural defects. Preserve expressions, identity, clothing, camera, story props, character positions and white lettering footprints. Repair hands together with the contacted object; maintain coherent occlusion. No global grain or style filter. Output only this panel. Re-measure faces and mouths after editing.'};
  fs.mkdirSync(path.join(dir,'quality'),{recursive:true});fs.writeFileSync(path.join(dir,'quality',p.id+'.repair.json'),JSON.stringify(result,null,2));
 }
 return {ready,plan,review,repair};
}
