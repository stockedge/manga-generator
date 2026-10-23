import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const reviewStages=['source','script','storyboard','artwork','lettering','final'];
const selectedPages=(c,target)=>target==='all'?c.pages:c.pages.filter(page=>page.id===target||page.panels.some(panel=>panel.id===target));
export function reviewBoundaries(c,target='all'){
  const selected=new Set(selectedPages(c,target).flatMap(p=>p.panels.map(a=>a.id)));
  const panels=c.pages.flatMap(p=>p.panels);
  return panels.slice(1).flatMap((p,i)=>selected.has(p.id)||selected.has(panels[i].id)?[{from:panels[i].id,to:p.id}]:[]);
}
export function reviewInputs(c,configFile,stage,target='all'){
  assert.ok(reviewStages.includes(stage),'Unknown review stage');
  const pages=selectedPages(c,target);
  assert.ok(pages.length,'Unknown review target');
  const base={stage,target,sourceFile:c.sourceFile};
  if(stage==='script'){
    base.dialoguePolicy='source-dialogue-dependencies-v1';
    base.dialogueInstructions='Compare every panel with the full original: retain the question before its answer, the referent before a pronoun, the apology before forgiveness, and the premise before a joke. Check speaker voice, emotional causality and text merged across intervening turns. Do not repair missing context from scene instructions alone. For pass return dialogueReview:{sourceCompared:true,panels:[{panel:panelId,observation:specific source comparison and dialogue dependency evidence}]} for every target panel, including silent panels. Unresolved or image-dependent issues cannot be certified from script alone.';
  }
  if(['storyboard','lettering','final'].includes(stage)){
    base.readingPolicy='unnumbered-proximity-and-scene-transitions-v2';
    base.requiredTransitions=reviewBoundaries(c,target);
  }
  const files=[c.sourceFile];
  const optionalFiles=[];
  if(stage!=='source'){
    const scriptPages=stage==='script'?pages.map(page=>({id:page.id,purpose:page.purpose,expectation:page.expectation,section:page.section,showcase:page.showcase,panels:page.panels.map(panel=>({id:panel.id,section:panel.section,scene:panel.scene,role:panel.role,beat:panel.beat,state:panel.state,transition:panel.transition,information:panel.information,pause:panel.pause,action:panel.action,emotion:panel.emotion,camera:panel.camera,dialogue:panel.dialogue.map(d=>({speaker:d.speaker,text:d.text,textColumns:d.textColumns,...(d.textSizeRanges===undefined?{}:{textSizeRanges:d.textSizeRanges})}))}))})):pages;
    base.script={title:c.title,cast:c.cast,style:c.style,continuity:c.continuity,sections:c.sections,pages:scriptPages};
    if(['storyboard','lettering','final'].includes(stage)&&target!=='all'){
      const selected=new Set(pages.map(p=>p.id)),ids=new Set(base.requiredTransitions.flatMap(t=>[t.from,t.to]));
      const context=c.pages.filter(p=>!selected.has(p.id)&&p.panels.some(a=>ids.has(a.id)));
      base.boundaryContext=context;
      for(const page of context){
        files.push(c.workflowDir+'/storyboards/page-'+page.id+'.svg');
        if(stage==='storyboard')files.push(c.workflowDir+'/storyboards-unnumbered/page-'+page.id+'.svg');
        if(stage!=='storyboard'){
          optionalFiles.push(c.workflowDir+'/review/page-'+page.id+'.png');
          for(const panel of page.panels)optionalFiles.push(c.assetDir+'/panels/'+panel.id+'.png');
        }
      }
    }
    if(stage==='script')files.push(c.workflowDir+'/source-coverage.json');
    if(['storyboard','artwork','lettering','final'].includes(stage)){
      files.push(...(c.references||[]));
      for(const page of pages){
        files.push(c.workflowDir+'/storyboards/page-'+page.id+'.svg');
        if(stage==='storyboard')files.push(c.workflowDir+'/storyboards-unnumbered/page-'+page.id+'.svg',c.workflowDir+'/reading-flow/page-'+page.id+'.svg',c.workflowDir+'/reading-flow/page-'+page.id+'.json');
        if(['artwork','lettering','final'].includes(stage))for(const panel of page.panels.filter(panel=>target==='all'||target===page.id||panel.id===target))files.push(c.assetDir+'/panels/'+panel.id+'.png');
        if(['lettering','final'].includes(stage))files.push(c.workflowDir+'/review/page-'+page.id+'.png');
      }
    }
    if(stage==='final')files.push(c.outputDir+'/reader.html',c.outputDir+'/pdf/manga.pdf');
  }
  // Configuration is embedded per target so unrelated page edits do not stale a
  // finished panel review. Every file the reviewer receives is hash-checked.
  return {base,files:[...new Set(files)],optionalFiles:[...new Set(optionalFiles)],configFile};
}
export function captureReview(root,c,configFile,stage,target='all'){
  const input=reviewInputs(c,configFile,stage,target);
  const optional=new Set(input.optionalFiles);
  const entries=Object.fromEntries([...new Set([...input.files,...input.optionalFiles])].map(name=>{
    const file=path.resolve(root,name);assert.ok(file.startsWith(path.resolve(root)+path.sep),'Review file escapes workspace');
    if(optional.has(name)&&!fs.existsSync(file))return [name,null];
    assert.ok(fs.existsSync(file),'Missing review input: '+name);return [name,hash(fs.readFileSync(file))];
  }));
  return {...input,files:[...new Set([...input.files,...input.optionalFiles.filter(f=>entries[f]!==null)])],entries,fingerprint:hash(JSON.stringify({base:input.base,entries}))};
}
export function requireReview(root,c,configFile,stage,target='all'){
  if(!c.productionReview?.required)return;
  const current=captureReview(root,c,configFile,stage,target);
  const file=path.resolve(root,c.workflowDir,'stage-reviews',stage+'-'+target+'.json');
  assert.ok(fs.existsSync(file),'Missing subagent review: '+stage+'/'+target);
  const record=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(record.fingerprint,current.fingerprint,'Stale subagent review: '+stage+'/'+target);
  assert.equal(record.status,'pass','Subagent requested changes: '+stage+'/'+target);
  assert.ok(Array.isArray(record.issues)&&record.issues.every(issue=>issue.resolved===true),'Unresolved subagent review issues');
  assert.ok(Array.isArray(record.observations)&&record.observations.length>=2,'Missing specific review observations');
  assert.ok(record.reviewer?.task && record.reviewer?.role==='subagent','Missing actual subagent identity');
  validateDialogueReview(c,stage,target,record);
  validateReadingReview(c,stage,target,record);
}

