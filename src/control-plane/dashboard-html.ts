export interface DashboardContext {
  proxyPort: number;
  certPath: string;
}

export const renderDashboardHtml = (_context: DashboardContext) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HTTP Tools Dashboard</title>
    <style>
      :root {
        --bg: #0f172a;
        --panel: #111827;
        --panel-soft: #0b1220;
        --border: #334155;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.18);
        --success: #10b981;
        --warning: #f59e0b;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; background: var(--bg); color: var(--text); }
      a { color: #93c5fd; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .page { padding: 16px; max-width: 1850px; margin: 0 auto; }
      .topbar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-bottom: 16px; padding: 12px 14px; border: 1px solid var(--border);
        border-radius: 12px; background: var(--panel);
      }
      .topbar-title { font-size: 20px; font-weight: 700; }
      .topbar-subtitle { font-size: 12px; color: var(--muted); margin-top: 4px; }
      .topbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .button-link, .button {
        display: inline-flex; align-items: center; justify-content: center; min-height: 40px;
        padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border);
        background: var(--panel-soft); color: var(--text); text-decoration: none;
      }
      .button { cursor: pointer; width: auto; }
      .button.primary { background: var(--accent); border-color: var(--accent); }
      .button.warning { background: rgba(245, 158, 11, 0.18); border-color: rgba(245, 158, 11, 0.4); color: #fde68a; }
      .shell { display: flex; align-items: stretch; gap: 0; }
      .shell-panel { min-width: 320px; }
      .shell-panel.timeline-panel { flex: 0 0 42%; }
      .shell-panel.detail-panel { flex: 1 1 auto; }
      .shell-resizer {
        flex: 0 0 14px; margin: 0 1px; cursor: col-resize; position: relative;
        display: flex; align-items: center; justify-content: center;
      }
      .shell-resizer::before {
        content: ""; width: 4px; height: 100%; border-radius: 4px; background: var(--border);
        transition: background 0.15s ease;
      }
      .shell-resizer:hover::before, .shell-resizer.dragging::before { background: var(--accent); }
      .shell-resizer::after {
        content: "⋮"; position: absolute; color: var(--muted); font-size: 14px; pointer-events: none;
      }
      body.shell-resizing { cursor: col-resize; user-select: none; }
      .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px; min-width: 0; }
      .card h2 { margin: 0 0 8px; font-size: 18px; }
      .subtle { color: var(--muted); font-size: 12px; line-height: 1.45; }
      .scroll-column { height: calc(100vh - 120px); overflow: auto; }
      .timeline-controls { display: grid; gap: 8px; grid-template-columns: 1fr 160px; margin: 12px 0; }
      input, select {
        width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border);
        background: var(--panel-soft); color: var(--text);
      }
      .timeline-table-wrap { overflow: auto; max-height: calc(100vh - 250px); border: 1px solid var(--border); border-radius: 10px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
      th, td { padding: 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
      th { position: sticky; top: 0; z-index: 1; background: var(--panel); }
      th.time, td.time { width: 88px; }
      th.method, td.method { width: 70px; }
      th.status, td.status { width: 70px; }
      th.pin, td.pin { width: 58px; }
      th.rules, td.rules { width: 70px; }
      tr.capture-row { cursor: pointer; }
      tr.capture-row:hover { background: rgba(255,255,255,0.03); }
      tr.capture-row.selected { background: var(--accent-soft); }
      td.url { white-space: normal; word-break: break-word; line-height: 1.35; }
      .mono { font-family: Menlo, Consolas, monospace; }
      .summary-grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 12px; }
      .summary-item { border: 1px solid var(--border); border-radius: 10px; background: var(--panel-soft); padding: 10px; }
      .summary-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
      .summary-value { font-size: 13px; word-break: break-word; }
      .detail-stack { display: grid; gap: 12px; }
      details.section { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--panel-soft); }
      details.section summary {
        list-style: none; display: flex; justify-content: space-between; align-items: center;
        gap: 12px; padding: 12px 14px; cursor: pointer; font-weight: 700;
      }
      details.section summary::-webkit-details-marker { display: none; }
      details.section summary::after { content: "▾"; color: var(--muted); transition: transform 0.18s ease; }
      details.section:not([open]) summary::after { transform: rotate(-90deg); }
      .section-body { padding: 0 14px 14px; }
      .headers-table { width: 100%; table-layout: fixed; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .headers-table td { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
      .headers-table td:first-child { width: 220px; color: #bfdbfe; }
      .kv-table { width: 100%; table-layout: fixed; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .kv-table td:first-child { width: 180px; color: #bfdbfe; }
      .kv-table td { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
      pre.payload {
        margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: #020617;
        white-space: pre-wrap; word-break: break-word; overflow: auto; max-height: 360px;
      }
      .pill-list { display: flex; flex-wrap: wrap; gap: 6px; }
      .pill {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px;
        border: 1px solid var(--border); background: #1e293b; font-size: 12px;
      }
      .pill.matched { background: rgba(16, 185, 129, 0.18); color: #d1fae5; border-color: rgba(16, 185, 129, 0.4); }
      .pill.none { color: var(--muted); }
      .pin-indicator { font-size: 16px; color: #fbbf24; }
      .helper-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
      .row-context-menu {
        position: fixed; z-index: 50; min-width: 220px; background: var(--panel); border: 1px solid var(--border);
        border-radius: 10px; padding: 6px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      }
      .row-context-menu button {
        display: block; width: 100%; text-align: left; background: none; border: none; color: var(--text);
        padding: 8px 10px; border-radius: 6px; font-size: 13px; cursor: pointer;
      }
      .row-context-menu button:hover { background: var(--panel-soft); }
      .row-context-menu button.danger { color: #fca5a5; }
      .row-context-menu .menu-separator { height: 1px; background: var(--border); margin: 6px 2px; }
      .row-context-menu .menu-hint { padding: 6px 10px; font-size: 11px; color: var(--muted); }
      @media (max-width: 1200px) {
        .shell { flex-direction: column; }
        .shell-panel.timeline-panel, .shell-panel.detail-panel { flex: 1 1 auto !important; width: 100% !important; }
        .shell-resizer { display: none; }
        .scroll-column { height: auto; max-height: none; }
        .timeline-table-wrap { max-height: 420px; }
      }
      @media (max-width: 760px) {
        .page { padding: 10px; }
        .timeline-controls, .summary-grid { grid-template-columns: 1fr; }
        .topbar { flex-direction: column; align-items: flex-start; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="topbar">
        <div>
          <div class="topbar-title">HTTP Tools Dashboard</div>
          <div class="topbar-subtitle">Traffic appears in capture order. Use pinning to keep important captures at the top. Parsed URL and cookie views are available in details.</div>
        </div>
        <div class="topbar-actions">
          <a class="button-link" href="/rules-editor">Open Rules Editor</a>
          <a class="button-link" href="/onboarding">Open Onboarding</a>
          <a class="button-link" href="/diagnostics/unsupported-traffic" target="_blank" rel="noreferrer">Open Diagnostics</a>
        </div>
      </div>

      <div class="shell" id="shellLayout">
        <section class="card scroll-column shell-panel timeline-panel" id="timelinePanel">
          <div class="helper-row">
            <div>
              <h2>Capture Timeline</h2>
              <div class="subtle">Pinned captures stay at the top of the filtered list. Timeline and details scroll independently. Drag the divider to resize.</div>
            </div>
            <button id="clearCapturesButton" class="button warning" title="Remove all captures except pinned ones">Clear</button>
          </div>
          <div class="timeline-controls">
            <input id="search" placeholder="Search URL, method, status, or rule id" />
            <select id="methodFilter">
              <option value="">All methods</option>
              <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option><option>OPTIONS</option>
            </select>
          </div>
          <div class="timeline-table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="time">Time</th>
                  <th class="method">Method</th>
                  <th class="status">Status</th>
                  <th class="pin">Pin</th>
                  <th class="rules">Rules</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody id="captureRows"></tbody>
            </table>
          </div>
        </section>

        <div class="shell-resizer" id="shellResizer" title="Drag to resize"></div>

        <section class="card scroll-column shell-panel detail-panel" id="detailPanel">
          <div class="helper-row">
            <div>
              <h2>Capture Detail</h2>
              <div class="subtle">Inspect raw ordered headers, parsed URL details, parsed cookies, and pretty-printed payloads.</div>
            </div>
            <button id="pinCaptureButton" class="button warning" style="display:none;">Pin Capture</button>
          </div>
          <div id="captureDetail" class="detail-stack">
            <div class="subtle">Select a row from the timeline to inspect method, headers, payload, URL parts, and cookie details.</div>
          </div>
        </section>
      </div>
    </div>

    <div id="rowContextMenu" class="row-context-menu" style="display:none;"></div>

    <script>
      const SHELL_RATIO_STORAGE_KEY = "http-tools:shell-timeline-ratio";
      const shellLayoutEl = document.getElementById("shellLayout");
      const timelinePanelEl = document.getElementById("timelinePanel");
      const shellResizerEl = document.getElementById("shellResizer");

      const applyShellRatio = (ratio) => {
        const clamped = Math.min(0.75, Math.max(0.2, ratio));
        timelinePanelEl.style.flex = "0 0 " + (clamped * 100).toFixed(2) + "%";
      };

      const loadShellRatio = () => {
        const stored = Number(localStorage.getItem(SHELL_RATIO_STORAGE_KEY));
        if (Number.isFinite(stored) && stored > 0) applyShellRatio(stored);
      };
      loadShellRatio();

      (() => {
        let dragging = false;

        const onPointerMove = (event) => {
          if (!dragging) return;
          const bounds = shellLayoutEl.getBoundingClientRect();
          const ratio = (event.clientX - bounds.left) / bounds.width;
          applyShellRatio(ratio);
        };

        const stopDragging = () => {
          if (!dragging) return;
          dragging = false;
          shellResizerEl.classList.remove("dragging");
          document.body.classList.remove("shell-resizing");
          const bounds = shellLayoutEl.getBoundingClientRect();
          const finalRatio = timelinePanelEl.getBoundingClientRect().width / bounds.width;
          localStorage.setItem(SHELL_RATIO_STORAGE_KEY, String(finalRatio));
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", stopDragging);
        };

        shellResizerEl.addEventListener("pointerdown", (event) => {
          dragging = true;
          shellResizerEl.classList.add("dragging");
          document.body.classList.add("shell-resizing");
          window.addEventListener("pointermove", onPointerMove);
          window.addEventListener("pointerup", stopDragging);
          event.preventDefault();
        });
      })();

      const PIN_STORAGE_KEY = "http-tools:pinned-capture-ids";
      const state = {
        requests: new Map(),
        captures: [],
        selectedId: null,
        method: "",
        search: "",
        pinnedIds: new Set(),
        sectionOpenState: new Map()
      };

      const rowsEl = document.getElementById("captureRows");
      const detailEl = document.getElementById("captureDetail");
      const pinButton = document.getElementById("pinCaptureButton");
      const clearButton = document.getElementById("clearCapturesButton");

      const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

      const loadPinnedIds = () => {
        try {
          const stored = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) ?? "[]");
          if (Array.isArray(stored)) state.pinnedIds = new Set(stored);
        } catch {}
      };

      const persistPinnedIds = () => {
        localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...state.pinnedIds]));
      };

      const isPinned = (captureId) => state.pinnedIds.has(captureId);

      const togglePinned = (captureId) => {
        if (!captureId) return;
        if (state.pinnedIds.has(captureId)) state.pinnedIds.delete(captureId);
        else state.pinnedIds.add(captureId);
        persistPinnedIds();
        updatePinButton();
        render();
      };

      const updatePinButton = () => {
        const selected = state.captures.find((capture) => capture.id === state.selectedId);
        if (!selected) {
          pinButton.style.display = "none";
          return;
        }
        pinButton.style.display = "inline-flex";
        const pinned = isPinned(selected.id);
        pinButton.textContent = pinned ? "Unpin Capture" : "Pin Capture";
      };

      const contextMenuEl = document.getElementById("rowContextMenu");

      const buildCurlCommand = (capture) => {
        const parts = ["curl", "-i", "-X", capture.method ?? "GET"];
        for (const [name, value] of capture.rawHeaders ?? []) {
          if (name.toLowerCase() === "content-length") continue;
          parts.push("-H", JSON.stringify(name + ": " + value));
        }
        if (capture.bodyText) parts.push("--data-raw", JSON.stringify(capture.bodyText));
        parts.push(JSON.stringify(capture.url ?? ""));
        return parts.join(" ");
      };

      const copyToClipboard = async (text) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
      };

      const downloadJson = (filename, data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      };

      const removeCapture = (captureId) => {
        state.captures = state.captures.filter((capture) => capture.id !== captureId);
        state.requests.delete(captureId);
        if (state.selectedId === captureId) state.selectedId = null;
        render();
      };

      const openAddRuleFromCapture = (capture) => {
        const parts = parseUrlParts(capture.url);
        const draft = {
          id: "rule-from-capture-" + Date.now(),
          enabled: true,
          match: {
            methods: capture.method ? [capture.method] : [],
            hostname: parts?.hostname ?? "",
            pathStartsWith: parts?.pathname ?? ""
          }
        };
        sessionStorage.setItem("http-tools:rule-draft", JSON.stringify(draft));
        window.location.href = "/rules-editor?fromDraft=1";
      };

      const closeRowContextMenu = () => {
        contextMenuEl.style.display = "none";
        contextMenuEl.innerHTML = "";
      };

      const openRowContextMenu = (event, capture) => {
        const items = [
          { label: "Copy URL", action: () => copyToClipboard(capture.url ?? "") },
          { label: "Copy as cURL", action: () => copyToClipboard(buildCurlCommand(capture)) },
          { label: "Copy Response Body", action: () => copyToClipboard(capture.responseBodyText ?? ""), disabled: !capture.responseBodyText },
          { separator: true },
          { label: "Export Capture as JSON", action: () => downloadJson("capture-" + capture.id + ".json", capture) },
          { label: "Add Rule from This Request", action: () => openAddRuleFromCapture(capture) },
          { separator: true },
          { label: isPinned(capture.id) ? "Unpin Capture" : "Pin Capture", action: () => togglePinned(capture.id) },
          { label: "Remove This Capture", action: () => removeCapture(capture.id), danger: true }
        ];

        contextMenuEl.innerHTML = items.map((item) => {
          if (item.separator) return '<div class="menu-separator"></div>';
          return '<button data-action' + (item.disabled ? " disabled" : "") + (item.danger ? ' class="danger"' : "") + '>' + escapeHtml(item.label) + '</button>';
        }).join("");

        const buttons = contextMenuEl.querySelectorAll("button[data-action]");
        items.filter((item) => !item.separator).forEach((item, index) => {
          buttons[index].onclick = () => {
            closeRowContextMenu();
            item.action();
          };
        });

        contextMenuEl.style.display = "block";
        const menuWidth = 240;
        const menuHeight = contextMenuEl.offsetHeight || items.length * 34;
        const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
        const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
        contextMenuEl.style.left = Math.max(8, x) + "px";
        contextMenuEl.style.top = Math.max(8, y) + "px";
      };

      document.addEventListener("click", (event) => {
        if (!contextMenuEl.contains(event.target)) closeRowContextMenu();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeRowContextMenu();
      });
      window.addEventListener("scroll", closeRowContextMenu, true);

      const formatPayload = (bodyText) => {
        if (bodyText === undefined || bodyText === null || bodyText === "") return "";
        try {
          const parsed = JSON.parse(bodyText);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return bodyText;
        }
      };

      const renderHeadersTable = (rawHeaders) => {
        if (!rawHeaders || rawHeaders.length === 0) return '<div class="subtle">No headers captured.</div>';
        return '<table class="headers-table"><tbody>' + rawHeaders.map(([name, value]) =>
          '<tr><td class="mono">' + escapeHtml(name) + '</td><td class="mono">' + escapeHtml(value) + '</td></tr>'
        ).join("") + '</tbody></table>';
      };

      const renderPayload = (bodyText) => {
        const formatted = formatPayload(bodyText);
        if (!formatted) return '<div class="subtle">No payload captured.</div>';
        return '<pre class="payload mono">' + escapeHtml(formatted) + '</pre>';
      };

      const renderSection = (title, content, open = true) => {
        const key = title;
        const isOpen = state.sectionOpenState.has(key) ? state.sectionOpenState.get(key) : open;
        return '<details class="section" data-section-key="' + escapeHtml(key) + '"' + (isOpen ? ' open' : '') + '><summary>' + escapeHtml(title) + '</summary><div class="section-body">' + content + '</div></details>';
      };

      const renderRulePills = (ruleIds) => {
        if (!ruleIds || ruleIds.length === 0) return '<span class="pill none">None</span>';
        return '<div class="pill-list">' + ruleIds.map((id) => '<span class="pill matched mono">' + escapeHtml(id) + '</span>').join("") + '</div>';
      };

      const parseUrlParts = (urlText) => {
        if (!urlText) return null;
        try {
          const url = new URL(urlText);
          return {
            protocol: url.protocol,
            host: url.host,
            hostname: url.hostname,
            port: url.port || "(default)",
            pathname: url.pathname,
            search: url.search || "(none)",
            hash: url.hash || "(none)",
            origin: url.origin
          };
        } catch {
          return null;
        }
      };

      const renderUrlParts = (urlText) => {
        const parts = parseUrlParts(urlText);
        if (!parts) return '<div class="subtle">Could not parse URL.</div>';
        const queryRows = [...new URL(urlText).searchParams.entries()];
        const baseTable = '<table class="kv-table"><tbody>' + [
          ["Protocol", parts.protocol],
          ["Origin", parts.origin],
          ["Host", parts.host],
          ["Hostname", parts.hostname],
          ["Port", parts.port],
          ["Path", parts.pathname],
          ["Query String", parts.search],
          ["Hash", parts.hash]
        ].map(([k, v]) => '<tr><td class="mono">' + escapeHtml(k) + '</td><td class="mono">' + escapeHtml(v) + '</td></tr>').join("") + '</tbody></table>';

        if (queryRows.length === 0) return baseTable;
        const queryTable = '<div style="margin-top:10px;"><div class="subtle" style="margin-bottom:6px;">Query Parameters</div><table class="kv-table"><tbody>' +
          queryRows.map(([k, v]) => '<tr><td class="mono">' + escapeHtml(k) + '</td><td class="mono">' + escapeHtml(v) + '</td></tr>').join("") +
          '</tbody></table></div>';
        return baseTable + queryTable;
      };

      const getHeaderValues = (rawHeaders, targetName) => {
        if (!rawHeaders) return [];
        const name = targetName.toLowerCase();
        return rawHeaders
          .filter(([headerName]) => headerName.toLowerCase() === name)
          .map(([, value]) => value);
      };

      const parseCookieHeader = (cookieValue) =>
        cookieValue.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
          const idx = part.indexOf("=");
          if (idx === -1) return { name: part, value: "" };
          return { name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
        });

      const parseSetCookieHeader = (setCookieValue) => {
        const parts = setCookieValue.split(";").map((part) => part.trim()).filter(Boolean);
        const [nameValue, ...attributes] = parts;
        const idx = nameValue.indexOf("=");
        const parsed = {
          name: idx === -1 ? nameValue : nameValue.slice(0, idx).trim(),
          value: idx === -1 ? "" : nameValue.slice(idx + 1).trim(),
          attributes: []
        };
        for (const attribute of attributes) {
          const attrIdx = attribute.indexOf("=");
          parsed.attributes.push({
            key: attrIdx === -1 ? attribute : attribute.slice(0, attrIdx).trim(),
            value: attrIdx === -1 ? "" : attribute.slice(attrIdx + 1).trim()
          });
        }
        return parsed;
      };

      const renderParsedCookies = (rawHeaders, type) => {
        const cookieHeaderName = type === "request" ? "cookie" : "set-cookie";
        const values = getHeaderValues(rawHeaders, cookieHeaderName);
        if (values.length === 0) return '<div class="subtle">No ' + escapeHtml(cookieHeaderName) + ' header captured.</div>';

        if (type === "request") {
          const cookies = values.flatMap(parseCookieHeader);
          return '<table class="kv-table"><tbody>' + cookies.map((cookie) =>
            '<tr><td class="mono">' + escapeHtml(cookie.name) + '</td><td class="mono">' + escapeHtml(cookie.value) + '</td></tr>'
          ).join("") + '</tbody></table>';
        }

        const parsedSetCookies = values.map(parseSetCookieHeader);
        return parsedSetCookies.map((cookie, index) => {
          const attrs = cookie.attributes.length === 0
            ? '<div class="subtle">No attributes.</div>'
            : '<table class="kv-table"><tbody>' + cookie.attributes.map((attribute) =>
              '<tr><td class="mono">' + escapeHtml(attribute.key) + '</td><td class="mono">' + escapeHtml(attribute.value) + '</td></tr>'
            ).join("") + '</tbody></table>';
          return '<div style="margin-bottom:12px;">' +
            '<div class="subtle" style="margin-bottom:6px;">Set-Cookie #' + (index + 1) + '</div>' +
            '<table class="kv-table" style="margin-bottom:8px;"><tbody>' +
            '<tr><td class="mono">Name</td><td class="mono">' + escapeHtml(cookie.name) + '</td></tr>' +
            '<tr><td class="mono">Value</td><td class="mono">' + escapeHtml(cookie.value) + '</td></tr>' +
            '</tbody></table>' + attrs + '</div>';
        }).join("");
      };

      const renderDetail = (capture) => {
        if (!capture) {
          detailEl.innerHTML = '<div class="subtle">Select a row from the timeline to inspect method, headers, payload, URL parts, and cookie details.</div>';
          updatePinButton();
          return;
        }

        const scrollTop = detailEl.scrollTop;
        detailEl.innerHTML = [
          '<div class="summary-grid">',
            '<div class="summary-item"><div class="summary-label">Method</div><div class="summary-value mono">' + escapeHtml(capture.method ?? "-") + '</div></div>',
            '<div class="summary-item"><div class="summary-label">Status</div><div class="summary-value mono">' + escapeHtml(capture.statusCode ?? "Pending") + '</div></div>',
            '<div class="summary-item"><div class="summary-label">Captured At</div><div class="summary-value">' + escapeHtml(new Date(capture.timestamp).toLocaleString()) + '</div></div>',
            '<div class="summary-item"><div class="summary-label">Rules Applied</div><div class="summary-value">' + escapeHtml(String((capture.matchedRuleIds ?? []).length)) + '</div></div>',
          '</div>',
          renderSection("URL", '<pre class="payload mono">' + escapeHtml(capture.url ?? "-") + '</pre>'),
          renderSection("Parsed URL", renderUrlParts(capture.url)),
          renderSection("Matched Rules", renderRulePills(capture.matchedRuleIds)),
          renderSection("Request Headers", renderHeadersTable(capture.rawHeaders)),
          renderSection("Parsed Request Cookies", renderParsedCookies(capture.rawHeaders, "request"), false),
          renderSection("Request Payload", renderPayload(capture.bodyText)),
          renderSection("Response Headers", renderHeadersTable(capture.responseRawHeaders)),
          renderSection("Parsed Response Set-Cookies", renderParsedCookies(capture.responseRawHeaders, "response"), false),
          renderSection("Response Payload", renderPayload(capture.responseBodyText), false)
        ].join("");

        detailEl.querySelectorAll("details.section").forEach((details) => {
          const key = details.getAttribute("data-section-key");
          details.addEventListener("toggle", () => {
            state.sectionOpenState.set(key, details.open);
          });
        });
        detailEl.scrollTop = scrollTop;

        updatePinButton();
      };

      const renderTimelineRuleIndicator = (ruleIds) => {
        if (!ruleIds || ruleIds.length === 0) return '<span class="pill none">-</span>';
        return '<span class="pill matched">' + escapeHtml(String(ruleIds.length)) + '</span>';
      };

      const renderPinnedIndicator = (captureId) => isPinned(captureId) ? '<span class="pin-indicator">★</span>' : '<span class="subtle">-</span>';

      const render = () => {
        const filtered = state.captures
          .filter((capture) => !state.method || capture.method === state.method)
          .filter((capture) => {
            if (!state.search) return true;
            const text = [
              capture.method,
              capture.url,
              String(capture.statusCode ?? ""),
              ...(capture.matchedRuleIds ?? [])
            ].join(" ").toLowerCase();
            return text.includes(state.search.toLowerCase());
          })
          .sort((a, b) => {
            const aPinned = isPinned(a.id) ? 1 : 0;
            const bPinned = isPinned(b.id) ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            return b.timestamp - a.timestamp;
          });

        rowsEl.innerHTML = "";
        for (const capture of filtered) {
          const tr = document.createElement("tr");
          tr.className = "capture-row" + (capture.id === state.selectedId ? " selected" : "");
          tr.innerHTML =
            '<td class="time">' + escapeHtml(new Date(capture.timestamp).toLocaleTimeString()) + '</td>' +
            '<td class="method mono">' + escapeHtml(capture.method ?? "-") + '</td>' +
            '<td class="status mono">' + escapeHtml(capture.statusCode ?? "-") + '</td>' +
            '<td class="pin">' + renderPinnedIndicator(capture.id) + '</td>' +
            '<td class="rules">' + renderTimelineRuleIndicator(capture.matchedRuleIds) + '</td>' +
            '<td class="url mono">' + escapeHtml(capture.url ?? "") + '</td>';
          tr.onclick = () => {
            state.selectedId = capture.id;
            render();
          };
          tr.oncontextmenu = (event) => {
            event.preventDefault();
            state.selectedId = capture.id;
            render();
            openRowContextMenu(event, capture);
          };
          rowsEl.appendChild(tr);
        }

        renderDetail(state.captures.find((capture) => capture.id === state.selectedId) ?? null);
      };

      const mergeRequest = (req) => {
        const existing = state.requests.get(req.id) ?? {};
        const merged = { ...existing, ...req };
        state.requests.set(req.id, merged);
        const index = state.captures.findIndex((capture) => capture.id === req.id);
        if (index >= 0) state.captures[index] = merged;
        else state.captures.push(merged);
      };

      const mergeResponse = (res) => {
        const existing = state.requests.get(res.id) ?? {};
        const merged = {
          ...existing,
          statusCode: res.statusCode,
          responseHeaders: res.headers,
          responseRawHeaders: res.rawHeaders,
          responseBodyText: res.bodyText,
          matchedRuleIds: res.matchedRuleIds ?? existing.matchedRuleIds
        };
        state.requests.set(res.id, merged);
        const index = state.captures.findIndex((capture) => capture.id === res.id);
        if (index >= 0) state.captures[index] = merged;
        else state.captures.push(merged);
      };

      document.getElementById("search").oninput = (event) => {
        state.search = event.target.value;
        render();
      };
      document.getElementById("methodFilter").onchange = (event) => {
        state.method = event.target.value;
        render();
      };
      pinButton.onclick = () => togglePinned(state.selectedId);

      const clearCaptures = async () => {
        const pinnedIds = [...state.pinnedIds];
        const nonPinnedCount = state.captures.filter((capture) => !state.pinnedIds.has(capture.id)).length;
        if (nonPinnedCount === 0) return;
        if (!confirm("Clear " + nonPinnedCount + " capture(s)? Pinned captures will be kept.")) return;

        clearButton.disabled = true;
        try {
          await fetch("/captures/clear", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ keepIds: pinnedIds })
          });
        } catch {}

        state.captures = state.captures.filter((capture) => state.pinnedIds.has(capture.id));
        for (const id of [...state.requests.keys()]) {
          if (!state.pinnedIds.has(id)) state.requests.delete(id);
        }
        if (state.selectedId && !state.pinnedIds.has(state.selectedId)) state.selectedId = null;

        clearButton.disabled = false;
        render();
      };
      clearButton.onclick = clearCaptures;

      const loadCaptures = async () => {
        const response = await fetch("/captures");
        const data = await response.json();
        data.requests.forEach(mergeRequest);
        data.responses.forEach(mergeResponse);
        render();
      };

      const events = new EventSource("/events");
      events.addEventListener("request", (message) => {
        const event = JSON.parse(message.data);
        mergeRequest(event.payload);
        render();
      });
      events.addEventListener("response", (message) => {
        const event = JSON.parse(message.data);
        mergeResponse(event.payload);
        render();
      });

      loadPinnedIds();
      loadCaptures();
    </script>
  </body>
</html>`;
