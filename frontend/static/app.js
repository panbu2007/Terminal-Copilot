/* global Terminal, FitAddon */

const statusEl = document.getElementById('status');
const stepsEl = document.getElementById('steps');
const suggestionsEl = document.getElementById('suggestions');
const hintEl = document.getElementById('hint');
const exportBtn = document.getElementById('export');
const resetBtn = document.getElementById('reset');
const askAiBtn = document.getElementById('askAi');
const runbooksBtn = document.getElementById('runbooks');
const llmBtn = document.getElementById('llm');
const llmModal = document.getElementById('llmModal');
const llmGuideEl = document.getElementById('llmGuide');
const llmGuideTextEl = document.getElementById('llmGuideText');
const llmGuideOpenBtn = document.getElementById('llmGuideOpen');
const llmTokenInput = document.getElementById('llmTokenInput');
const llmProviderSelect = document.getElementById('llmProviderSelect');
const llmProviderDropdown = document.getElementById('llmProviderDropdown');
const llmProviderDropdownBtn = document.getElementById('llmProviderDropdownBtn');
const llmProviderDropdownMenu = document.getElementById('llmProviderDropdownMenu');
const llmBaseUrlInput = document.getElementById('llmBaseUrlInput');
const llmModelDropdown = document.getElementById('llmModelDropdown');
const llmModelDropdownBtn = document.getElementById('llmModelDropdownBtn');
const llmModelDropdownMenu = document.getElementById('llmModelDropdownMenu');
const llmModelInput = document.getElementById('llmModelInput');
const llmModalHint = document.getElementById('llmModalHint');
const llmSaveBtn = document.getElementById('llmSave');
const llmCloseBtn = document.getElementById('llmClose');
const llmTestBtn = document.getElementById('llmTest');
const terminalModeSwitchEl = document.getElementById('terminalModeSwitch');
const executorSwitchEl = document.getElementById('executorSwitch');
const sideTabTimelineEl = document.getElementById('sideTabTimeline');
const sideTabPlanEl = document.getElementById('sideTabPlan');
const sideTabAuditEl = document.getElementById('sideTabAudit');
const timelinePanelEl = document.getElementById('timelinePanel');
const planPanelEl = document.getElementById('planPanel');
const auditPanelEl = document.getElementById('auditPanel');
const planTabDotEl = document.getElementById('planTabDot');
const agentPanelEl = document.getElementById('agentPanel');
const agentStepsEl = document.getElementById('agentSteps');
const planOpBarEl = document.getElementById('planOpBar');
const planOpTitleEl = document.getElementById('planOpTitle');
const planOpCountEl = document.getElementById('planOpCount');
const planPreAuditEl = document.getElementById('planPreAudit');
const planGraphEl = document.getElementById('planGraph');
const auditContentEl = document.getElementById('auditContent');
const planBtnFitEl = document.getElementById('planBtnFit');
const planBtnApproveEl = document.getElementById('planBtnApprove');
const planBtnEditEl = document.getElementById('planBtnEdit');
const planBtnExecuteEl = document.getElementById('planBtnExecute');
const planBtnPauseEl = document.getElementById('planBtnPause');
const planBtnStopEl = document.getElementById('planBtnStop');
const nodePopoverEl = document.getElementById('nodePopover');
const nodePopoverTitleEl = document.getElementById('nodePopoverTitle');
const nodePopoverBodyEl = document.getElementById('nodePopoverBody');
const nodePopoverCloseEl = document.getElementById('nodePopoverClose');
const topbarEl = document.querySelector('.topbar');
const layoutEl = document.querySelector('.layout');
const onboardingEl = document.getElementById('onboarding');
const onboardingCloseEl = document.getElementById('onboardingClose');
const demoBtnEls = Array.from(document.querySelectorAll('.demo-btn'));
const runbookModalEl = document.getElementById('runbookModal');
const runbookCloseEl = document.getElementById('runbookClose');
const runbookSaveEl = document.getElementById('runbookSave');
const runbookRefreshEl = document.getElementById('runbookRefresh');
const runbookFileInputEl = document.getElementById('runbookFileInput');
const runbookFileNameEl = document.getElementById('runbookFileName');
const runbookContentInputEl = document.getElementById('runbookContentInput');
const runbookListEl = document.getElementById('runbookList');

let currentExecutorMode = '';
let ptySupported = false;
let terminalMode = 'plan';
let ptyWebSocket = null;
let termDataDisposable = null;
let termResizeDisposable = null;
const ptyControlRequests = new Map();
let ptyControlSeq = 0;

// cwd prompt
let currentCwd = '';
let demoLocalRoot = '';
let demoWorkspaceAvailable = false;

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
  return '...' + s.slice(-47);
}

function promptPrefix() {
  const p = formatCwdForPrompt(currentCwd);
  return p ? `${p}> ` : '> ';
}

function softRedrawPromptLine(nextLine, nextCursorPos = null) {
  if (terminalMode === 'pty') return;
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
  if (terminalMode === 'pty') return;
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
    await dispatchTerminalCommand(c, true);
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

const DEMO_INTENTS = {
  health: '对这台服务器做一次全面健康巡检：检查磁盘空间、内存使用、CPU 负载、异常进程，有问题就修复，最后生成巡检报告。',
  deploy: '刚部署了一个服务，帮我验证它是否正常运行：检查进程是否存活、端口是否监听、健康接口是否响应、依赖是否完整。',
  port: 'demo port replan 18080: simulate occupancy on demo port 18080, do a first pass, and auto-extend follow-up steps if the port is still busy.',
};

function joinDemoPath(base, child) {
  const root = String(base || '').trim().replace(/[\\/]+$/, '');
  if (!root) return '';
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root}${sep}${child}`;
}

function quoteCdPath(target) {
  return `"${String(target || '').replace(/"/g, '\\"')}"`;
}

function getDemoTargetCwd(key) {
  if (!demoLocalRoot) return '';
  if (key === 'deploy' && demoWorkspaceAvailable) return joinDemoPath(demoLocalRoot, 'workspace');
  if (key === 'health' || key === 'port') return demoLocalRoot;
  return '';
}

async function ensureDemoContext(key) {
  const target = getDemoTargetCwd(key);
  if (!target || String(currentCwd || '') === target) return;
  const execRes = await apiExecute(`cd ${quoteCdPath(target)}`, false);
  if (execRes && typeof execRes.cwd === 'string' && execRes.cwd) {
    currentCwd = execRes.cwd;
    refreshPrompt();
  }
}

const AGENT_META = [
  { key: 'orchestrator', label: 'Orchestrator', icon: '◎' },
  { key: 'diag', label: 'DiagAgent', icon: '◌' },
  { key: 'rag', label: 'RAGAgent', icon: '◈' },
  { key: 'safety', label: 'SafetyAgent', icon: '◍' },
  { key: 'executor', label: 'ExecutorAgent', icon: '▶' },
];

const agentState = {};
let currentPlan = null;
let currentPlanIntent = '';
let currentAuditReport = null;
let currentSuggestStream = null;
let currentPlanStream = null;
let currentPlanAutoRunLevel = 'none';
let latestRunbookItems = [];
let currentPlanNodeOutputs = {};
let currentPlanNodeStatuses = {};
let currentPopoverNodeId = '';
let pendingPlanApprovals = new Set();
let planExecutionRoundId = '';
let planExecutionStartedAt = 0;

function initAgentState() {
  for (const item of AGENT_META) {
    agentState[item.key] = { status: 'waiting', message: '等待任务...' };
  }
}

function normalizeAgentStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'start' || s === 'running') return 'running';
  if (s === 'done' || s === 'completed' || s === 'ok') return 'done';
  if (s === 'error' || s === 'failed') return 'error';
  return 'waiting';
}

function renderAgentPanel() {
  if (!agentStepsEl) return;
  agentStepsEl.innerHTML = '';
  for (const item of AGENT_META) {
    const st = agentState[item.key] || { status: 'waiting', message: '等待任务...' };
    const row = document.createElement('div');
    row.className = `agent-step ${st.status === 'running' ? 'active' : ''} ${st.status === 'done' ? 'done' : ''} ${st.status === 'error' ? 'error' : ''}`;
    row.innerHTML = `
      <div class="agent-step-top">
        <span class="agent-step-icon">${item.icon}</span>
        <span class="agent-step-label">${item.label}</span>
        <span class="agent-step-status">${escapeHtml(st.status)}</span>
      </div>
      <div class="agent-progress-track"><div class="agent-progress-fill" style="width:${st.status === 'done' ? '100' : st.status === 'running' ? '72' : st.status === 'error' ? '100' : '16'}%"></div></div>
      <div class="agent-step-msg">${escapeHtml(st.message || '等待任务...')}</div>
    `;
    agentStepsEl.appendChild(row);
  }
}

function resetAgentPanel(message = '等待任务...') {
  for (const item of AGENT_META) {
    agentState[item.key] = { status: 'waiting', message };
  }
  renderAgentPanel();
}

function updateAgentProgress(agent, status, message) {
  const key = String(agent || '').trim().toLowerCase();
  if (!agentState[key]) {
    agentState[key] = { status: normalizeAgentStatus(status), message: String(message || '') };
  } else {
    agentState[key].status = normalizeAgentStatus(status);
    agentState[key].message = String(message || agentState[key].message || '');
  }
  renderAgentPanel();
}

function switchSidePanel(name) {
  const tabMap = {
    timeline: [sideTabTimelineEl, timelinePanelEl],
    plan: [sideTabPlanEl, planPanelEl],
    audit: [sideTabAuditEl, auditPanelEl],
  };
  for (const [key, pair] of Object.entries(tabMap)) {
    const [tab, panel] = pair;
    if (tab) tab.classList.toggle('is-active', key === name);
    if (panel) panel.classList.toggle('active', key === name);
  }
  if (name === 'plan' && planTabDotEl) planTabDotEl.classList.add('hidden');
  if (name === 'plan' && currentPlan) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        planRenderer.fit();
      });
    });
  }
}

let _rafLayoutPending = false;

function refreshResponsiveLayout() {
  if (_rafLayoutPending) return;
  _rafLayoutPending = true;
  requestAnimationFrame(() => {
    _rafLayoutPending = false;
    try {
      if (fitAddon) fitAddon.fit();
    } catch {
      // ignore
    }

    try {
      if (currentPlan) planRenderer.fit();
    } catch {
      // ignore
    }

    try {
      if (
        nodePopoverEl &&
        !nodePopoverEl.classList.contains('hidden') &&
        currentPopoverNodeId &&
        currentPlan &&
        Array.isArray(currentPlan.nodes)
      ) {
        const node = currentPlan.nodes.find((item) => item && item.id === currentPopoverNodeId);
        if (node) openNodePopover(node, null, pendingPlanApprovals.has(node.id));
      }
    } catch {
      // ignore
    }
  });
}

function setPlanUnread(hasUnread) {
  if (!planTabDotEl) return;
  planTabDotEl.classList.toggle('hidden', !hasUnread);
}

function isApprovalNode(node) {
  return !!(node && (node.type === 'human' || node.risk_level === 'warn' || node.risk_level === 'block'));
}

