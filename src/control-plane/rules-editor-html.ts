export const renderRulesEditorHtml = () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HTTP Tools Rules Editor</title>
    <style>
      :root {
        --bg: #0f172a; --panel: #111827; --panel-soft: #0b1220; --border: #334155;
        --text: #e2e8f0; --muted: #94a3b8; --accent: #2563eb; --danger: #dc2626;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; background: var(--bg); color: var(--text); }
      a { color: #93c5fd; text-decoration: none; }
      .page { padding: 16px; max-width: 1800px; margin: 0 auto; }
      .topbar, .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
      .topbar { display: flex; justify-content: space-between; gap: 12px; padding: 14px; margin-bottom: 16px; align-items: center; }
      .title { font-size: 20px; font-weight: 700; }
      .subtitle { font-size: 12px; color: var(--muted); margin-top: 4px; }
      .layout { display: grid; gap: 16px; grid-template-columns: 340px 1fr; }
      .panel { padding: 14px; min-width: 0; }
      .rule-list { display: grid; gap: 10px; max-height: calc(100vh - 180px); overflow: auto; }
      .rule-item {
        border: 1px solid var(--border); border-radius: 10px; padding: 10px; background: var(--panel-soft);
        cursor: pointer;
      }
      .rule-item.active { outline: 2px solid rgba(37, 99, 235, 0.45); }
      .rule-item-title { font-weight: 700; word-break: break-word; }
      .rule-item-meta { font-size: 12px; color: var(--muted); margin-top: 6px; }
      .controls { display: flex; gap: 8px; margin-bottom: 12px; }
      input, textarea, button, select {
        width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border);
        background: var(--panel-soft); color: var(--text);
      }
      textarea { min-height: 120px; resize: vertical; font-family: Menlo, Consolas, monospace; }
      button { cursor: pointer; background: var(--accent); border-color: var(--accent); }
      button.secondary { background: var(--panel-soft); }
      button.danger { background: var(--danger); border-color: var(--danger); }
      .grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .field { display: grid; gap: 6px; }
      .field label { font-size: 12px; color: var(--muted); }
      .checkbox-row { display: flex; align-items: center; gap: 8px; }
      .checkbox-row input { width: auto; }
      details.section { border: 1px solid var(--border); border-radius: 10px; margin-top: 12px; overflow: hidden; }
      details.section summary {
        list-style: none; display: flex; justify-content: space-between; align-items: center;
        padding: 12px; background: var(--panel-soft); cursor: pointer; font-weight: 700;
      }
      details.section summary::-webkit-details-marker { display: none; }
      details.section summary::after { content: "▾"; color: var(--muted); }
      details.section:not([open]) summary::after { content: "▸"; }
      .section-body { padding: 12px; }
      .footer-note { color: var(--muted); font-size: 12px; line-height: 1.5; }
      @media (max-width: 1100px) {
        .layout { grid-template-columns: 1fr; }
        .rule-list { max-height: 280px; }
      }
      @media (max-width: 760px) {
        .grid { grid-template-columns: 1fr; }
        .topbar { flex-direction: column; align-items: flex-start; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="topbar">
        <div>
          <div class="title">Rules Editor</div>
          <div class="subtitle">Manage request matching and request/response modifications in a structured form instead of raw dashboard JSON.</div>
        </div>
        <div><a href="/">Back to Dashboard</a></div>
      </div>

      <div class="layout">
        <section class="panel">
          <div class="controls">
            <button id="newRule">New Rule</button>
            <button id="saveAll" class="secondary">Save All</button>
          </div>
          <div id="ruleList" class="rule-list"></div>
        </section>

        <section class="panel">
          <div class="controls">
            <button id="duplicateRule" class="secondary">Duplicate</button>
            <button id="deleteRule" class="danger">Delete</button>
          </div>
          <div id="status" class="footer-note"></div>

          <div class="grid" style="margin-top: 12px;">
            <div class="field">
              <label for="ruleId">Rule ID</label>
              <input id="ruleId" />
            </div>
            <div class="field">
              <label>Enabled</label>
              <div class="checkbox-row"><input id="ruleEnabled" type="checkbox" checked /><span>Rule is active</span></div>
            </div>
          </div>

          <details class="section" open>
            <summary>Match Conditions</summary>
            <div class="section-body">
              <div class="grid">
                <div class="field"><label for="matchMethods">Methods (comma-separated)</label><input id="matchMethods" placeholder="GET,POST" /></div>
                <div class="field"><label for="matchHostname">Hostname</label><input id="matchHostname" placeholder="api.example.com" /></div>
                <div class="field"><label for="matchPathStartsWith">Path starts with</label><input id="matchPathStartsWith" placeholder="/v1/orders" /></div>
                <div class="field"><label for="matchUrlIncludes">URL contains</label><input id="matchUrlIncludes" placeholder="feature-flags" /></div>
              </div>
              <div class="field" style="margin-top: 10px;">
                <label for="matchHeaderEquals">Header equals map (JSON)</label>
                <textarea id="matchHeaderEquals" placeholder='{"x-tenant":"test"}'></textarea>
              </div>
            </div>
          </details>

          <details class="section" open>
            <summary>Request Changes</summary>
            <div class="section-body">
              <div class="field"><label for="requestSetHeaders">Set headers (JSON)</label><textarea id="requestSetHeaders" placeholder='{"x-debug":"true"}'></textarea></div>
              <div class="field"><label for="requestRemoveHeaders">Remove headers (comma-separated)</label><input id="requestRemoveHeaders" placeholder="authorization,x-secret" /></div>
              <div class="field"><label for="requestBody">Replace body text</label><textarea id="requestBody" placeholder='{"enabled":true}'></textarea></div>
            </div>
          </details>

          <details class="section" open>
            <summary>Response Changes</summary>
            <div class="section-body">
              <div class="grid">
                <div class="field"><label for="responseStatusCode">Set status code</label><input id="responseStatusCode" type="number" min="100" max="599" /></div>
                <div class="field"><label for="responseRemoveHeaders">Remove headers (comma-separated)</label><input id="responseRemoveHeaders" placeholder="set-cookie" /></div>
              </div>
              <div class="field" style="margin-top: 10px;"><label for="responseSetHeaders">Set headers (JSON)</label><textarea id="responseSetHeaders" placeholder='{"content-type":"application/json"}'></textarea></div>
              <div class="field"><label for="responseBody">Replace body text</label><textarea id="responseBody" placeholder='{"result":"mocked"}'></textarea></div>
            </div>
          </details>

          <details class="section">
            <summary>Static Response</summary>
            <div class="section-body">
              <div class="grid">
                <div class="field"><label for="staticStatusCode">Status code</label><input id="staticStatusCode" type="number" min="100" max="599" /></div>
                <div class="field"><label for="staticHeaders">Headers (JSON)</label><textarea id="staticHeaders" placeholder='{"content-type":"text/plain"}'></textarea></div>
              </div>
              <div class="field" style="margin-top: 10px;"><label for="staticBody">Body text</label><textarea id="staticBody" placeholder="mocked response"></textarea></div>
            </div>
          </details>

          <div class="footer-note" style="margin-top: 12px;">
            Notes:<br/>
            - Leave a section empty if you do not want that behavior.<br/>
            - Save All writes the whole rule set back to the proxy.<br/>
            - JSON textareas should contain valid JSON objects.
          </div>
        </section>
      </div>
    </div>

    <script>
      const state = { rules: [], selectedIndex: -1 };

      const fields = {
        ruleId: document.getElementById("ruleId"),
        ruleEnabled: document.getElementById("ruleEnabled"),
        matchMethods: document.getElementById("matchMethods"),
        matchHostname: document.getElementById("matchHostname"),
        matchPathStartsWith: document.getElementById("matchPathStartsWith"),
        matchUrlIncludes: document.getElementById("matchUrlIncludes"),
        matchHeaderEquals: document.getElementById("matchHeaderEquals"),
        requestSetHeaders: document.getElementById("requestSetHeaders"),
        requestRemoveHeaders: document.getElementById("requestRemoveHeaders"),
        requestBody: document.getElementById("requestBody"),
        responseStatusCode: document.getElementById("responseStatusCode"),
        responseRemoveHeaders: document.getElementById("responseRemoveHeaders"),
        responseSetHeaders: document.getElementById("responseSetHeaders"),
        responseBody: document.getElementById("responseBody"),
        staticStatusCode: document.getElementById("staticStatusCode"),
        staticHeaders: document.getElementById("staticHeaders"),
        staticBody: document.getElementById("staticBody")
      };

      const ruleList = document.getElementById("ruleList");
      const statusEl = document.getElementById("status");

      const asPrettyJson = (value) => value ? JSON.stringify(value, null, 2) : "";
      const parseJsonObject = (value, fieldName) => {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const parsed = JSON.parse(trimmed);
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new Error(fieldName + " must be a JSON object");
        }
        return parsed;
      };
      const parseCommaList = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
      const omitEmpty = (value) => {
        if (value === undefined || value === null) return undefined;
        if (typeof value === "string" && value.trim() === "") return undefined;
        if (Array.isArray(value) && value.length === 0) return undefined;
        if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return undefined;
        return value;
      };

      const renderRuleList = () => {
        ruleList.innerHTML = "";
        state.rules.forEach((rule, index) => {
          const card = document.createElement("div");
          card.className = "rule-item" + (index === state.selectedIndex ? " active" : "");
          const matchSummary = [
            rule.match?.hostname,
            rule.match?.pathStartsWith,
            rule.match?.urlIncludes
          ].filter(Boolean).join(" | ") || "No match summary";
          card.innerHTML =
            '<div class="rule-item-title">' + rule.id + '</div>' +
            '<div class="rule-item-meta">' + (rule.enabled ? "Enabled" : "Disabled") + ' • ' + matchSummary + '</div>';
          card.onclick = () => {
            persistFormToState();
            state.selectedIndex = index;
            populateForm();
            renderRuleList();
          };
          ruleList.appendChild(card);
        });
      };

      const populateForm = () => {
        const rule = state.rules[state.selectedIndex];
        if (!rule) return;
        fields.ruleId.value = rule.id ?? "";
        fields.ruleEnabled.checked = !!rule.enabled;
        fields.matchMethods.value = (rule.match?.methods ?? []).join(",");
        fields.matchHostname.value = rule.match?.hostname ?? "";
        fields.matchPathStartsWith.value = rule.match?.pathStartsWith ?? "";
        fields.matchUrlIncludes.value = rule.match?.urlIncludes ?? "";
        fields.matchHeaderEquals.value = asPrettyJson(rule.match?.headerEquals);
        fields.requestSetHeaders.value = asPrettyJson(rule.request?.setHeaders);
        fields.requestRemoveHeaders.value = (rule.request?.removeHeaders ?? []).join(",");
        fields.requestBody.value = rule.request?.replaceBodyText ?? "";
        fields.responseStatusCode.value = rule.response?.setStatusCode ?? "";
        fields.responseRemoveHeaders.value = (rule.response?.removeHeaders ?? []).join(",");
        fields.responseSetHeaders.value = asPrettyJson(rule.response?.setHeaders);
        fields.responseBody.value = rule.response?.replaceBodyText ?? "";
        fields.staticStatusCode.value = rule.staticResponse?.statusCode ?? "";
        fields.staticHeaders.value = asPrettyJson(rule.staticResponse?.headers);
        fields.staticBody.value = rule.staticResponse?.bodyText ?? "";
      };

      const persistFormToState = () => {
        if (state.selectedIndex < 0 || !state.rules[state.selectedIndex]) return;
        const nextRule = {
          id: fields.ruleId.value.trim() || "untitled-rule",
          enabled: fields.ruleEnabled.checked,
          match: {
            methods: omitEmpty(parseCommaList(fields.matchMethods.value)),
            hostname: omitEmpty(fields.matchHostname.value.trim()),
            pathStartsWith: omitEmpty(fields.matchPathStartsWith.value.trim()),
            urlIncludes: omitEmpty(fields.matchUrlIncludes.value.trim()),
            headerEquals: omitEmpty(parseJsonObject(fields.matchHeaderEquals.value, "Match header equals"))
          },
          request: omitEmpty({
            setHeaders: omitEmpty(parseJsonObject(fields.requestSetHeaders.value, "Request set headers")),
            removeHeaders: omitEmpty(parseCommaList(fields.requestRemoveHeaders.value)),
            replaceBodyText: omitEmpty(fields.requestBody.value)
          }),
          response: omitEmpty({
            setHeaders: omitEmpty(parseJsonObject(fields.responseSetHeaders.value, "Response set headers")),
            removeHeaders: omitEmpty(parseCommaList(fields.responseRemoveHeaders.value)),
            replaceBodyText: omitEmpty(fields.responseBody.value),
            setStatusCode: omitEmpty(fields.responseStatusCode.value ? Number(fields.responseStatusCode.value) : undefined)
          }),
          staticResponse: omitEmpty({
            statusCode: omitEmpty(fields.staticStatusCode.value ? Number(fields.staticStatusCode.value) : undefined),
            headers: omitEmpty(parseJsonObject(fields.staticHeaders.value, "Static response headers")),
            bodyText: omitEmpty(fields.staticBody.value)
          })
        };

        nextRule.match = Object.fromEntries(Object.entries(nextRule.match).filter(([, value]) => value !== undefined));
        if (Object.keys(nextRule.match).length === 0) nextRule.match = {};
        if (nextRule.request && Object.keys(nextRule.request).length === 0) delete nextRule.request;
        if (nextRule.response && Object.keys(nextRule.response).length === 0) delete nextRule.response;
        if (nextRule.staticResponse && Object.keys(nextRule.staticResponse).length === 0) delete nextRule.staticResponse;

        state.rules[state.selectedIndex] = nextRule;
      };

      const loadRules = async () => {
        const response = await fetch("/rules");
        state.rules = await response.json();

        const params = new URLSearchParams(window.location.search);
        if (params.get("fromDraft") === "1") {
          try {
            const draft = JSON.parse(sessionStorage.getItem("http-tools:rule-draft") ?? "null");
            if (draft) {
              state.rules.push(draft);
              sessionStorage.removeItem("http-tools:rule-draft");
              state.selectedIndex = state.rules.length - 1;
              populateForm();
              renderRuleList();
              statusEl.textContent = "Prefilled a new rule from the selected capture. Adjust and click Save.";
              return;
            }
          } catch {}
        }

        if (state.rules.length === 0) {
          state.rules.push({ id: "new-rule", enabled: true, match: {} });
        }
        state.selectedIndex = 0;
        populateForm();
        renderRuleList();
      };

      const saveAll = async () => {
        try {
          persistFormToState();
          const response = await fetch("/rules", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(state.rules)
          });
          if (!response.ok) throw new Error(await response.text());
          statusEl.textContent = "Rules saved.";
          renderRuleList();
        } catch (error) {
          statusEl.textContent = "Save failed: " + error.message;
        }
      };

      document.getElementById("newRule").onclick = () => {
        persistFormToState();
        state.rules.push({ id: "new-rule-" + (state.rules.length + 1), enabled: true, match: {} });
        state.selectedIndex = state.rules.length - 1;
        populateForm();
        renderRuleList();
      };

      document.getElementById("duplicateRule").onclick = () => {
        persistFormToState();
        const current = state.rules[state.selectedIndex];
        if (!current) return;
        const clone = JSON.parse(JSON.stringify(current));
        clone.id = current.id + "-copy";
        state.rules.splice(state.selectedIndex + 1, 0, clone);
        state.selectedIndex += 1;
        populateForm();
        renderRuleList();
      };

      document.getElementById("deleteRule").onclick = () => {
        if (state.selectedIndex < 0) return;
        state.rules.splice(state.selectedIndex, 1);
        if (state.rules.length === 0) {
          state.rules.push({ id: "new-rule", enabled: true, match: {} });
        }
        state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.rules.length - 1));
        populateForm();
        renderRuleList();
      };

      document.getElementById("saveAll").onclick = saveAll;

      loadRules().catch((error) => {
        statusEl.textContent = "Failed to load rules: " + error.message;
      });
    </script>
  </body>
</html>`;
