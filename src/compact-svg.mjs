import assert from 'node:assert/strict';

// Consolidate identical embedded page images without editing any image pixels.
export function compactSVG(source) {
  const pattern =
    /<image href="(data:image\/png;base64,[A-Za-z0-9+/=]+)" width="1024" height="1536" preserveAspectRatio="none" clip-path="(url\(#p\d+\))"\/>/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length < 2) return source;
  assert.ok(!source.includes('id="compacted-page-'), 'Already compacted');
  const images = [...new Set(matches.map((m) => m[1]))];
  const body = source.replace(
    pattern,
    (_, image, clip) =>
      `<use href="#compacted-page-${images.indexOf(image)}" clip-path="${clip}"/>`,
  );
  const defs =
    '<defs>' +
    images
      .map(
        (href, i) =>
          `<image id="compacted-page-${i}" href="${href}" width="1024" height="1536" preserveAspectRatio="none"/>`,
      )
      .join('') +
    '</defs>';
  return body.replace(/(<svg\b[^>]*>)/, '$1' + defs);
}
