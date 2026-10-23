// ComfyUI API driver for Qwen-Image-Edit-2511 (Node standard library only).
// Usage:
//   node cli/qwen-comfy.mjs run --prompt-file PROMPT.txt --out out.png [--images ref1.png,ref2.png] [options]
// Connects to ComfyUI over HTTP; for a RunPod pod use an SSH tunnel:
//   ssh -N -L 8188:localhost:8188 root@<pod-host> -p <port>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const args=process.argv.slice(2);
const command=args[0];
function option(name,fallback){
 const i=args.indexOf('--'+name);
 if(i<0)return fallback;
 const v=args[i+1];
 assert.ok(v!==undefined && !v.startsWith('--'),'Missing value: --'+name);
 return v;
}
function fail(msg){console.error('qwen-comfy: '+msg);process.exit(1);}
if(command!=='run')fail('Use run --prompt-file FILE --out OUT.png [--images A.png,B.png] [--inpaint TARGET.png --mask MASK.png --denoise F] [--api URL] [--width W] [--height H] [--steps N] [--cfg F] [--sampler NAME] [--scheduler NAME] [--seed N] [--loras "file:strength,..."] [--unet F] [--clip F] [--vae F] [--timeout-ms MS] [--sidecar FILE]');

const api=(option('api','http://127.0.0.1:8188')).replace(/\/$/,'');
const promptFile=option('prompt-file',null);assert.ok(promptFile,'Missing --prompt-file');
const out=option('out',null);assert.ok(out,'Missing --out');
const prompt=fs.readFileSync(path.resolve(promptFile),'utf8');
assert.ok(prompt.trim(),'Prompt is empty');
const width=Number(option('width','832')),height=Number(option('height','1216'));
assert.ok(Number.isInteger(width)&&Number.isInteger(height)&&width>=256&&height>=256&&width%16===0&&height%16===0,'Width/height must be multiples of 16, at least 256');
const steps=Number(option('steps','30')),cfg=Number(option('cfg','4.0'));
const sampler=option('sampler','euler'),scheduler=option('scheduler','simple');
const seed=option('seed',null)!==null?Number(option('seed')):crypto.randomInt(0,2**31-1);
assert.ok(Number.isInteger(seed)&&seed>=0,'Seed must be a non-negative integer');
const loras=(option('loras','')||'').split(',').filter(Boolean).map(s=>{const [file,strength]=s.split(':');assert.ok(file&&strength!==undefined,'Bad --loras entry: '+s);return {file,strength:Number(strength)};});
const images=(option('images','')||'').split(',').filter(Boolean);
assert.ok(images.length<=3,'Qwen-Image-Edit-Plus takes at most 3 reference images');
const inpaintTarget=option('inpaint',null),inpaintMask=option('mask',null);
assert.ok((inpaintTarget===null)===(inpaintMask===null),'--inpaint and --mask go together');
assert.ok(!(inpaintTarget&&images.length),'--inpaint cannot combine with --images');
const denoise=inpaintTarget?Number(option('denoise','0.7')):1.0;
assert.ok(denoise>0&&denoise<=1,'Denoise must be in (0,1]');
const unet=option('unet','qwen_image_edit_2511_fp8mixed.safetensors');
const clip=option('clip','qwen_2.5_vl_7b_fp8_scaled.safetensors');
const vae=option('vae','qwen_image_vae.safetensors');
const timeoutMs=Number(option('timeout-ms','900000'));
const t0=Date.now();

async function apiFetch(p,init){
 const res=await fetch(api+p,init);
 if(!res.ok)fail(`ComfyUI ${p} -> HTTP ${res.status}: ${(await res.text()).slice(0,500)}`);
 return res;
}
// Fail fast when the server is unreachable or too old.
const stats=await apiFetch('/system_stats').then(r=>r.json()).catch(e=>fail('ComfyUI unreachable at '+api+': '+e.message));
const objectInfo=await apiFetch('/object_info').then(r=>r.json());
for(const need of ['UNETLoader','CLIPLoader','VAELoader','LoraLoaderModelOnly','CLIPTextEncode','EmptyLatentImage','KSampler','VAEDecode','SaveImage','LoadImage',...(inpaintTarget?['LoadImageMask','VAEEncode','SetLatentNoiseMask']:[])])assert.ok(objectInfo[need],'ComfyUI lacks node: '+need);

