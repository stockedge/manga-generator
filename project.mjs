import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {trackState} from './state-history.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
export const configFile=process.env.MANGA_PROJECT || 'works/kensei/workflow.json';
export function local(file){
  assert.ok(typeof file==='string' && file.length && !path.isAbsolute(file),'Project paths must be relative');
  const resolved=path.resolve(root,file);
  assert.ok(resolved.startsWith(root+path.sep),'Project path escapes workspace');
  return resolved;
}
trackState(root,configFile);
export const config=JSON.parse(fs.readFileSync(local(configFile),'utf8'));