function normalizeTerminalText(text) {
  return String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function writePlanTerminalLine(text, color = '') {
  const msg = normalizeTerminalText(text);
  if (!msg) return;
  const body = msg.replaceAll('\n', '\r\n');
  if (color) {
    term.write(`\r\n${color}${body}\x1b[0m`);
    return;
  }
  term.write(`\r\n${body}`);
}

function writePlanNodeStartToTerminal(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return;
  writePlanTerminalLine(`[PLAN] $ ${cmd}`, '\x1b[35m');
}

function writePlanNodeStdoutToTerminal(chunk) {
  const out = normalizeTerminalText(chunk);
  if (!out) return;
  term.write(`\r\n${out.replaceAll('\n', '\r\n')}`);
}

function writePlanNodeDoneToTerminal(payload) {
  if (!payload) return;
  const stderr = normalizeTerminalText(payload.stderr || '');
  if (stderr) {
    term.write(`\r\n\x1b[31m${stderr.replaceAll('\n', '\r\n')}\x1b[0m`);
  }
  const status = String(payload.status || '').trim() || 'passed';
  const exitCode = payload.exit_code;
  if (status === 'failed' || stderr || typeof exitCode === 'number') {
    const summary = `[PLAN] ${status}${typeof exitCode === 'number' ? ` (exit=${exitCode})` : ''}`;
    writePlanTerminalLine(summary, status === 'failed' ? '\x1b[31m' : '\x1b[36m');
  }
}

function echoIntentToTerminal(intent) {
  const text = String(intent || '').trim();
  if (!text) return;
  if (terminalMode === 'pty') {
    writePlanTerminalLine(`[INTENT] ${text}`, '\x1b[36m');
    return;
  }
  redrawPromptLine(text);
  term.write('\r\n');
  currentLine = '';
  cursorPos = 0;
}

function trackPlanNodeStart(nodeId, command) {
  if (!planExecutionRoundId) {
    planExecutionStartedAt = Date.now();
    planExecutionRoundId = appendRound({
      ts: planExecutionStartedAt,
      command: currentPlanIntent || 'Execution Plan',
      executor: 'plan',
      exit_code: null,
      stdout: '',
      stderr: '',
      verify_steps: [],
      total_ms: null,
      plan: { id: currentPlan && currentPlan.id ? currentPlan.id : '', title: currentPlanIntent || 'Execution Plan' },
      next: { items: [] },
    });
  }
  const existing = timelineRounds.find((item) => item && String(item.rid || '') === planExecutionRoundId);
  const prevStdout = existing ? String(existing.stdout || '') : '';
  updateRoundById(planExecutionRoundId, {
    command: currentPlanIntent || 'Execution Plan',
    stdout: `${prevStdout}${String(command || '').trim() ? `[PLAN] $ ${String(command || '').trim()}\n` : ''}`,
  });
  void nodeId;
}

function appendPlanRoundOutput(chunk, field = 'stdout') {
  if (!planExecutionRoundId) return;
  const id = String(field || 'stdout') === 'stderr' ? 'stderr' : 'stdout';
  const normalized = normalizeTerminalText(chunk);
  if (!normalized) return;
  const existing = timelineRounds.find((item) => item && String(item.rid || '') === planExecutionRoundId);
  const prev = existing ? String(existing[id] || '') : '';
  updateRoundById(planExecutionRoundId, { [id]: `${prev}${normalized}` });
}

class PlanGraphRenderer {
  constructor(container) {
    this.container = container;
    this.svg = null;
    this.viewport = null;
    this.content = null;
    this.nodeEls = new Map();
    this.edgeEls = [];
    this.plan = null;
    this.scale = 1;
    this.editMode = false;
    this.zoom = null;
    this.currentTransform = null;
    this.onNodeClick = null;
  }

  clear() {
    if (!this.container) return;
    this.container.innerHTML = '<div class="audit-empty">生成执行计划后，这里会展示可交互 DAG。</div>';
    this.svg = null;
    this.viewport = null;
    this.content = null;
    this.zoom = null;
    this.currentTransform = null;
    this.nodeEls.clear();
    this.edgeEls = [];
  }

  setEditMode(enabled) {
    this.editMode = !!enabled;
    if (!this.container) return;
    this.container.classList.toggle('is-editing', this.editMode);
  }

  nodeColors(type) {
    const key = String(type || 'command').trim();
    const map = {
      diagnose: { stroke: '#60a5fa', fill: 'rgba(96, 165, 250, 0.12)' },
      command: { stroke: '#a78bfa', fill: 'rgba(167, 139, 250, 0.12)' },
      condition: { stroke: '#fbbf24', fill: 'rgba(251, 191, 36, 0.14)' },
      verify: { stroke: '#34d399', fill: 'rgba(52, 211, 153, 0.12)' },
      rollback: { stroke: '#f87171', fill: 'rgba(248, 113, 113, 0.12)' },
      end: { stroke: '#94a3b8', fill: 'rgba(148, 163, 184, 0.12)' },
      human: { stroke: '#fb923c', fill: 'rgba(251, 146, 60, 0.14)' },
    };
    return map[key] || map.command;
  }

  render(plan, { onNodeClick } = {}) {
    this.plan = plan;
    this.onNodeClick = typeof onNodeClick === 'function' ? onNodeClick : null;
    if (!this.container) return;
    if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
      this.clear();
      return;
    }
    this.container.innerHTML = '';

    const width = Math.max(this.container.clientWidth || 320, 320);
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 74, marginx: 28, marginy: 28 });
    graph.setDefaultEdgeLabel(() => ({}));

    for (const node of plan.nodes) {
      const command = String(node.command || '').trim();
      const textWidth = Math.max(String(node.title || '').length * 8, command ? Math.min(command.length, 34) * 6 : 0, 136);
      graph.setNode(node.id, {
        width: node.type === 'condition' ? 164 : Math.min(Math.max(textWidth + 64, 196), 290),
        height: node.type === 'condition' ? 120 : node.type === 'end' ? 82 : 104,
      });
    }
    for (const edge of plan.edges || []) {
      graph.setEdge(edge.source_id, edge.target_id, { label: edge.label || edge.condition || '' });
    }
    dagre.layout(graph);

    const graphHeight = Math.max(
      360,
      ...plan.nodes.map((node) => {
        const pos = graph.node(node.id);
        return pos ? pos.y + 112 : 360;
      })
    ) + 48;

    const svg = d3.select(this.container).append('svg').attr('viewBox', `0 0 ${width} ${graphHeight}`);
    const defs = svg.append('defs');
    const goldGlow = defs.append('filter').attr('id', 'planGlow');
    goldGlow.append('feGaussianBlur').attr('stdDeviation', 6).attr('result', 'coloredBlur');
    const greenGlow = defs.append('filter').attr('id', 'planSuccessGlow');
    greenGlow.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'coloredBlur');
    defs.append('marker')
      .attr('id', 'planArrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', '#7f8aa8');

    const viewport = svg.append('g').attr('class', 'plan-viewport');
    const content = viewport.append('g').attr('class', 'plan-content');
    this.svg = svg;
    this.viewport = viewport;
    this.content = content;
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        this.currentTransform = event.transform;
        this.viewport.attr('transform', event.transform);
      });
    this.svg.call(this.zoom).on('dblclick.zoom', null);
    this.nodeEls.clear();
    this.edgeEls = [];

    for (const edge of plan.edges || []) {
      const from = graph.node(edge.source_id);
      const to = graph.node(edge.target_id);
      if (!from || !to) continue;
      const group = content.append('g').attr('class', 'plan-edge-group');
      const points = graph.edge(edge.source_id, edge.target_id).points || [
        { x: from.x + from.width / 2, y: from.y },
        { x: to.x - to.width / 2, y: to.y },
      ];
      const line = d3.line().x((d) => d.x).y((d) => d.y).curve(d3.curveBasis);
      const path = group.append('path')
        .attr('class', `plan-edge ${edge.condition === 'failure' ? 'edge-failure' : edge.condition === 'always' ? 'edge-always' : 'edge-success'}`)
        .attr('d', line(points))
        .attr('marker-end', 'url(#planArrow)');
      if (edge.label || edge.condition) {
        const mid = points[Math.floor(points.length / 2)];
        group.append('rect')
          .attr('class', 'plan-edge-chip')
          .attr('x', mid.x - 20)
          .attr('y', mid.y - 20)
          .attr('width', 40)
          .attr('height', 16)
          .attr('rx', 8);
        group.append('text')
          .attr('class', 'plan-edge-label')
          .attr('x', mid.x)
          .attr('y', mid.y - 9)
          .attr('text-anchor', 'middle')
          .text(edge.label || edge.condition);
      }
      this.edgeEls.push({ source: edge.source_id, target: edge.target_id, condition: edge.condition || 'success', path, el: group });
    }

    for (const node of plan.nodes) {
      const layoutNode = graph.node(node.id);
      if (!layoutNode) continue;
      const group = content
        .append('g')
        .attr('class', `plan-node node-type-${node.type} status-pending`)
        .attr('transform', `translate(${layoutNode.x - layoutNode.width / 2}, ${layoutNode.y - layoutNode.height / 2})`)
        .on('mousedown', (event) => {
          event.stopPropagation();
        })
        .on('click', (event) => {
          event.stopPropagation();
          if (this.onNodeClick) this.onNodeClick(node, event.currentTarget);
        });

      const w = layoutNode.width;
      const h = layoutNode.height;
      const palette = this.nodeColors(node.type);
      group.append('rect').attr('class', `risk-bar risk-${node.risk_level || 'safe'}`).attr('x', 0).attr('y', 0).attr('width', 6).attr('height', h).attr('rx', 6);
      if (node.type === 'condition') {
        group.append('polygon')
          .attr('class', 'node-bg')
          .attr('points', `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`)
          .attr('stroke', palette.stroke)
          .attr('fill', palette.fill);
      } else if (node.type === 'end') {
        group.append('rect')
          .attr('class', 'node-bg')
          .attr('x', 0)
          .attr('y', 0)
          .attr('rx', 26)
          .attr('ry', 26)
          .attr('width', w)
          .attr('height', h)
          .attr('stroke', palette.stroke)
          .attr('fill', palette.fill);
      } else {
        group.append('rect')
          .attr('class', 'node-bg')
          .attr('x', 0)
          .attr('y', 0)
          .attr('rx', 18)
          .attr('ry', 18)
          .attr('width', w)
          .attr('height', h)
          .attr('stroke', palette.stroke)
          .attr('fill', palette.fill);
      }
      const iconWrap = group.append('g').attr('class', 'node-icon-wrap');
      iconWrap.append('circle').attr('class', 'node-icon-bg').attr('cx', 24).attr('cy', 24).attr('r', 12);
      iconWrap.append('text').attr('class', 'node-icon').attr('x', 24).attr('y', 28).attr('text-anchor', 'middle').attr('fill', '#f8fafc').text(this.typeIcon(node.type));
      group.append('text').attr('class', 'node-title').attr('x', 44).attr('y', 28).attr('fill', '#f8fafc').text(this.truncate(node.title || node.id, node.type === 'condition' ? 18 : 26));
      if (node.type !== 'condition') {
        group.append('text').attr('class', 'node-command').attr('x', 18).attr('y', 52).attr('fill', '#dee6f9').text(this.truncate(node.command || node.description || node.type, 34));
      } else {
        group.append('text').attr('class', 'node-command is-center').attr('x', w / 2).attr('y', 68).attr('text-anchor', 'middle').attr('fill', '#ffecb3').text(this.truncate(node.description || node.command || 'Condition', 18));
      }
      group.append('rect').attr('class', `node-pill pill-risk-${node.risk_level || 'safe'}`).attr('x', 16).attr('y', h - 28).attr('width', 52).attr('height', 16).attr('rx', 8);
      group.append('text').attr('class', `node-pill-text`).attr('x', 42).attr('y', h - 16).attr('text-anchor', 'middle').attr('fill', '#d9e2f5').text((node.risk_level || 'safe').toUpperCase());
      const groundedLabel = node.grounded ? 'Grounded' : 'Unverified';
      const groundedWidth = node.grounded ? 74 : 84;
      group.append('rect').attr('class', `node-pill ${node.grounded ? 'pill-grounded-true' : 'pill-grounded-false'}`).attr('x', w - groundedWidth - 16).attr('y', h - 28).attr('width', groundedWidth).attr('height', 16).attr('rx', 8);
      group.append('text').attr('class', 'node-pill-text grounded').attr('x', w - 16 - groundedWidth / 2).attr('y', h - 16).attr('text-anchor', 'middle').attr('fill', '#d9e2f5').text(groundedLabel);
      group.append('text').attr('class', 'badge-icon').attr('x', w - 18).attr('y', 28).attr('text-anchor', 'end').attr('fill', '#f8fafc').text('○');
      this.nodeEls.set(node.id, group);
    }
    requestAnimationFrame(() => this.fit());
  }

  typeIcon(type) {
    const map = {
      diagnose: '◉',
      command: '⌘',
      condition: '?',
      verify: '✓',
      rollback: '↺',
      human: '◎',
      end: '◆',
    };
    return map[type] || '•';
  }

  truncate(text, max) {
    const value = String(text || '');
    let width = 0;
    let result = '';
    for (const char of value) {
      // CJK and full-width characters count as 2 units
      const w = /[\u1100-\u115f\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1;
      if (width + w > max) { result += '…'; break; }
      result += char;
      width += w;
    }
    return result;
  }

  fit() {
    if (!this.svg || !this.viewport || !this.content || !this.container) return;
    const contentNode = this.content.node();
    if (!contentNode) return;
    const bounds = contentNode.getBBox();
    if (!bounds || !bounds.width || !bounds.height) return;
    const width = Math.max(this.container.clientWidth || 320, 320);
    const height = Math.max(this.container.clientHeight || 320, 320);
    if (width <= 0 || height <= 0) return;
    const scale = Math.min(width / (bounds.width + 48), height / (bounds.height + 48));
    const offsetX = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const offsetY = (height - bounds.height * scale) / 2 - bounds.y * scale;
    this.scale = scale;
    const transform = d3.zoomIdentity.translate(offsetX, offsetY).scale(scale);
    this.currentTransform = transform;
    if (this.svg && this.zoom) {
      this.svg.transition().duration(220).call(this.zoom.transform, transform);
      return;
    }
    this.viewport.attr('transform', transform);
  }

  updateNodeStatus(nodeId, status) {
    const node = this.nodeEls.get(nodeId);
    if (!node) return;
    node.attr('class', (_old) => {
      const existing = String(_old || '').split(/\s+/).filter((item) => item && !item.startsWith('status-') && item !== 'shake-anim' && item !== 'blink-anim');
      const next = String(status || 'pending');
      return `${existing.join(' ')} status-${next === 'awaiting_approval' ? 'awaiting' : next} ${next === 'failed' ? 'shake-anim' : ''} ${next === 'awaiting_approval' ? 'blink-anim' : ''}`.trim();
    });
    node.select('.badge-icon').text(
      status === 'running' ? '◔'
        : status === 'passed' ? '✓'
          : status === 'failed' ? '✕'
            : status === 'skipped' ? '−'
              : status === 'awaiting_approval' ? '!'
                : '○'
    );
  }

  resetEdgeStates() {
    for (const edge of this.edgeEls) {
      if (!edge || !edge.path) continue;
      edge.path.classed('edge-active', false).classed('edge-failed', false).classed('edge-flowing', false);
    }
  }

  highlightEdgesFrom(nodeId, mode = 'active') {
    const normalized = String(mode || 'active');
    for (const edge of this.edgeEls) {
      if (!edge || !edge.path || edge.source !== nodeId) continue;
      edge.path
        .classed('edge-active', normalized === 'active')
        .classed('edge-flowing', normalized === 'active')
        .classed('edge-failed', normalized === 'failed');
    }
  }

  appendNodes(newNodes, newEdges) {
    if (!this.plan || !Array.isArray(newNodes) || !newNodes.length) return;

    const existingNodeIds = new Set((this.plan.nodes || []).map((node) => node.id));
    const existingEdgeKeys = new Set(
      (this.plan.edges || []).map((edge) => `${edge.source_id}|${edge.target_id}|${edge.condition || ''}|${edge.label || ''}`)
    );

    const appendedNodeIds = [];
    const mergedNodes = [...(this.plan.nodes || [])];
    for (const node of newNodes) {
      if (existingNodeIds.has(node.id)) continue;
      existingNodeIds.add(node.id);
      mergedNodes.push(node);
      appendedNodeIds.push(node.id);
      currentPlanNodeStatuses[node.id] = currentPlanNodeStatuses[node.id] || 'pending';
      currentPlanNodeOutputs[node.id] = currentPlanNodeOutputs[node.id] || { stdout: '', stderr: '', exit_code: null };
    }

    const mergedEdges = [...(this.plan.edges || [])];
    for (const edge of (Array.isArray(newEdges) ? newEdges : [])) {
      const key = `${edge.source_id}|${edge.target_id}|${edge.condition || ''}|${edge.label || ''}`;
      if (existingEdgeKeys.has(key)) continue;
      existingEdgeKeys.add(key);
      mergedEdges.push(edge);
    }

    if (!appendedNodeIds.length) return;

    const prevStatuses = { ...currentPlanNodeStatuses };
    this.plan.nodes = mergedNodes;
    this.plan.edges = mergedEdges;
    if (currentPlan) {
      currentPlan.nodes = mergedNodes;
      currentPlan.edges = mergedEdges;
    }

    this.render(this.plan, { onNodeClick: this.onNodeClick });

    for (const [nodeId, status] of Object.entries(prevStatuses)) {
      this.updateNodeStatus(nodeId, status);
    }
    for (const nodeId of appendedNodeIds) {
      const nodeEl = this.nodeEls.get(nodeId);
      if (!nodeEl) continue;
      nodeEl.classed('plan-node-appended', true);
      nodeEl.select('.node-bg').attr('stroke-dasharray', '6 3');
      nodeEl.select('.badge-icon').text('+');
    }

    updatePlanOpBar();
    if (currentPopoverNodeId) {
      const current = getCurrentPlanNode(currentPopoverNodeId);
      if (current) openNodePopover(current, null, currentPlanNodeStatuses[currentPopoverNodeId] === 'awaiting_approval');
    }
  }
}

