const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

const projectRoot = __dirname;
const backendRoot = app.isPackaged 
  ? path.join(process.resourcesPath, 'backend') 
  : __dirname; // On GitHub root, the files are just in __dirname

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
  if (!normalizedBase) {
    return endpoint;
  }
  return `${normalizedBase}/${String(endpoint).replace(/^\/+/, '')}`;
}

function syncRuntimeConfig(partial = {}) {
  const localApiUrl = normalizeApiUrl(partial.localApiUrl ?? runtimeConfig.localApiUrl) ?? runtimeConfig.localApiUrl;
  const remoteApiUrl =
    partial.remoteApiUrl === undefined ? runtimeConfig.remoteApiUrl : normalizeApiUrl(partial.remoteApiUrl);
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
    platform: process.platform,
    arch: process.arch
  };
}

function validateRemoteUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported');
    }
  } catch {
    throw new Error('Remote API URL must be a valid http or https URL.');
  }
}

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

function resolveDevPython() {
  const candidate = path.join(
    backendRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  );
  if (!fs.existsSync(candidate)) {
    throw new Error(`Python runtime not found at ${candidate}`);
  }
  return candidate;
}

function resolveBackendCommand(port) {
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'pce-backend')
    : path.join(__dirname, 'pce-backend');

  console.log("Attempting to launch backend at:", executable);

  return {
    command: executable,
    args: [], // Your backend handles its own port 8000
    cwd: path.dirname(executable),
    env: { ...process.env, API_PORT: "8000" }
  };
}

  return {
    command: resolveDevPython(),
    args: ['-m', 'app.desktop_entry'],
    cwd: backendRoot,
    env: { ...process.env, API_PORT: String(port) }
  };

function startBackend(port) {
  const spec = resolveBackendCommand(port);
  
  // LOG THE EXACT COMMAND BEING RUN
  console.log(`Spawning backend: ${spec.command} in ${spec.cwd}`);

  backendProcess = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // CATCH SPAWN ERRORS (e.g., ENOENT or EACCES)
  backendProcess.on('error', (err) => {
    dialog.showErrorBox('Failed to Start Backend Process', 
      `Error: ${err.message}\nPath: ${spec.command}`);
  });

  backendProcess.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    // If there's a Python error, show it immediately!
    if (text.toLowerCase().includes('error') || text.toLowerCase().includes('traceback')) {
       dialog.showErrorBox('Backend Runtime Error', text);
    }
  });

  backendProcess.once('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      dialog.showErrorBox(
        'Backend exited unexpectedly',
        `The FastAPI backend stopped before the desktop app finished. Exit code: ${code ?? 'unknown'}`
      );
    }
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }
  backendProcess.kill();
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
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle('desktop:get-runtime-config', async () => getRuntimePayload());
  ipcMain.handle('desktop:get-runtime', async () => getRuntimePayload());
  ipcMain.handle('desktop:set-remote-api-url', async (_event, url) => {
    const normalized = normalizeApiUrl(url);
    if (normalized) {
      validateRemoteUrl(normalized);
    }
    return syncRuntimeConfig({ remoteApiUrl: normalized });
  });
  ipcMain.handle('desktop:upload-image-remote', async (_event, args) => uploadImageToRemote(args));
  ipcMain.handle('desktop:open-experiment-folder', () => openFolderDialog('Open experiment folder'));
  ipcMain.handle('desktop:open-qwen-repo-folder', () => openFolderDialog('Select Qwen repo folder'));
  ipcMain.handle('desktop:open-weights-folder', () => openFolderDialog('Select Qwen weights folder'));
}

async function openFolderDialog(title) {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory', 'createDirectory']
  });
  return {
    folderPath: result.canceled ? null : result.filePaths[0] ?? null
  };
}

async function uploadImageToRemote({ imagePath, remoteApiUrl }) {
  if (!imagePath) {
    throw new Error('No TIFF path was provided for remote upload.');
  }

  const targetRoot = normalizeApiUrl(remoteApiUrl ?? runtimeConfig.remoteApiUrl);
  if (!targetRoot) {
    throw new Error('Remote API URL is not configured.');
  }
  validateRemoteUrl(targetRoot);

  const stat = await fs.promises.stat(imagePath);
  if (!stat.isFile()) {
    throw new Error('Selected TIFF path is not a file.');
  }

  const safeFilename = path.basename(imagePath).replace(/[\r\n"]/g, '_');
  const boundary = `----PCEBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
      'Content-Type: image/tiff\r\n\r\n'
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
  const targetUrl = new URL(joinApiUrl(targetRoot, '/api/images'));
  const transport = targetUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || undefined,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': preamble.length + stat.size + epilogue.length
        }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          if (settled) {
            return;
          }
          settled = true;
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Remote upload returned an invalid JSON payload.'));
            }
            return;
          }
          reject(new Error(body || `Remote upload failed with ${response.statusCode}`));
        });
      }
    );

    request.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    request.write(preamble);

    const stream = fs.createReadStream(imagePath);
    stream.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      request.destroy(error);
      reject(error);
    });
    stream.on('end', () => {
      request.end(epilogue);
    });
    stream.pipe(request, { end: false });
  });
}

async function createMainWindow() {
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = Math.max(900, Math.min(1220, Math.floor(workAreaWidth * 0.74)));
  const minHeight = Math.max(640, Math.min(860, Math.floor(workAreaHeight * 0.74)));
  const width = Math.max(minWidth, Math.floor(workAreaWidth * 0.92));
  const height = Math.max(minHeight, Math.floor(workAreaHeight * 0.92));

  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    backgroundColor: '#0f172a',
    title: 'Probabilistic Colocalization Estimator',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  window.webContents.on('render-process-gone', () => {
    if (!shuttingDown) {
      stopBackend();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(path.join(projectRoot, 'dist', 'index.html'));
  }

  return window;
}

async function bootstrap() {
  const port = 8000;
  syncRuntimeConfig({
    localApiUrl: `http://127.0.0.1:8000`
  });
  registerIpc();
  startBackend(port);
  await waitForBackend();
  await createMainWindow();
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error(error);
  dialog.showErrorBox('Desktop startup failed', String(error));
  app.quit();
});

app.on('before-quit', () => {
  shuttingDown = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

process.on('exit', stopBackend);
process.on('SIGINT', () => {
  shuttingDown = true;
  stopBackend();
  process.exit(0);
});
