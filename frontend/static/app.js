/* global Terminal, FitAddon */

const statusEl = document.getElementById('status');
const stepsEl = document.getElementById('steps');
const suggestionsEl = document.getElementById('suggestions');
const hintEl = document.getElementById('hint');
const exportBtn = document.getElementById('export');
const resetBtn = document.getElementById('reset');
const llmBtn = document.getElementById('llm');
const llmModal = document.getElementById('llmModal');
const llmGuideEl = document.getElementById('llmGuide');
const llmGuideTextEl = document.getElementById('llmGuideText');
const llmGuideOpenBtn = document.getElementById('llmGuideOpen');
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

// cwd prompt
let currentCwd = '';

// Track what prompt prefix is currently rendered on the active input line.
// Used to compute minimal overwrite lengths without clearing the whole line (reduces flicker).
let lastRenderedPromptPrefix = '';

// pending confirmation UI (avoid browser confirm popups)
let pendingConfirmation = null;

function formatCwdForPrompt(cwd) {
  const s = String(cwd || '').trim();
  if (!s) return '';
  // Keep prompt compact; show tail when path is long.
  if (s.length <= 48) return s;
  return '…' + s.slice(-47);
}

function promptPrefix() {
  const p = formatCwdForPrompt(currentCwd);
  return p ? `${p}> ` : '> ';
}

function softRedrawPromptLine(nextLine, nextCursorPos = null) {
  try {
    const next = String(nextLine || '');
    const nextPrompt = promptPrefix();
    const pos = nextCursorPos === null ? next.length : Math.max(0, Math.min(Number(nextCursorPos) || 0, next.length));

    const oldPrompt = String(lastRenderedPromptPrefix || nextPrompt);
    const oldLine = String(currentLine || '');
    const oldTotal = oldPrompt.length + oldLine.length;
    const newTotal = nextPrompt.length + next.length;
    const pad = Math.max(0, oldTotal - newTotal);

    const back = pad + (next.length - pos);
    let out = `\r${nextPrompt}${next}`;
    if (pad > 0) out += ' '.repeat(pad);
    if (back > 0) out += `\x1b[${back}D`;
    term.write(out);

    currentLine = next;
    cursorPos = pos;
    lastRenderedPromptPrefix = nextPrompt;
  } catch {
    // Fallback to full redraw if anything goes wrong.
    const s = String(nextLine || '');
    currentLine = s;
    cursorPos = nextCursorPos === null ? s.length : Math.max(0, Math.min(Number(nextCursorPos) || 0, s.length));
    refreshPrompt();
  }
}

function refreshPrompt() {
  try {
    const line = String(currentLine || '');
    const pos = Math.max(0, Math.min(cursorPos, line.length));
    lastRenderedPromptPrefix = promptPrefix();
    term.write('\x1b[2K\r');
    term.write(`${lastRenderedPromptPrefix}${line}`);
    const back = line.length - pos;
    if (back > 0) term.write(`\x1b[${back}D`);
    cursorPos = pos;
  } catch {
    // ignore
  }
}

function clearPendingConfirmation() {
  pendingConfirmation = null;
  try {
    const old = document.getElementById('pendingConfirmCard');
    if (old) old.remove();
  } catch {
    // ignore
  }
}