class PlanStreamClient {
  constructor(planId, renderer) {
    this.planId = planId;
    this.renderer = renderer;
    this.source = null;
  }

  connect() {
    this.close();
    this.source = new EventSource(`/api/plan/${encodeURIComponent(this.planId)}/stream`);
    this.source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleEvent(payload);
      } catch {
        // ignore invalid event payloads
      }
    };
    this.source.onerror = () => {
      if (statusEl) statusEl.textContent = '计划流连接异常';
    };
  }

  handleEvent(payload) {
    if (!payload || !payload.type) return;
    if (payload.type === 'heartbeat') return;
    if (payload.type === 'replan_starting') {
      const nodeEl = this.renderer.nodeEls.get(payload.failed_node_id);
      if (nodeEl) nodeEl.select('.badge-icon').text('...');
      writePlanTerminalLine('[REPLAN] Generating follow-up steps...', '\x1b[33m');
      return;
    }
    if (payload.type === 'nodes_appended') {
      const newNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
      const newEdges = Array.isArray(payload.edges) ? payload.edges : [];
      this.renderer.appendNodes(newNodes, newEdges);
      writePlanTerminalLine(`[REPLAN] Appended ${newNodes.length} follow-up node(s).`, '\x1b[32m');
      return;
    }
    if (payload.type === 'replan_failed') {
      writePlanTerminalLine(`[REPLAN] Extension unavailable: ${payload.reason || 'no follow-up generated'}`, '\x1b[33m');
      return;
    }
    if (payload.type === 'node_start') {
      currentPlanNodeStatuses[payload.node_id] = 'running';
      trackPlanNodeStart(payload.node_id, payload.command || '');
      writePlanNodeStartToTerminal(payload.command || '');
      this.renderer.updateNodeStatus(payload.node_id, 'running');
      this.renderer.resetEdgeStates();
      this.renderer.highlightEdgesFrom(payload.node_id, 'active');
      switchSidePanel('plan');
      setPlanUnread(false);
      return;
    }
    if (payload.type === 'node_stdout') {
      appendNodeStdout(payload.node_id, payload.chunk || '');
      appendPlanRoundOutput(payload.chunk || '', 'stdout');
      writePlanNodeStdoutToTerminal(payload.chunk || '');
      if (currentPopoverNodeId === payload.node_id) {
        const node = getCurrentPlanNode(payload.node_id);
        if (node) openNodePopover(node, null, false);
      }
      return;
    }
    if (payload.type === 'node_done') {
      currentPlanNodeStatuses[payload.node_id] = payload.status || 'passed';
      mergeNodeOutput(payload.node_id, {
        stdout: payload.stdout,
        stderr: payload.stderr,
        exit_code: payload.exit_code,
      });
      appendPlanRoundOutput(payload.stderr || '', 'stderr');
      writePlanNodeDoneToTerminal(payload);
      this.renderer.updateNodeStatus(payload.node_id, payload.status || 'passed');
      this.renderer.resetEdgeStates();
      this.renderer.highlightEdgesFrom(payload.node_id, payload.status === 'failed' ? 'failed' : 'active');
      if (currentPopoverNodeId === payload.node_id) {
        const node = getCurrentPlanNode(payload.node_id);
        if (node) openNodePopover(node, null, false);
      }
      if (payload.status === 'failed') switchSidePanel('audit');
      return;
    }
    if (payload.type === 'node_skipped') {
      currentPlanNodeStatuses[payload.node_id] = 'skipped';
      this.renderer.updateNodeStatus(payload.node_id, 'skipped');
      this.renderer.resetEdgeStates();
      if (currentPopoverNodeId === payload.node_id) {
        const node = getCurrentPlanNode(payload.node_id);
        if (node) openNodePopover(node, null, false);
      }
      return;
    }
    if (payload.type === 'need_approval') {
      currentPlanNodeStatuses[payload.node_id] = 'awaiting_approval';
      this.renderer.updateNodeStatus(payload.node_id, 'awaiting_approval');
      const node = currentPlan && Array.isArray(currentPlan.nodes) ? currentPlan.nodes.find((item) => item.id === payload.node_id) : null;
      if (pendingPlanApprovals.has(payload.node_id)) {
        void apiPlanApproveNode(this.planId, payload.node_id).then(() => {
          currentPlanNodeStatuses[payload.node_id] = 'running';
          this.renderer.updateNodeStatus(payload.node_id, 'running');
        }).catch((err) => {
          writeError(String(err.message || err));
        });
        return;
      }
      if (node) openNodePopover(node, null, true);
      switchSidePanel('plan');
      return;
    }
    if (payload.type === 'audit_complete') {
      renderAuditReport(payload.report);
      switchSidePanel('audit');
      return;
    }
    if (payload.type === 'plan_done') {
      if (statusEl) statusEl.textContent = `计划执行完成: ${payload.summary || 'done'}`;
      if (planExecutionRoundId) {
        updateRoundById(planExecutionRoundId, {
          total_ms: planExecutionStartedAt > 0 ? Date.now() - planExecutionStartedAt : null,
        });
      }
      writePlanTerminalLine(`[PLAN] 执行完成: ${payload.summary || 'done'}`, '\x1b[36m');
      if (planBtnStopEl) planBtnStopEl.style.display = 'none';
      pendingPlanApprovals.clear();
      planExecutionRoundId = '';
      planExecutionStartedAt = 0;
      this.close();
    }
  }

  close() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }
}

const planRenderer = new PlanGraphRenderer(planGraphEl);

function getCurrentPlanNode(nodeId) {
  if (!currentPlan || !Array.isArray(currentPlan.nodes)) return null;
  return currentPlan.nodes.find((node) => node.id === nodeId) || null;
}

function getNodeOutputState(nodeId) {
  return currentPlanNodeOutputs[nodeId] || { stdout: '', stderr: '', exit_code: null };
}

function mergeNodeOutput(nodeId, next) {
  const prev = getNodeOutputState(nodeId);
  currentPlanNodeOutputs[nodeId] = {
    stdout: typeof next.stdout === 'string' ? next.stdout : prev.stdout,
    stderr: typeof next.stderr === 'string' ? next.stderr : prev.stderr,
    exit_code: next.exit_code === undefined ? prev.exit_code : next.exit_code,
  };
}

function appendNodeStdout(nodeId, chunk) {
  const prev = getNodeOutputState(nodeId);
  currentPlanNodeOutputs[nodeId] = {
    ...prev,
    stdout: `${prev.stdout || ''}${String(chunk || '')}`,
  };
}

function renderPreAuditCard(preAudit) {
  const existing = document.getElementById('planPreAuditCard');
  if (existing) existing.remove();
  if (!preAudit || !Array.isArray(preAudit.findings) || !preAudit.findings.length) return;

  const card = document.createElement('div');
  card.id = 'planPreAuditCard';
  card.style.marginTop = '8px';

  const severity = String(preAudit.severity || 'pass').toLowerCase();
  const severityClass = severity === 'fail' ? 'fail' : severity === 'warn' ? 'warn' : 'info';

  const header = document.createElement('div');
  header.className = 'audit-finding severity-' + severityClass;
  const headerTitle = document.createElement('div');
  headerTitle.className = 'audit-finding-header';
  headerTitle.textContent = '执行前预审 · ' + severity.toUpperCase();
  header.appendChild(headerTitle);
  const headerMsg = document.createElement('div');
  headerMsg.className = 'audit-finding-msg';
  headerMsg.textContent = String(preAudit.summary || '');
  header.appendChild(headerMsg);
  card.appendChild(header);

  let showFindings = false;
  const toggle = document.createElement('div');
  toggle.className = 'explain';
  toggle.style.cursor = 'pointer';
  toggle.style.marginTop = '4px';
  const findingsContainer = document.createElement('div');
  findingsContainer.style.display = 'none';

  const updateToggle = () => {
    toggle.textContent = (showFindings ? '▼ ' : '▶ ') + '查看 ' + preAudit.findings.length + ' 条详情';
    findingsContainer.style.display = showFindings ? '' : 'none';
  };
  updateToggle();
  toggle.onclick = () => { showFindings = !showFindings; updateToggle(); };
  card.appendChild(toggle);
  card.appendChild(findingsContainer);

  for (const f of preAudit.findings) {
    const fc = String(f.severity || 'info').toLowerCase();
    const row = document.createElement('div');
    row.className = 'audit-finding severity-' + (fc === 'fail' ? 'fail' : fc === 'warn' ? 'warn' : 'info');
    const rowTitle = document.createElement('div');
    rowTitle.className = 'audit-finding-header';
    rowTitle.textContent = String(f.title || '');
    row.appendChild(rowTitle);
    const rowMsg = document.createElement('div');
    rowMsg.className = 'audit-finding-msg';
    rowMsg.textContent = String(f.message || '');
    row.appendChild(rowMsg);
    findingsContainer.appendChild(row);
  }

  if (planGraphEl && planGraphEl.parentNode) {
    planGraphEl.parentNode.insertBefore(card, planGraphEl.nextSibling);
  }
}

