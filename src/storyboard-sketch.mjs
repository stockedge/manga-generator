import assert from 'node:assert/strict';

// Only structured geometry enters SVG; no XML, URI, style, labels or raw path d.
const keys=(o,allowed)=>{assert.ok(o && Object.getPrototypeOf(o)===Object.prototype);for(const k of Object.keys(o))assert.ok(allowed.includes(k),'Unsupported sketch key: '+k);};
const unit=n=>{assert.ok(typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1,'Expected coordinate in 0..1');return n;};
const color=s=>{assert.ok(['none','black','white','#777','#bbb','#ddd'].includes(s),'Unsupported sketch color');return s;};
const counts={M:2,L:2,Q:4,C:6,Z:0};
function primitive(p){
 keys(p,['type','points','x','y','width','height','cx','cy','rx','ry','commands','stroke','fill','strokeWidth']);
 const stroke=color(p.stroke??'black'),fill=color(p.fill??'none'),width=p.strokeWidth??3;
 assert.ok(Number.isFinite(width)&&width>=1&&width<=8,'Invalid sketch stroke width');
 const style=`fill="${fill}" stroke="${stroke}" stroke-width="${width}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"`;
 const n=k=>unit(p[k]);
 if(p.type==='line'){
  assert.ok(Array.isArray(p.points)&&p.points.length===4);p.points.forEach(unit);
  return `<line x1="${p.points[0]}" y1="${p.points[1]}" x2="${p.points[2]}" y2="${p.points[3]}" ${style}/>`;
 }
 if(p.type==='rect'){assert.ok(n('width')>0&&n('height')>0&&n('x')+n('width')<=1&&n('y')+n('height')<=1);return `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" ${style}/>`;}
 if(p.type==='ellipse'){assert.ok(n('rx')>0&&n('ry')>0&&n('cx')>=p.rx&&p.cx+p.rx<=1&&n('cy')>=p.ry&&p.cy+p.ry<=1);return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" ${style}/>`;}
 assert.equal(p.type,'path','Unknown sketch primitive');
 assert.ok(Array.isArray(p.commands)&&p.commands.length>0&&p.commands.length<=64&&p.commands[0][0]==='M','Structured path must start with M');
 const d=p.commands.map(cmd=>{assert.ok(Array.isArray(cmd)&&Object.hasOwn(counts,cmd[0])&&cmd.length===counts[cmd[0]]+1,'Invalid path command');cmd.slice(1).forEach(unit);return cmd.join(' ');}).join(' ');
 return `<path d="${d}" ${style}/>`;
}
export function renderStoryboardSketch(sketch,rect,clipId,{rough=false,hasArt=false}={}){
 if(!rough||hasArt||sketch===undefined)return '';
 keys(sketch,['version','moment','primitives']);assert.equal(sketch.version,1);
 assert.ok(typeof sketch.moment==='string'&&sketch.moment.trim().length>0&&sketch.moment.length<=200,'Describe one central instant; metadata is not rendered');
 assert.ok(Array.isArray(sketch.primitives)&&sketch.primitives.length>0&&sketch.primitives.length<=128,'Limit sketch primitive count');
 assert.ok(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[0]>=0&&rect[1]>=0&&rect[2]>0&&rect[3]>0&&rect[0]+rect[2]<=1024&&rect[1]+rect[3]<=1536,'Invalid page rectangle');
 assert.match(clipId,/^[A-Za-z][A-Za-z0-9_-]{0,70}$/);
 const shapes=sketch.primitives.map(primitive).join('');
 const [x,y,w,h]=rect;
 return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#${clipId})"><g transform="translate(${x} ${y}) scale(${w} ${h})">${shapes}</g></g>`;
}
