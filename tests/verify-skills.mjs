import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root as workspaceRoot } from '../src/workspace.mjs';

const skillsDir = path.join(workspaceRoot, '.agents/skills');
assert.ok(fs.existsSync(skillsDir), 'Missing .agents/skills directory');
const ids = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.ok(ids.length > 0, 'No skills found under .agents/skills');

const parseFrontmatter = (text, file) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, `${file} must start with a YAML frontmatter block`);
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.startsWith(' ') || line.startsWith('\t')) continue;
    const at = line.indexOf(':');
    assert.ok(at > 0, `${file} has a malformed frontmatter line: ${line}`);
    frontmatter[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { frontmatter, body: text.slice(match[0].length) };
};

for (const id of ids) {
  const file = path.join(skillsDir, id, 'SKILL.md');
  assert.ok(fs.existsSync(file), `Missing ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const { frontmatter, body } = parseFrontmatter(text, file);
  const { name, description } = frontmatter;
  assert.ok(
    name &&
      name.length <= 64 &&
      /^[a-z0-9-]+$/.test(name) &&
      !name.startsWith('-') &&
      !name.endsWith('-') &&
      !name.includes('--'),
    `${file} has an invalid skill name: ${JSON.stringify(name)}`,
  );
  assert.equal(name, id, `${file} name must match its directory: ${id}`);
  assert.ok(
    description && description.length <= 1024,
    `${file} needs a 1-1024 character description`,
  );
  const [heading] = body.split('\n').filter((line) => line.trim());
  assert.ok(
    heading && heading.startsWith('# '),
    `${file} needs a top-level heading after the frontmatter`,
  );
  const bundled = new Set();
  for (const [, target] of text.matchAll(
    /\]\((?!https?:|mailto:|#)([^)]+)\)/g,
  )) {
    const relative = target.split('#')[0];
    const resolved = path.resolve(path.dirname(file), relative);
    assert.ok(
      fs.existsSync(resolved),
      `${file} links to a missing file: ${target}`,
    );
    if (relative.startsWith('references/')) bundled.add(relative);
  }
  // Bundled references must match the repo sources. Compared LF-normalized
  // so CRLF and LF checkouts both pass.
  const referencesDir = path.join(path.dirname(file), 'references');
  const onDisk = fs.existsSync(referencesDir)
    ? fs.readdirSync(referencesDir).sort()
    : [];
  assert.deepEqual(
    onDisk,
    [...bundled].map((link) => path.basename(link)).sort(),
    `${file} references/ must contain exactly its linked copies`,
  );
  const normalize = (entry) =>
    fs.readFileSync(entry, 'utf8').replace(/\r\n/g, '\n');
  for (const link of bundled) {
    const name = path.basename(link);
    const source =
      name === 'AGENTS.md'
        ? path.join(workspaceRoot, name)
        : path.join(workspaceRoot, 'docs', name);
    assert.ok(fs.existsSync(source), `${file} has no repo source for ${link}`);
    assert.equal(
      normalize(path.join(referencesDir, name)),
      normalize(source),
      `${file} copy is out of sync: ${link}`,
    );
  }
}
console.log(
  `PASS: ${ids.length} agent skills with valid frontmatter (${ids.join(', ')})`,
);