function renderAuditReport(report) {
  currentAuditReport = report || null;
  if (!auditContentEl) return;
  if (!report) {
    auditContentEl.innerHTML = '<div class="audit-empty">执行计划完成后，自动审计报告将在此展示。</div>';
    return;
  }
  const overall = String(report.overall || 'PASS').toUpperCase();
  const actionableSkipped = Number(report.actionable_skipped || 0);
  const branchSkipped = Number(report.branch_skipped || 0);
  const effectiveTotal = Number(report.effective_total || report.total || 0);
  const verdictClass = overall === 'FAIL' ? 'fail' : report.failed > 0 || actionableSkipped > 0 ? 'warn' : 'pass';
  const verdictIcon = verdictClass === 'fail' ? '✕' : verdictClass === 'warn' ? '!' : '✓';
  auditContentEl.innerHTML = '';
  const verdict = document.createElement('div');
  verdict.className = `audit-verdict ${verdictClass}`;
  verdict.innerHTML = `
    <div class="audit-verdict-icon">${verdictIcon}</div>
    <div class="audit-verdict-label">${escapeHtml(overall)}</div>
    <div class="audit-verdict-stats">${report.passed || 0}/${effectiveTotal || 0} 通过 · ${report.failed || 0} 失败 · ${actionableSkipped} 跳过${branchSkipped ? ` · ${branchSkipped} 未命中分支` : ''}</div>
  `;
  auditContentEl.appendChild(verdict);

  const meta = document.createElement('div');
  meta.className = 'card';
  meta.innerHTML = `<div class="card-title"><span>Intent</span><span class="badge">${escapeHtml(report.plan_id || '')}</span></div><div class="explain">${escapeHtml(report.intent || '')}</div>`;
  auditContentEl.appendChild(meta);

  const analysis = report.analysis || null;
  if (analysis) {
    const summary = document.createElement('div');
    summary.className = `audit-finding severity-${analysis.severity === 'fail' ? 'fail' : analysis.severity === 'warn' ? 'warn' : 'info'}`;
    summary.innerHTML = `
      <div class="audit-finding-header">Safety Analysis</div>
      <div class="audit-finding-msg">${escapeHtml(String(analysis.summary || ''))}</div>
    `;
    auditContentEl.appendChild(summary);

    if (Array.isArray(analysis.findings) && analysis.findings.length) {
      const findingsTitle = document.createElement('div');
      findingsTitle.className = 'audit-section-title';
      findingsTitle.textContent = 'Findings';
      auditContentEl.appendChild(findingsTitle);
      for (const finding of analysis.findings) {
        const row = document.createElement('div');
        row.className = `audit-finding severity-${finding.severity === 'fail' ? 'fail' : finding.severity === 'warn' ? 'warn' : 'info'}`;
        row.innerHTML = `
          <div class="audit-finding-header">${escapeHtml(finding.title || 'Finding')}</div>
          <div class="audit-finding-msg">${escapeHtml(finding.message || '')}</div>
        `;
        auditContentEl.appendChild(row);
      }
    }

    if (Array.isArray(analysis.recommendations) && analysis.recommendations.length) {
      const recCard = document.createElement('div');
      recCard.className = 'card';
      recCard.innerHTML = `
        <div class="card-title"><span>Recommendations</span></div>
        <div class="explain">${analysis.recommendations.map((item) => `• ${escapeHtml(item)}`).join('<br>')}</div>
      `;
      auditContentEl.appendChild(recCard);
    }
  }

  const section = document.createElement('div');
  section.className = 'audit-section-title';
  section.textContent = 'Node Results';
  auditContentEl.appendChild(section);
  for (const node of (report.nodes || [])) {
    const row = document.createElement('div');
    row.className = 'audit-finding severity-info';
    const output = node.output || {};
    const excerpt = String(output.stderr || output.stdout || '').trim().slice(0, 180);
    const skipReason = node.skip_reason === 'unreachable'
      ? ' · 分支未命中'
      : node.skip_reason
        ? ` · 跳过原因: ${escapeHtml(String(node.skip_reason))}`
        : '';
    row.innerHTML = `
      <div class="audit-finding-header">${escapeHtml(node.title || node.node_id)} · ${escapeHtml(node.status || '')}</div>
      <div class="audit-finding-msg">类型: ${escapeHtml(node.type || 'command')} · 风险: ${escapeHtml(node.risk_level || 'safe')} · 依据: ${node.grounded ? 'grounded' : 'unverified'}${skipReason}${excerpt ? ` · 输出: ${escapeHtml(excerpt)}` : ''}</div>
    `;
    auditContentEl.appendChild(row);
  }

  const exportBar = document.createElement('div');
  exportBar.className = 'audit-export-bar';
  const btnJson = document.createElement('button');
  btnJson.className = 'audit-export-btn';
  btnJson.textContent = '导出 JSON';
  btnJson.onclick = () => downloadJson(`audit-${report.plan_id || 'report'}.json`, report);
  const btnMd = document.createElement('button');
  btnMd.className = 'audit-export-btn';
  btnMd.textContent = '导出 Markdown';
  btnMd.onclick = () => {
    const lines = [
      `# Audit Report`,
      ``,
      `- Plan ID: ${report.plan_id || ''}`,
      `- Intent: ${report.intent || ''}`,
      `- Overall: ${overall}`,
      `- Passed: ${report.passed || 0}/${effectiveTotal || 0}`,
      `- Failed: ${report.failed || 0}`,
      `- Skipped: ${actionableSkipped}`,
      ...(branchSkipped ? [`- Branch Not Taken: ${branchSkipped}`] : []),
      ``,
      ...(analysis ? [`## Analysis`, ``, `- Severity: ${analysis.severity || ''}`, `- Summary: ${analysis.summary || ''}`, ``] : []),
      `## Nodes`,
      ...((report.nodes || []).map((node) => `- ${node.title || node.node_id}: ${node.status}${node.skip_reason ? ` [${node.skip_reason}]` : ''} (${node.risk_level})`)),
    ];
    downloadText(`audit-${report.plan_id || 'report'}.md`, lines.join('\n'));
  };
  exportBar.appendChild(btnJson);
  exportBar.appendChild(btnMd);
  auditContentEl.appendChild(exportBar);
}

function _updateAutoRunGroup() {
  const group = document.getElementById('planAutoRunGroup');
  if (!group) return;
  for (const btn of group.querySelectorAll('.auto-run-btn')) {
    btn.classList.toggle('active', btn.dataset.level === currentPlanAutoRunLevel);
  }
}

function updatePlanOpBar() {
  if (!planOpBarEl) return;
  const hasPlan = !!(currentPlan && Array.isArray(currentPlan.nodes) && currentPlan.nodes.length);
  planOpBarEl.classList.toggle('hidden', !hasPlan);
  if (!hasPlan) return;
  planOpTitleEl.textContent = currentPlanIntent || currentPlan.intent || 'Execution Plan';
  planOpCountEl.textContent = `${currentPlan.nodes.length} nodes`;
  const warnCount = currentPlan.nodes.filter((node) => node.risk_level === 'warn').length;
  const blockCount = currentPlan.nodes.filter((node) => node.risk_level === 'block').length;
  const groundedCount = currentPlan.nodes.filter((node) => node.grounded).length;
  const preAudit = currentPlan && currentPlan.pre_audit ? currentPlan.pre_audit : null;
  const severity = String((preAudit && preAudit.severity) || '').trim().toLowerCase();
  // Auto-run segmented button group
  let autoRunGroup = document.getElementById('planAutoRunGroup');
  if (!autoRunGroup) {
    const btnsBar = planOpTitleEl && planOpTitleEl.closest('.plan-op-bar');
    if (btnsBar) {
      const group = document.createElement('div');
      group.id = 'planAutoRunGroup';
      group.className = 'auto-run-group';

      const lbl = document.createElement('span');
      lbl.className = 'auto-run-group-label';
      lbl.textContent = 'Auto-run';
      group.appendChild(lbl);

      const opts = [['none', 'Off'], ['safe', 'Safe'], ['safe_warn', 'Safe+warn']];
      for (const [val, text] of opts) {
        const btn = document.createElement('button');
        btn.className = 'auto-run-btn';
        btn.dataset.level = val;
        btn.textContent = text;
        btn.addEventListener('click', async () => {
          currentPlanAutoRunLevel = val;
          _updateAutoRunGroup();
          if (currentPlan && currentPlan.id && currentPlanStream && currentPlanStream.source) {
            try { await apiPlanSetAutoRun(currentPlan.id, val); } catch { /* ignore */ }
          }
        });
        group.appendChild(btn);
      }

      // Insert before .plan-op-btns so it sits in the bar naturally
      const planOpBtns = btnsBar.querySelector('.plan-op-btns');
      if (planOpBtns) {
        btnsBar.insertBefore(group, planOpBtns);
      } else {
        btnsBar.appendChild(group);
      }
      autoRunGroup = group;
    }
  }
  _updateAutoRunGroup();
  if (planPreAuditEl) {
    if (severity) {
      planPreAuditEl.dataset.severity = severity;
    } else {
      delete planPreAuditEl.dataset.severity;
    }
  }
  if (preAudit && preAudit.summary) {
    planPreAuditEl.textContent = `Pre-audit ${String(preAudit.severity || 'pass').toUpperCase()}: ${String(preAudit.summary || '')} · ${warnCount} warn · ${blockCount} block · ${groundedCount}/${currentPlan.nodes.length} grounded`;
    return;
  }
  planPreAuditEl.textContent = `Pre-audit pending · ${warnCount} warn · ${blockCount} block · ${groundedCount}/${currentPlan.nodes.length} grounded`;
}

function renderNodePopoverBody(node, forceApproval = false) {
  if (!nodePopoverBodyEl || !node) return;
  const output = getNodeOutputState(node.id);
  const status = currentPlanNodeStatuses[node.id] || 'pending';
  const outputText = String(output.stderr || output.stdout || '').trim();
  const citeHtml = Array.isArray(node.citations) && node.citations.length
    ? node.citations.slice(0, 2).map((citation) => `<div class="node-popover-citation">${escapeHtml(citation.title || citation.source || '')}: ${escapeHtml(citation.snippet || '')}</div>`).join('')
    : '<div class="node-popover-citation">暂无引用依据</div>';
  nodePopoverBodyEl.innerHTML = `
    <div class="node-popover-row"><span class="node-popover-label">状态</span><span class="node-popover-value">${escapeHtml(status)}</span></div>
    <div class="node-popover-row"><span class="node-popover-label">类型</span><span class="node-popover-value">${escapeHtml(node.type || '')}</span></div>
    <div class="node-popover-row"><span class="node-popover-label">风险</span><span class="node-popover-value">${escapeHtml(node.risk_level || 'safe')}</span></div>
    <div class="node-popover-row"><span class="node-popover-label">说明</span><span class="node-popover-value">${escapeHtml(node.description || '')}</span></div>
    <div class="node-popover-cmd">${escapeHtml(node.command || '(no command)')}</div>
    ${node.rollback ? `<div class="node-popover-row"><span class="node-popover-label">回滚</span><span class="node-popover-value">${escapeHtml(node.rollback)}</span></div>` : ''}
    ${outputText ? `<div class="node-popover-row"><span class="node-popover-label">输出</span><span class="node-popover-value">${output.exit_code === null || output.exit_code === undefined ? '' : `exit=${escapeHtml(String(output.exit_code))}`}</span></div><pre class="node-popover-output">${escapeHtml(outputText.slice(-1200))}</pre>` : '<div class="node-popover-citation">执行中输出会实时显示在这里。</div>'}
    ${citeHtml}
    <div class="actions" id="nodePopoverActions"></div>
  `;
  const actionsEl = document.getElementById('nodePopoverActions');
  if (actionsEl && currentPlan) {
    const addBtn = (label, handler, cls = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (cls) btn.className = cls;
      btn.onclick = handler;
      actionsEl.appendChild(btn);
    };
    if (forceApproval || node.type === 'human' || node.risk_level === 'warn' || node.risk_level === 'block') {
      addBtn('批准该节点', async () => {
        try {
          await apiPlanApproveNode(currentPlan.id, node.id);
          planRenderer.updateNodeStatus(node.id, 'running');
          currentPlanNodeStatuses[node.id] = 'running';
          closeNodePopover();
        } catch (err) {
          writeError(String(err.message || err));
        }
      }, 'primary');
      addBtn('跳过该节点', async () => {
        try {
          await apiPlanSkipNode(currentPlan.id, node.id);
          currentPlanNodeStatuses[node.id] = 'skipped';
          planRenderer.updateNodeStatus(node.id, 'skipped');
          closeNodePopover();
        } catch (err) {
          writeError(String(err.message || err));
        }
      }, 'danger');
    }
    if (node.command) {
      addBtn('插入终端', () => {
        insertTextAtCursor(node.command);
        closeNodePopover();
      });
    }
  }
}

