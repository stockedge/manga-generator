// Diagnostic guides are planning aids, never a claim of visual inspection.
export function readingFlow(page,balloonBox){
  const panels=page.panels.map(panel=>{
    const steps=panel.dialogue.map((dialogue,index)=>{
      const rect=balloonBox(panel,dialogue);
      return {number:index+1,speaker:dialogue.speaker,text:dialogue.text,rect,center:[rect[0]+rect[2]/2,rect[1]+rect[3]/2],mouth:panel.speakers?.[dialogue.speaker]?.anchor??null};
    });
    const warnings=[];
    for(let i=1;i<steps.length;i++){
      const a=steps[i-1],b=steps[i];
      if(b.rect[0]>a.rect[0] && b.rect[1]<a.rect[1]+a.rect[3])warnings.push({from:i,to:i+1,reason:'左から右へ戻る移動と縦方向の範囲が重なる。段差・余白・人物の配置を目視で検討する。'});
    }
    // Distances are diagnostic heuristics, not measured reader eye movements.
    const gap=(a,b)=>Math.hypot(Math.max(0,a[0]-b[0]-b[2],b[0]-a[0]-a[2]),Math.max(0,a[1]-b[1]-b[3],b[1]-a[1]-a[3]));
    for(let i=0;i<steps.length-2;i++){
      const a=steps[i],expected=steps[i+1],expectedGap=gap(a.rect,expected.rect);
      for(let j=i+2;j<steps.length;j++){
        const competing=steps[j],competingGap=gap(a.rect,competing.rect);
        const sameColumn=a.rect[0]<competing.rect[0]+competing.rect[2]&&competing.rect[0]<a.rect[0]+a.rect[2];
        if(sameColumn&&competingGap<expectedGap*0.65&&competingGap<=Math.max(32,panel.rect[2]*0.14))warnings.push({code:'nonconsecutive-cluster',from:i+1,expected:i+2,competing:j+1,expectedGap:Math.round(expectedGap),competingGap:Math.round(competingGap),reason:'非連続の吹き出しが同じ縦列で近接し、間の返答を飛ばして続けて読まれる候補。番号なしで確認し、行・会話グループ・人物配置またはコマ分割を直す。'});
      }
    }
    const intent=panel.readingFlow??null;
    const groups=intent?.groups??null;
    if(groups){
      const seen=[];
      for(const group of groups){
        if(!Array.isArray(group.dialogueIds))warnings.push({code:'invalid-reading-group',reason:'readingFlow.groups の dialogueIds が配列ではない。'});
        else seen.push(...group.dialogueIds);
      }
      const expected=steps.map(step=>step.number);
      if(seen.length!==new Set(seen).size || seen.some(n=>!expected.includes(n)) || expected.some(n=>!seen.includes(n)))warnings.push({code:'incomplete-reading-groups',reason:'台詞群は各発話を一度ずつ含め、配列順と一致させる。'});
    }
    return {id:panel.id,rect:panel.rect,steps,faces:panel.speakers,protected:panel.protected??[],intent,groups,warnings};
  });
  return {version:3,page:page.id,status:'planning-guide-not-reviewed',direction:'right-to-left, top-to-bottom',panels,checklist:['番号と誘導線を隠した画像を先に読み、予測した発話順を記録する','最初のセリフへ上・右から入れるか','近い非連続の吹き出しを一組と誤認して返答を飛ばさないか','前の会話のまとまりを読み終えてから次のまとまりへ進めるか','返答へ自然に移り、視線が大きく逆戻りしないか','顔の向き・視線・手や小道具の動作と読順がつながるか','話者への尾が別人物や重要物を横切らないか','場所・時間・回想の切替と物の移動を直前直後から理解できるか','最後のセリフ・反応から次のコマへ移れるか','大きなコマ・余白・情報公開の順がページの感情の狙いに合うか','話題の境界と段・ページ境界が一致し、不要な読み戻りを誘わないか']};
}
export function flowOverlay(svg,flow){
  const elements=[];
  for(const panel of flow.panels){
    const points=panel.steps.map(step=>step.center.join(',')).join(' ');
    if(panel.steps.length>1)elements.push(`<polyline points="${points}" fill="none" stroke="#005eb8" stroke-width="4" stroke-dasharray="10 5"/>`);
    for(const step of panel.steps){
      const [x,y]=step.center;
      elements.push(`<circle cx="${x}" cy="${y}" r="17" fill="white" stroke="#005eb8" stroke-width="3"/><text x="${x}" y="${y+6}" text-anchor="middle" font-size="19" fill="#005eb8">${step.number}</text>`);
    }
    for(const gaze of panel.intent?.gazes??[]){
      if(!Array.isArray(gaze.from)||!Array.isArray(gaze.to)||gaze.from.length!==2||gaze.to.length!==2||![...gaze.from,...gaze.to].every(Number.isFinite))throw new Error('Invalid planned gaze coordinates: '+panel.id);
      elements.push(`<path d="M ${gaze.from.join(' ')} L ${gaze.to.join(' ')}" fill="none" stroke="#d04a00" stroke-width="3" stroke-dasharray="6 5"/>`);
    }
  }
  return svg.replace('</svg>',elements.join('')+'</svg>');
}

