const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

/**
 * PATH CONFIGURATION (Windows Optimized)
 */
const projectRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(projectRoot, 'backend');

let backendProcess = null;
let ipcRegistered = false;
let shuttingDown = false;

const runtimeConfig = {
  localApiUrl: 'http://127.0.0.1:8000',
  remoteApiUrl: null,
  effectiveApiUrl: 'http://127.0.0.1:8000',
  mode: 'local'
};

/**
 * HELPER: API URL NORMALIZATION
 */
function normalizeApiUrl(value) {
  const next = String(value ?? '').trim().replace(/\/+$/, '');
  return next || null;
}

function joinApiUrl(base, endpoint) {
  const normalizedBase = normalizeApiUrl(base);
  if (!normalizedBase) return endpoint;
  return `${normalizedBase}/${String(endpoint).replace(/^\/+/, '')}`;
}

function syncRuntimeConfig(partial = {}) {
  const localApiUrl = normalizeApiUrl(partial.localApiUrl ?? runtimeConfig.localApiUrl) ?? runtimeConfig.localApiUrl;
  const remoteApiUrl = partial.remoteApiUrl === undefined ? runtimeConfig.remoteApiUrl : normalizeApiUrl(partial.remoteApiUrl);
  const mode = remoteApiUrl ? 'remote' : 'local';
  const effectiveApiUrl = normalizeApiUrl(
    partial.effectiveApiUrl ?? (mode === 'remote' ? remoteApiUrl : localApiUrl)
  ) ?? localApiUrl;

  runtimeConfig.localApiUrl = localApiUrl;
  runtimeConfig.remoteApiUrl = remoteApiUrl;
  runtimeConfig.effectiveApiUrl = effectiveApiUrl;
  runtimeConfig.mode = mode;
  return getRuntimePayload();
}

function getRuntimePayload() {
  return {
    localApiUrl: runtimeConfig.localApiUrl,
    remoteApiUrl: runtimeConfig.remoteApiUrl,
    effectiveApiUrl: runtimeConfig.effectiveApiUrl,
    mode: runtimeConfig.mode,
    platform: 'win32',
    arch: process.arch
  };
}

/**
 * NETWORK: PORT ALLOCATION
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a localhost port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * BACKEND MANAGEMENT (Windows Specific)
 */
function resolveDevPython() {
  // Windows uses Scripts/python.exe
  const candidate = path.join(backendRoot, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(candidate)) {
    throw new Error(`Windows Python runtime not found at ${candidate}. Did you run 'python -m venv .venv'?`);
  }
  return candidate;
}

function resolveBackendCommand(port) {
  const pythonExe = resolveDevPython();
  return {
    command: pythonExe,
    args: ['-m', 'app.desktop_entry'], // Ensure desktop_entry.py exists in backend/app/
    cwd: backendRoot,
    env: { 
      ...process.env, 
      API_PORT: String(port),
      PYTHONPATH: backendRoot // Forces Python to see the 'app' module correctly
    }
  };
}

function startBackend(port) {
  const spec = resolveBackendCommand(port);
  
  // Use shell: true for better Windows compatibility with virtualenvs
  backendProcess = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true 
  });

  backendProcess.stdout?.on('data', (chunk) => console.log(`[backend] ${chunk.toString().trim()}`));
  backendProcess.stderr?.on('data', (chunk) => console.error(`[backend-err] ${chunk.toString().trim()}`));

  backendProcess.once('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      dialog.showErrorBox(
        'Backend exited unexpectedly',
        `The FastAPI backend stopped. Code: ${code ?? 'unknown'}`
      );
    }
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess) return;
  
  // CRITICAL: Windows requires taskkill to clean up Python module process trees
  // Otherwise, the port remains "locked" even after Electron closes.
  spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
  backendProcess = null;
}

function waitForBackend(timeoutMs = 60000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for backend at ${runtimeConfig.localApiUrl}`));
        return;
      }
      const request = http.get(`${runtimeConfig.localApiUrl}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else setTimeout(attempt, 500);
      });
      request.on('error', () => setTimeout(attempt, 500));
    };
    attempt();
  });
}

/**
 * IPC HANDLERS
 */
function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('desktop:get-runtime-config', async () => getRuntimePayload());
  ipcMain.handle('desktop:open-experiment-folder', () => openFolderDialog('Open experiment folder'));
  ipcMain.handle('desktop:open-qwen-repo-folder', () => openFolderDialog('Select Qwen repo folder'));
  ipcMain.handle('desktop:open-weights-folder', () => openFolderDialog('Select Qwen weights folder'));
}

async function openFolderDialog(title) {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory', 'createDirectory']
  });
  return { folderPath: result.canceled ? null : result.filePaths[0] ?? null };
}

/**
 * UI MANAGEMENT
 */
async function createMainWindow() {
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  const window = new BrowserWindow({
    width: Math.floor(workAreaWidth * 0.9),
    height: Math.floor(workAreaHeight * 0.9),
    backgroundColor: '#0f172a',
    title: 'Probabilistic Colocalization Estimator (Windows)',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Standard Windows path joining for built files
    await window.loadFile(path.join(projectRoot, 'frontend', 'dist', 'index.html'));
  }

  return window;
}

/**
 * BOOTSTRAP
 */
async function bootstrap() {
  const port = await getFreePort();
  syncRuntimeConfig({ localApiUrl: `http://127.0.0.1:${port}` });
  registerIpc();
  startBackend(port);
  await waitForBackend();
  await createMainWindow();
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error(err);
  dialog.showErrorBox('Desktop startup failed', String(err));
  app.quit();
});

app.on('before-quit', () => {
  shuttingDown = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('exit', stopBackend);