function renderPendingConfirmation() {
  if (!suggestionsEl) return;
  try {
    const old = document.getElementById('pendingConfirmCard');
    if (old) old.remove();
  } catch {
    // ignore
  }
  if (!pendingConfirmation) return;

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'pendingConfirmCard';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.innerHTML = `<span>需要二次确认</span><span class="badge warn">warn</span>`;
  card.appendChild(title);

  const cmd = document.createElement('div');
  cmd.className = 'cmd';
  cmd.textContent = String(pendingConfirmation.command || '');
  card.appendChild(cmd);

  const reason = String(pendingConfirmation.reason || '').trim();
  if (reason) {
    const explain = document.createElement('div');
    explain.className = 'explain';
    explain.textContent = `原因：${reason}`;
    card.appendChild(explain);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  const btnOk = document.createElement('button');
  btnOk.className = 'primary';
  btnOk.textContent = '确认执行';
  btnOk.onclick = async () => {
    const c = pendingConfirmation ? String(pendingConfirmation.command || '') : '';
    clearPendingConfirmation();
    if (!c) return;
    await runCommand(c, true);
  };

  const btnCancel = document.createElement('button');
  btnCancel.className = 'danger';
  btnCancel.textContent = '取消';
  btnCancel.onclick = () => {
    clearPendingConfirmation();
    writeInfoAbovePrompt('已取消执行。');
  };

  actions.appendChild(btnOk);
  actions.appendChild(btnCancel);
  card.appendChild(actions);

  // Prepend to suggestions panel so it's always visible.
  try {
    suggestionsEl.prepend(card);
  } catch {
    suggestionsEl.appendChild(card);
  }
}

function setPendingConfirmation(command, reason) {
  pendingConfirmation = {
    command: String(command || ''),
    reason: String(reason || ''),
    ts: Date.now(),
  };
  renderPendingConfirmation();
}

// Timeline (infinite UI)
let timelineRounds = [];
let lastSuggestionsCache = [];

function newRoundId() {
  try {
    if (typeof crypto !== 'undefined' && crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
  statusEl.textContent = isSuggesting ? `就绪（executor=${mode}，生成建议中…）` : `就绪（executor=${mode}）`;
}

function setLlmGuideVisible(visible, text) {
  if (llmGuideEl) llmGuideEl.classList.toggle('hidden', !visible);
  if (llmGuideTextEl && text) llmGuideTextEl.textContent = String(text);
  if (llmBtn) llmBtn.classList.toggle('btn-attention', !!visible);
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

async function resetClientState({ clearToken = true, newSession = true, refreshPrompt: shouldRefreshPrompt = true } = {}) {
  // Clear timeline for the current session id *before* clearing it.
  // Otherwise we'd end up clearing only the "nosession" key.
  clearTimeline();

  clearSessionId();
  if (clearToken) clearCachedLlmToken();

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
      const s = await apiNewSession();
      if (s && typeof s.cwd === 'string') {
        currentCwd = s.cwd;
        if (shouldRefreshPrompt) refreshPrompt();
      }
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
        insertTextAtCursor(s.command);
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
  const r = Object.assign({ rid: newRoundId() }, round || {});
  timelineRounds.push(r);
  saveTimeline();
  renderTimeline();
  return r.rid;
}

function updateLastRound(patch) {
  if (!timelineRounds.length) return;
  const r = timelineRounds[timelineRounds.length - 1];
  Object.assign(r, patch || {});
  saveTimeline();
  renderTimeline();
}

function updateRoundById(rid, patch) {
  if (!rid || !timelineRounds.length) return;
  const id = String(rid);
  for (let i = timelineRounds.length - 1; i >= 0; i--) {
    const r = timelineRounds[i];
    if (r && String(r.rid || '') === id) {
      Object.assign(r, patch || {});
      saveTimeline();
      renderTimeline();
      return;
    }
  }
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
    const dur = (typeof r.total_ms === 'number' && r.total_ms >= 0) ? `  ${r.total_ms}ms` : '';
    meta.textContent = `${formatTs(r.ts)}  ${mode}${code ? '  ' + code : ''}${dur}`;

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

    // Next
    const stNext = document.createElement('div');
    stNext.className = 'stage';
    const stNextTitle = document.createElement('div');
    stNextTitle.className = 'stage-title';
    stNextTitle.textContent = '下一步';
    stNext.appendChild(stNextTitle);

    if (r.next && Array.isArray(r.next.items) && r.next.items.length > 0) {
      for (const it of r.next.items.slice(0, 3)) {
        const line = document.createElement('div');
        line.className = 'explain';
        const t = it && it.title ? String(it.title) : '';
        const c = it && it.command ? String(it.command) : '';
        line.textContent = t ? `建议：${t}${c ? '（' + c + '）' : ''}` : (c ? `建议：${c}` : '');
        stNext.appendChild(line);
      }
    } else {
      const line = document.createElement('div');
      line.className = 'explain';
      line.textContent = '（暂无下一步建议摘要）';
      stNext.appendChild(line);
    }
    wrap.appendChild(stNext);

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

  // Always show pending confirmation (if any) at top.
  if (pendingConfirmation) {
    renderPendingConfirmation();
  }

  if (!suggestions || suggestions.length === 0) {
    suggestionsEl.innerHTML = '<div class="card"><div class="explain">暂无建议（继续输入命令或触发 Demo）</div></div>';
    if (pendingConfirmation) renderPendingConfirmation();
    return;
  }

  setHint(suggestions[0].command && suggestions[0].command !== '(auto)' ? suggestions[0].command : '');

  for (const s of suggestions) {
    const cmdText = (s && typeof s.command === 'string') ? s.command : String(s.command || '');
    const tags = (s && Array.isArray(s.tags)) ? s.tags.map(String) : [];
    const isNonExecutable = !cmdText || cmdText === '(auto)' || tags.includes('error') || tags.includes('status');

    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'card-title';
    const confirmTag = s.requires_confirmation ? ' · 需确认' : '';
    const agentTag = s.agent ? ` · ${escapeHtml(s.agent)}` : '';
    title.innerHTML = `<span>${escapeHtml(s.title)}${agentTag}${confirmTag}</span><span class="badge ${badgeClass(s.risk_level)}">${escapeHtml(s.risk_level)}</span>`;

    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = cmdText;

    const explain = document.createElement('div');
    explain.className = 'explain';
    explain.textContent = s.explanation;

    function addExplainLine(label, value) {
      const v = String(value || '').trim();
      if (!v) return;
      const line = document.createElement('div');
      line.className = 'explain';
      line.textContent = `${label}：${v}`;
      card.appendChild(line);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    if (!isNonExecutable) {
      const btnInsert = document.createElement('button');
      btnInsert.textContent = '插入到终端';
      btnInsert.onclick = () => insertFn(s);

      const btnExec = document.createElement('button');
      btnExec.textContent = '执行';
      btnExec.className = 'primary';
      btnExec.onclick = () => executeFn(s);

      actions.appendChild(btnInsert);
      actions.appendChild(btnExec);
    }

      card.appendChild(title);
      card.appendChild(cmd);
      card.appendChild(explain);

      addExplainLine('Why', s.why);
      addExplainLine('Risk', s.risk);
      addExplainLine('Rollback', s.rollback);
      addExplainLine('Verify', s.verify);

      if (Array.isArray(s.citations) && s.citations.length > 0) {
        for (const c of s.citations.slice(0, 3)) {
          const cite = document.createElement('div');
          cite.className = 'explain';
          const src = c && c.source ? `（${c.source}）` : '';
          cite.textContent = `依据：${c.title}${src} — ${c.snippet}`;
          card.appendChild(cite);
        }
      }

      if (!isNonExecutable) card.appendChild(actions);

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
let cursorPos = 0;

// Cache the latest LLM status line so we can re-print it after clearing the terminal
// (e.g., when creating a new session).
let lastLlmStatusLine = '';

let isExecuting = false;

let isSuggesting = false;
let suggestToken = 0;

const history = [];
let historyIndex = 0;

function redrawPromptLine(nextLine) {
  const s = String(nextLine || '');
  softRedrawPromptLine(s, s.length);
}

function insertTextAtCursor(text) {
  const t = String(text || '');
  if (!t) return;

  // Fast path: appending at end (most common typing case) — avoid full redraw.
  if (cursorPos === currentLine.length) {
    currentLine += t;
    cursorPos += t.length;
    term.write(t);
    return;
  }

  const pos = Math.max(0, Math.min(cursorPos, currentLine.length));
  const before = currentLine.slice(0, pos);
  const after = currentLine.slice(pos);
  currentLine = before + t + after;
  cursorPos = pos + t.length;
  refreshPrompt();
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
  lastRenderedPromptPrefix = promptPrefix();
  term.write(`\r\n${lastRenderedPromptPrefix}`);
  currentLine = '';
  cursorPos = 0;
}

function clearTerminalUi() {
  // Use a strong reset (RIS) to avoid any leftover prompt/path prefix being
  // stuck on the same line as the banner after clearing.
  try {
    term.write('\x1bc');
  } catch {
    // ignore
  }
  try {
    term.reset();
  } catch {
    try {
      term.clear();
    } catch {
      // ignore
    }
  }

  term.write('Terminal Copilot (MVP)');
  if (lastLlmStatusLine) term.write(`\r\n\x1b[36m${lastLlmStatusLine}\x1b[0m`);
  currentLine = '';
  cursorPos = 0;
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
  const pos = cursorPos;
  lastRenderedPromptPrefix = promptPrefix();
  term.write('\x1b[2K\r');
  term.write(`\x1b[36m${msg}\x1b[0m\r\n${lastRenderedPromptPrefix}${typed}`);
  currentLine = typed;
  cursorPos = Math.max(0, Math.min(pos, typed.length));
  const back = typed.length - cursorPos;
  if (back > 0) term.write(`\x1b[${back}D`);
}

async function runCommand(cmd, confirmed = false) {
  let prompted = false;
  try {
    statusEl.textContent = '执行中…';
    isExecuting = true;

    // If the command wasn't typed in the terminal (e.g. clicked from suggestions),
    // echo it on the current prompt line so users can see what is being executed.
    try {
      const shown = String(currentLine || '');
      const target = String(cmd || '');
      if (target && shown !== target) {
        redrawPromptLine(target);
      }
    } catch {
      // ignore
    }

    const t0 = Date.now();
    const execRes = await apiExecute(cmd, confirmed);

    if (execRes && typeof execRes.cwd === 'string') {
      currentCwd = execRes.cwd;
      refreshPrompt();
    }

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
    const rid = appendRound({
      ts: Date.now(),
      command: cmd,
      executor: execRes && execRes.executor ? String(execRes.executor) : '',
      exit_code: typeof execRes.exit_code === 'number' ? execRes.exit_code : null,
      stdout: execRes.stdout || '',
      stderr: execRes.stderr || '',
      verify_steps: extractVerificationSteps(execRes.steps, cmd),
      exec_ms: Date.now() - t0,
      total_ms: null,
      plan: (() => {
        try {
          const m = (lastSuggestionsCache || []).find((x) => x && x.command === cmd);
          return m ? { id: m.id, title: m.title } : null;
        } catch {
          return null;
        }
      })(),
      next: { items: [] },
    });

    const lastStep = Array.isArray(execRes.steps) && execRes.steps.length > 0 ? execRes.steps[execRes.steps.length - 1] : null;
    const lastDetail = lastStep && lastStep.detail ? String(lastStep.detail) : '';

    if (execRes.stderr === 'confirmation_required' && !confirmed) {
      const reason = findLastPolicyDetail(execRes.steps, ['需要确认']) || lastDetail;
      setPendingConfirmation(cmd, reason || '潜在影响较大');
      writeInfoAbovePrompt('该命令需要二次确认：请在右侧点击「确认执行」或「取消」。');
      setStatusReady();
      prompt();
      prompted = true;
      return;
    }
    if (execRes.stderr === 'blocked_by_policy') {
      const reason = findLastPolicyDetail(execRes.steps, ['安全拦截']) || lastDetail;
      writeError('该命令被安全策略拦截（block）。');
      if (reason) writeError(`原因：${reason}`);
      setStatusReady();
      prompt();
      prompted = true;
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

    // Do NOT block the prompt on suggestions generation.
    setStatusReady();
    prompt();
    prompted = true;
    isExecuting = false;

    const token = ++suggestToken;
    isSuggesting = true;
    setStatusReady();
    void (async () => {
      try {
        const sug = await apiSuggest({
          command: cmd,
          exit_code: execRes.exit_code,
          stdout: execRes.stdout,
          stderr: execRes.stderr,
        });

        // Update the correct round even if user already ran another command.
        updateRoundById(rid, {
          verify_steps: extractVerificationSteps(sug.steps, cmd),
          total_ms: Date.now() - t0,
          next: {
            items: Array.isArray(sug.suggestions)
              ? sug.suggestions
                  .filter((x) => x && x.command && x.command !== '(auto)')
                  .slice(0, 5)
                  .map((x) => ({ title: x.title, command: x.command, agent: x.agent }))
              : [],
          },
        });

        renderSuggestions(
          sug.suggestions,
          (s) => {
            if (s.command === '(auto)') return;
            insertTextAtCursor(s.command);
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
              setPendingConfirmation(s.command, '风险等级为 warn（可能影响系统/数据），建议确认后再执行。');
              writeInfoAbovePrompt('该建议需要确认：请在右侧点击「确认执行」。');
              return;
            }
            await runCommand(s.command, false);
          }
        );
      } catch (e) {
        try {
          clearSuggestions();
          suggestionsEl.innerHTML = `<div class="card"><div class="explain">建议生成失败：${escapeHtml(String(e.message || e))}</div></div>`;
        } catch {
          // ignore
        }
      } finally {
        if (token === suggestToken) {
          isSuggesting = false;
          setStatusReady();
        }
      }
    })();
    return;
  } catch (e) {
    statusEl.textContent = '错误';
    writeError(String(e.message || e));
  } finally {
    isExecuting = false;
    if (!prompted) prompt();
  }
}

term.write('Terminal Copilot (MVP)');
prompt();

// On browser refresh, do NOT restore the previous task flow/timeline.
// Users expect a clean slate after reload.
try {
  const nav = performance && performance.getEntriesByType
    ? performance.getEntriesByType('navigation')[0]
    : null;
  const isReload = nav && nav.type === 'reload';
  if (isReload) {
    clearTimeline();
  } else {
    // Try restore timeline for current session (non-reload navigation).
    loadTimeline();
  }
} catch {
  // ignore
}
renderTimeline();

(async () => {
  try {
    // Ensure we have a session and sync cwd for prompt.
    let sid = getSessionId();
    if (!sid) {
      const s = await apiNewSession();
      if (s && typeof s.cwd === 'string') {
        currentCwd = s.cwd;
        refreshPrompt();
      }
    } else {
      // best-effort: keep existing session, but if server restarted, create a new one.
      try {
        const res = await fetch(`/api/sessions/${sid}`);
        if (res.ok) {
          const s = await res.json();
          if (s && typeof s.cwd === 'string') {
            currentCwd = s.cwd;
            refreshPrompt();
          }
        } else {
          const s = await apiNewSession();
          if (s && typeof s.cwd === 'string') {
            currentCwd = s.cwd;
            refreshPrompt();
          }
        }
      } catch {
        const s = await apiNewSession();
        if (s && typeof s.cwd === 'string') {
          currentCwd = s.cwd;
          refreshPrompt();
        }
      }
    }

    const st = await apiLlmStatus();
    const on = st.enabled ? 'ON' : 'OFF';
    const token = st.has_token ? '已配置' : '未配置';
    lastLlmStatusLine = `LLM(${st.provider})=${on}，Token=${token}，Model=${st.model}`;
    writeInfoAbovePrompt(lastLlmStatusLine);

    if (!st.has_token) {
      setLlmGuideVisible(true, '未配置 Token：请在「LLM设置」中配置 Token 以启用 AI 功能');
      writeInfoAbovePrompt('提示：请在右上角「LLM设置」中配置 Token 以启用 AI 建议功能。');
    } else {
      setLlmGuideVisible(false);
    }
  } catch (e) {
    // ignore
  }
})();

if (llmGuideOpenBtn) {
  llmGuideOpenBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openLlmModal();
  });
}

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
    if (st.has_token) setLlmGuideVisible(false);
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

  // Left/Right/Home/End
  if (data === '\x1b[D') {
    if (cursorPos > 0) {
      cursorPos -= 1;
      term.write('\x1b[D');
    }
    return;
  }
  if (data === '\x1b[C') {
    if (cursorPos < currentLine.length) {
      cursorPos += 1;
      term.write('\x1b[C');
    }
    return;
  }
  // Delete (forward delete)
  if (data === '\x1b[3~') {
    if (cursorPos < currentLine.length) {
      const before = currentLine.slice(0, cursorPos);
      const after = currentLine.slice(cursorPos + 1);
      currentLine = before + after;
      // Incremental update from cursor to end (avoid full redraw flicker).
      try {
        term.write('\x1b[s');
        term.write(after + ' ');
        term.write('\x1b[u');
      } catch {
        refreshPrompt();
      }
    }
    return;
  }
  if (data === '\x1b[H' || data === '\x1b[1~') {
    if (cursorPos > 0) term.write(`\x1b[${cursorPos}D`);
    cursorPos = 0;
    return;
  }
  if (data === '\x1b[F' || data === '\x1b[4~') {
    const delta = currentLine.length - cursorPos;
    if (delta > 0) term.write(`\x1b[${delta}C`);
    cursorPos = currentLine.length;
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
    if (cursorPos > 0 && currentLine.length > 0) {
      if (cursorPos === currentLine.length) {
        // Fast path: delete last char without full redraw.
        currentLine = currentLine.slice(0, -1);
        cursorPos -= 1;
        term.write('\b \b');
      } else {
        const before = currentLine.slice(0, cursorPos - 1);
        const after = currentLine.slice(cursorPos);
        currentLine = before + after;
        cursorPos -= 1;
        refreshPrompt();
      }
    }
    return;
  }

  // Tab: accept top hint
  if (data === '\t') {
    const text = hintEl.textContent || '';
    const m = text.match(/^Tab 接受：(.+)$/);
    if (m && m[1]) {
      const toInsert = m[1];
      insertTextAtCursor(toInsert);
    }
    return;
  }

  // Printable
  if (data >= ' ' && data !== '\x7f') {
    insertTextAtCursor(data);
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
      prompt();
      return;
    } finally {
      // writeInfoAbovePrompt already redraws the prompt; avoid adding an extra prompt line.
      refreshPrompt();
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
      const ok = confirm('创建新会话并清空当前控制台/历史？（不会清空本地 LLM Token）');
      if (!ok) return;
      statusEl.textContent = '重置中…';
      // Keep the LLM token in sessionStorage; only reset session/timeline/UI.
      await resetClientState({ clearToken: false, newSession: true, refreshPrompt: false });
      clearTerminalUi();
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
