import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function emitResult(c, local, value) {
  if (c.productionMode !== 'economy' || process.argv.includes('--verbose')) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  const file = `${c.workflowDir}/cli-logs/${crypto.randomUUID()}.json`;
  fs.mkdirSync(path.dirname(local(file)), { recursive: true });
  fs.writeFileSync(local(file), JSON.stringify(value, null, 2), { flag: 'wx' });
  console.log(
    JSON.stringify({
      request: value.request,
      status: value.status || 'prepared',
      details: file,
      inputCount: value.inputs?.length ?? value.references?.length,
      next: 'Read details/request from file; pass exact saved inputs to the tool.',
    }),
  );
}
