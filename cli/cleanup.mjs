import { cleanupTemporary } from '../src/temporary.mjs';
console.log(JSON.stringify({ removed: cleanupTemporary() }, null, 2));
