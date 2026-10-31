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
  const skillDir = path.dirname(file);
  const referencesDir = path.join(skillDir, 'references');
  const mdFiles = new Set([path.resolve(file)]);
  if (fs.existsSync(referencesDir)) {
    for (const entry of fs.readdirSync(referencesDir)) {
      assert.ok(
        entry.endsWith('.md'),
        `${file} references/ must contain only Markdown: ${entry}`,
      );
      mdFiles.add(path.join(referencesDir, entry));
    }
  }
  const mdLinks = (content) =>
    [...content.matchAll(/\]\((?!https?:|mailto:|#)([^)]+)\)/g)]
      .map(([, target]) => target.split('#')[0])
      .filter((target) => target.endsWith('.md'));
  // Every relative Markdown link must resolve inside this skill directory,
  // so the bundle stays standalone. Non-Markdown asset links are out of
  // scope: some point at untracked research files.
  const seen = new Set([path.resolve(file)]);
  const queue = [path.resolve(file)];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const target of mdLinks(fs.readFileSync(current, 'utf8'))) {
      const resolved = path.resolve(path.dirname(current), target);
      assert.ok(
        resolved.startsWith(skillDir + path.sep),
        `${file} links outside its skill directory: ${target}`,
      );
      assert.ok(
        mdFiles.has(resolved),
        `${file} links to a missing file: ${target}`,
      );
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  for (const entry of mdFiles) {
    if (entry === path.resolve(file)) continue;
    assert.ok(
      seen.has(entry),
      `${file} references/ has an unreachable file: ${path.basename(entry)}`,
    );
  }
  // Bundled references must match the repo sources. Compared LF-normalized
  // so CRLF and LF checkouts both pass.
  const normalize = (entry) =>
    fs.readFileSync(entry, 'utf8').replace(/\r\n/g, '\n');
  for (const entry of mdFiles) {
    if (entry === path.resolve(file)) continue;
    const name = path.basename(entry);
    const source =
      name === 'AGENTS.md'
        ? path.join(workspaceRoot, name)
        : path.join(workspaceRoot, 'docs', name);
    assert.ok(fs.existsSync(source), `${file} has no repo source for ${name}`);
    assert.equal(
      normalize(entry),
      normalize(source),
      `${file} copy is out of sync: ${name}`,
    );
  }
}
console.log(
  `PASS: ${ids.length} agent skills with valid frontmatter (${ids.join(', ')})`,
);
