import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [mode,author]=process.argv.slice(2);
assert.ok(/^[a-zA-Z0-9_-]+$/.test(author||''),'Specify an author screen name');
const base='collections/'+author,manifest=base+'/manifest.json';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(v,null,2));fs.renameSync(f+'.tmp',f);};
const run=(f,args,config)=>execFileSync(process.execPath,[f,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,...(config?{MANGA_PROJECT:config}:{})},maxBuffer:20*1024*1024});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(m){
 const labels={'pending':'原作取得待ち','prepared':'制作待ち','in-progress':'制作中','complete':'完成・検証済み','needs-verification':'既存漫画・再確認待ち','source-changed':'原作変更あり・再確認待ち'};
 const cards=m.works.map(w=>`<article><h2>${escape(w.title)}</h2><p>${labels[w.status]||escape(w.status)} · 原作 ${w.characters}文字</p><a href="${w.url}">原作</a>${w.reader?` · <a href="../../${w.reader}">漫画を読む</a>`:''}${w.pdf?` · <a href="../../${w.pdf}">PDF</a>`:''}</article>`).join('');
 const done=m.works.filter(w=>w.status==='complete').length;
 fs.writeFileSync(base+'/index.html',`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(m.authorName)} 短編漫画集</title><style>body{font-family:Meiryo,sans-serif;background:#f4f1ea;color:#292a27;margin:32px auto;padding:0 20px;max-width:1000px}article{background:white;border:1px solid #ddd;padding:20px;margin:16px 0}h2{font-size:18px;line-height:1.7}a{color:#29535e}p{line-height:1.7}</style><h1>${escape(m.authorName)} 短編漫画集</h1><p>対象${m.works.length}作品 / 完成・検証済み${done}作品。未完成の作品を完成扱いにはしていません。</p><p>対象は${escape(m.snapshotAt)}時点の公開作品一覧で「完結済み・一話」の作品。連載${m.excluded.length}作品は含みません。</p>${cards}</html>`);
}
if(mode==='init'){
 assert.ok(!fs.existsSync(manifest),'Manifest exists; preserve the production queue');
 const html=fs.readFileSync(base+'/source/works.html','utf8');
 const d=JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]).props.pageProps.__APOLLO_STATE__;
 const ref=d.ROOT_QUERY[`userByScreenName({"screenName":"${author}"})`].__ref,u=d[ref];
 const works=Object.values(d).filter(w=>w.__typename==='Work'&&w.author?.__ref===ref);
 assert.equal(new Set(works.map(w=>w.id)).size,u.totalPublicWorks,'Incomplete author inventory; fetch every page');
 const entries=works.map(w=>({id:w.id,title:w.title,url:'https://kakuyomu.jp/works/'+w.id,episodes:w.publicEpisodeCount,characters:w.totalCharacterCount,serialStatus:w.serialStatus,status:'pending'}));
 const m={version:1,author,authorName:u.activityName,url:'https://kakuyomu.jp/users/'+author+'/works',snapshotAt:new Date().toISOString(),selection:'COMPLETED and exactly one public episode',sourceHash:hash(Buffer.from(html)),works:entries.filter(w=>w.serialStatus==='COMPLETED'&&w.episodes===1),excluded:entries.filter(w=>w.serialStatus!=='COMPLETED'||w.episodes!==1)};
 write(manifest,m);render(m);console.log(`Registered ${m.works.length} short stories; excluded ${m.excluded.length} serial works`);
}else if(mode==='import'){
 const m=read(manifest);
 for(const w of m.works){
  if(w.sourceHash)continue;
  const staging=base+'/source/'+w.id;
  console.log(run('import-kakuyomu.mjs',[w.url,staging]));
  const bytes=fs.readFileSync(staging+'/original.txt'),sourceHash=hash(bytes);
  w.sourceHash=sourceHash;w.source=staging+'/original.txt';w.retrieval=staging+'/retrieval.json';
  let existing;
  for(const e of fs.readdirSync('works',{withFileTypes:true}).filter(e=>e.isDirectory())){
   const f='works/'+e.name+'/workflow.json';if(!fs.existsSync(f))continue;const c=read(f);
   const provenance='works/'+e.name+'/workflow/source-retrieval.json';
   if(c.sourceFile&&fs.existsSync(c.sourceFile)&&hash(fs.readFileSync(c.sourceFile))===sourceHash||fs.existsSync(provenance)&&read(provenance).work===w.url||typeof c.source==='string'&&c.source.startsWith(w.url+'/')){existing=f;break;}
  }
  if(existing){w.config=existing;w.status='needs-verification';}
  else{
   const config='works/auto-'+sourceHash.slice(0,12)+'/workflow.json';
   console.log(run('auto.mjs',['start',w.source,'--title',w.title],config));w.config=config;w.status='prepared';
   const c=read(config);fs.copyFileSync(w.retrieval,path.dirname(config)+'/source/retrieval.json');fs.copyFileSync(w.retrieval,c.workflowDir+'/source-retrieval.json');
  }
  write(manifest,m);render(m);
 }
}else if(mode==='status'){
 const m=read(manifest);
 for(const w of m.works){
  if(!w.config)continue;
  const c=read(w.config),completed=path.dirname(w.config)+'/automation.json';
  if(fs.existsSync(c.outputDir+'/reader.html'))w.reader=c.outputDir+'/reader.html';
  if(fs.existsSync(c.outputDir+'/pdf/manga.pdf'))w.pdf=c.outputDir+'/pdf/manga.pdf';
  if(!fs.existsSync(c.workflowDir+'/automation-request.json')){w.status='needs-verification';w.verification={note:'Legacy work: verify current source, reviews, PDF and reproducibility package before marking complete'};continue;}
  try{const a=JSON.parse(run('auto.mjs',['status'],w.config));w.status=a.status==='complete'?'complete':w.status==='prepared'?'prepared':'in-progress';w.verification=a;}catch(e){w.status='needs-verification';w.verification={error:String(e.stderr||e.message).slice(0,500)};}
  if(fs.existsSync(completed))w.completionRecord=completed;
 }
 write(manifest,m);render(m);console.log(JSON.stringify(m.works.map(w=>({id:w.id,status:w.status,config:w.config})),null,2));
}else throw new Error('Use collection.mjs init|import|status AUTHOR');
