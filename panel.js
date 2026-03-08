#!/usr/bin/env node
require('dotenv/config');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PANEL_PORT = 3001;
const PROJECT_DIR = __dirname;
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const GITHUB_URL = process.env.GITHUB_HELP_URL || '';
const MAX_LOG_LINES = 500;
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// --- Config ---
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// --- LINE webhook API ---
function lineApiRequest(method, apiPath, data) {
  return new Promise((resolve, reject) => {
    const body = data ? Buffer.from(JSON.stringify(data)) : null;
    addLog('tunnel', `LINE API ${method} ${apiPath} body=${body ? body.toString().slice(0,100) : ''}`);
    const req = https.request({
      hostname: 'api.line.me',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => out += c);
      res.on('end', () => {
        addLog('tunnel', `LINE API response: ${res.statusCode} ${out.slice(0,200)}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(out)); } catch { resolve(out); }
        } else reject(new Error(`LINE API ${res.statusCode}: ${out}`));
      });
    });
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function updateAndVerifyWebhook(webhookUrl) {
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    const wait = (i + 1) * 5;
    addLog('tunnel', `LINE: attempt ${i + 1}/${maxRetries}, waiting ${wait}s for tunnel...`);
    await new Promise(r => setTimeout(r, wait * 1000));
    try {
      await lineApiRequest('PUT', '/v2/bot/channel/webhook/endpoint', { endpoint: webhookUrl });
      const info = await lineApiRequest('GET', '/v2/bot/channel/webhook/endpoint');
      if (info.endpoint === webhookUrl && info.active) {
        return { ok: true, endpoint: info.endpoint };
      }
      return { ok: false, endpoint: info.endpoint, active: info.active };
    } catch (err) {
      addLog('tunnel', `LINE: attempt ${i + 1} failed: ${err.message}`);
      if (i === maxRetries - 1) throw err;
    }
  }
}

// --- State ---
const state = {
  server: { proc: null, status: 'stopped', port: 3000, logs: [], errors: [] },
  tunnel: { proc: null, status: 'stopped', url: '', logs: [], errors: [] },
  lineWebhook: { endpoint: '', active: false, verified: false },
};

function addLog(svc, line) {
  state[svc].logs.push({ time: new Date().toISOString(), msg: line });
  if (state[svc].logs.length > MAX_LOG_LINES) state[svc].logs.shift();
}
function addError(svc, line) {
  state[svc].errors.push({ time: new Date().toISOString(), msg: line });
  if (state[svc].errors.length > MAX_LOG_LINES) state[svc].errors.shift();
}

// --- Server control ---
function startServer(port) {
  if (state.server.proc) return { ok: false, msg: 'Server already running' };
  state.server.port = port || state.server.port;
  state.server.logs = [];
  state.server.errors = [];

  const env = { ...process.env, PORT: String(state.server.port) };
  const proc = spawn('node', [path.join(PROJECT_DIR, 'dist/server.js')], {
    cwd: PROJECT_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
  });

  state.server.proc = proc;
  state.server.status = 'starting';

  proc.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) addLog('server', line);
    if (line.includes('SaveBot running')) state.server.status = 'running';
  });
  proc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) { addError('server', line); addLog('server', `[ERR] ${line}`); }
  });
  proc.on('close', (code) => {
    state.server.status = 'stopped';
    state.server.proc = null;
    addLog('server', `Process exited with code ${code}`);
  });

  return { ok: true, msg: `Server starting on port ${state.server.port}` };
}

function stopServer() {
  if (!state.server.proc) return { ok: false, msg: 'Server not running' };
  state.server.proc.kill();
  state.server.status = 'stopping';
  return { ok: true, msg: 'Server stopping' };
}

// --- Tunnel control ---
function startTunnel() {
  if (state.tunnel.proc) return { ok: false, msg: 'Tunnel already running' };
  if (state.server.status !== 'running') return { ok: false, msg: 'Start server first' };
  state.tunnel.logs = [];
  state.tunnel.errors = [];
  state.tunnel.url = '';

  const proc = spawn('cloudflared', [
    'tunnel', '--url', `http://localhost:${state.server.port}`,
  ], { cwd: PROJECT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });

  state.tunnel.proc = proc;
  state.tunnel.status = 'starting';

  let tunnelBuffer = '';
  const processLine = (line) => {
    line = line.trim();
    if (!line) return;
    addLog('tunnel', line);
    const urlMatch = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (urlMatch && state.tunnel.url !== urlMatch[0]) {
      state.tunnel.url = urlMatch[0];
      state.tunnel.status = 'running';
      const webhookUrl = state.tunnel.url + '/webhook';
      addLog('tunnel', `Webhook URL: ${webhookUrl}`);
      if (LINE_ACCESS_TOKEN) {
        updateAndVerifyWebhook(webhookUrl)
          .then((r) => {
            state.lineWebhook = { endpoint: r.endpoint, active: true, verified: r.ok };
            if (r.ok) {
              addLog('tunnel', `LINE webhook verified: ${r.endpoint}`);
            } else {
              addError('tunnel', `LINE webhook mismatch! expected: ${webhookUrl}, got: ${r.endpoint}, active: ${r.active}`);
            }
          })
          .catch((err) => addError('tunnel', `LINE webhook update failed: ${err.message}`));
      }
    }
    if ((line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) && !line.includes('WRN')) {
      addError('tunnel', line);
    }
  };

  const handleOutput = (d) => {
    tunnelBuffer += d.toString();
    const lines = tunnelBuffer.split('\n');
    tunnelBuffer = lines.pop();
    lines.forEach(processLine);
  };
  // Also flush partial lines after a delay
  const flushTimer = setInterval(() => {
    if (tunnelBuffer.trim()) { processLine(tunnelBuffer); tunnelBuffer = ''; }
  }, 1000);

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);
  proc.on('close', (code) => {
    clearInterval(flushTimer);
    if (tunnelBuffer.trim()) processLine(tunnelBuffer);
    state.tunnel.status = 'stopped';
    state.tunnel.proc = null;
    state.tunnel.url = '';
    state.lineWebhook = { endpoint: '', active: false, verified: false };
    addLog('tunnel', `Process exited with code ${code}`);
  });

  return { ok: true, msg: 'Tunnel starting' };
}

function stopTunnel() {
  if (!state.tunnel.proc) return { ok: false, msg: 'Tunnel not running' };
  state.tunnel.proc.kill();
  state.tunnel.status = 'stopping';
  return { ok: true, msg: 'Tunnel stopping' };
}

// --- API ---
function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PANEL_PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/api/status') {
    return res.end(JSON.stringify({
      server: { status: state.server.status, port: state.server.port },
      tunnel: { status: state.tunnel.status, url: state.tunnel.url,
        webhookUrl: state.tunnel.url ? state.tunnel.url + '/webhook' : '' },
      lineWebhook: state.lineWebhook,
      github: GITHUB_URL,
    }));
  }

  if (url.pathname === '/api/logs') {
    const svc = url.searchParams.get('svc') || 'server';
    const s = state[svc];
    if (!s) return res.end(JSON.stringify({ logs: [], errors: [] }));
    return res.end(JSON.stringify({ logs: s.logs, errors: s.errors }));
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    return res.end(JSON.stringify(loadConfig()));
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      let params = {};
      try { params = body ? JSON.parse(body) : {}; } catch {}

      let result;
      switch (url.pathname) {
        case '/api/server/start': result = startServer(params.port); break;
        case '/api/server/stop':  result = stopServer(); break;
        case '/api/tunnel/start': result = startTunnel(); break;
        case '/api/tunnel/stop':  result = stopTunnel(); break;
        case '/api/config':
          try {
            saveConfig(params);
            result = { ok: true, msg: 'Config saved' };
          } catch (e) {
            result = { ok: false, msg: e.message };
          }
          break;
        default: res.statusCode = 404; result = { ok: false, msg: 'Not found' };
      }
      res.end(JSON.stringify(result));
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, msg: 'Not found' }));
}

