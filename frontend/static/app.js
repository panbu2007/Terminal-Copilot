/* global Terminal, FitAddon */

const statusEl = document.getElementById('status');
const stepsEl = document.getElementById('steps');
const suggestionsEl = document.getElementById('suggestions');
const hintEl = document.getElementById('hint');
const exportBtn = document.getElementById('export');
const resetBtn = document.getElementById('reset');
const llmBtn = document.getElementById('llm');
const llmModal = document.getElementById('llmModal');
const llmTokenInput = document.getElementById('llmTokenInput');
const llmModelDropdown = document.getElementById('llmModelDropdown');
const llmModelDropdownBtn = document.getElementById('llmModelDropdownBtn');
const llmModelDropdownMenu = document.getElementById('llmModelDropdownMenu');
const llmModelInput = document.getElementById('llmModelInput');
const llmModalHint = document.getElementById('llmModalHint');
const llmSaveBtn = document.getElementById('llmSave');
const llmCloseBtn = document.getElementById('llmClose');
const llmTestBtn = document.getElementById('llmTest');
const executorSwitchEl = document.getElementById('executorSwitch');

let currentExecutorMode = '';

// Timeline (infinite UI)
let timelineRounds = [];
let lastSuggestionsCache = [];

function timelineStorageKey() {
  const sid = getSessionId();
  return sid ? `tc_timeline_${sid}` : 'tc_timeline_nosession';
}

function saveTimeline() {
  try {
    sessionStorage.setItem(timelineStorageKey(), JSON.stringify(timelineRounds));
  } catch {
    // ignore
  }
}

function loadTimeline() {
  try {
    const raw = sessionStorage.getItem(timelineStorageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) timelineRounds = parsed;
  } catch {
    // ignore
  }
}

function clearTimeline() {
  timelineRounds = [];
  try {
    sessionStorage.removeItem(timelineStorageKey());
  } catch {
    // ignore
  }
}

function setStatusReady() {
  const mode = currentExecutorMode ? String(currentExecutorMode) : 'unknown';
  statusEl.textContent = `就绪（executor=${mode}）`;
}

// Keep the last user-provided token on the client side.
// We intentionally do NOT fetch token from backend for security.
// Persisting in sessionStorage allows keeping it across reloads in the same tab.
const LLM_TOKEN_STORAGE_KEY = 'tc_llm_token';
let cachedLlmToken = '';
try {
  cachedLlmToken = sessionStorage.getItem(LLM_TOKEN_STORAGE_KEY) || '';
} catch {
  cachedLlmToken = '';
}

const MODE = {
  get() {
    const checked = document.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : 'suggest';
  },
};