function openNodePopover(node, target, forceApproval = false) {
  if (!nodePopoverEl || !nodePopoverTitleEl || !nodePopoverBodyEl || !node) return;
  currentPopoverNodeId = node.id || '';
  nodePopoverTitleEl.textContent = node.title || node.id;
  renderNodePopoverBody(node, forceApproval);
  const popoverWidth = Math.min(300, Math.max(240, window.innerWidth - 24));
  const popoverHeight = Math.min(360, Math.max(220, window.innerHeight - 96));
  const currentLeft = parseInt(nodePopoverEl.style.left || '0', 10);
  const currentTop = parseInt(nodePopoverEl.style.top || '0', 10);
  const hasPinnedPosition = !Number.isNaN(currentLeft) && !Number.isNaN(currentTop) && !target;
  const rect = target && target.getBoundingClientRect
    ? target.getBoundingClientRect()
    : hasPinnedPosition
      ? { right: currentLeft + popoverWidth, top: currentTop }
      : { right: window.innerWidth / 2, top: window.innerHeight / 2 };
  nodePopoverEl.style.width = `${popoverWidth}px`;
  nodePopoverEl.style.left = `${Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, rect.right + 8))}px`;
  nodePopoverEl.style.top = `${Math.max(76, Math.min(window.innerHeight - popoverHeight - 12, rect.top))}px`;
  nodePopoverEl.classList.remove('hidden');
}

function closeNodePopover() {
  currentPopoverNodeId = '';
  if (nodePopoverEl) nodePopoverEl.classList.add('hidden');
}

function renderPlan(plan, intent) {
  currentPlan = plan;
  currentPlanIntent = intent || (plan && plan.intent) || '';
  currentPlanNodeOutputs = {};
  currentPlanNodeStatuses = {};
  pendingPlanApprovals = new Set();
  planExecutionRoundId = '';
  planExecutionStartedAt = 0;
  if (plan && Array.isArray(plan.nodes)) {
    for (const node of plan.nodes) currentPlanNodeStatuses[node.id] = 'pending';
  }
  updatePlanOpBar();
  planRenderer.render(plan, {
    onNodeClick: (node, target) => openNodePopover(node, target),
  });
  renderPreAuditCard((plan && plan.pre_audit) ? plan.pre_audit : null);
  setPlanUnread(true);
}

function closeSuggestStream() {
  if (currentSuggestStream) {
    try {
      currentSuggestStream.close();
    } catch {
      // ignore
    }
    currentSuggestStream = null;
  }
}

function closePlanStream() {
  if (currentPlanStream) {
    currentPlanStream.close();
    currentPlanStream = null;
  }
}

const SHELL_COMMAND_PREFIX_RE = /^(git|npm|pnpm|yarn|node|python|python3|pip|uv|cargo|go|java|docker|kubectl|ssh|scp|ls|dir|cd|pwd|cat|type|echo|grep|rg|find|ps|kill|tasklist|taskkill|netstat|ss|lsof|curl|wget|ping|tracert|ipconfig|ifconfig|systemctl|service|journalctl|make|cmake|pytest|uvicorn|bash|sh|pwsh|powershell|cmd)$/;
const CHAT_PATTERNS = [
  /^(你好|您好|嗨|哈喽|在吗)\s*[!.。！？?]*$/i,
  /^(hi|hello|hey)\s*[!.。！？?]*$/i,
  /^(谢谢|谢了|thanks|thank you)\s*[!.。！？?]*$/i,
  /^(你是谁|你是做什么的|who are you)\s*[!.。！？?]*$/i,
];
const PLAN_PATTERNS = [
  /(排查|修复|执行计划|计划|步骤|方案|runbook|checklist)/i,
  /(帮我|给我|请你).*(排查|修复|处理|解决|配置|安装|梳理|生成)/i,
  /(怎么|如何).*(修复|排查|处理|解决)/i,
];

function isLikelyCommand(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/[\u4e00-\u9fff]/.test(value) && !/[|><=&]/.test(value)) return false;
  const first = value.split(/\s+/)[0].toLowerCase();
  if (SHELL_COMMAND_PREFIX_RE.test(first)) return true;
  if (/[|><=&]/.test(value)) return true;
  if (/^(\.\/|\.\.\/|~\/|\/)/.test(value)) return true;
  return false;
}

function isLikelyNaturalLanguage(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/[\u4e00-\u9fff]/.test(value)) return true;
  const first = value.split(/\s+/)[0].toLowerCase();
  if (SHELL_COMMAND_PREFIX_RE.test(first)) {
    return false;
  }
  if (/\?$/.test(value)) return true;
  if (value.split(/\s+/).length >= 5 && !/[|><=&]/.test(value)) return true;
  return false;
}

function classifyInputIntent(text) {
  const value = String(text || '').trim();
  if (!value) return { kind: 'empty', confidence: 1, reason: 'empty_input', missing: [] };
  if (isLikelyCommand(value)) return { kind: 'command', confidence: 0.95, reason: 'command_shape', missing: [] };
  if (CHAT_PATTERNS.some((pattern) => pattern.test(value))) return { kind: 'chat', confidence: 0.95, reason: 'chat_pattern', missing: [] };
  if (PLAN_PATTERNS.some((pattern) => pattern.test(value))) return { kind: 'plan', confidence: 0.85, reason: 'plan_pattern', missing: [] };
  if (isLikelyNaturalLanguage(value)) return { kind: 'clarify', confidence: 0.7, reason: 'natural_language_needs_clarify', missing: ['goal'] };
  return { kind: 'command', confidence: 0.6, reason: 'fallback_command', missing: [] };
}

function writeAssistantLines(lines, color = '\x1b[36m') {
  const items = Array.isArray(lines) ? lines : [lines];
  for (const line of items) {
    if (!line) continue;
    writePlanTerminalLine(`[AI] ${line}`, color);
  }
}

function handleChatIntent(intent) {
  const value = String(intent || '').trim();
  clearSuggestions();
  renderSteps([]);
  const replies = /^(谢谢|谢了|thanks|thank you)/i.test(value)
    ? ['收到。继续输入命令或问题即可。']
    : /^(你是谁|你是做什么的|who are you)/i.test(value)
      ? ['我是终端助手。你可以直接输入命令，或描述你要排查的问题。']
      : ['你好。直接输入命令，或描述你要处理的问题。'];
  writeAssistantLines(replies);
  setStatusReady();
}

function buildClarifyReply(intent) {
  const value = String(intent || '').trim();
  if (/docker/i.test(value)) {
    return [
      '我理解你是在处理 Docker 相关问题。',
      '你是想查启动失败原因、查看日志，还是直接给出排查步骤？',
      '也可以直接说“帮我排查 docker 起不来并给步骤”。',
    ];
  }
  if (/(8000|端口|port)/i.test(value)) {
    return [
      '我理解你是在处理端口问题。',
      '你是想查谁占用了端口、为什么监听失败，还是想直接释放端口？',
      '也可以直接说“帮我排查 8000 端口占用并给步骤”。',
    ];
  }
  return [
    `我理解你想处理：${value}`,
    '现在还缺少一个关键目标：你希望我解释原因、给命令，还是直接生成排查步骤？',
    '你也可以补一句更明确的话，例如“帮我排查并给步骤”。',
  ];
}

function handleClarifyIntent(intent) {
  clearSuggestions();
  renderSteps([]);
  writeAssistantLines(buildClarifyReply(intent));
  setStatusReady();
}

async function streamSuggestionsForIntent(intent, extraPayload = {}) {
  closeSuggestStream();
  resetAgentPanel('准备任务...');
  switchSidePanel('timeline');
  statusEl.textContent = '多智能体分析中...';
  const controller = new AbortController();
  currentSuggestStream = { close: () => controller.abort() };
  const res = await fetch('/api/suggest/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: getSessionId() || null,
      last_command: intent,
      last_exit_code: 0,
      last_stdout: '',
      last_stderr: '',
      platform: getPlatform(),
      ...extraPayload,
    }),
    signal: controller.signal,
  });
  if (!res.ok || !res.body) {
    currentSuggestStream = null;
    throw new Error(`HTTP ${res.status}: suggest_stream_failed`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  const handleChunk = (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const lines = part.split('\n').filter((line) => line.startsWith('data:'));
      for (const line of lines) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        const payload = JSON.parse(raw);
        if (payload.type === 'agent_progress') {
          updateAgentProgress(payload.agent, payload.status, payload.message);
        } else if (payload.type === 'tool_call') {
          updateAgentProgress(payload.agent, 'running', `调用工具 ${payload.tool}`);
        } else if (payload.type === 'suggestions') {
          finalPayload = payload;
          if (payload && payload.session_id) setSessionId(payload.session_id);
          renderSteps(payload.steps || []);
          renderLiveSuggestions(payload.suggestions || []);
        } else if (payload.type === 'alignment_update') {
          if (applyAlignmentUpdate(payload)) {
            renderLiveSuggestions(lastSuggestionsCache);
            finalPayload = syncFinalSuggestionPayload(finalPayload);
          }
        } else if (payload.type === 'agent_enhancement') {
          if (applyAgentEnhancement(payload)) {
            renderLiveSuggestions(lastSuggestionsCache);
            finalPayload = syncFinalSuggestionPayload(finalPayload);
          }
        } else if (payload.type === 'error') {
          throw new Error(payload.message || 'suggest_stream_failed');
        }
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      handleChunk(value);
    }
    currentSuggestStream = null;
    return syncFinalSuggestionPayload(finalPayload) || { suggestions: [], steps: [] };
  } catch (err) {
    currentSuggestStream = null;
    throw err;
  }
}

async function generateExecutionPlan(intent, suggestions) {
  const result = await apiPlanGenerate(intent, suggestions || []);
  if (result && result.session_id) setSessionId(result.session_id);
  renderPlan(result.plan, intent);
  renderAuditReport(null);
  const _oldPreAuditCard = document.getElementById('planPreAuditCard');
  if (_oldPreAuditCard) _oldPreAuditCard.remove();
  switchSidePanel('plan');
  return result.plan;
}

async function executeCurrentPlan() {
  if (!currentPlan || !currentPlan.id) return;
  statusEl.textContent = '执行计划中...';
  if (planBtnStopEl) planBtnStopEl.style.display = 'inline-flex';
  writePlanTerminalLine(`[PLAN] 开始执行: ${currentPlanIntent || currentPlan.id}`, '\x1b[36m');
  await apiPlanExecute(currentPlan.id);
  closePlanStream();
  currentPlanStream = new PlanStreamClient(currentPlan.id, planRenderer);
  currentPlanStream.connect();
  switchSidePanel('plan');
}

async function approveAllPlanNodes() {
  if (!currentPlan || !Array.isArray(currentPlan.nodes)) return;
  for (const node of currentPlan.nodes) {
    if (isApprovalNode(node)) {
      pendingPlanApprovals.add(node.id);
      try {
        const res = await apiPlanApproveNode(currentPlan.id, node.id);
        if (res && res.ok) {
          currentPlanNodeStatuses[node.id] = 'running';
          planRenderer.updateNodeStatus(node.id, 'running');
        }
      } catch {
        // ignore individual approval failures before execution starts
      }
    }
  }
  writePlanTerminalLine('[PLAN] 已记录全部批准，后续待审批节点会自动放行。', '\x1b[36m');
}