export function resolvedNarrativeState(config,page,panel){
  const base=config.sections?.[panel.section??page.section]??{},change=panel.state??{};
  const state={...base,...change};
  for(const field of ['costumes','objects'])if(base[field]||change[field])state[field]={...base[field],...change[field]};
  return state;
}
export function narrativePlan(config){
  let previous=null;const transitions=[],pages=[];
  for(const page of config.pages){
    const areas=page.panels.map(p=>p.rect[2]*p.rect[3]),maxArea=Math.max(...areas);
    const showcase=page.showcase??null;
    pages.push({
      page:page.id,
      feeling:page.purpose,
      questionForNextPage:page.expectation,
      intent:{emotion:page.emotion??page.purpose,revealOrder:page.revealOrder??null,peakPanel:showcase,turnQuestion:page.turnQuestion??page.expectation??null,turnAnswer:page.turnAnswer??null},
      showcase,
      diagnostics:{showcaseExists:showcase===null||page.panels.some(p=>p.id===showcase),areaRange:[Math.min(...areas),maxArea],strengthsEqual:new Set(areas).size===1},
      panels:page.panels.map((p,i)=>({id:p.id,beat:p.beat??p.role,camera:p.camera,area:areas[i],strength:maxArea?Math.round(areas[i]/maxArea*100)/100:null,showcase:p.id===showcase,information:p.information??null,pause:p.pause??null,readingGroups:p.readingFlow?.groups??null,layoutRow:p.layoutRow??null}))
    });
    for(const panel of page.panels){const section=panel.section??page.section??null;
      const setting=resolvedNarrativeState(config,page,panel);
      if(previous){const change=previous.section!==section,t=panel.transition??null,warnings=[];
        if(change&&!t?.bridge)warnings.push('場面設定が変わる。読者が時間・場所・回想への出入りを識別できる導入を記録し、実画像で確認する。');
        if(!change&&JSON.stringify(previous.setting)!==JSON.stringify(setting))warnings.push('同じ場面内の設定が変わる。場所・時刻・衣装・物の状態と動作の接続を確認する。');
        const common=Object.keys(panel.speakers??{}).filter(a=>panel.speakers[a].anchor&&previous.panel.speakers?.[a]?.anchor);
        if(common.some((a,i)=>common.slice(i+1).some(b=>(panel.speakers[a].anchor[0]-panel.speakers[b].anchor[0])*(previous.panel.speakers[a].anchor[0]-previous.panel.speakers[b].anchor[0])<0)))warnings.push('人物の画面上の左右が入れ替わる。逆角度・移動・持ち物の接続を絵から理解できるか確認する。');
        const beforeObjects=previous.setting.objects??{},afterObjects=setting.objects??{};
        const retainedObjects=Object.keys(beforeObjects).filter(id=>Object.hasOwn(afterObjects,id)&&beforeObjects[id]===afterObjects[id]);
        const changedObjects=[...new Set([...Object.keys(beforeObjects),...Object.keys(afterObjects)])].filter(id=>beforeObjects[id]!==afterObjects[id]);
        const pageBoundary=previous.page!==page.id;
        transitions.push({
          from:previous.panel.id,
          to:panel.id,
          pageBoundary,
          layoutBoundary:pageBoundary||previous.panel.layoutRow!==panel.layoutRow,
          kind:t?.kind??(change?'scene-change':JSON.stringify(previous.setting)!==JSON.stringify(setting)?'state-change':'continuation'),
          before:{section:previous.section,setting:previous.setting,scene:previous.panel.scene,action:previous.panel.action},
          after:{section,setting,scene:panel.scene,action:panel.action},
          ledger:{timeBefore:t?.timeBefore??previous.setting.time??null,timeAfter:t?.timeAfter??setting.time??null,locationBefore:t?.locationBefore??previous.setting.location??null,locationAfter:t?.locationAfter??setting.location??null,readerMustKnow:t?.readerMustKnow??null,anchor:t?.anchor??(t?.bridge?'visual-or-caption':null),anchorEvidencePanel:t?.anchorEvidencePanel??panel.id,axisBefore:t?.axisBefore??null,axisAfter:t?.axisAfter??null,resetCue:t?.resetCue??null,retainedObjects,changedObjects,actionBefore:t?.actionBefore??previous.panel.action??null,actionAfter:t?.actionAfter??panel.action??null,sourceBasis:t?.sourceBasis??null,supplementBasis:t?.supplementBasis??t?.settingBasis??null},
          bridge:t?.bridge??null,
          settingBasis:t?.settingBasis??null,
          warnings
        });
      }previous={panel,section,setting,page:page.id};
    }
  }
  return {version:2,status:'planned-not-visually-reviewed',guidance:config.narrativeDesign??{version:1,direction:'right-to-left, top-to-bottom',rules:['one beat per panel','speech groups and faces are planned together','scene and time boundaries receive a visual or caption anchor','page-end question and next-page answer are reviewed, not forced']},pages,transitions,note:'研究メモを実装へ翻訳した計画台帳。強度・段境界・場面接続はレビュー候補であり、実際の読者の視線や面白さを機械的に保証しない。'};
}
