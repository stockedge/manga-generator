import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root as workspaceRoot } from '../src/workspace.mjs';

// Restricted frontmatter syntax: single-line double-quoted scalars only,
// plus an optional `metadata:` mapping skipped as indented lines. Anything
// else (unquoted scalars, block scalars) is rejected so CI never passes
// frontmatter that strict YAML skill loaders reject.
const parseFrontmatter = (text, file) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, `${file} must start with a YAML frontmatter block`);
  const frontmatter = {};
  let inMap = false;
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      continue;
    }
    if (/^\s/.test(line)) {
      assert.ok(
        inMap,
        `${file} has an indented line outside a mapping: ${line}`,
      );
      continue;
    }
    inMap = false;
    const scalar = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    assert.ok(scalar, `${file} has a malformed frontmatter line: ${line}`);
    const [, key, raw] = scalar;
    if (raw === '') {
      assert.equal(
        key,
        'metadata',
        `${file} only metadata may use mapping form`,
      );
      inMap = true;
      continue;
    }
    assert.ok(
      /^"(?:[^"\\\r\n]|\\["\\])*"$/.test(raw),
      `${file} field ${key} must use a double-quoted scalar`,
    );
    frontmatter[key] = raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return { frontmatter, body: text.slice(match[0].length) };
};

const checkIdentity = (frontmatter, file, id) => {
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
};

// Regression fixtures for the parser itself.
const head = (fields) => `---\n${fields}\n---\n\n# Fixture\n`;
const fixtures = [
  {
    title: 'quoted colon is accepted',
    text: head('name: "demo-skill"\ndescription: "Does things: with a colon."'),
    id: 'demo-skill',
    want: null,
  },
  {
    title: 'unquoted colon is rejected',
    text: head('name: "demo-skill"\ndescription: Does things: badly'),
    id: 'demo-skill',
    want: /double-quoted/,
  },
  {
    title: 'empty block scalar is rejected',
    text: head('name: "demo-skill"\ndescription: >'),
    id: 'demo-skill',
    want: /double-quoted/,
  },
  {
    title: 'empty description is rejected',
    text: head('name: "demo-skill"\ndescription: ""'),
    id: 'demo-skill',
    want: /1-1024/,
  },
  {
    title: 'invalid name is rejected',
    text: head('name: "Bad_Name"\ndescription: "Fine."'),
    id: 'Bad_Name',
    want: /invalid skill name/,
  },
  {
    title: 'name and directory mismatch is rejected',
    text: head('name: "demo-skill"\ndescription: "Fine."'),
    id: 'other-dir',
    want: /must match its directory/,
  },
];
for (const fixture of fixtures) {
  if (fixture.want === null) {
    const { frontmatter } = parseFrontmatter(fixture.text, fixture.title);
    checkIdentity(frontmatter, fixture.title, fixture.id);
  } else {
    assert.throws(() => {
      const { frontmatter } = parseFrontmatter(fixture.text, fixture.title);
      checkIdentity(frontmatter, fixture.title, fixture.id);
    }, fixture.want);
  }
}

const skillsDir = path.join(workspaceRoot, '.agents/skills');
assert.ok(fs.existsSync(skillsDir), 'Missing .agents/skills directory');
const ids = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.ok(ids.length > 0, 'No skills found under .agents/skills');

for (const id of ids) {
  const file = path.join(skillsDir, id, 'SKILL.md');
  assert.ok(fs.existsSync(file), `Missing ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const { frontmatter, body } = parseFrontmatter(text, file);
  checkIdentity(frontmatter, file, id);
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
