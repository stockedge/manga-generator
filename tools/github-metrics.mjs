import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] || 'stockedge/manga-generator';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
  throw new Error('Use OWNER/REPOSITORY');

function api(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', `repos/${repo}${endpoint}`], {
      encoding: 'utf8', windowsHide: true,
    }));
  } catch (error) {
    throw new Error(`GitHub API failed at ${endpoint}. Authenticate with gh and ensure repository traffic access. ${error.message}`);
  }
}

const details = api('');
const snapshot = {
  version: 1,
  capturedAt: new Date().toISOString(),
  repository: details.full_name,
  createdAt: details.created_at,
  stars: details.stargazers_count,
  forks: details.forks_count,
  topics: api('/topics').names,
  traffic: {
    views: api('/traffic/views'),
    clones: api('/traffic/clones'),
    referrers: api('/traffic/popular/referrers'),
  },
  interpretation: 'Traffic is a rolling window reported by GitHub and may lag; unique counts are not additive across days. Stars and forks are point-in-time totals.',
};
const filename = snapshot.capturedAt.replace(/[:.]/g, '-') + '.json';
const destination = path.join('docs', 'metrics', filename);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
console.log(destination);
