const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const cp = require('child_process');
const http = require('http');
const fs = require('fs');
const url = require('url');
require('dotenv').config();

const isDev = !app.isPackaged;
let pythonProcess = null;
let cloudflaredProcess = null;
let staticServer = null;
let mainWindow = null;
let whisperModel = process.env.WHISPER_MODEL || 'small';
let pythonStopRequested = false;

// Buffer logs until window is ready
const logBuffer = [];
let windowReady = false;

// Backend startup status tracking
let backendStatus = {
    phase: 'starting',    // starting | initializing | loading_whisper | loading_alignment | loading_diarization | ready | error
    message: 'Starting Python backend...',
    ready: false
};

function parseStartupPhase(message) {
    if (message.includes('Initializing Engine')) {
        return { phase: 'initializing', message: 'Initializing WhisperX engine...' };
    } else if (message.includes('Loading Whisper model')) {
        return { phase: 'loading_whisper', message: 'Loading Whisper model...' };
    } else if (message.includes('Whisper model loaded')) {
        return { phase: 'loading_alignment', message: 'Whisper loaded, loading alignment model...' };
    } else if (message.includes('Alignment model loaded')) {
        return { phase: 'loading_diarization', message: 'Loading diarization model...' };
    } else if (message.includes('Starting server on')) {
        return { phase: 'ready', message: 'Backend ready!', ready: true };
    } else if (message.includes('process exited') || message.includes('Failed to start')) {
        return { phase: 'error', message: 'Backend failed to start', ready: false };
    }
    return null;
}

function sendStatusToRenderer(status) {
    if (mainWindow && windowReady) {
        mainWindow.webContents.send('backend-status', status);
    }
}

function sendLogToRenderer(message, type = 'info') {
    const logEntry = { message, type };

    // Console log always
    if (type === 'error') console.error(message);
    else console.log(message);

    // Parse for status updates
    const statusUpdate = parseStartupPhase(message);
    if (statusUpdate) {
        backendStatus = { ...backendStatus, ...statusUpdate };
        sendStatusToRenderer(backendStatus);
    }

    if (mainWindow && windowReady) {
        // Send buffered logs first
        while (logBuffer.length > 0) {
            const buffered = logBuffer.shift();
            mainWindow.webContents.send('server-log', buffered);
        }
        // Send current log
        mainWindow.webContents.send('server-log', logEntry);
    } else {
        // Buffer until window is ready
        logBuffer.push(logEntry);
    }
}

