// This records a real tool invocation's inputs/outputs; it does not call image_gen.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {config as c,local,configFile,root} from '../src/project.mjs';
import {requireReview} from '../src/stage-reviews.mjs';
assert.ok(process.env.MANGA_PROJECT,'Select a work explicitly');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(local(f),'utf8'));
const write=(f,v)=>{fs.mkdirSync(path.dirname(local(f)),{recursive:true});fs.writeFileSync(local(f),JSON.stringify(v,null,2));};
const [mode,id,input]=process.argv.slice(2);
const jobs=read(c.workflowDir+'/panel-jobs.json');
if(mode==='prepare' || mode==='prepare-edit'){
 const j=jobs.find(j=>j.id===id);assert.ok(j,'Unknown panel');
 requireReview(root,c,configFile,'source');requireReview(root,c,configFile,'script');
 const reviewPage=c.pages.find(page=>page.panels.some(panel=>panel.id===id));
 requireReview(root,c,configFile,'storyboard',reviewPage.id);
 const editing=mode==='prepare-edit';
 const prompt=editing?fs.readFileSync(local(process.argv[5]),'utf8'):j.prompt+'\nThe storyboard is a layout GUIDE, not finished artwork: do not copy labels, gray face boxes or circles. Keep actual faces within their marked face regions and mouths near marked anchors. Reserved lettering rectangles are INVISIBLE keep-away zones: do not outline them or draw any empty boxes. Let pure white negative space occur naturally at the sides. Use only 2 to 5 thin background contour lines for the setting and no background shading or surface grain. Do not add paintings, plants, bookshelves, extra cups, floor planks or extra furniture. Keep the characters, table, chairs and explicitly named props legible. Use the supplied reference-role mapping: canonical faces for identity, the style reference only for pen and background simplicity, and the storyboard only for this panel\'s composition. Do not inherit the style reference\'s action or facial expression. Output a complete clean standalone panel with aspect '+c.pages.flatMap(p=>p.panels).find(p=>p.id===id).rect.slice(2).join(':')+'.';
 const extra=process.argv.slice(editing?6:4),support=[],genOpts={};
 for(let i=0;i<extra.length;i++){
  const a=extra[i],v=extra[i+1];
  if(a==='--renderer'||a==='--model'||a==='--seed'){assert.ok(v!==undefined && !v.startsWith('--'),'Missing value: '+a);genOpts[a.slice(2)]=v;i++;}
  else if(editing && a==='--reference'){assert.ok(v!==undefined,'Use --reference PATH for each supporting edit reference');support.push(v);i++;}
  else if(a==='--reference')throw new Error('Supporting references are available for prepare-edit only');
  else if(editing)throw new Error('Unknown edit option: '+a);
  else throw new Error('Unknown option: '+a);
 }
 if(genOpts.seed!==undefined)assert.match(genOpts.seed,/^\d+$/,'Seed must be digits');
 const sourceReferences=editing?[input,...support]:j.references;
 const fingerprint=hash(Buffer.from(j.fingerprint+prompt+sourceReferences.map(f=>hash(fs.readFileSync(local(f)))).join('')));
 const folder=c.workflowDir+'/generation-inputs/'+id+'-'+fingerprint.slice(0,16);
 const references=sourceReferences.map((file,i)=>{
  const bytes=fs.readFileSync(local(file)),dest=folder+'/reference-'+i+path.extname(file);
  fs.mkdirSync(path.dirname(local(dest)),{recursive:true});
  if(fs.existsSync(local(dest)))assert.equal(hash(fs.readFileSync(local(dest))),hash(bytes),'Immutable reference changed');else fs.writeFileSync(local(dest),bytes);
  return {file:dest,hash:hash(bytes),original:file,role:editing?(i===0?'Edit target: preserve character identity, pose, placement and meaningful props; apply only the saved edit instruction.':c.referenceRoles?.[file]||'Supporting edit reference: use only the feature and role explicitly described in the saved edit instruction; never replace the target composition or acting.'):c.referenceRoles?.[file]||'Storyboard: composition, face footprints and reserved lettering areas only. Do not reproduce labels, circles or gray guides.'};
 });
 const request={panel:id,project:configFile,fingerprint:j.fingerprint,operation:editing?'edit':'generate',sourceHash:hash(fs.readFileSync(local(c.sourceFile))),prompt,promptHash:hash(Buffer.from(prompt)),references,renderer:genOpts.renderer||'Codex built-in image_gen',model:genOpts.model||null,seed:genOpts.seed??null};
 const requestFile=folder+'/request.json';
 if(fs.existsSync(local(requestFile)))assert.equal(hash(fs.readFileSync(local(requestFile))),hash(Buffer.from(JSON.stringify(request,null,2))),'Immutable generation request changed');else write(requestFile,request);
 console.log(JSON.stringify({request:requestFile,prompt,references:references.map(r=>local(r.file))}));
}else if(mode==='record'){
 assert.ok(input && process.argv[5],'Use record ID REQUEST.json GENERATED.png');
 const request=read(input);assert.equal(request.panel,id);
 const bytes=fs.readFileSync(path.resolve(process.argv[5]));
 assert.ok(bytes.length>24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Tool output must be a PNG');
 const imageHash=hash(bytes),image=c.assetDir+'/generated/'+id+'-'+imageHash.slice(0,16)+'.png';
 fs.mkdirSync(path.dirname(local(image)),{recursive:true});
 if(fs.existsSync(local(image)))assert.equal(hash(fs.readFileSync(local(image))),imageHash);else fs.writeFileSync(local(image),bytes);
 const record=c.workflowDir+'/generation-history/'+id+'-'+imageHash.slice(0,16)+'.json';
 if(!fs.existsSync(local(record)))write(record,{...request,imageHash,image,generatedSourceFile:path.resolve(process.argv[5]),recordedAt:new Date().toISOString(),note:'Actual tool prompt and snapshots; acceptedJob after later layout changes may differ from this generation plan.'});
 console.log(image);
}else if(mode==='compile'){
 const history=local(c.workflowDir+'/generation-history');
 const records=fs.readdirSync(history).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(history,f),'utf8')));
 const panels=c.pages.flatMap(p=>p.panels).map(p=>{
  const adopted=hash(fs.readFileSync(local(c.assetDir+'/panels/'+p.id+'.png')));
  const samePanel=records.filter(r=>r.panel===p.id && r.imageHash===adopted).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0];
  if(samePanel)return samePanel;
  const reused=records.filter(r=>r.imageHash===adopted).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0];
  assert.ok(reused,'No actual generation evidence for '+p.id);
  return {...reused,panel:p.id,adoptedFromPanel:reused.panel,evidence:'re-adopted existing generated output',note:`Panel ${p.id} reuses the exact generated PNG recorded for ${reused.panel}; no new generation is claimed.`};
 });
 write(c.workflowDir+'/generation-log.json',{sourceHash:hash(fs.readFileSync(local(c.sourceFile))),panels});
 console.log('Saved actual generation log: '+panels.length+' panels');
}else throw new Error('Use prepare ID [--renderer NAME] [--model ID] [--seed N] | prepare-edit ID TARGET.png PROMPT.txt [--reference SUPPORT.png] [--renderer NAME] [--model ID] [--seed N] | record ID REQUEST.json GENERATED.png | compile');
