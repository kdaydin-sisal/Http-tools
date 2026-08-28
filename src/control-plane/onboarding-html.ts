export interface OnboardingContext {
  proxyPort: number;
  certPath: string;
}

export const renderOnboardingHtml = (context: OnboardingContext) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HTTP Tools – Device Setup</title>
    <style>
      :root {
        --bg: #0f172a; --panel: #111827; --panel-soft: #0b1220; --border: #334155;
        --text: #e2e8f0; --muted: #94a3b8; --accent: #3b82f6; --accent-hover: #2563eb;
        --success: #22c55e; --warn: #f59e0b; --danger: #ef4444; --tag-android: #22c55e;
        --tag-ios: #60a5fa; --radius: 10px;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, Arial, sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }
      a { color: #93c5fd; text-decoration: none; }
      a:hover { text-decoration: underline; }

      .page { padding: 16px; max-width: 1100px; margin: 0 auto; }
      .topbar { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px; margin-bottom: 16px; gap: 12px; }
      .topbar-title { font-size: 18px; font-weight: 700; }
      .topbar-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
      .topbar-links { display: flex; gap: 16px; flex-shrink: 0; }
      .topbar-links a { color: var(--muted); font-size: 13px; }
      .topbar-links a:hover { color: var(--text); }

      .section { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; margin-bottom: 16px; }
      .section-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
      .section-actions { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }

      .btn { display: inline-flex; align-items: center; gap: 6px; border: none; border-radius: 6px; padding: 7px 14px;
             font-size: 13px; font-weight: 500; cursor: pointer; transition: opacity 0.15s; }
      .btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .btn-primary { background: var(--accent); color: #fff; }
      .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
      .btn-danger { background: #7f1d1d; color: #fca5a5; }
      .btn-danger:hover:not(:disabled) { background: #991b1b; }
      .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
      .btn-ghost:hover:not(:disabled) { color: var(--text); border-color: #64748b; }

      .device-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
      .device-card { background: var(--panel-soft); border: 1px solid var(--border); border-radius: 8px;
                     padding: 14px 16px; display: flex; align-items: flex-start; gap: 14px; }
      .device-card.listening { border-color: var(--accent); }
      .device-platform-icon { font-size: 22px; line-height: 1; flex-shrink: 0; padding-top: 2px; }
      .device-info { flex: 1; min-width: 0; }
      .device-name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .device-id { color: var(--muted); font-size: 11px; font-family: Menlo, monospace; }
      .device-meta { color: var(--muted); font-size: 12px; margin-top: 3px; display: flex; gap: 10px; flex-wrap: wrap; }
      .device-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }

      .badge { display: inline-block; border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 600; }
      .badge-android { background: #14532d; color: var(--tag-android); }
      .badge-ios { background: #1e3a5f; color: var(--tag-ios); }
      .badge-listening { background: #1e3a5f; color: #93c5fd; }
      .badge-offline { background: #3f1515; color: #fca5a5; }
      .badge-booted { background: #14532d; color: var(--tag-android); }
      .badge-shutdown { background: #1f2937; color: var(--muted); }
      .badge-unauthorized { background: #451a03; color: var(--warn); }

      .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .status-dot.on { background: var(--success); box-shadow: 0 0 5px var(--success); animation: pulse 2s infinite; }
      .status-dot.off { background: #374151; }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

      .msg-box { border-radius: 7px; padding: 10px 14px; font-size: 13px; line-height: 1.5; margin-top: 8px; }
      .msg-box.info { background: #1e3a5f; border: 1px solid #2563eb; color: #93c5fd; }
      .msg-box.success { background: #14532d; border: 1px solid #15803d; color: #86efac; }
      .msg-box.error { background: #3f1515; border: 1px solid #b91c1c; color: #fca5a5; }
      .msg-box.warn { background: #451a03; border: 1px solid #b45309; color: #fde68a; }

      .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2);
                 border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .empty-state { text-align: center; padding: 40px 20px; color: var(--muted); }
      .empty-state .icon { font-size: 40px; margin-bottom: 10px; }
      .empty-state p { margin: 4px 0; }

      .proxy-info { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 4px; }
      .proxy-info-item label { color: var(--muted); font-size: 11px; display: block; margin-bottom: 2px; }
      .proxy-info-item code { font-family: Menlo, monospace; font-size: 12px; background: #1e293b; padding: 2px 6px; border-radius: 4px; }

      .cert-info { font-size: 12px; color: var(--muted); margin-top: 8px; font-family: Menlo, monospace; word-break: break-all; }
      .filter-bar { display: flex; gap: 8px; align-items: center; }
      .filter-bar select { background: var(--panel-soft); color: var(--text); border: 1px solid var(--border);
                           border-radius: 6px; padding: 5px 9px; font-size: 13px; }

      @media (max-width: 700px) {
        .topbar { flex-direction: column; align-items: flex-start; }
        .device-card { flex-direction: column; }
        .device-actions { flex-direction: row; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="topbar">
        <div>
          <div class="topbar-title">📡 Device Setup</div>
          <div class="topbar-sub">Discover and activate listening on Android emulators, iOS simulators, and connected devices.</div>
        </div>
        <div class="topbar-links">
          <a href="/">Dashboard</a>
          <a href="/rules-editor">Rules</a>
          <a href="/diagnostics/unsupported-traffic">Diagnostics</a>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          Proxy &amp; Certificate
        </div>
        <div class="proxy-info">
          <div class="proxy-info-item">
            <label>Proxy Port</label>
            <code id="proxy-port">${context.proxyPort}</code>
          </div>
          <div class="proxy-info-item">
            <label>Mac IP (detected)</label>
            <code id="mac-ip">detecting…</code>
          </div>
          <div class="proxy-info-item">
            <label>Emulator target</label>
            <code>10.0.2.2:${context.proxyPort}</code>
          </div>
        </div>
        <div class="cert-info" title="CA certificate path">${context.certPath}</div>
      </div>

      <div class="section">
        <div class="section-title">
          Available Devices
          <button class="btn btn-ghost" id="btn-refresh" onclick="loadDevices()" title="Refresh device list">↻ Refresh</button>
        </div>
        <div class="section-actions filter-bar">
          <label style="color: var(--muted); font-size: 13px;">Platform:</label>
          <select id="filter-platform" onchange="renderDevices()">
            <option value="all">All</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
          </select>
          <label style="color: var(--muted); font-size: 13px;">Status:</label>
          <select id="filter-status" onchange="renderDevices()">
            <option value="all">All</option>
            <option value="listening">Listening</option>
            <option value="idle">Idle</option>
          </select>
        </div>
        <div id="device-warnings"></div>
        <div id="device-list"></div>
      </div>
    </div>

    <script>
      let allDevices = [];
      let actionMessages = {}; // deviceId -> { type, text }

      // Detect Mac IP by looking at SSE response host
      async function detectMacIp() {
        try {
          const res = await fetch('/api/devices/sessions');
          const host = new URL(window.location.href).hostname;
          document.getElementById('mac-ip').textContent = host === '127.0.0.1' || host === 'localhost'
            ? 'use your Mac network IP'
            : host;
        } catch { }
      }
      detectMacIp();

      async function loadDevices() {
        const btn = document.getElementById('btn-refresh');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Refreshing…';
        try {
          const res = await fetch('/api/devices');
          if (!res.ok) throw new Error(await res.text());
          const result = await res.json();
          allDevices = result.devices ?? [];
          renderWarnings(result.warnings ?? {});
        } catch (err) {
          allDevices = [];
          document.getElementById('device-list').innerHTML =
            '<div class="msg-box error">Failed to load devices: ' + escapeHtml(String(err)) + '</div>';
          btn.disabled = false;
          btn.textContent = '↻ Refresh';
          return;
        }
        btn.disabled = false;
        btn.textContent = '↻ Refresh';
        renderDevices();
      }

      function renderWarnings(warnings) {
        const el = document.getElementById('device-warnings');
        const entries = Object.entries(warnings || {}).filter(([, msg]) => !!msg);
        if (entries.length === 0) {
          el.innerHTML = '';
          return;
        }
        const labels = { android: 'Android (ADB)', ios: 'iOS (Xcode / simctl)' };
        el.innerHTML = entries.map(([platform, msg]) =>
          '<div class="msg-box error">' + escapeHtml(labels[platform] || platform) + ': ' + escapeHtml(msg) + '</div>'
        ).join('');
      }

      function renderDevices() {
        const platformFilter = document.getElementById('filter-platform').value;
        const statusFilter = document.getElementById('filter-status').value;

        let devices = allDevices.filter(d => {
          if (platformFilter !== 'all' && d.platform !== platformFilter) return false;
          if (statusFilter === 'listening' && !d.isListening) return false;
          if (statusFilter === 'idle' && d.isListening) return false;
          return true;
        });

        const container = document.getElementById('device-list');
        if (devices.length === 0) {
          container.innerHTML = \`<div class="empty-state">
            <div class="icon">🔍</div>
            <p>No devices found.</p>
            <p>Connect an Android device via USB, start an emulator, or boot an iOS simulator.</p>
          </div>\`;
          return;
        }

        // Sort: listening first, then by platform, then by name
        devices.sort((a, b) => {
          if (a.isListening !== b.isListening) return a.isListening ? -1 : 1;
          if (a.platform !== b.platform) return a.platform === 'android' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        container.innerHTML = '<div class="device-grid">' + devices.map(d => renderDeviceCard(d)).join('') + '</div>';
      }

      function renderDeviceCard(d) {
        const icon = d.platform === 'android' ? '🤖' : '📱';
        const platformBadge = \`<span class="badge badge-\${d.platform}">\${d.platform === 'android' ? 'Android' : 'iOS'}</span>\`;
        const stateBadge = renderStateBadge(d);
        const listeningBadge = d.isListening ? '<span class="badge badge-listening">● Listening</span>' : '';
        const dotClass = d.isListening ? 'on' : 'off';

        const msg = actionMessages[d.id];
        const msgHtml = msg ? \`<div class="msg-box \${msg.type}">\${escapeHtml(msg.text)}</div>\` : '';

        const isReady = d.state === 'active' || d.state === 'booted';
        let actionBtn = '';
        if (d.isListening) {
          actionBtn = \`<button class="btn btn-danger" onclick="stopDevice('\${escapeAttr(d.id)}')">■ Stop</button>\`;
        } else if (isReady) {
          actionBtn = \`<button class="btn btn-primary" onclick="startDevice('\${escapeAttr(d.id)}', '\${d.platform}')">▶ Listen</button>\`;
        } else {
          actionBtn = \`<button class="btn btn-ghost" disabled title="Device not ready">Unavailable</button>\`;
        }

        const listeningMeta = d.isListening && d.listeningStartedAt
          ? \`<span>Since \${formatTime(d.listeningStartedAt)}</span>\`
          : '';

        return \`<div class="device-card \${d.isListening ? 'listening' : ''}" id="card-\${escapeAttr(d.id)}">
          <div class="device-platform-icon">\${icon}</div>
          <div class="device-info">
            <div class="device-name">
              <span class="status-dot \${dotClass}"></span>
              \${escapeHtml(d.name)}
              \${platformBadge} \${stateBadge} \${listeningBadge}
            </div>
            <div class="device-id">\${escapeHtml(d.id)}</div>
            <div class="device-meta">\${listeningMeta}</div>
            \${msgHtml}
          </div>
          <div class="device-actions">\${actionBtn}</div>
        </div>\`;
      }

      function renderStateBadge(d) {
        const labels = { active: ['badge-booted', 'Connected'], offline: ['badge-offline', 'Offline'],
          unauthorized: ['badge-unauthorized', 'Unauthorized'], booted: ['badge-booted', 'Booted'],
          shutdown: ['badge-shutdown', 'Shutdown'], unknown: ['badge-shutdown', 'Unknown'] };
        const [cls, text] = labels[d.state] || ['badge-shutdown', d.state];
        return \`<span class="badge \${cls}">\${text}</span>\`;
      }

      async function startDevice(deviceId, platform) {
        const card = document.getElementById('card-' + deviceId);
        const btn = card?.querySelector('.btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…'; }

        try {
          const res = await fetch('/api/devices/' + encodeURIComponent(deviceId) + '/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ platform }),
          });
          const data = await res.json();
          actionMessages[deviceId] = {
            type: data.ok ? (data.requiresManualCertInstall ? 'warn' : 'success') : 'error',
            text: data.message,
          };
        } catch (err) {
          actionMessages[deviceId] = { type: 'error', text: 'Request failed: ' + String(err) };
        }

        await loadDevices();
      }

      async function stopDevice(deviceId) {
        const card = document.getElementById('card-' + deviceId);
        const btn = card?.querySelector('.btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Stopping…'; }

        try {
          const res = await fetch('/api/devices/' + encodeURIComponent(deviceId) + '/stop', {
            method: 'POST',
          });
          const data = await res.json();
          actionMessages[deviceId] = { type: data.ok ? 'info' : 'error', text: data.message };
        } catch (err) {
          actionMessages[deviceId] = { type: 'error', text: 'Request failed: ' + String(err) };
        }

        await loadDevices();
      }

      function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      }
      function escapeAttr(s) {
        return String(s).replace(/['"]/g, c => c === "'" ? '&#39;' : '&quot;');
      }
      function formatTime(iso) {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      // Initial load
      loadDevices();

      // Auto-refresh every 8s to catch newly connected/booted devices
      setInterval(loadDevices, 8000);
    </script>
  </body>
</html>`;