function createPythonProcess() {
    let scriptPath;
    let pythonPath = 'python'; // Default to system python
    const fs = require('fs');

    sendLogToRenderer(`[Electron] App is packaged: ${app.isPackaged}`);
    sendLogToRenderer(`[Electron] Resource path: ${process.resourcesPath}`);

    if (app.isPackaged) {
        // In production, resources/python/align_server.py
        scriptPath = path.join(process.resourcesPath, 'python', 'align_server.py');
        sendLogToRenderer(`[Electron] Production mode - looking for script at: ${scriptPath}`);

        // Check if script exists
        if (!fs.existsSync(scriptPath)) {
            sendLogToRenderer(`[Electron] ERROR: Script not found at ${scriptPath}`, 'error');
            backendStatus = { phase: 'error', message: 'Python script not found', ready: false };
            sendStatusToRenderer(backendStatus);
            return;
        }
    } else {
        // In dev, python/align_server.py (relative to electron/main.js)
        scriptPath = path.join(__dirname, '../python/align_server.py');

        // Check for venv in local dev
        const venvPython = path.join(__dirname, '../venv/Scripts/python.exe');
        if (fs.existsSync(venvPython)) {
            pythonPath = venvPython;
            sendLogToRenderer(`[Electron] Using venv Python: ${pythonPath}`);
        }
    }

    sendLogToRenderer(`[Electron] Python executable: ${pythonPath}`);
    sendLogToRenderer(`[Electron] Script path: ${scriptPath}`);
    sendLogToRenderer(`[Electron] Working directory: ${path.dirname(scriptPath)}`);
    sendLogToRenderer(`[Electron] Whisper model: ${whisperModel}`);

    // We set cwd to the script's directory so it can find requirements.txt, etc. if needed.
    pythonProcess = cp.spawn(pythonPath, [scriptPath], {
        cwd: path.dirname(scriptPath),
        stdio: ['ignore', 'pipe', 'pipe'], // Pipe stdout/stderr
        shell: true, // Use shell to ensure PATH is available
        env: { ...process.env, WHISPER_MODEL: whisperModel }
    });

    sendLogToRenderer(`[Electron] Python process spawned with PID: ${pythonProcess.pid}`);

    pythonProcess.stdout.on('data', data => sendLogToRenderer(data.toString()));
    pythonProcess.stderr.on('data', data => sendLogToRenderer(data.toString(), 'error'));

    pythonProcess.on('error', (err) => {
        sendLogToRenderer(`[Electron] Failed to start python process: ${err.message}`, 'error');
        backendStatus = { phase: 'error', message: `Failed to start: ${err.message}`, ready: false };
        sendStatusToRenderer(backendStatus);
    });

    pythonProcess.on('exit', (code, signal) => {
        if (pythonStopRequested) {
            sendLogToRenderer(`[Electron] Python process stopped with code ${code} and signal ${signal}`);
            pythonStopRequested = false;
            return;
        }
        sendLogToRenderer(`[Electron] Python process exited with code ${code} and signal ${signal}`, 'error');
        if (code !== 0) {
            backendStatus = { phase: 'error', message: `Exited with code ${code}`, ready: false };
            sendStatusToRenderer(backendStatus);
        }
    });
}

function stopPythonProcess() {
    if (!pythonProcess) return;

    sendLogToRenderer('[Electron] Stopping Python backend...');
    pythonStopRequested = true;
    if (process.platform === 'win32') {
        cp.exec(`taskkill /pid ${pythonProcess.pid} /T /F`, (err) => {
            if (err) sendLogToRenderer(`[Electron] Python kill error: ${err.message}`, 'error');
        });
    } else {
        pythonProcess.kill();
    }
    pythonProcess = null;
}

function restartPythonProcess() {
    stopPythonProcess();
    backendStatus = {
        phase: 'starting',
        message: 'Restarting Python backend...',
        ready: false
    };
    sendStatusToRenderer(backendStatus);
    setTimeout(() => createPythonProcess(), 1000);
}

function toggleCloudflared(enable) {
    if (enable) {
        if (cloudflaredProcess) {
            sendLogToRenderer('[Cloudflared] Tunnel already running');
            return;
        }

        sendLogToRenderer('[Cloudflared] Starting tunnel "podfluent"...');

        // Assumes cloudflared is in system PATH
        try {
            cloudflaredProcess = cp.spawn('cloudflared', ['tunnel', 'run', 'podfluent'], {
                shell: true, // Needed for PATH resolution on Windows usually
                stdio: ['ignore', 'pipe', 'pipe']
            });

            sendLogToRenderer(`[Cloudflared] Process spawned with PID: ${cloudflaredProcess.pid}`);

            cloudflaredProcess.stdout.on('data', data => sendLogToRenderer(`[Cloudflared] ${data.toString().trim()}`));
            cloudflaredProcess.stderr.on('data', data => sendLogToRenderer(`[Cloudflared] ${data.toString().trim()}`)); // stderr often used for logs

            cloudflaredProcess.on('error', (err) => {
                sendLogToRenderer(`[Cloudflared] Failed to start: ${err.message}`, 'error');
            });

            cloudflaredProcess.on('exit', (code) => {
                sendLogToRenderer(`[Cloudflared] Process exited with code ${code}`);
                cloudflaredProcess = null;
            });
        } catch (e) {
            sendLogToRenderer(`[Cloudflared] Exception: ${e.message}`, 'error');
        }

    } else {
        if (cloudflaredProcess) {
            sendLogToRenderer('[Cloudflared] Stopping tunnel...');
            // On Windows with shell:true, we usually need taskkill to really kill the tree
            if (process.platform === 'win32') {
                cp.exec(`taskkill /pid ${cloudflaredProcess.pid} /T /F`, (err) => {
                    if (err) sendLogToRenderer(`[Cloudflared] Kill error: ${err.message}`, 'error');
                });
            } else {
                cloudflaredProcess.kill();
            }
            cloudflaredProcess = null;
        }
    }
}

