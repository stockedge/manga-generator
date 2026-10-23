import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Resolve from the installed code, never from the caller's working directory.
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