async function startIntentIteration(intent, { autoExecute = false, generatePlan = true, streamPayload = {} } = {}) {
  const normalized = String(intent || '').trim();
  if (!normalized) return;
  try {
    const sug = await streamSuggestionsForIntent(normalized, streamPayload);
    if (sug && sug.session_id) setSessionId(sug.session_id);
    renderSteps(sug.steps || []);
    renderSuggestions(
      sug.suggestions || [],
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
        await dispatchTerminalCommand(s.command, false);
      }
    );
    if (generatePlan) {
      try {
        await generateExecutionPlan(normalized, sug.suggestions || []);
      } catch (planErr) {
        writeInfoAbovePrompt(`执行计划生成失败，已保留建议列表：${String(planErr.message || planErr)}`);
      }
    }
    // Actual execution must be a separate user action from the plan panel.
    void autoExecute;
    setStatusReady();
  } catch (err) {
    statusEl.textContent = '错误';
    writeError(String(err.message || err));
  }
}

async function requestPtySuggestion() {
  if (terminalMode !== 'pty') {
    writeInfoAbovePrompt('当前不在 PTY 模式。');
    return;
  }

  const intent = window.prompt('请输入你想让 AI 协助的问题');
  const normalized = String(intent || '').trim();
  if (!normalized) return;

  try {
    statusEl.textContent = '提取终端上下文中...';
    await requestPTYControl('ai_suggest', { intent: normalized });
    const ctx = await requestPTYControl('ai_context');
    const conversationMessages = Array.isArray(ctx.conversation_messages) ? ctx.conversation_messages : [];
    if (ctx.cwd) currentCwd = String(ctx.cwd);

    const sug = await streamSuggestionsForIntent(normalized, {
      last_stdout: String(ctx.recent_output || ''),
      last_stderr: '',
      conversation_messages: conversationMessages,
    });

    if (Array.isArray(sug.suggestions)) {
      renderSuggestions(
        sug.suggestions,
        (s) => {
          if (s.command === '(auto)') return;
          insertTextAtCursor(s.command);
        },
        async (s) => {
          if (s.command === '(auto)') return;
          if (s.risk_level === 'block') {
            writeError('该命令被安全策略拦截（block）。');
            return;
          }
          if (s.requires_confirmation) {
            setPendingConfirmation(s.command, '风险等级为 warn（可能影响系统/数据），建议确认后再执行。');
            return;
          }
          await dispatchTerminalCommand(s.command, false);
        }
      );
    }
    setStatusReady();
  } catch (err) {
    statusEl.textContent = '错误';
    writeError(String(err.message || err));
  }
}

function setStatusReady() {
  const mode = currentExecutorMode ? String(currentExecutorMode) : 'unknown';
  const termLabel = terminalMode === 'pty' ? 'pty' : 'plan';
  statusEl.textContent = isSuggesting
    ? `就绪（terminal=${termLabel}，executor=${mode}，生成建议中...）`
    : `就绪（terminal=${termLabel}，executor=${mode}）`;
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

const LLM_PROVIDER_OPTIONS = [
  { value: 'modelscope', label: 'modelscope（OpenAI-compatible）' },
  { value: 'kimi', label: 'kimi 官方 API（Moonshot）' },
  { value: 'siliconflow', label: 'siliconflow（OpenAI-compatible）' },
  { value: 'custom', label: 'custom（自定义兼容接口）' },
];

const LLM_PROVIDER_DEFAULTS = {
  modelscope: {
    baseUrl: 'https://api-inference.modelscope.cn/v1/',
    model: 'moonshotai/Kimi-K2.5',
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1/',
    model: 'kimi-k2.5',
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1/',
    model: 'moonshotai/Kimi-K2.5',
  },
  custom: {
    baseUrl: '',
    model: '',
  },
};

const LLM_PROVIDER_MODEL_PRESETS = {
  modelscope: [
    { value: 'moonshotai/Kimi-K2.5', label: 'moonshotai/Kimi-K2.5（默认）' },
    { value: 'ZhipuAI/GLM-5', label: 'ZhipuAI/GLM-5' },
    { value: 'MiniMax/MiniMax-M2.5', label: 'MiniMax/MiniMax-M2.5' },
    { value: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', label: 'Qwen/Qwen3-Coder-30B-A3B-Instruct' },
    { value: 'Qwen/Qwen3-235B-A22B', label: 'Qwen/Qwen3-235B-A22B' },
    { value: 'deepseek-ai/DeepSeek-V3.2', label: 'deepseek-ai/DeepSeek-V3.2' },
    { value: 'deepseek-ai/DeepSeek-R1-0528', label: 'deepseek-ai/DeepSeek-R1-0528' },
    { value: 'moonshotai/Kimi-K2-Instruct-0905', label: 'moonshotai/Kimi-K2-Instruct-0905' },
    { value: 'moonshotai/Kimi-K2-Instruct', label: 'moonshotai/Kimi-K2-Instruct' },
    { value: 'moonshotai/Kimi-K2-Thinking', label: 'moonshotai/Kimi-K2-Thinking' },
  ],
  kimi: [
    { value: 'kimi-k2.5', label: 'kimi-k2.5（默认）' },
  ],
  siliconflow: [
    { value: 'moonshotai/Kimi-K2.5', label: 'moonshotai/Kimi-K2.5' },
    { value: 'moonshotai/Kimi-K2-Thinking', label: 'moonshotai/Kimi-K2-Thinking' },
    { value: 'moonshotai/Kimi-K2-Instruct', label: 'moonshotai/Kimi-K2-Instruct' },
    { value: 'moonshotai/Kimi-K2-Instruct-0905', label: 'moonshotai/Kimi-K2-Instruct-0905' },
    { value: 'zai-org/GLM-5', label: 'zai-org/GLM-5' },
    { value: 'zai-org/GLM-4.7', label: 'zai-org/GLM-4.7' },
    { value: 'Qwen/Qwen3-32B', label: 'Qwen/Qwen3-32B' },
    { value: 'Qwen/Qwen3-14B', label: 'Qwen/Qwen3-14B' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'deepseek-ai/DeepSeek-R1' },
    { value: 'deepseek-ai/DeepSeek-V3', label: 'deepseek-ai/DeepSeek-V3' },
  ],
  custom: [],
};

function renderDropdownItems(menuEl, items) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'dropdown-item';
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');
    row.setAttribute('data-value', item.value);
    row.textContent = item.label || item.value;
    menuEl.appendChild(row);
  }
}

function renderProviderOptions() {
  renderDropdownItems(llmProviderDropdownMenu, LLM_PROVIDER_OPTIONS);
}

function renderModelPresets(provider) {
  const key = String(provider || 'modelscope').trim() || 'modelscope';
  const presets = LLM_PROVIDER_MODEL_PRESETS[key] || LLM_PROVIDER_MODEL_PRESETS.modelscope;
  renderDropdownItems(llmModelDropdownMenu, presets);
  syncLlmModelPicker();
}

function getDefaultProviderBaseUrl(provider) {
  const key = String(provider || 'modelscope').trim() || 'modelscope';
  return (LLM_PROVIDER_DEFAULTS[key] && LLM_PROVIDER_DEFAULTS[key].baseUrl) || LLM_PROVIDER_DEFAULTS.modelscope.baseUrl;
}

function getDefaultProviderModel(provider) {
  const key = String(provider || 'modelscope').trim() || 'modelscope';
  return (LLM_PROVIDER_DEFAULTS[key] && LLM_PROVIDER_DEFAULTS[key].model) || '';
}

function maybeSyncProviderBaseUrl(provider, previousProvider = '') {
  if (!llmBaseUrlInput) return;
  const nextDefault = getDefaultProviderBaseUrl(provider);
  const prevDefault = getDefaultProviderBaseUrl(previousProvider || provider);
  const current = String(llmBaseUrlInput.value || '').trim();
  if (!current || current === prevDefault || current === nextDefault) {
    llmBaseUrlInput.value = nextDefault;
  }
}

function maybeSyncProviderModel(provider, previousProvider = '') {
  if (!llmModelInput) return;
  const nextDefault = getDefaultProviderModel(provider);
  const prevDefault = getDefaultProviderModel(previousProvider || provider);
  const current = String(llmModelInput.value || '').trim();
  if (!current || current === prevDefault || current === nextDefault) {
    llmModelInput.value = nextDefault;
  }
}

function setProviderSelection(provider, { refreshModels = true, syncBaseUrl = true, syncModel = false } = {}) {
  const value = String(provider || '').trim() || 'modelscope';
  const previousValue = llmProviderSelect ? String(llmProviderSelect.value || '').trim() || 'modelscope' : 'modelscope';
  if (llmProviderSelect) llmProviderSelect.value = value;
  const items = llmProviderDropdownMenu ? Array.from(llmProviderDropdownMenu.querySelectorAll('[data-value]')) : [];
  let matched = null;
  for (const it of items) {
    const v = String(it.getAttribute('data-value') || '').trim();
    const isActive = v && v === value;
    it.classList.toggle('active', isActive);
    if (isActive) matched = it;
  }
  if (llmProviderDropdownBtn) {
    if (matched) {
      llmProviderDropdownBtn.textContent = matched.textContent;
    } else {
      llmProviderDropdownBtn.textContent = value || '选择 Provider...';
    }
  }
  if (syncBaseUrl) maybeSyncProviderBaseUrl(value, previousValue);
  if (refreshModels) renderModelPresets(value);
  if (syncModel) {
    maybeSyncProviderModel(value, previousValue);
    syncLlmModelPicker();
  }
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

async function apiSetLlmConfig(provider, token, model, baseUrl) {
  return postJson('/api/llm/config', {
    provider: provider || null,
    token: token || null,
    model: model || null,
    base_url: baseUrl || null,
  });
}

async function apiLlmTest(provider, token, model, baseUrl) {
  return postJson('/api/llm/test', {
    provider: provider || null,
    token: token || null,
    model: model || null,
    base_url: baseUrl || null,
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

async function apiPlanGenerate(intent, suggestions = []) {
  return postJson('/api/plan/generate', {
    session_id: getSessionId() || null,
    intent,
    platform: getPlatform(),
    suggestions,
  });
}

async function apiPlanExecute(planId) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/execute`, {
    session_id: getSessionId() || null,
    auto_run_level: currentPlanAutoRunLevel,
  });
}

async function apiPlanSetAutoRun(planId, level) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/auto-run`, { level });
}

async function apiPlanApproveNode(planId, nodeId) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/node/${encodeURIComponent(nodeId)}/approve`, {});
}

async function apiPlanSkipNode(planId, nodeId) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/node/${encodeURIComponent(nodeId)}/skip`, {});
}

async function apiPlanCancel(planId) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/cancel`, {});
}

async function apiRunbooksList() {
  const res = await fetch('/api/runbooks');
  if (!res.ok) throw new Error(`HTTP ${res.status}: failed_to_list_runbooks`);
  return res.json();
}

async function apiRunbooksUpsert(filename, content) {
  return postJson('/api/runbooks', { filename, content });
}

async function apiRunbooksDelete(filename) {
  const res = await fetch(`/api/runbooks/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function runSuggestOnly(text) {
  await startIntentIteration(text, { autoExecute: false, generatePlan: false });
  prompt();
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
      outDiv.textContent = out.length > 2000 ? (out.slice(0, 2000) + '\n...（已截断，完整内容可下载）') : out;
      stExec.appendChild(outDiv);
    }
    if (err) {
      const errDiv = document.createElement('div');
      errDiv.className = 'output';
      errDiv.style.color = 'rgba(255, 92, 122, 0.92)';
      errDiv.textContent = err.length > 2000 ? (err.slice(0, 2000) + '\n...（已截断，完整内容可下载）') : err;
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
        line.textContent = `${ok ? '通过' : '失败'}：${v.title}${v.detail ? ' - ' + v.detail : ''}`;
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
        line.textContent = t ? `建议：${t}${c ? `（${c}）` : ''}` : (c ? `建议：${c}` : '');
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

function confidenceBadge(suggestion) {
  const level = String((suggestion && suggestion.confidence) || '').trim().toLowerCase();
  const label = String((suggestion && suggestion.confidence_label) || '').trim();
  if (!level || !label) return '';
  return `<span class="badge confidence-${escapeHtml(level)}">${escapeHtml(label)}</span>`;
}

function alignmentBadge(suggestion) {
  const level = String((suggestion && suggestion.alignment) || '').trim().toLowerCase();
  if (!level) return '';
  const labels = {
    ok: 'aligned',
    warn: 'check',
    mismatch: 'mismatch',
  };
  return `<span class="badge alignment-${escapeHtml(level)}">${escapeHtml(labels[level] || level)}</span>`;
}

function alignmentSummary(suggestion) {
  const level = String((suggestion && suggestion.alignment) || '').trim().toLowerCase();
  if (!level) return '';
  const reason = String((suggestion && suggestion.alignment_reason) || '').trim();
  const label = level === 'ok' ? 'Aligned' : level === 'warn' ? 'Alignment Check' : 'Mismatch';
  return reason ? `${label}: ${reason}` : label;
}

function insertSuggestionCommand(suggestion) {
  if (!suggestion || suggestion.command === '(auto)') return;
  insertTextAtCursor(suggestion.command);
}

async function executeSuggestion(suggestion) {
  if (!suggestion || suggestion.command === '(auto)') return;
  if (MODE.get() !== 'assist') {
    writeInfo('当前是「只建议」模式，切换到「建议+执行」即可一键执行。');
    return;
  }
  if (suggestion.risk_level === 'block') {
    writeError('该命令被安全策略拦截（block）。');
    return;
  }
  if (suggestion.requires_confirmation) {
    setPendingConfirmation(
      suggestion.command,
      '风险等级为 warn，建议确认后再执行。'
    );
    writeInfoAbovePrompt('该建议需要确认：请在右侧点击「确认执行」。');
    return;
  }
  await dispatchTerminalCommand(suggestion.command, false);
}

function cloneSuggestionsForPayload(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    citations: Array.isArray(item && item.citations)
      ? item.citations.map((citation) => ({ ...citation }))
      : [],
  }));
}

