const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const projectRoot = __dirname;
let backendProcess = null;
let ipcRegistered = false;
let shuttingDown = false;

const runtimeConfig = {
  localApiUrl: 'http://127.0.0.1:8000',
  remoteApiUrl: null,
  effectiveApiUrl: 'http://127.0.0.1:8000',
  mode: 'local'
};

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
  
  runtimeConfig.localApiUrl = localApiUrl;
  runtimeConfig.remoteApiUrl = remoteApiUrl;
  runtimeConfig.effectiveApiUrl = normalizeApiUrl(partial.effectiveApiUrl ?? (mode === 'remote' ? remoteApiUrl : localApiUrl)) ?? localApiUrl;
  runtimeConfig.mode = mode;
  return getRuntimePayload();
}

function getRuntimePayload() {
  return {
    localApiUrl: runtimeConfig.localApiUrl,
    remoteApiUrl: runtimeConfig.remoteApiUrl,
    effectiveApiUrl: runtimeConfig.effectiveApiUrl,
    mode: runtimeConfig.mode,
    platform: process.platform,
    arch: process.arch
  };
}

function resolveBackendCommand() {
  // Hardcoded to port 8000 to match your Python backend
  const port = 8000; 

  if (app.isPackaged) {
    const executable = path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'pce-backend.exe' : 'pce-backend');
    return {
      command: executable,
      args: [],
      cwd: path.dirname(executable),
      env: { ...process.env, API_PORT: String(port) }
    };
  }

  // Dev mode (if you ever run npm run dev again)
  const pythonPath = path.join(__dirname, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return {
    command: pythonPath,
    args: ['-m', 'app.desktop_entry'],
    cwd: __dirname,
    env: { ...process.env, API_PORT: String(port) }
  };
}

function startBackend() {
  const spec = resolveBackendCommand();
  
  console.log(`[Electron] Starting backend at: ${spec.command}`);

  backendProcess = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[backend] ${text}`);
  });

  backendProcess.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[backend] ${text}`);
  });

  backendProcess.once('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Backend exited with code: ${code}`);
    }
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function waitForBackend(timeoutMs = 300000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for backend at ${runtimeConfig.localApiUrl}`));
        return;
      }
      const request = http.get(`${runtimeConfig.localApiUrl}/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
        } else {
          setTimeout(attempt, 350);
        }
      });
      request.on('error', () => setTimeout(attempt, 350));
    };
    attempt();
  });
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('desktop:get-runtime-config', async () => getRuntimePayload());
  ipcMain.handle('desktop:get-runtime', async () => getRuntimePayload());
  ipcMain.handle('desktop:set-remote-api-url', async (_event, url) => syncRuntimeConfig({ remoteApiUrl: normalizeApiUrl(url) }));
  ipcMain.handle('desktop:open-experiment-folder', () => openFolderDialog('Open experiment folder'));
  ipcMain.handle('desktop:open-qwen-repo-folder', () => openFolderDialog('Select Qwen repo folder'));
  ipcMain.handle('desktop:open-weights-folder', () => openFolderDialog('Select Qwen weights folder'));
}

async function openFolderDialog(title) {
  const result = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] });
  return { folderPath: result.canceled ? null : result.filePaths[0] ?? null };
}

async function createMainWindow() {
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.max(900, Math.floor(workAreaWidth * 0.92)),
    height: Math.max(640, Math.floor(workAreaHeight * 0.92)),
    backgroundColor: '#0f172a',
    title: 'Probabilistic Colocalization Estimator',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  window.webContents.on('render-process-gone', () => { if (!shuttingDown) stopBackend(); });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(path.join(projectRoot, 'dist', 'index.html'));
  }
  return window;
}

async function bootstrap() {
  registerIpc();
  startBackend();
  await waitForBackend();
  await createMainWindow();
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error(error);
  dialog.showErrorBox('Startup Failed', String(error));
  app.quit();
});

app.on('before-quit', () => { shuttingDown = true; stopBackend(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('exit', stopBackend);
process.on('SIGINT', () => { shuttingDown = true; stopBackend(); process.exit(0); });