// Static file server for remote access (production only)
function startStaticServer() {
    const PORT = 5173;
    // In packaged app, files are inside app.asar
    const distPath = path.join(app.getAppPath(), 'dist');

    sendLogToRenderer(`[HTTP Server] Dist path: ${distPath}`);

    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav'
    };

    staticServer = http.createServer((req, res) => {
        let parsedUrl = url.parse(req.url);
        let pathname = parsedUrl.pathname;

        // Default to index.html for SPA routing
        if (pathname === '/' || !path.extname(pathname)) {
            pathname = '/index.html';
        }

        const filePath = path.join(distPath, pathname);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, data) => {
            if (err) {
                // For SPA, serve index.html for 404s (client-side routing)
                if (err.code === 'ENOENT') {
                    fs.readFile(path.join(distPath, 'index.html'), (err2, data2) => {
                        if (err2) {
                            res.writeHead(404);
                            res.end('Not Found');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(data2);
                        }
                    });
                } else {
                    res.writeHead(500);
                    res.end('Server Error');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    });

    staticServer.listen(PORT, '0.0.0.0', () => {
        sendLogToRenderer(`[HTTP Server] Static file server running on http://localhost:${PORT}`);
    });

    staticServer.on('error', (err) => {
        sendLogToRenderer(`[HTTP Server] Error: ${err.message}`, 'error');
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For simplicity in this local tool; consider toggling for security in prod
            webSecurity: false // Allow loading local resources if needed
        },
        autoHideMenuBar: true,
        titleBarStyle: 'hidden', // Custom title bar style if we wanted
        titleBarOverlay: {
            color: '#0f172a',
            symbolColor: '#ffffff'
        }
    });

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // Open DevTools in dev mode
        // mainWindow.webContents.openDevTools();
        console.log('Running in development mode');
    } else {
        // In production, load the index.html from the build folder
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Mark window as ready and flush buffered logs
    mainWindow.webContents.on('did-finish-load', () => {
        windowReady = true;
        sendLogToRenderer('[Electron] Window loaded, flushing buffered logs...');
    });

    // Handle external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        windowReady = false;
    });
}

// App Readiness
app.whenReady().then(() => {
    ipcMain.on('toggle-remote-access', (event, enabled) => {
        toggleCloudflared(enabled);
    });

    ipcMain.on('set-whisper-model', (event, model) => {
        const allowedModels = new Set(['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3']);
        if (!allowedModels.has(model)) {
            sendLogToRenderer(`[Electron] Ignoring invalid Whisper model: ${model}`, 'error');
            return;
        }
        if (model === whisperModel) return;

        whisperModel = model;
        sendLogToRenderer(`[Electron] Applying Whisper model change: ${model}`);
        restartPythonProcess();
    });

    createPythonProcess();
    createWindow();

    // Start static file server in production for remote access
    if (!isDev) {
        startStaticServer();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    stopPythonProcess();
    if (cloudflaredProcess) {
        console.log('[Electron] Killing Cloudflared process...');
        if (process.platform === 'win32') {
            try { cp.execSync(`taskkill /pid ${cloudflaredProcess.pid} /T /F`); } catch (e) { }
        } else {
            cloudflaredProcess.kill();
        }
        cloudflaredProcess = null;
    }
});