function renderLiveSuggestions(suggestions) {
  renderSuggestions(suggestions || [], insertSuggestionCommand, executeSuggestion);
}

function syncFinalSuggestionPayload(finalPayload) {
  if (!finalPayload) return finalPayload;
  return {
    ...finalPayload,
    suggestions: cloneSuggestionsForPayload(lastSuggestionsCache),
  };
}

function updateSuggestionCache(suggestionId, updater) {
  const id = String(suggestionId || '').trim();
  if (!id || !Array.isArray(lastSuggestionsCache) || !lastSuggestionsCache.length) return false;
  let changed = false;
  lastSuggestionsCache = lastSuggestionsCache.map((item) => {
    if (!item || String(item.id || '') !== id) return item;
    const next = updater({ ...item, citations: Array.isArray(item.citations) ? item.citations.map((citation) => ({ ...citation })) : [] });
    changed = true;
    return next;
  });
  return changed;
}

function applyAlignmentUpdate(payload) {
  if (!payload) return false;
  return updateSuggestionCache(payload.suggestion_id, (item) => ({
    ...item,
    alignment: String(payload.alignment || '').trim(),
    alignment_reason: String(payload.alignment_reason || '').trim(),
  }));
}

function applyAgentEnhancement(payload) {
  if (!payload) return false;
  return updateSuggestionCache(payload.suggestion_id, (item) => {
    const existing = Array.isArray(item.citations) ? item.citations.map((citation) => ({ ...citation })) : [];
    const seen = new Set(existing.map((citation) => `${citation.title || ''}::${citation.snippet || ''}::${citation.source || ''}`));
    for (const citation of Array.isArray(payload.citations) ? payload.citations : []) {
      const key = `${citation && citation.title ? citation.title : ''}::${citation && citation.snippet ? citation.snippet : ''}::${citation && citation.source ? citation.source : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      existing.push({ ...citation });
    }
    return {
      ...item,
      citations: existing,
      confidence: String(payload.confidence || item.confidence || ''),
      confidence_label: String(payload.confidence_label || item.confidence_label || ''),
    };
  });
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
    card.dataset.suggestionId = String(s.id || '');

    const title = document.createElement('div');
    title.className = 'card-title';
    const confirmTag = s.requires_confirmation ? ' · 需确认' : '';
    const agentTag = s.agent ? ` 路 ${escapeHtml(s.agent)}` : '';
    title.innerHTML = `<span>${escapeHtml(s.title)}${agentTag}${confirmTag}</span><span class="badge-row"><span class="badge ${badgeClass(s.risk_level)}">${escapeHtml(s.risk_level)}</span>${confidenceBadge(s)}${alignmentBadge(s)}</span>`;

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
      addExplainLine('Alignment', alignmentSummary(s));

      if (Array.isArray(s.citations) && s.citations.length > 0) {
        for (const c of s.citations.slice(0, 3)) {
          const cite = document.createElement('div');
          cite.className = 'explain';
          const src = c && c.source ? `（${c.source}）` : '';
          cite.textContent = `依据：${c.title}${src} - ${c.snippet}`;
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
    window.fitAddon = fitAddon;
    term.loadAddon(fitAddon);
    fitAddon.fit();
  }
} catch {
  // ignore
}
window.addEventListener('resize', refreshResponsiveLayout);
if (typeof ResizeObserver !== 'undefined') {
  const responsiveObserver = new ResizeObserver(() => {
    refreshResponsiveLayout();
  });
  // Observe topbar and onboarding only. Observing layoutEl creates a feedback
  // loop because fitAddon.fit() changes terminal height and retriggers resize.
  if (topbarEl) responsiveObserver.observe(topbarEl);
  if (onboardingEl) responsiveObserver.observe(onboardingEl);
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
  if (terminalMode === 'pty') {
    if (ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
      ptyWebSocket.send(new TextEncoder().encode(t));
    }
    return;
  }

  // Fast path: appending at end (most common typing case) - avoid full redraw.
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

async function ensureSessionId() {
  let sid = getSessionId();
  if (sid) {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}`);
      if (res.ok) return sid;
    } catch {
      // ignore and recreate
    }
  }
  const session = await apiNewSession();
  return session && session.session_id ? String(session.session_id) : '';
}

function disconnectPTY({ clearRef = true } = {}) {
  if (!ptyWebSocket) return;
  try {
    ptyWebSocket.close();
  } catch {
    // ignore
  }
  if (clearRef) ptyWebSocket = null;
}

async function connectPTY() {
  const sessionId = await ensureSessionId();
  if (!sessionId) throw new Error('session_unavailable');

  disconnectPTY();
  clearTerminalUi();
  writeInfo('连接真实终端...');

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal/${encodeURIComponent(sessionId)}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    statusEl.textContent = '真实终端已连接';
    try {
      ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
    } catch {
      // ignore
    }
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(event.data));
      return;
    }

    try {
      const payload = JSON.parse(String(event.data || '{}'));
      if (payload.request_id && ptyControlRequests.has(payload.request_id)) {
        const pending = ptyControlRequests.get(payload.request_id);
        clearTimeout(pending.timer);
        ptyControlRequests.delete(payload.request_id);
        pending.resolve(payload.data || payload);
        return;
      }
      if (payload.type === 'terminal_status' && payload.status === 'unsupported') {
        ptySupported = false;
        writeError('当前运行环境不支持 PTY，已切回计划模式。');
        void setTerminalMode('plan');
      }
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    for (const [requestId, pending] of ptyControlRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('pty_disconnected'));
      ptyControlRequests.delete(requestId);
    }
    if (ptyWebSocket === ws) ptyWebSocket = null;
    if (terminalMode === 'pty') statusEl.textContent = '真实终端连接已断开';
  };

  ws.onerror = () => {
    if (terminalMode === 'pty') statusEl.textContent = '真实终端连接错误';
  };

  ptyWebSocket = ws;
}

function bindPlanModeInput() {
  if (termDataDisposable) termDataDisposable.dispose();
  if (termResizeDisposable) termResizeDisposable.dispose();
  termResizeDisposable = null;
  termDataDisposable = term.onData((data) => {
    void handlePlanModeInput(data);
  });
}

function bindPTYModeInput() {
  if (termDataDisposable) termDataDisposable.dispose();
  if (termResizeDisposable) termResizeDisposable.dispose();
  termDataDisposable = term.onData((data) => {
    if (ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
      ptyWebSocket.send(new TextEncoder().encode(data));
    }
  });
  termResizeDisposable = term.onResize(({ rows, cols }) => {
    if (ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
      ptyWebSocket.send(JSON.stringify({ type: 'resize', rows, cols }));
    }
  });
}

function applyTerminalModeUi() {
  if (!terminalModeSwitchEl) return;
  for (const btn of Array.from(terminalModeSwitchEl.querySelectorAll('button[data-term-mode]'))) {
    const mode = String(btn.getAttribute('data-term-mode') || '').trim();
    btn.classList.toggle('is-active', mode === terminalMode);
    if (mode === 'pty') btn.disabled = !ptySupported;
  }
  if (askAiBtn) askAiBtn.disabled = terminalMode !== 'pty' || !ptySupported;
}

async function setTerminalMode(mode) {
  const next = mode === 'pty' && ptySupported ? 'pty' : 'plan';
  const prev = terminalMode;
  terminalMode = next;
  applyTerminalModeUi();

  if (next === 'pty') {
    bindPTYModeInput();
    await connectPTY();
    return;
  }

  if (prev === 'pty' && ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
    try {
      const ctx = await requestPTYControl('ai_context');
      if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) currentCwd = ctx.cwd;
    } catch {
      // ignore best-effort cwd sync
    }
  }
  disconnectPTY();
  bindPlanModeInput();
  clearTerminalUi();
  prompt();
  setStatusReady();
}

function requestPTYControl(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ptyWebSocket || ptyWebSocket.readyState !== WebSocket.OPEN) {
      reject(new Error('pty_not_connected'));
      return;
    }
    const requestId = `pty-${Date.now()}-${++ptyControlSeq}`;
    const timer = setTimeout(() => {
      ptyControlRequests.delete(requestId);
      reject(new Error(`${type}_timeout`));
    }, 8000);
    ptyControlRequests.set(requestId, {
      resolve,
      reject,
      timer,
      type,
    });
    ptyWebSocket.send(JSON.stringify({ type, request_id: requestId, ...payload }));
  });
}

async function dispatchTerminalCommand(cmd, confirmed = false) {
  if (terminalMode === 'pty') {
    if (!ptyWebSocket || ptyWebSocket.readyState !== WebSocket.OPEN) {
      await connectPTY();
    }
    if (!ptyWebSocket || ptyWebSocket.readyState !== WebSocket.OPEN) {
      throw new Error('pty_not_connected');
    }
    if (confirmed) writeInfo('PTY 模式下确认后直接写入真实终端。');
    ptyWebSocket.send(new TextEncoder().encode(`${cmd}\r`));
    return null;
  }
  return runCommand(cmd, confirmed);
}

function prompt() {
  if (terminalMode === 'pty') return;
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
  if (terminalMode === 'pty') {
    writeInfo(msg);
    return;
  }
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
  if (terminalMode === 'pty') {
    return dispatchTerminalCommand(cmd, confirmed);
  }
  let prompted = false;
  try {
    statusEl.textContent = '执行中...';
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
      const shown = out.length > MAX_TERM_CHARS ? (out.slice(0, MAX_TERM_CHARS) + '\n...（输出过长已截断，完整内容在右侧时间线可下载）\n') : out;
      term.write(`\r\n${shown.replaceAll('\n', '\r\n')}`);
    }
    if (execRes.stderr) {
      const err = String(execRes.stderr);
      const shown = err.length > MAX_TERM_CHARS ? (err.slice(0, MAX_TERM_CHARS) + '\n...（stderr 过长已截断，完整内容在右侧时间线可下载）\n') : err;
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
            await dispatchTerminalCommand(s.command, false);
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
    statusEl.textContent = '閿欒';
    writeError(String(e.message || e));
  } finally {
    isExecuting = false;
    if (!prompted) prompt();
  }
}

clearTerminalUi();

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
initAgentState();
renderAgentPanel();
planRenderer.clear();
renderAuditReport(null);
if (onboardingEl) onboardingEl.classList.remove('hidden');
refreshResponsiveLayout();

async function refreshRunbookList() {
  if (!runbookListEl) return;
  try {
    runbookListEl.innerHTML = '<div class="audit-empty">加载中...</div>';
    const data = await apiRunbooksList();
    latestRunbookItems = Array.isArray(data.items) ? data.items : [];
    if (!latestRunbookItems.length) {
      runbookListEl.innerHTML = '<div class="audit-empty">暂无 Runbook，可上传自定义 Markdown。</div>';
      return;
    }
    runbookListEl.innerHTML = '';
    for (const item of latestRunbookItems) {
      const row = document.createElement('div');
      row.className = 'runbook-item';
      row.innerHTML = `
        <div class="runbook-item-head">
          <div>
            <div class="runbook-item-title">${escapeHtml(item.title || item.name)}</div>
            <div class="runbook-item-meta">${escapeHtml(item.source || '')} · ${(item.size || 0)} bytes</div>
          </div>
          <div class="runbook-item-actions"></div>
        </div>
      `;
      const actions = row.querySelector('.runbook-item-actions');
      if (actions) {
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.textContent = '载入名称';
        fillBtn.onclick = () => {
          if (runbookFileNameEl) runbookFileNameEl.value = item.name || '';
        };
        actions.appendChild(fillBtn);
        if (item.editable) {
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'danger';
          deleteBtn.textContent = '删除';
          deleteBtn.onclick = async () => {
            await apiRunbooksDelete(item.name);
            await refreshRunbookList();
          };
          actions.appendChild(deleteBtn);
        }
      }
      runbookListEl.appendChild(row);
    }
  } catch (err) {
    runbookListEl.innerHTML = `<div class="audit-empty">加载失败: ${escapeHtml(String(err.message || err))}</div>`;
  }
}