// --- HTML ---
const HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LineClip Control Panel</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  .header { background: #1e293b; padding: 16px 24px; display: flex;
            justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
  .header h1 { font-size: 20px; color: #38bdf8; }
  .header-links { display: flex; gap: 16px; }
  .header a { color: #94a3b8; text-decoration: none; font-size: 14px; cursor: pointer; }
  .header a:hover { color: #38bdf8; }
  .header a.active { color: #38bdf8; }
  .container { max-width: 1000px; margin: 0 auto; padding: 24px; }
  .card { background: #1e293b; border-radius: 8px; padding: 20px;
          margin-bottom: 16px; border: 1px solid #334155; }
  .card-title { font-size: 14px; color: #94a3b8; text-transform: uppercase;
                letter-spacing: 1px; margin-bottom: 12px; }
  .status-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.running { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
  .dot.stopped { background: #ef4444; }
  .dot.starting, .dot.stopping { background: #eab308; animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: 0.5; } }
  .status-text { font-size: 14px; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;
         font-size: 13px; font-weight: 500; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-green { background: #22c55e; color: #000; }
  .btn-red { background: #ef4444; color: #fff; }
  .btn-blue { background: #38bdf8; color: #000; }
  .controls { display: flex; gap: 8px; align-items: center; }
  .port-input { background: #0f172a; border: 1px solid #475569; border-radius: 6px;
                padding: 8px 12px; color: #e2e8f0; width: 80px; font-size: 13px; }
  .port-input:focus { outline: none; border-color: #38bdf8; }
  .url-box { background: #0f172a; border: 1px solid #334155; border-radius: 6px;
             padding: 10px 14px; font-family: monospace; font-size: 13px;
             color: #38bdf8; word-break: break-all; margin-top: 8px; }
  .url-box.empty { color: #475569; }
  .tabs { display: flex; gap: 0; margin-bottom: 0; }
  .tab { padding: 8px 16px; cursor: pointer; font-size: 13px; color: #94a3b8;
         border-bottom: 2px solid transparent; }
  .tab.active { color: #38bdf8; border-bottom-color: #38bdf8; }
  .tab:hover { color: #e2e8f0; }
  .log-box { background: #0a0e1a; border: 1px solid #334155; border-radius: 0 0 6px 6px;
             padding: 12px; height: 300px; overflow-y: auto; font-family: 'Fira Code', monospace;
             font-size: 12px; line-height: 1.6; }
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-line .time { color: #475569; }
  .log-line.error { color: #f87171; }
  .filter-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
  .filter-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid #334155;
                background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; }
  .filter-btn.active { border-color: #38bdf8; color: #38bdf8; }
  .copy-btn { background: none; border: 1px solid #475569; border-radius: 4px;
              color: #94a3b8; cursor: pointer; padding: 2px 8px; font-size: 11px; margin-left: 8px; }
  .copy-btn:hover { color: #38bdf8; border-color: #38bdf8; }
  /* Settings */
  .setting-group { margin-bottom: 20px; }
  .setting-label { font-size: 13px; color: #94a3b8; margin-bottom: 6px; display: flex;
                   align-items: center; gap: 8px; }
  .setting-label .hint { font-size: 11px; color: #475569; }
  .toggle { position: relative; width: 44px; height: 24px; cursor: pointer; }
  .toggle input { display: none; }
  .toggle .slider { position: absolute; inset: 0; background: #475569; border-radius: 12px; transition: .2s; }
  .toggle .slider:before { content: ''; position: absolute; width: 18px; height: 18px;
    left: 3px; top: 3px; background: #e2e8f0; border-radius: 50%; transition: .2s; }
  .toggle input:checked + .slider { background: #22c55e; }
  .toggle input:checked + .slider:before { transform: translateX(20px); }
  .tag-container { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
         background: #0f172a; border: 1px solid #334155; border-radius: 4px;
         font-size: 12px; color: #e2e8f0; }
  .tag .remove { cursor: pointer; color: #ef4444; font-size: 14px; line-height: 1; }
  .tag .remove:hover { color: #f87171; }
  .tag-input-row { display: flex; gap: 6px; }
  .tag-input { background: #0f172a; border: 1px solid #475569; border-radius: 6px;
               padding: 6px 10px; color: #e2e8f0; font-size: 12px; flex: 1; }
  .tag-input:focus { outline: none; border-color: #38bdf8; }
  .prompt-textarea { background: #0a0e1a; border: 1px solid #334155; border-radius: 6px;
                     padding: 12px; color: #e2e8f0; font-family: 'Fira Code', monospace;
                     font-size: 12px; line-height: 1.6; width: 100%; min-height: 200px;
                     resize: vertical; }
  .prompt-textarea:focus { outline: none; border-color: #38bdf8; }
  .prompt-vars { font-size: 11px; color: #475569; margin-top: 4px; }
  .save-bar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
              padding-top: 16px; border-top: 1px solid #334155; }
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 10px 20px;
           border-radius: 6px; font-size: 13px; opacity: 0; transition: opacity 0.3s;
           pointer-events: none; z-index: 100; }
  .toast.show { opacity: 1; }
  .toast.ok { background: #22c55e; color: #000; }
  .toast.err { background: #ef4444; color: #fff; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="header">
  <h1>LineClip Control Panel</h1>
  <div class="header-links">
    <a class="active" onclick="showPage('dashboard')">Dashboard</a>
    <a onclick="showPage('settings')">Settings</a>
    <a href="#" id="helpLink" target="_blank">Help</a>
  </div>
</div>

<!-- Dashboard -->
<div class="container" id="pageDashboard">
  <div class="card">
    <div class="card-title">Server (Fastify)</div>
    <div class="status-row">
      <span class="dot" id="serverDot"></span>
      <span class="status-text" id="serverStatus">--</span>
    </div>
    <div class="controls">
      <label style="font-size:13px;color:#94a3b8;">Port:</label>
      <input type="number" class="port-input" id="portInput" value="3000" min="1024" max="65535">
      <button class="btn btn-green" id="serverStartBtn" onclick="apiPost('/api/server/start',{port:+document.getElementById('portInput').value})">Start</button>
      <button class="btn btn-red" id="serverStopBtn" onclick="apiPost('/api/server/stop')">Stop</button>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Cloudflare Tunnel</div>
    <div class="status-row">
      <span class="dot" id="tunnelDot"></span>
      <span class="status-text" id="tunnelStatus">--</span>
    </div>
    <div class="controls">
      <button class="btn btn-green" id="tunnelStartBtn" onclick="apiPost('/api/tunnel/start')">Start</button>
      <button class="btn btn-red" id="tunnelStopBtn" onclick="apiPost('/api/tunnel/stop')">Stop</button>
    </div>
    <div class="url-box empty" id="webhookUrl">Tunnel not started</div>
    <div class="status-row" style="margin-top:10px;">
      <span class="dot stopped" id="lineDot"></span>
      <span class="status-text" id="lineStatus">LINE webhook: not set</span>
    </div>
  </div>
  <div class="card" style="padding-bottom:0;">
    <div class="card-title">Logs</div>
    <div class="filter-row">
      <div class="tabs">
        <div class="tab active" data-svc="server" onclick="switchTab(this)">Server</div>
        <div class="tab" data-svc="tunnel" onclick="switchTab(this)">Tunnel</div>
      </div>
      <button class="filter-btn active" id="filterAll" onclick="setFilter('all')">All</button>
      <button class="filter-btn" id="filterErrors" onclick="setFilter('errors')">Errors Only</button>
      <button class="filter-btn" onclick="clearLogs()">Clear</button>
    </div>
    <div class="log-box" id="logBox"></div>
  </div>
</div>

<!-- Settings -->
<div class="container hidden" id="pageSettings">
  <div class="card">
    <div class="card-title">AI Settings</div>

    <div class="setting-group">
      <div class="setting-label">
        Summary
        <label class="toggle"><input type="checkbox" id="cfgSummary"><span class="slider"></span></label>
        <span class="hint">( off = only tags + category )</span>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label">Categories <span class="hint">( AI must pick one )</span></div>
      <div class="tag-container" id="cfgCategories"></div>
      <div class="tag-input-row">
        <input class="tag-input" id="catInput" placeholder="Add category...">
        <button class="btn btn-blue" onclick="addItem('categories')">Add</button>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label">Predefined Tags <span class="hint">( AI picks from these first )</span></div>
      <div class="tag-container" id="cfgTags"></div>
      <div class="tag-input-row">
        <input class="tag-input" id="tagInput" placeholder="Add tag...">
        <button class="btn btn-blue" onclick="addItem('tags')">Add</button>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label">Prompt Template</div>
      <textarea class="prompt-textarea" id="cfgPrompt"></textarea>
      <div class="prompt-vars">Variables: {{categories}} {{tags}} {{summaryRule}} {{jsonFormat}} {{title}} {{content}}</div>
    </div>

    <div class="save-bar">
      <button class="btn btn-red" onclick="loadSettings()">Reset</button>
      <button class="btn btn-green" onclick="saveSettings()">Save</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let currentSvc = 'server';
let currentFilter = 'all';
let autoScroll = true;
let cfg = null;

function showPage(p) {
  document.getElementById('pageDashboard').classList.toggle('hidden', p !== 'dashboard');
  document.getElementById('pageSettings').classList.toggle('hidden', p !== 'settings');
  document.querySelectorAll('.header-links a').forEach(a => a.classList.remove('active'));
  event.target.classList.add('active');
  if (p === 'settings' && !cfg) loadSettings();
}

function toast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (ok ? 'ok' : 'err');
  setTimeout(() => t.className = 'toast', 2000);
}

// --- Dashboard ---
async function apiPost(path, body) {
  try {
    const r = await fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (d.msg) toast(d.msg, d.ok);
  } catch(e) { console.error(e); }
  setTimeout(poll, 300);
}

function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentSvc = el.dataset.svc;
  renderLogs();
}
function setFilter(f) {
  currentFilter = f;
  document.getElementById('filterAll').classList.toggle('active', f === 'all');
  document.getElementById('filterErrors').classList.toggle('active', f === 'errors');
  renderLogs();
}
function clearLogs() { document.getElementById('logBox').innerHTML = ''; }

let cachedLogs = { server: { logs: [], errors: [] }, tunnel: { logs: [], errors: [] } };

function renderLogs() {
  const box = document.getElementById('logBox');
  const data = cachedLogs[currentSvc] || { logs: [], errors: [] };
  const lines = currentFilter === 'errors' ? data.errors : data.logs;
  box.innerHTML = lines.map(l => {
    const isErr = l.msg.includes('[ERR]') || currentFilter === 'errors';
    const t = l.time.slice(11, 19);
    return '<div class="log-line' + (isErr ? ' error' : '') + '"><span class="time">' + t + '</span> ' + escHtml(l.msg) + '</div>';
  }).join('');
  if (autoScroll) box.scrollTop = box.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function poll() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    document.getElementById('serverDot').className = 'dot ' + d.server.status;
    document.getElementById('serverStatus').textContent = d.server.status + ' (port ' + d.server.port + ')';
    document.getElementById('serverStartBtn').disabled = d.server.status !== 'stopped';
    document.getElementById('serverStopBtn').disabled = d.server.status === 'stopped';
    document.getElementById('portInput').disabled = d.server.status !== 'stopped';
    document.getElementById('tunnelDot').className = 'dot ' + d.tunnel.status;
    document.getElementById('tunnelStatus').textContent = d.tunnel.status;
    document.getElementById('tunnelStartBtn').disabled = d.tunnel.status !== 'stopped';
    document.getElementById('tunnelStopBtn').disabled = d.tunnel.status === 'stopped';
    const urlBox = document.getElementById('webhookUrl');
    if (d.tunnel.webhookUrl) {
      urlBox.className = 'url-box';
      urlBox.innerHTML = 'Webhook: ' + escHtml(d.tunnel.webhookUrl)
        + '<button class="copy-btn" onclick="navigator.clipboard.writeText(this.dataset.url);toast(\\'Copied!\\',true)" data-url="'+escHtml(d.tunnel.webhookUrl)+'">Copy</button>';
    } else {
      urlBox.className = 'url-box empty';
      urlBox.textContent = 'Tunnel not started';
    }
    // LINE webhook status
    const lw = d.lineWebhook;
    const lineDot = document.getElementById('lineDot');
    const lineStatus = document.getElementById('lineStatus');
    if (lw.verified) {
      lineDot.className = 'dot running';
      lineStatus.textContent = 'LINE webhook: verified';
    } else if (lw.endpoint) {
      lineDot.className = 'dot starting';
      lineStatus.textContent = 'LINE webhook: mismatch (' + lw.endpoint + ')';
    } else {
      lineDot.className = 'dot stopped';
      lineStatus.textContent = 'LINE webhook: not set';
    }
    if (d.github) document.getElementById('helpLink').href = d.github;
    const lr1 = await fetch('/api/logs?svc=server');
    cachedLogs.server = await lr1.json();
    const lr2 = await fetch('/api/logs?svc=tunnel');
    cachedLogs.tunnel = await lr2.json();
    renderLogs();
  } catch(e) { console.error(e); }
}

const logBox = document.getElementById('logBox');
logBox.addEventListener('scroll', () => {
  autoScroll = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 30;
});

// --- Settings ---
async function loadSettings() {
  try {
    const r = await fetch('/api/config');
    cfg = await r.json();
    document.getElementById('cfgSummary').checked = cfg.ai.enableSummary;
    document.getElementById('cfgPrompt').value = cfg.ai.prompt;
    renderTags('cfgCategories', cfg.ai.categories, 'categories');
    renderTags('cfgTags', cfg.ai.predefinedTags, 'tags');
  } catch(e) { toast('Failed to load config', false); }
}

function renderTags(containerId, items, type) {
  const c = document.getElementById(containerId);
  c.innerHTML = items.map((t, i) =>
    '<span class="tag">' + escHtml(t) + '<span class="remove" onclick="removeItem(\\'' + type + '\\',' + i + ')">&times;</span></span>'
  ).join('');
}

function removeItem(type, idx) {
  if (type === 'categories') cfg.ai.categories.splice(idx, 1);
  else cfg.ai.predefinedTags.splice(idx, 1);
  renderTags(type === 'categories' ? 'cfgCategories' : 'cfgTags',
    type === 'categories' ? cfg.ai.categories : cfg.ai.predefinedTags, type);
}

function addItem(type) {
  const inputId = type === 'categories' ? 'catInput' : 'tagInput';
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val) return;
  if (type === 'categories') cfg.ai.categories.push(val);
  else cfg.ai.predefinedTags.push(val);
  input.value = '';
  renderTags(type === 'categories' ? 'cfgCategories' : 'cfgTags',
    type === 'categories' ? cfg.ai.categories : cfg.ai.predefinedTags, type);
}

// Enter key to add
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'catInput') addItem('categories');
  if (e.key === 'Enter' && e.target.id === 'tagInput') addItem('tags');
});

async function saveSettings() {
  cfg.ai.enableSummary = document.getElementById('cfgSummary').checked;
  cfg.ai.prompt = document.getElementById('cfgPrompt').value;
  try {
    const r = await fetch('/api/config', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg) });
    const d = await r.json();
    toast(d.msg, d.ok);
  } catch(e) { toast('Save failed', false); }
}

poll();
setInterval(poll, 2000);
</script>
</body>
</html>`;

// --- HTTP Server ---
const httpServer = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(HTML);
});

httpServer.listen(PANEL_PORT, () => {
  console.log(`Control Panel: http://localhost:${PANEL_PORT}`);
});

process.on('SIGINT', () => {
  if (state.server.proc) state.server.proc.kill();
  if (state.tunnel.proc) state.tunnel.proc.kill();
  process.exit();
});
process.on('SIGTERM', () => {
  if (state.server.proc) state.server.proc.kill();
  if (state.tunnel.proc) state.tunnel.proc.kill();
  process.exit();
});
