import assert from 'node:assert/strict';
export function mergeNarrativeState(base, change) {
  const state = { ...base, ...change };
  for (const field of ['costumes', 'objects'])
    if (base[field] || change[field])
      state[field] = { ...base[field], ...change[field] };
  return state;
}
export function resolveStoryState(config, page, p, local) {
  const id = p?.section ?? page.section;
  if (id)
    assert.ok(
      Object.hasOwn(config.sections || {}, id),
      'Unknown story section: ' + id,
    );
  const base = id ? config.sections[id] : {},
    change = p?.state || {};
  for (const value of [base, change])
    assert.ok(
      value && typeof value === 'object' && !Array.isArray(value),
      'Section state must be an object',
    );

  for (const field of ['costumes', 'objects']) {
    for (const value of [base[field], change[field]])
      if (value !== undefined)
        assert.ok(
          value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.values(value).every((v) => typeof v === 'string'),
          'State ' + field + ' must map IDs to descriptions',
        );
  }
  const state = mergeNarrativeState(base, change);
  for (const actor of Object.keys(state.costumes || {}))
    assert.ok(
      Object.hasOwn(config.cast, actor),
      'Unknown costume actor: ' + actor,
    );
  if (state.references !== undefined)
    assert.ok(
      Array.isArray(state.references),
      'State references must be an array',
    );
  for (const file of state.references || []) local(file);
  return state;
}