function openRunbookModal() {
  if (!runbookModalEl) return;
  runbookModalEl.classList.remove('hidden');
  runbookModalEl.setAttribute('aria-hidden', 'false');
  refreshRunbookList();
}

function closeRunbookModal() {
  if (!runbookModalEl) return;
  runbookModalEl.classList.add('hidden');
  runbookModalEl.setAttribute('aria-hidden', 'true');
}

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
    llmTokenInput.value = cachedLlmToken;
    llmTokenInput.focus();
  }
  renderProviderOptions();
  (async () => {
    try {
      const st = await apiLlmStatus();
      setProviderSelection(st.provider || 'modelscope');
      if (llmModelInput) llmModelInput.value = st.model || '';
      if (llmBaseUrlInput) llmBaseUrlInput.value = st.base_url || '';
      syncLlmModelPicker();
      if (llmModalHint && st.has_token && !cachedLlmToken) {
        llmModalHint.textContent = '后端已配置 Token（出于安全前端不读取明文）；如需修改请重新粘贴。';
      }
    } catch (e) {
      // ignore
    }
  })();
}

if (sideTabTimelineEl) sideTabTimelineEl.addEventListener('click', () => switchSidePanel('timeline'));
if (sideTabPlanEl) sideTabPlanEl.addEventListener('click', () => switchSidePanel('plan'));
if (sideTabAuditEl) sideTabAuditEl.addEventListener('click', () => switchSidePanel('audit'));
if (planBtnFitEl) planBtnFitEl.addEventListener('click', () => planRenderer.fit());
if (planBtnEditEl) {
  planBtnEditEl.addEventListener('click', () => {
    const next = !planBtnEditEl.classList.contains('plan-btn-active');
    planBtnEditEl.classList.toggle('plan-btn-active', next);
    planRenderer.setEditMode(next);
  });
}
if (planBtnApproveEl) planBtnApproveEl.addEventListener('click', () => approveAllPlanNodes());
if (planBtnExecuteEl) planBtnExecuteEl.addEventListener('click', () => executeCurrentPlan());
if (planBtnStopEl) {
  planBtnStopEl.addEventListener('click', async () => {
    if (!currentPlan || !currentPlan.id) return;
    await apiPlanCancel(currentPlan.id);
    closePlanStream();
    statusEl.textContent = '计划已中断';
  });
}
if (nodePopoverCloseEl) nodePopoverCloseEl.addEventListener('click', () => closeNodePopover());
document.addEventListener('click', (ev) => {
  if (!nodePopoverEl || nodePopoverEl.classList.contains('hidden')) return;
  const target = ev.target;
  if (nodePopoverEl.contains(target)) return;
  if (target && target.closest && target.closest('.plan-node')) return;
  closeNodePopover();
});

for (const btn of demoBtnEls) {
  btn.addEventListener('click', async () => {
    const key = String(btn.getAttribute('data-demo') || '').trim();
    if (key === 'custom') {
      if (onboardingEl) onboardingEl.classList.add('hidden');
      refreshResponsiveLayout();
      writeInfoAbovePrompt('请输入自然语言问题后回车，系统会生成执行计划。');
      return;
    }
    const intent = DEMO_INTENTS[key];
    if (!intent) return;
    if (onboardingEl) onboardingEl.classList.add('hidden');
    refreshResponsiveLayout();
    await ensureDemoContext(key);
    echoIntentToTerminal(intent);
    await startIntentIteration(intent, {
      autoExecute: false,
      streamPayload: {
        extra: {
          demo_key: key,
        },
      },
    });
  });
}
if (onboardingCloseEl) {
  onboardingCloseEl.addEventListener('click', () => {
    if (onboardingEl) onboardingEl.classList.add('hidden');
    refreshResponsiveLayout();
  });
}

if (runbooksBtn) runbooksBtn.addEventListener('click', () => openRunbookModal());
if (runbookCloseEl) runbookCloseEl.addEventListener('click', () => closeRunbookModal());
if (runbookRefreshEl) runbookRefreshEl.addEventListener('click', () => refreshRunbookList());
if (runbookModalEl) {
  runbookModalEl.addEventListener('click', (ev) => {
    if (ev.target === runbookModalEl || (ev.target && ev.target.classList && ev.target.classList.contains('modal-backdrop'))) {
      closeRunbookModal();
    }
  });
}
if (runbookFileInputEl) {
  runbookFileInputEl.addEventListener('change', async (ev) => {
    const file = ev.target && ev.target.files ? ev.target.files[0] : null;
    if (!file) return;
    if (runbookFileNameEl && !runbookFileNameEl.value) runbookFileNameEl.value = file.name;
    const text = await file.text();
    if (runbookContentInputEl) runbookContentInputEl.value = text;
  });
}
if (runbookSaveEl) {
  runbookSaveEl.addEventListener('click', async () => {
    const filename = runbookFileNameEl ? String(runbookFileNameEl.value || '').trim() : '';
    const content = runbookContentInputEl ? String(runbookContentInputEl.value || '') : '';
    if (!filename || !content.trim()) {
      writeError('请填写文件名并提供 Markdown 内容。');
      return;
    }
    try {
      statusEl.textContent = '上传 Runbook...';
      await apiRunbooksUpsert(filename, content);
      await refreshRunbookList();
      statusEl.textContent = '知识库已更新';
    } catch (err) {
      statusEl.textContent = '错误';
      writeError(String(err.message || err));
    }
  });
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

function setProviderDropdownOpen(open) {
  if (!llmProviderDropdownBtn || !llmProviderDropdownMenu) return;
  if (open) {
    llmProviderDropdownMenu.classList.remove('hidden');
    llmProviderDropdownBtn.setAttribute('aria-expanded', 'true');
  } else {
    llmProviderDropdownMenu.classList.add('hidden');
    llmProviderDropdownBtn.setAttribute('aria-expanded', 'false');
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
      llmModelDropdownBtn.textContent = '常用模型（点击选择后自动填入）...';
    }
  }
}

function closeLlmModal() {
  if (!llmModal) return;
  setDropdownOpen(false);
  setProviderDropdownOpen(false);
  llmModal.classList.add('hidden');
  llmModal.setAttribute('aria-hidden', 'true');
}

async function saveLlmTokenFromModal() {
  const provider = llmProviderSelect ? String(llmProviderSelect.value || '').trim() : 'modelscope';
  const token = llmTokenInput ? String(llmTokenInput.value || '').trim() : '';
  const model = llmModelInput ? String(llmModelInput.value || '').trim() : '';
  const baseUrl = llmBaseUrlInput ? String(llmBaseUrlInput.value || '').trim() : '';
  if (!provider && !token && !model && !baseUrl) {
    if (llmModalHint) llmModalHint.textContent = '请至少填写 Provider/Token/模型/Base URL 之一。';
    return;
  }
  try {
    statusEl.textContent = '保存 LLM 配置...';
    await apiSetLlmConfig(provider || null, token || null, model || null, baseUrl || null);

    cachedLlmToken = token;
    try {
      if (cachedLlmToken) sessionStorage.setItem(LLM_TOKEN_STORAGE_KEY, cachedLlmToken);
      else sessionStorage.removeItem(LLM_TOKEN_STORAGE_KEY);
    } catch {
      // ignore storage failures
    }

    const st = await apiLlmStatus();
    writeInfo(`LLM 配置已保存。Provider=${st.provider}，LLM=${st.enabled ? 'ON' : 'OFF'}，Model=${st.model}`);
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
  const provider = llmProviderSelect ? String(llmProviderSelect.value || '').trim() : 'modelscope';
  const token = llmTokenInput ? String(llmTokenInput.value || '').trim() : '';
  const model = llmModelInput ? String(llmModelInput.value || '').trim() : '';
  const baseUrl = llmBaseUrlInput ? String(llmBaseUrlInput.value || '').trim() : '';
  try {
    if (llmModalHint) llmModalHint.textContent = '测试中...';
    if (llmTestBtn) llmTestBtn.disabled = true;
    const res = await apiLlmTest(provider || null, token || null, model || null, baseUrl || null);
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
    writeInfo('打开 LLM 设置...');
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
      setProviderDropdownOpen(false);
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
    setProviderDropdownOpen(false);
    const isOpen = llmModelDropdownMenu && !llmModelDropdownMenu.classList.contains('hidden');
    setDropdownOpen(!isOpen);
    syncLlmModelPicker();
  });
}

if (llmProviderDropdownBtn) {
  llmProviderDropdownBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDropdownOpen(false);
    const isOpen = llmProviderDropdownMenu && !llmProviderDropdownMenu.classList.contains('hidden');
    setProviderDropdownOpen(!isOpen);
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

if (llmProviderDropdownMenu) {
  llmProviderDropdownMenu.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.target && ev.target.closest ? ev.target.closest('[data-value]') : null;
    if (!target) return;
    const v = String(target.getAttribute('data-value') || '').trim();
    if (v) {
      setProviderSelection(v, { syncModel: true });
    }
    setProviderDropdownOpen(false);
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

document.addEventListener('click', (ev) => {
  if (!llmProviderDropdownMenu || !llmProviderDropdownBtn || !llmProviderDropdown) return;
  if (llmProviderDropdownMenu.classList.contains('hidden')) return;
  const t = ev.target;
  if (llmProviderDropdown.contains(t)) return;
  setProviderDropdownOpen(false);
});

async function handlePlanModeInput(data) {
  // Ctrl+C
  if (data === '\x03') {
    if (isExecuting) {
      writeInfoAbovePrompt('^C 中断中...');
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
    const intent = classifyInputIntent(cmd);
    if (intent.kind !== 'command') {
      pushHistory(cmd);
      term.write('\r\n');
      currentLine = '';
      cursorPos = 0;
      if (intent.kind === 'chat') {
        handleChatIntent(cmd);
      } else if (intent.kind === 'clarify') {
        handleClarifyIntent(cmd);
      } else {
        await startIntentIteration(cmd, { autoExecute: false, generatePlan: true });
      }
      prompt();
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
}

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
      statusEl.textContent = `切换 executor=${nextMode}...`;
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
    ptySupported = String(h.pty_supported || '0') === '1';
    demoLocalRoot = String(h.local_root || '').trim();
    demoWorkspaceAvailable = String(h.demo_workspace_available || '0') === '1';
    applyTerminalModeUi();

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
      await setTerminalMode('plan');
      return;
    }
    if (h && h.executor) currentExecutorMode = String(h.executor);
    await setTerminalMode('plan');
  } catch {
    statusEl.textContent = '后端未连接';
  }
})();

if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    try {
      const ok = confirm('创建新会话并清空当前控制台/历史？（不会清空本地 LLM Token）');
      if (!ok) return;
      statusEl.textContent = '重置中...';
      // Keep the LLM token in sessionStorage; only reset session/timeline/UI.
      await resetClientState({ clearToken: false, newSession: true, refreshPrompt: false });
      await setTerminalMode(terminalMode);
    } catch (e) {
      statusEl.textContent = '错误';
      writeError(String(e.message || e));
    } finally {
      prompt();
    }
  });
}

if (terminalModeSwitchEl) {
  terminalModeSwitchEl.addEventListener('click', async (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-term-mode]') : null;
    if (!btn || btn.disabled) return;
    const nextMode = String(btn.getAttribute('data-term-mode') || '').trim();
    if (!nextMode || nextMode === terminalMode) return;
    await setTerminalMode(nextMode);
  });
}

if (askAiBtn) {
  askAiBtn.addEventListener('click', async () => {
    await requestPtySuggestion();
  });
}

document.addEventListener('keydown', (ev) => {
  if (terminalMode !== 'pty') return;
  if (ev.ctrlKey && ev.code === 'Space') {
    ev.preventDefault();
    void requestPtySuggestion();
  }
});

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

