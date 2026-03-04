/* global Terminal, FitAddon */

const statusEl = document.getElementById('status');
const stepsEl = document.getElementById('steps');
const suggestionsEl = document.getElementById('suggestions');
const hintEl = document.getElementById('hint');
const exportBtn = document.getElementById('export');
const resetBtn = document.getElementById('reset');
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
  return '...' + s.slice(-47);
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

const DEMO_INTENTS = {
  port: '端口 8000 被占用了怎么办？请生成排查和修复执行计划。',
  docker: '帮我配置 Docker 国内镜像源，并给出可以验证是否生效的执行计划。',
  git: '我输入了 git chekcout main，帮我诊断并生成修复执行计划。',
};

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
let latestRunbookItems = [];

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

function setPlanUnread(hasUnread) {
  if (!planTabDotEl) return;
  planTabDotEl.classList.toggle('hidden', !hasUnread);
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

  render(plan, { onNodeClick } = {}) {
    this.plan = plan;
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
      .scaleExtent([0.35, 2.5])
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
      group.append('path')
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
      this.edgeEls.push({ source: edge.source_id, target: edge.target_id, el: group });
    }

    for (const node of plan.nodes) {
      const layoutNode = graph.node(node.id);
      if (!layoutNode) continue;
      const group = content
        .append('g')
        .attr('class', `plan-node node-type-${node.type} status-pending`)
        .attr('transform', `translate(${layoutNode.x - layoutNode.width / 2}, ${layoutNode.y - layoutNode.height / 2})`)
        .on('click', (event) => {
          if (typeof onNodeClick === 'function') onNodeClick(node, event.currentTarget);
        });

      const w = layoutNode.width;
      const h = layoutNode.height;
      group.append('rect').attr('class', `risk-bar risk-${node.risk_level || 'safe'}`).attr('x', 0).attr('y', 0).attr('width', 6).attr('height', h).attr('rx', 6);
      if (node.type === 'condition') {
        group.append('polygon').attr('class', 'node-bg').attr('points', `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`);
      } else if (node.type === 'end') {
        group.append('rect').attr('class', 'node-bg').attr('x', 0).attr('y', 0).attr('rx', 26).attr('ry', 26).attr('width', w).attr('height', h);
      } else {
        group.append('rect').attr('class', 'node-bg').attr('x', 0).attr('y', 0).attr('rx', 18).attr('ry', 18).attr('width', w).attr('height', h);
      }
      const iconWrap = group.append('g').attr('class', 'node-icon-wrap');
      iconWrap.append('circle').attr('class', 'node-icon-bg').attr('cx', 24).attr('cy', 24).attr('r', 12);
      iconWrap.append('text').attr('class', 'node-icon').attr('x', 24).attr('y', 28).attr('text-anchor', 'middle').text(this.typeIcon(node.type));
      group.append('text').attr('class', 'node-title').attr('x', 44).attr('y', 28).text(this.truncate(node.title || node.id, node.type === 'condition' ? 18 : 26));
      if (node.type !== 'condition') {
        group.append('text').attr('class', 'node-command').attr('x', 18).attr('y', 52).text(this.truncate(node.command || node.description || node.type, 34));
      } else {
        group.append('text').attr('class', 'node-command is-center').attr('x', w / 2).attr('y', 68).attr('text-anchor', 'middle').text(this.truncate(node.description || node.command || 'Condition', 18));
      }
      group.append('rect').attr('class', `node-pill pill-risk-${node.risk_level || 'safe'}`).attr('x', 16).attr('y', h - 28).attr('width', 52).attr('height', 16).attr('rx', 8);
      group.append('text').attr('class', `node-pill-text`).attr('x', 42).attr('y', h - 16).attr('text-anchor', 'middle').text((node.risk_level || 'safe').toUpperCase());
      const groundedLabel = node.grounded ? 'Grounded' : 'Unverified';
      const groundedWidth = node.grounded ? 74 : 84;
      group.append('rect').attr('class', `node-pill ${node.grounded ? 'pill-grounded-true' : 'pill-grounded-false'}`).attr('x', w - groundedWidth - 16).attr('y', h - 28).attr('width', groundedWidth).attr('height', 16).attr('rx', 8);
      group.append('text').attr('class', 'node-pill-text grounded').attr('x', w - 16 - groundedWidth / 2).attr('y', h - 16).attr('text-anchor', 'middle').text(groundedLabel);
      group.append('text').attr('class', 'badge-icon').attr('x', w - 18).attr('y', 28).attr('text-anchor', 'end').text('○');
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
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
    const scale = Math.min(width / (bounds.width + 48), height / (bounds.height + 48), 1);
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
    if (payload.type === 'node_start') {
      this.renderer.updateNodeStatus(payload.node_id, 'running');
      switchSidePanel('plan');
      setPlanUnread(false);
      return;
    }
    if (payload.type === 'node_done') {
      this.renderer.updateNodeStatus(payload.node_id, payload.status || 'passed');
      if (payload.status === 'failed') switchSidePanel('audit');
      return;
    }
    if (payload.type === 'node_skipped') {
      this.renderer.updateNodeStatus(payload.node_id, 'skipped');
      return;
    }
    if (payload.type === 'need_approval') {
      this.renderer.updateNodeStatus(payload.node_id, 'awaiting_approval');
      const node = currentPlan && Array.isArray(currentPlan.nodes) ? currentPlan.nodes.find((item) => item.id === payload.node_id) : null;
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
      if (planBtnStopEl) planBtnStopEl.style.display = 'none';
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

function renderAuditReport(report) {
  currentAuditReport = report || null;
  if (!auditContentEl) return;
  if (!report) {
    auditContentEl.innerHTML = '<div class="audit-empty">执行计划完成后，自动审计报告将在此展示。</div>';
    return;
  }
  const overall = String(report.overall || 'PASS').toUpperCase();
  const verdictClass = overall === 'FAIL' ? 'fail' : report.failed > 0 || report.skipped > 0 ? 'warn' : 'pass';
  const verdictIcon = verdictClass === 'fail' ? '✕' : verdictClass === 'warn' ? '!' : '✓';
  auditContentEl.innerHTML = '';
  const verdict = document.createElement('div');
  verdict.className = `audit-verdict ${verdictClass}`;
  verdict.innerHTML = `
    <div class="audit-verdict-icon">${verdictIcon}</div>
    <div class="audit-verdict-label">${escapeHtml(overall)}</div>
    <div class="audit-verdict-stats">${report.passed || 0}/${report.total || 0} 通过 · ${report.failed || 0} 失败 · ${report.skipped || 0} 跳过</div>
  `;
  auditContentEl.appendChild(verdict);

  const meta = document.createElement('div');
  meta.className = 'card';
  meta.innerHTML = `<div class="card-title"><span>Intent</span><span class="badge">${escapeHtml(report.plan_id || '')}</span></div><div class="explain">${escapeHtml(report.intent || '')}</div>`;
  auditContentEl.appendChild(meta);

  const section = document.createElement('div');
  section.className = 'audit-section-title';
  section.textContent = 'Node Results';
  auditContentEl.appendChild(section);
  for (const node of (report.nodes || [])) {
    const row = document.createElement('div');
    row.className = 'audit-finding severity-info';
    const output = node.output || {};
    const excerpt = String(output.stderr || output.stdout || '').trim().slice(0, 180);
    row.innerHTML = `
      <div class="audit-finding-header">${escapeHtml(node.title || node.node_id)} · ${escapeHtml(node.status || '')}</div>
      <div class="audit-finding-msg">风险: ${escapeHtml(node.risk_level || 'safe')} ${excerpt ? `· 输出: ${escapeHtml(excerpt)}` : ''}</div>
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
      `- Passed: ${report.passed || 0}/${report.total || 0}`,
      ``,
      `## Nodes`,
      ...((report.nodes || []).map((node) => `- ${node.title || node.node_id}: ${node.status} (${node.risk_level})`)),
    ];
    downloadText(`audit-${report.plan_id || 'report'}.md`, lines.join('\n'));
  };
  exportBar.appendChild(btnJson);
  exportBar.appendChild(btnMd);
  auditContentEl.appendChild(exportBar);
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
  planPreAuditEl.textContent = `预审查: ${warnCount} 个 warn，${blockCount} 个 block，${currentPlan.nodes.filter((node) => node.grounded).length}/${currentPlan.nodes.length} 个节点有依据`;
}

function openNodePopover(node, target, forceApproval = false) {
  if (!nodePopoverEl || !nodePopoverTitleEl || !nodePopoverBodyEl || !node) return;
  nodePopoverTitleEl.textContent = node.title || node.id;
  const citeHtml = Array.isArray(node.citations) && node.citations.length
    ? node.citations.slice(0, 2).map((citation) => `<div class="node-popover-citation">${escapeHtml(citation.title || citation.source || '')}: ${escapeHtml(citation.snippet || '')}</div>`).join('')
    : '<div class="node-popover-citation">暂无引用依据</div>';
  nodePopoverBodyEl.innerHTML = `
    <div class="node-popover-row"><span class="node-popover-label">类型</span><span class="node-popover-value">${escapeHtml(node.type || '')}</span></div>
    <div class="node-popover-row"><span class="node-popover-label">风险</span><span class="node-popover-value">${escapeHtml(node.risk_level || 'safe')}</span></div>
    <div class="node-popover-row"><span class="node-popover-label">说明</span><span class="node-popover-value">${escapeHtml(node.description || '')}</span></div>
    <div class="node-popover-cmd">${escapeHtml(node.command || '(no command)')}</div>
    ${node.rollback ? `<div class="node-popover-row"><span class="node-popover-label">回滚</span><span class="node-popover-value">${escapeHtml(node.rollback)}</span></div>` : ''}
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
          closeNodePopover();
        } catch (err) {
          writeError(String(err.message || err));
        }
      }, 'primary');
    }
    if (node.command) {
      addBtn('插入终端', () => {
        insertTextAtCursor(node.command);
        closeNodePopover();
      });
    }
  }
  const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : { right: window.innerWidth / 2, top: window.innerHeight / 2 };
  nodePopoverEl.style.left = `${Math.max(12, Math.min(window.innerWidth - 320, rect.right + 8))}px`;
  nodePopoverEl.style.top = `${Math.max(76, Math.min(window.innerHeight - 360, rect.top))}px`;
  nodePopoverEl.classList.remove('hidden');
}

function closeNodePopover() {
  if (nodePopoverEl) nodePopoverEl.classList.add('hidden');
}

function renderPlan(plan, intent) {
  currentPlan = plan;
  currentPlanIntent = intent || (plan && plan.intent) || '';
  updatePlanOpBar();
  planRenderer.render(plan, {
    onNodeClick: (node, target) => openNodePopover(node, target),
  });
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

function isLikelyNaturalLanguage(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/[\u4e00-\u9fff]/.test(value)) return true;
  const first = value.split(/\s+/)[0].toLowerCase();
  if (/^(git|npm|pnpm|yarn|node|python|python3|pip|uv|cargo|go|java|docker|kubectl|ssh|scp|ls|dir|cd|pwd|cat|type|echo|grep|rg|find|ps|kill|tasklist|taskkill|netstat|ss|lsof|curl|wget|ping|tracert|ipconfig|ifconfig|systemctl|service|journalctl|make|cmake|pytest|uvicorn|bash|sh|pwsh|powershell|cmd)$/.test(first)) {
    return false;
  }
  if (/\?$/.test(value)) return true;
  if (value.split(/\s+/).length >= 5 && !/[|><=&]/.test(value)) return true;
  return false;
}

async function streamSuggestionsForIntent(intent) {
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
    return finalPayload || { suggestions: [], steps: [] };
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
  switchSidePanel('plan');
  return result.plan;
}

async function executeCurrentPlan() {
  if (!currentPlan || !currentPlan.id) return;
  statusEl.textContent = '执行计划中...';
  if (planBtnStopEl) planBtnStopEl.style.display = 'inline-flex';
  await apiPlanExecute(currentPlan.id);
  closePlanStream();
  currentPlanStream = new PlanStreamClient(currentPlan.id, planRenderer);
  currentPlanStream.connect();
  switchSidePanel('plan');
}

async function approveAllPlanNodes() {
  if (!currentPlan || !Array.isArray(currentPlan.nodes)) return;
  for (const node of currentPlan.nodes) {
    if (node.type === 'human' || node.risk_level === 'warn' || node.risk_level === 'block') {
      try {
        await apiPlanApproveNode(currentPlan.id, node.id);
      } catch {
        // ignore individual approval failures
      }
    }
  }
}

async function startIntentIteration(intent, { autoExecute = false } = {}) {
  const normalized = String(intent || '').trim();
  if (!normalized) return;
  try {
    const sug = await streamSuggestionsForIntent(normalized);
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
        await runCommand(s.command, false);
      }
    );
    const plan = await generateExecutionPlan(normalized, sug.suggestions || []);
    if (autoExecute && plan) await executeCurrentPlan();
    setStatusReady();
  } catch (err) {
    statusEl.textContent = '错误';
    writeError(String(err.message || err));
  }
}

function setStatusReady() {
  const mode = currentExecutorMode ? String(currentExecutorMode) : 'unknown';
  statusEl.textContent = isSuggesting ? `就绪（executor=${mode}，生成建议中...）` : `就绪（executor=${mode}）`;
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
];

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

function setProviderSelection(provider, { refreshModels = true } = {}) {
  const value = String(provider || '').trim() || 'modelscope';
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
  if (refreshModels) renderModelPresets(value);
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
  });
}

async function apiPlanApproveNode(planId, nodeId) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/node/${encodeURIComponent(nodeId)}/approve`, {});
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
  await startIntentIteration(text, { autoExecute: false });
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
    const agentTag = s.agent ? ` 路 ${escapeHtml(s.agent)}` : '';
    title.innerHTML = `<span>${escapeHtml(s.title)}${agentTag}${confirmTag}</span><span class="badge-row"><span class="badge ${badgeClass(s.risk_level)}">${escapeHtml(s.risk_level)}</span>${confidenceBadge(s)}</span>`;

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
window.addEventListener('resize', () => {
  try {
    planRenderer.fit();
  } catch {
    // ignore
  }
});

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
    statusEl.textContent = '閿欒';
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
initAgentState();
renderAgentPanel();
planRenderer.clear();
renderAuditReport(null);
if (onboardingEl) onboardingEl.classList.remove('hidden');

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
      writeInfoAbovePrompt('请输入自然语言问题后回车，系统会生成执行计划。');
      return;
    }
    const intent = DEMO_INTENTS[key];
    if (!intent) return;
    if (onboardingEl) onboardingEl.classList.add('hidden');
    await startIntentIteration(intent, { autoExecute: true });
  });
}
if (onboardingCloseEl) onboardingCloseEl.addEventListener('click', () => onboardingEl && onboardingEl.classList.add('hidden'));

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
      setProviderSelection(v);
      if (llmModelInput) llmModelInput.value = '';
      syncLlmModelPicker();
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

term.onData(async (data) => {
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
    if (isLikelyNaturalLanguage(cmd)) {
      pushHistory(cmd);
      term.write('\r\n');
      currentLine = '';
      cursorPos = 0;
      await startIntentIteration(cmd, { autoExecute: MODE.get() === 'assist' });
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
      statusEl.textContent = '重置中...';
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