function getPlatform() {
  const p = (navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  return 'linux';
}

function getSessionId() {
  return localStorage.getItem('tc_session_id');
}

function setSessionId(id) {
  localStorage.setItem('tc_session_id', id);
}

function clearSessionId() {
  try {
    localStorage.removeItem('tc_session_id');
  } catch {
    // ignore
  }
}

function clearCachedLlmToken() {
  cachedLlmToken = '';
  try {
    sessionStorage.removeItem(LLM_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function resetClientState({ clearToken = true, newSession = true } = {}) {
  clearSessionId();
  if (clearToken) clearCachedLlmToken();

  clearTimeline();

  // Clear UI panels
  try {
    if (stepsEl) stepsEl.innerHTML = '';
    if (suggestionsEl) suggestionsEl.innerHTML = '';
    setHint('');
  } catch {
    // ignore
  }

  if (newSession) {
    try {
      await apiNewSession();
    } catch {
      // ignore
    }
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiHealth() {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('health failed');
  return res.json();
}

async function apiLlmStatus() {
  const res = await fetch('/api/llm/status');
  if (!res.ok) throw new Error('llm status failed');
  return res.json();
}

async function apiExecutorStatus() {
  const res = await fetch('/api/executor/status');
  if (!res.ok) throw new Error('executor status failed');
  return res.json();
}

async function apiSetExecutorMode(mode) {
  return postJson('/api/executor/mode', { mode });
}

function applyExecutorStatusUi(st) {
  if (!st) return;
  const mode = String(st.mode || st.current_mode || '');
  if (mode) currentExecutorMode = mode;

  if (!executorSwitchEl) return;
  const btns = Array.from(executorSwitchEl.querySelectorAll('button[data-exec]'));
  const allowLocal = !!st.allow_local;
  const available = Array.isArray(st.available) ? st.available.map(String) : [];

  for (const b of btns) {
    const m = String(b.getAttribute('data-exec') || '');
    b.classList.toggle('is-active', m === currentExecutorMode);

    let enabled = true;
    if (available.length > 0 && !available.includes(m)) enabled = false;
    if (m === 'local' && !allowLocal) enabled = false;

    b.disabled = !enabled;
    if (m === 'local' && !allowLocal) b.title = 'local 未启用（后端 allow_local=false）';
    else b.title = '';
  }
}

async function refreshExecutorStatus({ updateReadyText = false } = {}) {
  try {
    const st = await apiExecutorStatus();
    applyExecutorStatusUi(st);
    if (updateReadyText) setStatusReady();
    return st;
  } catch {
    return null;
  }
}

async function apiSetLlmToken(token) {
  return postJson('/api/llm/token', { token });
}

async function apiSetLlmConfig(token, model) {
  return postJson('/api/llm/config', { token, model });
}

async function apiLlmTest(token, model) {
  return postJson('/api/llm/test', {
    token: token || null,
    model: model || null,
  });
}

async function apiNewSession() {
  const res = await fetch('/api/sessions/new', { method: 'POST' });
  if (!res.ok) throw new Error('new session failed');
  const data = await res.json();
  setSessionId(data.session_id);
  return data;
}

async function apiEvents() {
  let sid = getSessionId();
  if (!sid) {
    await apiNewSession();
    sid = getSessionId();
  }
  const res = await fetch(`/api/sessions/${sid}/events`);
  if (!res.ok) throw new Error('events fetch failed');
  return res.json();
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function apiExecute(command, confirmed = false) {
  const payload = {
    session_id: getSessionId() || null,
    command,
    confirmed,
  };
  const data = await postJson('/api/execute', payload);
  setSessionId(data.session_id);
  return data;
}

async function apiInterrupt() {
  let sid = getSessionId();
  if (!sid) {
    await apiNewSession();
    sid = getSessionId();
  }
  return postJson('/api/interrupt', { session_id: sid });
}

async function apiSuggest(last) {
  const payload = {
    session_id: getSessionId() || null,
    last_command: last.command,
    last_exit_code: last.exit_code,
    last_stdout: last.stdout,
    last_stderr: last.stderr,
    platform: getPlatform(),
  };
  const data = await postJson('/api/suggest', payload);
  setSessionId(data.session_id);
  return data;
}

async function runSuggestOnly(text) {
  try {
    statusEl.textContent = '生成建议…';
    const sug = await apiSuggest({
      command: text,
      exit_code: 0,
      stdout: '',
      stderr: '',
    });
    renderSteps(sug.steps);
    renderSuggestions(
      sug.suggestions,
      (s) => {
        if (s.command === '(auto)') return;
        term.write(s.command);
        currentLine += s.command;
      },
      async (s) => {
        if (MODE.get() !== 'assist') {
          writeInfo('当前为「只建议」模式，切换到「建议+执行」即可一键执行。');
          return;
        }
        if (s.risk_level === 'block') {
          writeError('该命令被安全策略拦截（block）。');
          return;
        }
        if (s.requires_confirmation) {
          const ok = confirm(`该操作需要确认：\n\n${s.command}\n\n确认执行？`);
          if (!ok) return;
          await runCommand(s.command, true);
          return;
        }
        await runCommand(s.command, false);
      }
    );
    setStatusReady();
  } catch (e) {
    statusEl.textContent = '错误';
    writeError(String(e.message || e));
  } finally {
    prompt();
  }
}

function setHint(text) {
  hintEl.textContent = text ? `Tab 接受：${text}` : '';
}

function clearSuggestions() {
  suggestionsEl.innerHTML = '';
  setHint('');
}

function formatTs(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts || '');
    return d.toLocaleString();
  } catch {
    return String(ts || '');
  }
}

function makeSmallButton(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function downloadText(filename, text) {
  const blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function appendRound(round) {
  timelineRounds.push(round);
  saveTimeline();
  renderTimeline();
}

function updateLastRound(patch) {
  if (!timelineRounds.length) return;
  const r = timelineRounds[timelineRounds.length - 1];
  Object.assign(r, patch || {});
  saveTimeline();
  renderTimeline();
}

function extractVerificationSteps(steps, cmd) {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  // Find the last execution step for this command
  let idx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st && st.title === '执行命令' && String(st.command || '') === String(cmd || '')) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return [];
  const out = [];
  for (let j = idx + 1; j < steps.length; j++) {
    const st = steps[j];
    if (!st) continue;
    if (st.title === '执行命令') break;
    if (String(st.command || '') !== String(cmd || '')) continue;
    // verification / policy steps are appended after execute
    out.push(st);
  }
  return out;
}

function renderTimeline() {
  if (!stepsEl) return;
  stepsEl.innerHTML = '';

  if (!Array.isArray(timelineRounds) || timelineRounds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.innerHTML = '<div class="explain">尚未执行命令。执行一次后这里会按回合持续追加（不会覆盖）。</div>';
    stepsEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < timelineRounds.length; i++) {
    const r = timelineRounds[i];
    const wrap = document.createElement('div');
    wrap.className = 'timeline-round';

    const head = document.createElement('div');
    head.className = 'round-head';

    const title = document.createElement('div');
    title.className = 'round-title';
    title.textContent = `回合 #${i + 1}`;

    const meta = document.createElement('div');
    meta.className = 'round-meta';
    const mode = r.executor ? `executor=${r.executor}` : 'executor=?';
    const code = (typeof r.exit_code === 'number') ? `exit=${r.exit_code}` : '';
    meta.textContent = `${formatTs(r.ts)}  ${mode}${code ? '  ' + code : ''}`;

    head.appendChild(title);
    head.appendChild(meta);
    wrap.appendChild(head);

    // Plan
    const stPlan = document.createElement('div');
    stPlan.className = 'stage';
    const stPlanTitle = document.createElement('div');
    stPlanTitle.className = 'stage-title';
    stPlanTitle.textContent = '计划（建议来源）';
    stPlan.appendChild(stPlanTitle);
    const planText = document.createElement('div');
    planText.className = 'explain';
    if (r.plan && r.plan.title) {
      planText.textContent = `来自建议：${r.plan.title}`;
    } else {
      planText.textContent = '用户手动输入（或未匹配到建议）。';
    }
    stPlan.appendChild(planText);
    wrap.appendChild(stPlan);

    // Execute
    const stExec = document.createElement('div');
    stExec.className = 'stage';
    const stExecTitle = document.createElement('div');
    stExecTitle.className = 'stage-title';
    stExecTitle.textContent = '执行';
    stExec.appendChild(stExecTitle);

    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = String(r.command || '');
    stExec.appendChild(cmd);

    const actions = document.createElement('div');
    actions.className = 'small-actions';

    if (r.stdout) {
      actions.appendChild(makeSmallButton('下载 stdout', () => downloadText(`round-${i + 1}-stdout.txt`, r.stdout)));
    }
    if (r.stderr) {
      actions.appendChild(makeSmallButton('下载 stderr', () => downloadText(`round-${i + 1}-stderr.txt`, r.stderr)));
    }
    if (actions.children.length > 0) stExec.appendChild(actions);

    const out = (r.stdout || '').trim();
    const err = (r.stderr || '').trim();
    if (out) {
      const outDiv = document.createElement('div');
      outDiv.className = 'output';
      outDiv.textContent = out.length > 2000 ? (out.slice(0, 2000) + '\n…（已截断，完整内容可下载）') : out;
      stExec.appendChild(outDiv);
    }
    if (err) {
      const errDiv = document.createElement('div');
      errDiv.className = 'output';
      errDiv.style.color = 'rgba(255, 92, 122, 0.92)';
      errDiv.textContent = err.length > 2000 ? (err.slice(0, 2000) + '\n…（已截断，完整内容可下载）') : err;
      stExec.appendChild(errDiv);
    }
    if (!out && !err) {
      const none = document.createElement('div');
      none.className = 'output is-muted';
      none.textContent = '（无输出）';
      stExec.appendChild(none);
    }

    wrap.appendChild(stExec);

    // Verify
    const stVer = document.createElement('div');
    stVer.className = 'stage';
    const stVerTitle = document.createElement('div');
    stVerTitle.className = 'stage-title';
    stVerTitle.textContent = '校验 / 护栏';
    stVer.appendChild(stVerTitle);

    if (Array.isArray(r.verify_steps) && r.verify_steps.length > 0) {
      for (const v of r.verify_steps) {
        const line = document.createElement('div');
        line.className = 'explain';
        const ok = v.status === 'success';
        line.textContent = `${ok ? '通过' : '失败'}：${v.title}${v.detail ? ' — ' + v.detail : ''}`;
        stVer.appendChild(line);
      }
    } else {
      const line = document.createElement('div');
      line.className = 'explain';
      line.textContent = '（暂无可用校验规则）';
      stVer.appendChild(line);
    }
    wrap.appendChild(stVer);

    stepsEl.appendChild(wrap);
  }

  // Keep scrolled to bottom (infinite append UX)
  try {
    stepsEl.scrollTop = stepsEl.scrollHeight;
  } catch {
    // ignore
  }
}

function findLastPolicyDetail(steps, titles) {
  if (!Array.isArray(steps)) return '';
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st && titles.includes(st.title) && st.detail) return st.detail;
  }
  return '';
}

function renderSteps(steps) {
  // Deprecated: steps panel is now a timeline.
  // We keep this function for compatibility but redirect to timeline rendering.
  // (Some code paths still call renderSteps with backend steps.)
  void steps;
  renderTimeline();
}

function badgeClass(level) {
  if (level === 'warn') return 'warn';
  if (level === 'block') return 'block';
  return 'safe';
}

function renderSuggestions(suggestions, insertFn, executeFn) {
  clearSuggestions();
  lastSuggestionsCache = Array.isArray(suggestions) ? suggestions : [];
  if (!suggestions || suggestions.length === 0) {
    suggestionsEl.innerHTML = '<div class="card"><div class="explain">暂无建议（继续输入命令或触发 Demo）</div></div>';
    return;
  }

  setHint(suggestions[0].command && suggestions[0].command !== '(auto)' ? suggestions[0].command : '');

  for (const s of suggestions) {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'card-title';
    const confirmTag = s.requires_confirmation ? ' · 需确认' : '';
    title.innerHTML = `<span>${escapeHtml(s.title)}${confirmTag}</span><span class="badge ${badgeClass(s.risk_level)}">${escapeHtml(s.risk_level)}</span>`;

    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = s.command;

    const explain = document.createElement('div');
    explain.className = 'explain';
    explain.textContent = s.explanation;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const btnInsert = document.createElement('button');
    btnInsert.textContent = '插入到终端';
    btnInsert.onclick = () => insertFn(s);

    const btnExec = document.createElement('button');
    btnExec.textContent = '执行';
    btnExec.className = 'primary';
    btnExec.onclick = () => executeFn(s);

    actions.appendChild(btnInsert);
    actions.appendChild(btnExec);

      card.appendChild(title);
      card.appendChild(cmd);
      card.appendChild(explain);

      if (Array.isArray(s.citations) && s.citations.length > 0) {
        for (const c of s.citations.slice(0, 3)) {
          const cite = document.createElement('div');
          cite.className = 'explain';
          cite.textContent = `依据：${c.title} — ${c.snippet}`;
          card.appendChild(cite);
        }
      }

      card.appendChild(actions);

    suggestionsEl.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Terminal
const term = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  convertEol: true,
  theme: {
    background: '#070a14',
    foreground: '#e7eaf3',
  },
});

const termContainer = document.getElementById('terminal');
term.open(termContainer);

// Auto-fit terminal to container so wrapping works correctly.
let fitAddon = null;
try {
  if (typeof FitAddon !== 'undefined' && FitAddon && FitAddon.FitAddon) {
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    fitAddon.fit();
    window.addEventListener('resize', () => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });
  }
} catch {
  // ignore
}

let currentLine = '';
const PROMPT = '> ';

let isExecuting = false;

const history = [];
let historyIndex = 0;

function redrawPromptLine(nextLine) {
  const s = String(nextLine || '');
  currentLine = s;
  term.write('\x1b[2K\r');
  term.write(`${PROMPT}${s}`);
}

function pushHistory(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return;
  const last = history.length ? history[history.length - 1] : '';
  if (last !== c) history.push(c);
  historyIndex = history.length;
}

function historyUp() {
  if (!history.length) return;
  if (historyIndex > 0) historyIndex -= 1;
  redrawPromptLine(history[historyIndex] || '');
}

function historyDown() {
  if (!history.length) return;
  if (historyIndex < history.length) historyIndex += 1;
  const v = historyIndex >= history.length ? '' : (history[historyIndex] || '');
  redrawPromptLine(v);
}

function prompt() {
  term.write(`\r\n${PROMPT}`);
  currentLine = '';
}
function writeError(msg) {
  term.write(`\r\n\x1b[31m${msg}\x1b[0m`);
}

function writeInfo(msg) {
  term.write(`\r\n\x1b[36m${msg}\x1b[0m`);
}

function writeInfoAbovePrompt(msg) {
  // Print an info line above the current prompt, without leaving the cursor after the info.
  const typed = currentLine;
  term.write('\x1b[2K\r');
  term.write(`\x1b[36m${msg}\x1b[0m\r\n${PROMPT}${typed}`);
  currentLine = typed;
}

async function runCommand(cmd, confirmed = false) {
  try {
    statusEl.textContent = '执行中…';
    isExecuting = true;
    const execRes = await apiExecute(cmd, confirmed);

    // Best-effort sync current executor (backend returns executor name per run).
    if (execRes && execRes.executor) {
      currentExecutorMode = String(execRes.executor);
      if (executorSwitchEl) {
        for (const b of Array.from(executorSwitchEl.querySelectorAll('button[data-exec]'))) {
          const m = String(b.getAttribute('data-exec') || '');
          b.classList.toggle('is-active', m === currentExecutorMode);
        }
      }
    }

    // Append a new timeline round immediately after execution.
    appendRound({
      ts: Date.now(),
      command: cmd,
      executor: execRes && execRes.executor ? String(execRes.executor) : '',
      exit_code: typeof execRes.exit_code === 'number' ? execRes.exit_code : null,
      stdout: execRes.stdout || '',
      stderr: execRes.stderr || '',
      verify_steps: extractVerificationSteps(execRes.steps, cmd),
      plan: (() => {
        try {
          const m = (lastSuggestionsCache || []).find((x) => x && x.command === cmd);
          return m ? { id: m.id, title: m.title } : null;
        } catch {
          return null;
        }
      })(),
    });

    const lastStep = Array.isArray(execRes.steps) && execRes.steps.length > 0 ? execRes.steps[execRes.steps.length - 1] : null;
    const lastDetail = lastStep && lastStep.detail ? String(lastStep.detail) : '';

    if (execRes.stderr === 'confirmation_required' && !confirmed) {
      const reason = findLastPolicyDetail(execRes.steps, ['需要确认']) || lastDetail;
      if (MODE.get() !== 'assist') {
        writeInfo('该命令需要二次确认；切换到「建议+执行」模式后可继续。');
        if (reason) writeInfo(`原因：${reason}`);
        setStatusReady();
        return;
      }
      const ok = confirm(`该命令需要二次确认：\n\n${cmd}\n\n原因：${reason || '潜在影响较大'}\n\n确认执行？`);
      if (ok) {
        await runCommand(cmd, true);
      }
      return;
    }
    if (execRes.stderr === 'blocked_by_policy') {
      const reason = findLastPolicyDetail(execRes.steps, ['安全拦截']) || lastDetail;
      writeError('该命令被安全策略拦截（block）。');
      if (reason) writeError(`原因：${reason}`);
      setStatusReady();
      return;
    }
    const MAX_TERM_CHARS = 8000;
    if (execRes.stdout) {
      const out = String(execRes.stdout);
      const shown = out.length > MAX_TERM_CHARS ? (out.slice(0, MAX_TERM_CHARS) + '\n…（输出过长已截断，完整内容在右侧时间线可下载）\n') : out;
      term.write(`\r\n${shown.replaceAll('\n', '\r\n')}`);
    }
    if (execRes.stderr) {
      const err = String(execRes.stderr);
      const shown = err.length > MAX_TERM_CHARS ? (err.slice(0, MAX_TERM_CHARS) + '\n…（stderr 过长已截断，完整内容在右侧时间线可下载）\n') : err;
      term.write(`\r\n\x1b[31m${shown.replaceAll('\n', '\r\n')}\x1b[0m`);
    }

    const sug = await apiSuggest({
      command: cmd,
      exit_code: execRes.exit_code,
      stdout: execRes.stdout,
      stderr: execRes.stderr,
    });

    // Update the last round with any verify step appended after suggest (planned steps are not verification).
    updateLastRound({
      verify_steps: extractVerificationSteps(sug.steps, cmd),
    });

    renderSuggestions(
      sug.suggestions,
      (s) => {
        if (s.command === '(auto)') return;
        term.write(s.command);
        currentLine += s.command;
      },
      async (s) => {
        if (MODE.get() !== 'assist') {
          writeInfo('当前为「只建议」模式，切换到「建议+执行」即可一键执行。');
          return;
        }
        if (s.risk_level === 'block') {
          writeError('该命令被安全策略拦截（block）。');
          return;
        }
        if (s.requires_confirmation) {
          const ok = confirm(`该操作风险等级为 warn：\n\n${s.command}\n\n确认执行？`);
          if (!ok) return;
          await runCommand(s.command, true);
          return;
        }
        await runCommand(s.command, false);
      }
    );

    setStatusReady();
  } catch (e) {
    statusEl.textContent = '错误';
    writeError(String(e.message || e));
  } finally {
    isExecuting = false;
    prompt();
  }
}

term.write('Terminal Copilot (MVP)');
prompt();

// Try restore timeline for current session (local dev refresh behavior)
loadTimeline();
renderTimeline();

(async () => {
  try {
    const st = await apiLlmStatus();
    const on = st.enabled ? 'ON' : 'OFF';
    const token = st.has_token ? '已配置' : '未配置';
    writeInfoAbovePrompt(`LLM(${st.provider})=${on}，Token=${token}，Model=${st.model}`);
  } catch (e) {
    // ignore
  }
})();

function openLlmModal() {
  if (!llmModal) return;
  llmModal.classList.remove('hidden');
  llmModal.setAttribute('aria-hidden', 'false');
  if (llmModalHint) llmModalHint.textContent = '';
  if (llmTokenInput) {
    // Keep previously entered token to avoid forcing users to re-paste.
    // Note: this only persists for the current page session.
    llmTokenInput.value = cachedLlmToken;
    llmTokenInput.focus();
  }
  (async () => {
    try {
      const st = await apiLlmStatus();
      if (llmModelInput) llmModelInput.value = st.model || '';
      syncLlmModelPicker();

      // If backend has token but we don't have it cached, hint the user.
      if (llmModalHint && st.has_token && !cachedLlmToken) {
        llmModalHint.textContent = '后端已配置 Token（出于安全前端不读取明文）；如需修改请重新粘贴。';
      }
    } catch (e) {
      // ignore
    }
  })();
}

function setDropdownOpen(open) {
  if (!llmModelDropdownBtn || !llmModelDropdownMenu) return;
  if (open) {
    llmModelDropdownMenu.classList.remove('hidden');
    llmModelDropdownBtn.setAttribute('aria-expanded', 'true');
  } else {
    llmModelDropdownMenu.classList.add('hidden');
    llmModelDropdownBtn.setAttribute('aria-expanded', 'false');
  }
}

function getPresetModelItems() {
  if (!llmModelDropdownMenu) return [];
  return Array.from(llmModelDropdownMenu.querySelectorAll('[data-value]'));
}

function syncLlmModelPicker() {
  if (!llmModelInput) return;
  const model = String(llmModelInput.value || '').trim();
  const items = getPresetModelItems();
  let matched = null;
  for (const it of items) {
    const v = String(it.getAttribute('data-value') || '').trim();
    const isActive = v && v === model;
    it.classList.toggle('active', isActive);
    if (isActive) matched = it;
  }
  if (llmModelDropdownBtn) {
    if (matched) {
      llmModelDropdownBtn.textContent = `已选：${matched.textContent}`;
    } else {
      llmModelDropdownBtn.textContent = '常用模型（点击选择后自动填入）…';
    }
  }
}

function closeLlmModal() {
  if (!llmModal) return;
  setDropdownOpen(false);
  llmModal.classList.add('hidden');
  llmModal.setAttribute('aria-hidden', 'true');
}

async function saveLlmTokenFromModal() {
  const token = llmTokenInput ? String(llmTokenInput.value || '').trim() : '';
  const model = llmModelInput ? String(llmModelInput.value || '').trim() : '';
  if (!token && !model) {
    if (llmModalHint) llmModalHint.textContent = '请至少填写 Token 或 模型ID。';
    return;
  }
  try {
    statusEl.textContent = '保存 Token…';
    // Prefer config endpoint (supports token + model). Fallback to token-only for compatibility.
    if (token || model) {
      await apiSetLlmConfig(token || null, model || null);
    } else {
      await apiSetLlmToken(token);
    }

    // Update client-side cache (and sessionStorage) after a successful save.
    cachedLlmToken = token;
    try {
      if (cachedLlmToken) sessionStorage.setItem(LLM_TOKEN_STORAGE_KEY, cachedLlmToken);
      else sessionStorage.removeItem(LLM_TOKEN_STORAGE_KEY);
    } catch {
      // ignore storage failures
    }

    const st = await apiLlmStatus();
    writeInfo(`Token 已保存。LLM=${st.enabled ? 'ON' : 'OFF'}，Model=${st.model}`);
    setStatusReady();
    closeLlmModal();
  } catch (e) {
    statusEl.textContent = '错误';
    const msg = String(e.message || e);
    if (llmModalHint) llmModalHint.textContent = msg;
    writeError(msg);
  } finally {
    prompt();
  }
}

async function testLlmFromModal() {
  const token = llmTokenInput ? String(llmTokenInput.value || '').trim() : '';
  const model = llmModelInput ? String(llmModelInput.value || '').trim() : '';
  try {
    if (llmModalHint) llmModalHint.textContent = '测试中…';
    if (llmTestBtn) llmTestBtn.disabled = true;
    const res = await apiLlmTest(token || null, model || null);
    const label = `${res.provider} / ${res.model} / ${res.latency_ms}ms`;
    if (res.ok) {
      if (llmModalHint) llmModalHint.textContent = `成功：${label}${res.preview ? `（${res.preview}）` : ''}`;
    } else {
      if (llmModalHint) llmModalHint.textContent = `失败：${label}：${res.message}`;
    }
  } catch (e) {
    const msg = String(e.message || e);
    if (llmModalHint) llmModalHint.textContent = `失败：${msg}`;
  } finally {
    if (llmTestBtn) llmTestBtn.disabled = false;
  }
}

if (llmBtn) {
  llmBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    writeInfo('打开 LLM 设置…');
    openLlmModal();
  });
}

if (llmCloseBtn) {
  llmCloseBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeLlmModal();
    prompt();
  });
}

