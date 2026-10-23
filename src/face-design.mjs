import assert from 'node:assert/strict';

// Face geometry and drawing method belong to each work, not the compositor.
export function validateFaceDesign(config, local) {
  if (config.version < 8) return;
  for (const [id, actor] of Object.entries(config.cast)) {
    if (actor.kind === 'caption') continue;
    const f = actor.faceDesign;
    assert.ok(
      f &&
        Array.isArray(f.traits) &&
        f.traits.length === 3 &&
        f.traits.every((t) => typeof t === 'string' && t.trim()),
      'Define three face traits: ' + id,
    );
    assert.ok(
      typeof f.reference === 'string' && f.reference.trim(),
      'Define face reference: ' + id,
    );
    local(f.reference);
    assert.ok(
      (config.references || []).includes(f.reference),
      'Face reference must be a production reference: ' + id,
    );
    assert.ok(
      typeof f.settingBasis === 'string' && f.settingBasis.trim(),
      'Separate source facts and adaptation choices: ' + id,
    );
  }
  for (const [file, role] of Object.entries(config.referenceRoles || {})) {
    local(file);
    assert.ok(
      typeof role === 'string' && role.trim(),
      'Describe reference role: ' + file,
    );
  }
}
export function referenceInstructions(config, references) {
  if (config.version < 8) return '';
  return (
    '\nREFERENCE ROLES (in supplied order): ' +
    references
      .map(
        (file, i) =>
          `${i + 1}: ${file} — ${config.referenceRoles?.[file] || (/\/storyboards\/|\/panels\//.test(file) ? 'Layout and reserved lettering footprints only; labels are not artwork.' : 'Scene composition, costumes and props only; canonical face geometry and drawing method take priority.')}`,
      )
      .join('\n') +
    "\nKeep each actor's THREE faceDesign traits in every view. Vary acting and camera without replacing their skull, eyelids or brows. Use the canonical reference for faces and rendering; do not inherit generic faces or dense shading from older composition images."
  );
}
export function faceReviewTemplate(config, p) {
  if (config.version < 8) return {};
  return {
    faceIdentity: Object.fromEntries(
      Object.entries(p.speakers || {})
        .filter(
          ([, s]) => s.face && s.kind !== 'head' && s.kind !== 'offscreen',
        )
        .map(([id]) => [
          id,
          {
            reference: config.cast[id].faceDesign.reference,
            traits: ['', '', ''],
            expression: '',
          },
        ]),
    ),
  };
}
export function validateFaceReview(config, p, r) {
  if (config.version < 8) return;
  const expected = Object.keys(
    faceReviewTemplate(config, p).faceIdentity,
  ).sort();
  assert.deepEqual(
    Object.keys(r.faceIdentity || {}).sort(),
    expected,
    'Review every visible face against its canonical reference',
  );
  for (const id of expected) {
    const v = r.faceIdentity[id];
    assert.equal(
      v.reference,
      config.cast[id].faceDesign.reference,
      'Wrong face reference: ' + id,
    );
    assert.ok(
      Array.isArray(v.traits) &&
        v.traits.length === 3 &&
        v.traits.every((t) => typeof t === 'string' && t.trim().length >= 4),
      'Observe each of three face traits: ' + id,
    );
    assert.ok(
      typeof v.expression === 'string' && v.expression.trim().length >= 4,
      'Observe scene-specific expression: ' + id,
    );
  }
}
