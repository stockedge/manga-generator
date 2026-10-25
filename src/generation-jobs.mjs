import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { box } from './lettering.mjs';
import { qualityInstructions } from './quality.mjs';
import { referenceInstructions } from './face-design.mjs';
import { modernPrompts, referenceManifest, panelPrompt } from './prompts.mjs';
import { decisionContext, reviewContext } from './review-context.mjs';
export function createGenerationJobs({ config, local, stateFor, svg }) {
  const cast = config.cast,
    workflowDir = config.workflowDir || 'workflow',
    assetDir = config.assetDir || 'assets/v2',
    panelsOnly = config.renderMode === 'panels';
  const drawingInstructions = qualityInstructions(config);
  const hash = (value) =>
    crypto.createHash('sha256').update(value).digest('hex');
  const layoutReference = (file) =>
    [workflowDir + '/storyboards', workflowDir + '/panels'].includes(
      path.posix.dirname(file),
    ) && /^page-[a-zA-Z0-9_-]+\.png$/.test(path.posix.basename(file));
  const stateText = (page, p) => {
    const s = stateFor(page, p);
    return Object.keys(s).length ? '\nSECTION STATE: ' + JSON.stringify(s) : '';
  };
  function promptBase(page, baked = false) {
    return `Use case: illustration-story. Produce ONE finished monochrome manga page, 1024x1536 portrait, Japanese RIGHT-TO-LEFT reading. Use the supplied canonical references. The storyboard is the exact layout: preserve ALL panel rectangle positions and sizes and white balloon footprints. Gray face rectangles and labeled mouth anchors are exact reserved character positions, not final artwork. Preserve them; balloon tails must point to those actors. Additional artwork references preserve identity; their old layouts do not override this plan.\nSTYLE: ${config.style}\nPAGE PURPOSE: ${page.purpose}.\n${page.panels.map((p) => `Panel ${p.order}, rectangle [x,y,width,height]=${JSON.stringify(p.rect)}: ${p.scene}${stateText(page, p)}\nDialogue in reading order: ${p.dialogue.map((d) => `${d.speaker}: "${d.text.replace(/\n/g, '')}" at ${JSON.stringify(box(p, d))}`).join('; ')}`).join('\n')}\n${baked ? 'Render the quoted Japanese dialogue verbatim in vertical columns inside exactly the indicated balloons. No extra words.' : 'Do NOT render any text, letters, page number or storyboard labels. Keep white EMPTY balloons in precisely the supplied positions; typography will be added separately. Do not draw faces, hands, receipts or rings underneath those balloon footprints.'}\nNo extra panels. No top dialogue strips. Integrate balloons into each composition with natural white space. Economical ink, white backgrounds in closeups, only a few simple location contours in establishing shots. NO wood grain, grass texture, wall texture, excessive strands, fabric micro-hatching, photorealism or glossy gradients. Clear purposeful acting, different shot sizes, coherent hands. CAST: ${JSON.stringify(cast)}. CONTINUITY: ${config.continuity || 'Preserve reference identities and props.'}`;
  }
  function prompt(page, baked = false) {
    return promptBase(page, baked) + drawingInstructions;
  }
  function job(page) {
    const references = [
      ...new Set([
        ...(config.references || []),
        `${workflowDir}/storyboards/page-${page.id}.png`,
        ...(page.references || []),
        ...page.panels.flatMap((p) => stateFor(page, p).references || []),
      ]),
    ];
    const spec = {
      page: page.id,
      prompt: prompt(page) + referenceInstructions(config, references),
      references,
      rectangles: page.panels.map((p) => p.rect),
    };
    if (modernPrompts(config)) {
      for (const file of page.panels.flatMap((p) => p.references || []))
        if (!references.includes(file)) references.push(file);
      const manifest = referenceManifest(config, references, {
        layouts: [`${workflowDir}/storyboards/page-${page.id}.png`],
      });
      Object.assign(spec, { promptVersion: 2, referenceManifest: manifest });
      spec.prompt =
        'TASK: Draw ONE monochrome manga page, 1024x1536, right-to-left then top-to-bottom. Place each panel at its page rectangle. Within each panel, placement data is panel-local. No text, balloons, visible guides or page numbers; the compositor adds lettering and borders.\n' +
        page.panels
          .map(
            (p) =>
              'PAGE RECTANGLE: ' +
              JSON.stringify(p.rect) +
              '\n' +
              panelPrompt(
                config,
                page,
                p,
                stateFor(page, p),
                p.dialogue.map((d) => box(p, d)),
                manifest,
                drawingInstructions,
              )
                .split('\n')
                .filter(
                  (line) =>
                    !line.startsWith('TASK:') && !line.startsWith('OUTPUT:'),
                )
                .join('\n'),
          )
          .join('\n');
    }
    if (config.productionDecisions?.length) {
      const decisions = decisionContext(
        config,
        reviewContext(config, 'artwork', page.id),
      );
      if (decisions.length)
        spec.prompt +=
          '\nPRODUCTION DECISIONS (content constraints): ' +
          JSON.stringify(decisions);
    }
    const fingerprint = hash(
      JSON.stringify(spec) +
        hash(svg(page, null, true)) +
        references
          .filter((r) => !layoutReference(r))
          .map((r) =>
            fs.existsSync(local(r))
              ? hash(fs.readFileSync(local(r)))
              : 'missing:' + r,
          )
          .join('') +
        (config.sourceFile
          ? hash(fs.readFileSync(local(config.sourceFile)))
          : ''),
    );
    return {
      ...spec,
      fingerprint,
      asset: `${assetDir}/page-${page.id}.png`,
      record: `${assetDir}/page-${page.id}.json`,
    };
  }
  function panelJobBase(page, p) {
    if (panelsOnly) {
      const [x, y, w, h] = p.rect;
      const instructions = `Use case: illustration-story. Draw ONE monochrome manga panel, aspect ${w}:${h}. No page layout, borders, speech bubbles, captions, letters or watermark. Leave the storyboard balloon footprints WHITE and EMPTY; typography and balloon shapes will be added by the compositor. Preserve the marked character positions.\nSTYLE: ${config.style}\nCAST: ${JSON.stringify(cast)}\nCONTINUITY: ${config.continuity || 'Preserve reference identities.'}\nSCENE: ${p.scene}${stateText(page, p)}\nACTING/SHOT: ${JSON.stringify({ action: p.action, emotion: p.emotion, camera: p.camera })}\nLocal mouth/face positions: ${JSON.stringify(Object.fromEntries(Object.entries(p.speakers || {}).map(([id, s]) => [id, { ...s, anchor: s.anchor?.map((v, i) => v - [x, y][i]), face: s.face?.map((v, i) => (i < 2 ? v - [x, y][i] : v)) }])))}\nReserved white rectangles [x,y,width,height]: ${JSON.stringify(p.dialogue.map((d) => box(p, d).map((v, i) => (i < 2 ? v - [x, y][i] : v))))}\nUse sparse background contours, purposeful expressions, varied ink pressure. Avoid glossy gradients, microtexture, extra people and redundant decorations.`;
      const references = [
        ...new Set([
          ...(config.references || []),
          `${workflowDir}/panels/page-${p.id}.png`,
          ...(page.references || []),
          ...(stateFor(page, p).references || []),
          ...(p.references || []),
        ]),
      ];
      references.forEach(local);
      const fingerprint = hash(
        instructions +
          (p.storyboardSketch === undefined
            ? ''
            : JSON.stringify(p.storyboardSketch)) +
          JSON.stringify({
            rect: p.rect,
            dialogue: p.dialogue,
            role: p.role,
            purpose: page.purpose,
            expectation: page.expectation,
            references,
          }) +
          references
            .filter((f) => !layoutReference(f))
            .map((f) =>
              fs.existsSync(local(f))
                ? hash(fs.readFileSync(local(f)))
                : 'missing:' + f,
            )
            .join('') +
          (config.sourceFile
            ? hash(fs.readFileSync(local(config.sourceFile)))
            : ''),
      );
      return {
        id: p.id,
        parentPage: page.id,
        prompt: instructions,
        references,
        asset: `${assetDir}/panels/${p.id}.png`,
        record: `${assetDir}/panels/${p.id}.json`,
        fingerprint,
      };
    }
    const one = { ...page, panels: [p] };
    const [x, y, w, h] = p.rect;
    const instructions =
      prompt(one).replace(
        '1024x1536 portrait',
        `${w}x${h} single panel, aspect ${w}:${h}`,
      ) +
      `\nOutput only panel ${p.id}, no page layout or surrounding panels. Subtract [${x},${y}] from the supplied balloon coordinates to place them in this local panel. Reference 2 already shows the isolated panel. No text.`;
    const refs = [
      ...(config.references || ['assets/characters.png']),
      `${workflowDir}/panels/page-${p.id}.png`,
      ...(page.references || []),
    ];
    return {
      id: p.id,
      parentPage: page.id,
      prompt: instructions,
      references: refs,
      asset: `${assetDir}/panels/${p.id}.png`,
      record: `${assetDir}/panels/${p.id}.json`,
      fingerprint: hash(instructions + job(page).fingerprint),
    };
  }
  function panelJobCore(page, p) {
    if (modernPrompts(config)) {
      const layout = `${workflowDir}/panels/page-${p.id}.png`;
      const state = stateFor(page, p);
      const manifest = referenceManifest(
        config,
        [
          ...(config.references || []),
          layout,
          ...(page.references || []),
          ...(state.references || []),
          ...(p.references || []),
        ],
        { layouts: [layout] },
      );
      const references = manifest.map((item) => item.file);
      references.forEach(local);
      const instructions = panelPrompt(
        config,
        page,
        p,
        state,
        p.dialogue.map((d) => box(p, d)),
        manifest,
        drawingInstructions,
      );
      const fingerprint = hash(
        instructions +
          JSON.stringify({ policy: config.promptPolicy, panel: p, manifest }) +
          references
            .filter((f) => f !== layout)
            .map((f) =>
              fs.existsSync(local(f))
                ? hash(fs.readFileSync(local(f)))
                : 'missing:' + f,
            )
            .join('') +
          hash(fs.readFileSync(local(config.sourceFile))),
      );
      return {
        id: p.id,
        parentPage: page.id,
        promptVersion: 2,
        prompt: instructions,
        referenceManifest: manifest,
        references,
        fingerprint,
        asset: `${assetDir}/panels/${p.id}.png`,
        record: `${assetDir}/panels/${p.id}.json`,
      };
    }
    let j = panelJobBase(page, p);
    if (drawingInstructions && panelsOnly)
      j = {
        ...j,
        prompt: j.prompt + drawingInstructions,
        fingerprint: hash(j.fingerprint + drawingInstructions),
      };
    const roles = referenceInstructions(config, j.references);
    return roles
      ? {
          ...j,
          prompt: j.prompt + roles,
          fingerprint: hash(j.fingerprint + roles),
        }
      : j;
  }
  function panelJob(page, p) {
    const j = panelJobCore(page, p);
    if (!config.productionDecisions?.length) return j;
    const decisions = decisionContext(
      config,
      reviewContext(config, 'artwork', p.id),
    );
    if (!decisions.length) return j;
    const text =
      '\nPRODUCTION DECISIONS (content constraints): ' +
      JSON.stringify(decisions);
    return {
      ...j,
      prompt: j.prompt + text,
      fingerprint: hash(j.fingerprint + text),
    };
  }
  return { prompt, job, panelJob, layoutReference };
}