if (llmSaveBtn) {
  llmSaveBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    saveLlmTokenFromModal();
  });
}

if (llmTestBtn) {
  llmTestBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    testLlmFromModal();
  });
}

if (llmModal) {
  llmModal.addEventListener('click', (ev) => {
    // click outside closes
    if (ev.target === llmModal || (ev.target && ev.target.classList && ev.target.classList.contains('modal-backdrop'))) {
      setDropdownOpen(false);
      closeLlmModal();
      prompt();
    }
  });
  const card = llmModal.querySelector('.modal-card');
  if (card) {
    card.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });
  }
}

if (llmTokenInput) {
  llmTokenInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      saveLlmTokenFromModal();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      closeLlmModal();
      prompt();
    }
  });
}

if (llmModelInput) {
  llmModelInput.addEventListener('input', () => {
    syncLlmModelPicker();
  });
  llmModelInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      saveLlmTokenFromModal();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      setDropdownOpen(false);
      closeLlmModal();
      prompt();
    }
  });
}

if (llmModelDropdownBtn) {
  llmModelDropdownBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const isOpen = llmModelDropdownMenu && !llmModelDropdownMenu.classList.contains('hidden');
    setDropdownOpen(!isOpen);
    syncLlmModelPicker();
  });
}

if (llmModelDropdownMenu) {
  llmModelDropdownMenu.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.target && ev.target.closest ? ev.target.closest('[data-value]') : null;
    if (!target) return;
    const v = String(target.getAttribute('data-value') || '').trim();
    if (v && llmModelInput) llmModelInput.value = v;
    syncLlmModelPicker();
    setDropdownOpen(false);
  });
}

