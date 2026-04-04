import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Point to the root directory where your app/ folder now lives
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';

function isRunnable(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

// 2. Look for Python in the current environment
const candidates = [
  process.env.PYTHON_BIN,
  'python3',
  'python'
].filter(Boolean);

const python = candidates.find((candidate) => {
  if (candidate && candidate.includes(path.sep)) {
    return existsSync(candidate);
  }
  return isRunnable(candidate);
});

if (!python) {
  throw new Error('Unable to locate a Python runtime for the backend build.');
}

console.log(`🐍 Using Python: ${python}`);

// 3. Run PyInstaller from the ROOT directory
const result = spawnSync(
  python,
  [
    '-m', 'PyInstaller', 
    '--noconfirm', 
    '--clean', 
    '--onefile', 
    '--name', 'pce-backend', 
    '"app copy/core/main.py"' // <--- Verify this is the correct path to your main Python file!
  ],
  {
    cwd: projectRoot, // Start in the root
    stdio: 'inherit',
    shell: true,
    env: process.env
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