export function validateDialogueReview(c,stage,target,record){
  if(stage!=='script'||record.status!=='pass')return;
  const review=record.dialogueReview;
  assert.equal(review?.sourceCompared,true,'Compare dialogue selection and dependencies with the full original');
  const panels=selectedPages(c,target).flatMap(page=>page.panels);
  assert.ok(Array.isArray(review.panels)&&review.panels.length===panels.length,'Record source dialogue review for every target panel');
  for(const panel of panels){
    const matches=review.panels.filter(item=>item.panel===panel.id);
    assert.ok(matches.length===1&&typeof matches[0].observation==='string'&&matches[0].observation.trim(),'Missing or duplicate dialogue observation: '+panel.id);
  }
}

export function validateReadingReview(c,stage,target,record){
  if(!['storyboard','lettering','final'].includes(stage)||record.status!=='pass')return;
  const r=record.readingReview;
  assert.equal(r?.withoutGuides,true,'Inspect reading order without numbered guides first');
  assert.ok(Array.isArray(r.observations)&&r.observations.length>=2,'Record natural reading and proximity observations');
  const expected=reviewBoundaries(c,target);
  assert.ok(Array.isArray(r.transitions)&&r.transitions.length===expected.length&&r.transitions.every(t=>t.from&&t.to&&typeof t.observation==='string'&&t.observation.trim()),'Record every real scene/action transition, including continuous scenes');
  for(const pair of expected)assert.equal(r.transitions.filter(t=>t.from===pair.from&&t.to===pair.to).length,1,'Missing or duplicate transition: '+pair.from+' -> '+pair.to);
  const panels=(target==='all'?c.pages:c.pages.filter(p=>p.id===target||p.panels.some(a=>a.id===target))).flatMap(p=>p.panels);
  assert.ok(Array.isArray(r.predictedOrder)&&r.predictedOrder.length===panels.length,'Record predicted reading order for every target panel');
  for(const p of panels){const matches=r.predictedOrder.filter(a=>a.panel===p.id);assert.equal(matches.length,1,'Missing or duplicate predicted panel: '+p.id);assert.deepEqual(matches[0].dialogue,p.dialogue.map((_,i)=>i+1),'Natural reading differs from intended order: '+p.id);}
}