// Click outside the dropdown closes it (but keeps modal open)
document.addEventListener('click', (ev) => {
  if (!llmModelDropdownMenu || !llmModelDropdownBtn || !llmModelDropdown) return;
  if (llmModelDropdownMenu.classList.contains('hidden')) return;
  const t = ev.target;
  if (llmModelDropdown.contains(t)) return;
  setDropdownOpen(false);
});

term.onData(async (data) => {
  // Ctrl+C
  if (data === '\x03') {
    if (isExecuting) {
      writeInfoAbovePrompt('^C 中断中…');
      try {
        const res = await apiInterrupt();
        if (res && res.ok) writeInfoAbovePrompt('已发送中断信号。');
        else writeInfoAbovePrompt('当前无可中断的运行任务。');
      } catch (e) {
        writeError(String(e.message || e));
      }
      return;
    }
    term.write('^C');
    prompt();
    return;
  }

  // 执行中：锁定输入（只允许 Ctrl+C）
  if (isExecuting) {
    return;
  }

  // Arrow keys (history)
  if (data === '\x1b[A') {
    historyUp();
    return;
  }
  if (data === '\x1b[B') {
    historyDown();
    return;
  }

  // Enter
  if (data === '\r') {
    const cmd = currentLine.trim();
    if (!cmd) {
      prompt();
      return;
    }
    if (cmd.startsWith('?')) {
      await runSuggestOnly(cmd.slice(1).trim());
      return;
    }
    pushHistory(cmd);
    await runCommand(cmd);
    return;
  }

  // Backspace
  if (data === '\u007f') {
    if (currentLine.length > 0) {
      currentLine = currentLine.slice(0, -1);
      term.write('\b \b');
    }
    return;
  }

  // Tab: accept top hint
  if (data === '\t') {
    const text = hintEl.textContent || '';
    const m = text.match(/^Tab 接受：(.+)$/);
    if (m && m[1]) {
      const toInsert = m[1];
      term.write(toInsert);
      currentLine += toInsert;
    }
    return;
  }

  // Printable
  if (data >= ' ' && data !== '\x7f') {
    currentLine += data;
    term.write(data);
  }
});

