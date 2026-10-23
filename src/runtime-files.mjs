import fs from 'node:fs';
import path from 'node:path';

// These directories contain code and templates needed by restored copies.
export function runtimeFiles(root) {
  const result = [];
  function walk(relative) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      // OneDrive placeholders may look like links in Dirent; inspect the path.
      const stat = fs.lstatSync(path.join(root, file));
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) result.push(file);
    }
  }
  for (const dir of ['cli', 'src', 'scripts', 'templates', 'tests']) walk(dir);
  return result.sort();
}
