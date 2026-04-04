import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.join(projectRoot, 'backend');
const isWindows = process.platform === 'win32';

function isRunnable(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

const candidates = [
  process.env.PYTHON_BIN,
  path.join(backendRoot, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python'),
  'python3',
  'python'
].filter(Boolean);

const python = candidates.find((candidate) => {
  if (candidate.includes(path.sep)) {
    return existsSync(candidate);
  }
  return isRunnable(candidate);
});

if (!python) {
  throw new Error('Unable to locate a Python runtime for the backend build.');
}

const result = spawnSync(
  python,
  ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--name', 'pce-backend', 'app/desktop_entry.py'],
  {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