if (executorSwitchEl) {
  executorSwitchEl.addEventListener('click', async (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-exec]') : null;
    if (!btn) return;
    if (btn.disabled) return;
    const nextMode = String(btn.getAttribute('data-exec') || '').trim();
    if (!nextMode) return;
    if (nextMode === currentExecutorMode) return;

    if (nextMode === 'local') {
      const ok = confirm('切换到 local 会在宿主机上真实执行命令（有风险）。确认切换？');
      if (!ok) return;
    }

    try {
      statusEl.textContent = `切换 executor=${nextMode}…`;
      await apiSetExecutorMode(nextMode);
      await refreshExecutorStatus({ updateReadyText: true });
      writeInfoAbovePrompt(`执行器已切换：${nextMode}`);
    } catch (e) {
      statusEl.textContent = '错误';
      writeError(String(e.message || e));
      await refreshExecutorStatus({ updateReadyText: false });
    } finally {
      prompt();
    }
  });
}

(async () => {
  try {
    const h = await apiHealth();

    // Hosted Spaces: avoid persisting token/session across refresh by default.
    // Backend returns persist_client_state as "1" or "0".
    const persist = String(h.persist_client_state || '1') === '1';
    if (!persist) {
      await resetClientState({ clearToken: true, newSession: true });
      writeInfoAbovePrompt('已重置：刷新不会保留 Token/历史（创空间默认）');
    }

    const st = await refreshExecutorStatus({ updateReadyText: false });
    const m = st ? (st.mode || st.current_mode) : '';
    if (m) {
      currentExecutorMode = String(m);
      setStatusReady();
      return;
    }
    if (h && h.executor) currentExecutorMode = String(h.executor);
    setStatusReady();
  } catch {
    statusEl.textContent = '后端未连接';
  }
})();

if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    try {
      const ok = confirm('清空本地 Token/历史并创建新会话？');
      if (!ok) return;
      statusEl.textContent = '重置中…';
      await resetClientState({ clearToken: true, newSession: true });
      term.write('\r\n');
      writeInfoAbovePrompt('已创建新会话');
      setStatusReady();
    } catch (e) {
      statusEl.textContent = '错误';
      writeError(String(e.message || e));
    } finally {
      prompt();
    }
  });
}

if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    try {
      exportBtn.disabled = true;
      const ev = await apiEvents();
      const sid = getSessionId() || 'session';
      downloadJson(`terminal-copilot-${sid}.events.json`, ev);
    } catch (e) {
      alert(String(e.message || e));
    } finally {
      exportBtn.disabled = false;
    }
  });
}