async function upload(file){
 const form=new FormData();
 form.append('image',new Blob([fs.readFileSync(path.resolve(file))],{type:'image/png'}),path.basename(file));
 form.append('overwrite','true');
 return (await apiFetch('/upload/image',{method:'POST',body:form}).then(r=>r.json())).name;
}
const uploaded=[];
for(const file of images)uploaded.push(await upload(file));
let inpaintUp=null,maskUp=null;
if(inpaintTarget){inpaintUp=await upload(inpaintTarget);maskUp=await upload(inpaintMask);}
let encodeNode='CLIPTextEncode',encodeInputs={clip:['2',0],text:prompt};
if(uploaded.length){
 const plus=objectInfo['TextEncodeQwenImageEditPlus'];
 if(!plus)fail('ComfyUI lacks TextEncodeQwenImageEditPlus; update ComfyUI for multi-reference edit. Available Qwen nodes: '+Object.keys(objectInfo).filter(k=>/qwen/i.test(k)).join(','));
 encodeNode='TextEncodeQwenImageEditPlus';
 encodeInputs={clip:['2',0],prompt};
 const req=plus.input.required||{};
 uploaded.forEach((name,i)=>{encodeInputs['image'+(i+1)]=[String(10+i),0];});
 if(req.vae!==undefined)encodeInputs.vae=['3',0];
}
const graph={
 '1':{class_type:'UNETLoader',inputs:{unet_name:unet,weight_dtype:'default'}},
 '2':{class_type:'CLIPLoader',inputs:{clip_name:clip,type:'qwen_image'}},
 '3':{class_type:'VAELoader',inputs:{vae_name:vae}},
 '4':{class_type:'CLIPTextEncode',inputs:{clip:['2',0],text:''}},
 '5':{class_type:'EmptyLatentImage',inputs:{width,height,batch_size:1}},
 '6':{class_type:encodeNode,inputs:encodeInputs},
};
let modelRef=['1',0],nextId=7;
for(const lora of loras){graph[String(nextId)]={class_type:'LoraLoaderModelOnly',inputs:{model:modelRef,lora_name:lora.file,strength_model:lora.strength}};modelRef=[String(nextId),0];nextId++;}
uploaded.forEach((name,i)=>{graph[String(10+i)]={class_type:'LoadImage',inputs:{image:name}};});
let latentRef=['5',0];
if(inpaintTarget){
 graph['10']={class_type:'LoadImage',inputs:{image:inpaintUp}};
 graph['11']={class_type:'LoadImageMask',inputs:{image:maskUp,channel:'red'}};
 graph['12']={class_type:'VAEEncode',inputs:{pixels:['10',0],vae:['3',0]}};
 graph['13']={class_type:'SetLatentNoiseMask',inputs:{samples:['12',0],mask:['11',0]}};
 latentRef=['13',0];
}
graph['20']={class_type:'KSampler',inputs:{model:modelRef,seed,steps,cfg,sampler_name:sampler,scheduler,positive:['6',0],negative:['4',0],latent_image:latentRef,denoise}};
graph['21']={class_type:'VAEDecode',inputs:{samples:['20',0],vae:['3',0]}};
graph['22']={class_type:'SaveImage',inputs:{images:['21',0],filename_prefix:'qwen_trial'}};
const queued=await apiFetch('/prompt',{method:'POST',headers:{'content-type':'application/json','User-Agent':'Mozilla/5.0'},body:JSON.stringify({prompt:graph})}).then(r=>r.json());
const promptId=queued.prompt_id;
assert.ok(promptId,'ComfyUI returned no prompt_id');
let image=null;
for(;;){
 if(Date.now()-t0>timeoutMs)fail('Timed out waiting for '+promptId);
 await new Promise(r=>setTimeout(r,5000));
 const history=await apiFetch('/history/'+promptId).then(r=>r.json());
 const entry=history[promptId];
 if(!entry||!entry.status||!entry.status.completed)continue;
 if(entry.status.status_str==='error')fail('ComfyUI execution failed: '+JSON.stringify(entry.status.messages).slice(0,1000));
 const outs=entry.outputs?.['22']?.images||[];
 if(!outs.length)fail('ComfyUI returned empty outputs (cached execution?); retry with a new seed');
 image=outs[0];
 break;
}
const params=new URLSearchParams({filename:image.filename,subfolder:image.subfolder||'',type:image.type||'output'});
const bytes=Buffer.from(await apiFetch('/view?'+params).then(r=>r.arrayBuffer()));
assert.ok(bytes.length>24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'ComfyUI output is not a PNG');
fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
fs.writeFileSync(path.resolve(out),bytes);
const sidecar={api,seed,width,height,steps,cfg,sampler,scheduler,loras,unet,clip,vae,
 promptFile,promptHash:crypto.createHash('sha256').update(prompt).digest('hex'),
 images:images.map(f=>path.resolve(f)),uploaded,inpaint:inpaintTarget?path.resolve(inpaintTarget):null,mask:inpaintMask?path.resolve(inpaintMask):null,denoise,out:path.resolve(out),promptId,
 imageHash:crypto.createHash('sha256').update(bytes).digest('hex'),elapsedMs:Date.now()-t0,
 comfyui:stats?.system?.comfyui_version||null};
const sidecarFile=option('sidecar',out+'.json');
fs.writeFileSync(path.resolve(sidecarFile),JSON.stringify(sidecar,null,2));
console.log(JSON.stringify({out:path.resolve(out),seed,sidecar:path.resolve(sidecarFile),imageHash:sidecar.imageHash}));
