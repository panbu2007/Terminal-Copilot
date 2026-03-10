# Mobile Adaptation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add phone-first (≤ 480px) responsive layout with bottom tab navigation and hamburger menu, replacing the fixed two-pane desktop grid.

**Architecture:** Pure CSS `@media (max-width: 480px)` rules override the desktop layout; a new `mobile.js` file (~200 lines) handles tab switching and hamburger menu; HTML additions inject the mobile UI elements statically (simpler and avoids flash-of-content vs. JS injection, which was noted in the spec as an alternative). Desktop layout is completely untouched.

**Tech Stack:** Vanilla HTML/CSS/JS, xterm.js, no build step. Open `frontend/index.html` served by the Python backend for manual testing.

**Spec:** `docs/superpowers/specs/2026-03-10-mobile-adaptation-design.md`

**Note on spec deviation:** The spec's "Files Changed" table said `index.html` requires no changes (JS injects mobile elements). This plan uses static HTML instead — it's simpler, avoids flash-of-content, and doesn't change the outcome. `mobile.js` is also a separate file rather than appended to `app.js`, for cleaner separation.

---

## Chunk 1: CSS Foundation

### Task 1: Hide desktop-only topbar items on mobile

**Files:**
- Modify: `frontend/static/styles.css` (append to end)

**Context:** The topbar contains `.modes` (radio buttons), two `.segmented` switch groups, four `.btn-export` buttons, and `#llmGuide`. These overflow at 375px and must be hidden — they'll reappear in the hamburger drawer. Append a fresh `@media (max-width: 480px)` block at the end of the file.

- [ ] **Step 1: Append the first mobile block to styles.css**

Add at the very end of `frontend/static/styles.css`:

```css
/* ════════════════════════════════════════════════════════
   MOBILE LAYOUT  ≤ 480px
   ════════════════════════════════════════════════════════ */

/* ── 1. Topbar: hide desktop-only items ───────────────── */
@media (max-width: 480px) {
  .topbar .modes,
  .topbar .segmented,
  .topbar .btn-export,
  #llmGuide {
    display: none !important;
  }

  .mobile-menu-btn {
    display: flex !important;
  }
}
```

- [ ] **Step 2: Verify in browser at 375px**

Open the app in Chrome DevTools with device emulation at 375px. The topbar should now show only "Terminal Copilot", the status badge, and nothing else. The four buttons and both segmented controls are gone.

- [ ] **Step 3: Commit**

```bash
git add frontend/static/styles.css
git commit -m "style: hide desktop topbar items on mobile ≤480px"
```

---

### Task 2: Override layout grid and fix main structure on mobile

**Files:**
- Modify: `frontend/static/styles.css` (append)

**Context:** On mobile the two-column grid is replaced: side pane is hidden (tabs take over), terminal pane fills the space between topbar (44px) and composer + tab bar (52px each). Append a separate `@media (max-width: 480px)` block — the browser merges multiple blocks for the same breakpoint correctly.

- [ ] **Step 1: Append the layout override block**

Add at the end of `frontend/static/styles.css`:

```css
/* ── 2. Layout: single column, side pane hidden ────────── */
@media (max-width: 480px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
    /* topbar 44px + tab bar 52px */
    height: calc(100dvh - 44px - 52px);
  }

  .terminal-pane {
    border-right: none;
    border-bottom: none;
    height: 100%;
    overflow: hidden;
  }

  /* Side pane hidden — content shown via bottom tab bar */
  .side-pane {
    display: none;
  }

  /* Composer: remove rounded corners on mobile edges */
  .composer {
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
  }

  /* Push composer above the fixed tab bar */
  .terminal-pane {
    padding-bottom: 52px;
  }

  /* Hide desktop-only hints */
  .composer-guide,
  .composer-shortcuts,
  .terminal-toolbar-hint {
    display: none;
  }

  .terminal-toolbar {
    margin-bottom: 4px;
  }
}
```

- [ ] **Step 2: Validate CSS brace balance**

```bash
node -e "
const fs = require('fs');
const css = fs.readFileSync('frontend/static/styles.css', 'utf8');
const open = (css.match(/\{/g)||[]).length;
const close = (css.match(/\}/g)||[]).length;
console.log('{ count:', open, '} count:', close, open === close ? 'OK balanced' : 'MISMATCH');
"
```

Expected output: `OK balanced`

- [ ] **Step 3: Verify layout in DevTools at 375px**

The terminal pane should fill the screen (minus topbar and composer). The composer should sit at the bottom. The side pane (Agents/Plan/Audit) is invisible.

- [ ] **Step 4: Commit**

```bash
git add frontend/static/styles.css
git commit -m "style: mobile layout — single column, hide side pane"
```

---

### Task 3: Add styles for new mobile components

**Files:**
- Modify: `frontend/static/styles.css` (append)

**Context:** The HTML for the bottom tab bar, hamburger button, and drawer is added in Task 4. Their styles go here. These rules are split: always-hidden-on-desktop components use no media query (they default to `display: none`); mobile-specific overrides use `@media (max-width: 480px)`.

- [ ] **Step 1: Append mobile component styles**

Add at the end of `frontend/static/styles.css`:

```css
/* ── 3. New mobile components (hidden on desktop by default) */

.mobile-menu-btn {
  display: none; /* shown via media query above */
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.mobile-menu-btn:hover { background: rgba(255, 255, 255, 0.10); }

/* Bottom tab bar — hidden on desktop */
.mobile-tab-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 52px;
  background: #0d1426;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 100;
  align-items: stretch;
}

.mobile-tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 6px 0;
  position: relative;
}

.mobile-tab-btn .tab-icon { font-size: 17px; line-height: 1; }
.mobile-tab-btn .tab-label { font-size: 9px; line-height: 1; }

.mobile-tab-btn.is-active { color: var(--text); }

.mobile-tab-btn.is-active::after {
  content: '';
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background: #8b5cf6;
  border-radius: 2px;
}

.mobile-tab-btn:hover:not(.is-active) { background: rgba(255, 255, 255, 0.04); }

/* Unread dot on plan tab */
.mobile-tab-btn .mob-tab-dot {
  position: absolute;
  top: 5px;
  right: calc(50% - 14px);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ef4444;
  pointer-events: none;
}

/* Hamburger drawer */
.mobile-drawer-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 200;
}

.mobile-drawer-overlay.is-open { display: block; }

.mobile-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 260px;
  background: #111831;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 201;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.22s ease;
  overflow-y: auto;
}

.mobile-drawer.is-open { transform: translateX(0); }

.mobile-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.mobile-drawer-title { font-weight: 700; font-size: 14px; color: var(--text); }

.mobile-drawer-close {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.mobile-drawer-close:hover { color: var(--text); background: transparent; }

.mobile-drawer-section {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mobile-drawer-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.mobile-drawer-segmented {
  display: flex;
  border: 1px solid #374151;
  border-radius: 8px;
  overflow: hidden;
  background: #0b1220;
}

.mobile-drawer-seg-btn {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 7px 0;
  font-size: 12px;
  cursor: pointer;
  border-right: 1px solid #374151;
}

.mobile-drawer-seg-btn:last-child { border-right: none; }
.mobile-drawer-seg-btn.is-active { background: #1f2937; color: var(--text); }

.mobile-drawer-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.mobile-drawer-btns button { padding: 8px 6px; font-size: 12px; border-radius: 8px; }

/* ── 4. Mobile overrides: node popover and modals ──────── */
@media (max-width: 480px) {
  /* Node popover → bottom sheet */
  .node-popover {
    position: fixed;
    top: auto;
    bottom: 52px; /* above tab bar */
    left: 0;
    right: 0;
    width: 100%;
    border-radius: 16px 16px 0 0;
    max-height: 60vh;
    overflow-y: auto;
  }

  /* Modals → full-width bottom sheet */
  .modal {
    align-items: flex-end;
  }

  .modal-card {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-height: 90dvh;
    border-radius: 16px 16px 0 0;
    overflow-y: auto;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }

  /* Allow pinch-zoom on plan graph */
  .plan-graph svg {
    touch-action: pinch-zoom;
  }

  /* Show bottom tab bar */
  .mobile-tab-bar {
    display: flex;
  }
}
```

- [ ] **Step 2: Validate CSS brace balance**

```bash
node -e "
const fs = require('fs');
const css = fs.readFileSync('frontend/static/styles.css', 'utf8');
const open = (css.match(/\{/g)||[]).length;
const close = (css.match(/\}/g)||[]).length;
console.log('{ count:', open, '} count:', close, open === close ? 'OK balanced' : 'MISMATCH');
"
```

Expected output: `OK balanced`

- [ ] **Step 3: Commit**

```bash
git add frontend/static/styles.css
git commit -m "style: add mobile tab bar, hamburger drawer, bottom-sheet overrides"
```

---

## Chunk 2: HTML Structure

### Task 4: Add mobile UI elements to index.html

**Files:**
- Modify: `frontend/index.html`

**Context:** Four additions to the HTML:
1. A hamburger button inside `.topbar` (always in DOM, `display:none` on desktop via CSS)
2. A `.mobile-drawer-overlay` + `.mobile-drawer` div before `</body>`
3. A `.mobile-tab-bar` nav before `</body>`
4. A `<script src="/static/mobile.js">` before `</body>`

The side panels (`#timelinePanel`, `#planPanel`, `#auditPanel`) stay in `.side-pane` — `mobile.js` moves them into a full-screen wrapper at runtime.

- [ ] **Step 1: Add hamburger button to topbar**

In `frontend/index.html`, locate the closing `</header>` tag. Add the hamburger button as the last item inside the header, right before `</header>`:

```html
      <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="打开菜单" type="button">≡</button>
    </header>
```

The surrounding context should look like:
```html
      <div class="status" id="status">连接中...</div>
      <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="打开菜单" type="button">≡</button>
    </header>
```

- [ ] **Step 2: Add drawer overlay and drawer before `</body>`**

Before the final `</body>` tag (after the existing `<script>` tags), add:

```html
    <!-- Mobile Hamburger Drawer -->
    <div id="mobileDrawerOverlay" class="mobile-drawer-overlay"></div>
    <div id="mobileDrawer" class="mobile-drawer" role="dialog" aria-modal="true" aria-label="设置菜单">
      <div class="mobile-drawer-header">
        <span class="mobile-drawer-title">设置</span>
        <button class="mobile-drawer-close" id="mobileDrawerClose" type="button" aria-label="关闭">×</button>
      </div>
      <div class="mobile-drawer-section">
        <div class="mobile-drawer-label">AI 模式</div>
        <div class="mobile-drawer-segmented" id="mobileModeSeg">
          <button class="mobile-drawer-seg-btn" data-mode="suggest" type="button">只建议</button>
          <button class="mobile-drawer-seg-btn" data-mode="assist" type="button">建议+执行</button>
        </div>
      </div>
      <div class="mobile-drawer-section">
        <div class="mobile-drawer-label">终端模式</div>
        <div class="mobile-drawer-segmented" id="mobileTermModeSeg">
          <button class="mobile-drawer-seg-btn" data-term-mode="pty" type="button">🖥️ 真实</button>
          <button class="mobile-drawer-seg-btn" data-term-mode="plan" type="button">📋 计划</button>
        </div>
      </div>
      <div class="mobile-drawer-section">
        <div class="mobile-drawer-label">执行器</div>
        <div class="mobile-drawer-segmented" id="mobileExecSeg">
          <button class="mobile-drawer-seg-btn" data-exec="simulate" type="button">simulate</button>
          <button class="mobile-drawer-seg-btn" data-exec="local" type="button">local</button>
        </div>
      </div>
      <div class="mobile-drawer-section">
        <div class="mobile-drawer-btns">
          <button id="mobileResetBtn" type="button">新会话</button>
          <button id="mobileRunbooksBtn" type="button">知识库</button>
          <button id="mobileLlmBtn" type="button">LLM设置</button>
          <button id="mobileExportBtn" type="button">导出回放</button>
        </div>
      </div>
    </div>

    <!-- Mobile Bottom Tab Bar -->
    <nav class="mobile-tab-bar" id="mobileTabBar" aria-label="导航">
      <button class="mobile-tab-btn is-active" data-tab="terminal" type="button" aria-label="终端">
        <span class="tab-icon">🖥</span>
        <span class="tab-label">终端</span>
      </button>
      <button class="mobile-tab-btn" data-tab="agents" type="button" aria-label="Agents">
        <span class="tab-icon">🧠</span>
        <span class="tab-label">Agents</span>
      </button>
      <button class="mobile-tab-btn" data-tab="plan" type="button" aria-label="计划">
        <span class="tab-icon">🗺️</span>
        <span class="tab-label">计划</span>
        <span class="mob-tab-dot hidden" id="mobPlanDot"></span>
      </button>
      <button class="mobile-tab-btn" data-tab="audit" type="button" aria-label="审计">
        <span class="tab-icon">🧾</span>
        <span class="tab-label">审计</span>
      </button>
    </nav>
```

- [ ] **Step 3: Add mobile.js script tag**

After the last `<script>` tag and before `</body>`:

```html
    <script src="/static/mobile.js"></script>
  </body>
```

- [ ] **Step 4: Verify HTML at desktop width**

At desktop width (> 480px): tab bar and hamburger button are invisible. Layout looks exactly as before.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html
git commit -m "html: add mobile hamburger button, drawer, and bottom tab bar"
```

---

## Chunk 3: JavaScript Module

### Task 5: Expose fitAddon globally in app.js

**Files:**
- Modify: `frontend/static/app.js` (line ~2213)

**Context:** `fitAddon` is a module-level variable in `app.js` (defined at line 2208, populated at line 2211). It is not on `window`. `mobile.js` needs to call `fitAddon.fit()` when switching back to the terminal tab. Adding `window.fitAddon = fitAddon;` is the minimal change needed.

- [ ] **Step 1: Find the fitAddon instantiation in app.js**

```bash
grep -n "fitAddon = new FitAddon" frontend/static/app.js
```

Expected output shows line ~2211: `fitAddon = new FitAddon.FitAddon();`

- [ ] **Step 2: Add window.fitAddon assignment after instantiation**

On the line immediately after `fitAddon = new FitAddon.FitAddon();` (around line 2211), add:

```js
    window.fitAddon = fitAddon;
```

The surrounding context should look like:
```js
    fitAddon = new FitAddon.FitAddon();
    window.fitAddon = fitAddon;   // expose for mobile.js
    term.loadAddon(fitAddon);
    fitAddon.fit();
```

- [ ] **Step 3: Commit**

```bash
git add frontend/static/app.js
git commit -m "fix: expose fitAddon on window for mobile tab resize"
```

---

### Task 6: Create mobile.js

**Files:**
- Create: `frontend/static/mobile.js`

**Context:** This module handles all mobile interactivity. It runs after `app.js` (loaded last in HTML), so it can call `switchSidePanel()` which is defined in `app.js`. The module only activates at ≤ 480px via `matchMedia`.

Tab switching works by:
- For terminal tab: hide the `.mobile-tab-content` wrapper, show `.terminal-pane`
- For other tabs: create a full-screen wrapper div, move the target panel into it, hide `.terminal-pane`

- [ ] **Step 1: Create frontend/static/mobile.js**

```js
/* mobile.js — Mobile navigation for Terminal Copilot
 * Activates only at ≤ 480px. Handles:
 *   - Bottom tab bar switching (terminal / agents / plan / audit)
 *   - Hamburger drawer open/close
 *   - Drawer segmented buttons synced with desktop equivalents
 */
(function () {
  'use strict';

  const MOBILE_BP = 480;

  // ── Element refs ─────────────────────────────────────────
  const tabBar        = document.getElementById('mobileTabBar');
  const tabBtns       = tabBar ? Array.from(tabBar.querySelectorAll('.mobile-tab-btn')) : [];
  const terminalPane  = document.querySelector('.terminal-pane');
  const sidePaneEl    = document.querySelector('.side-pane');
  const timelinePanel = document.getElementById('timelinePanel');
  const planPanel     = document.getElementById('planPanel');
  const auditPanel    = document.getElementById('auditPanel');
  const mobPlanDot    = document.getElementById('mobPlanDot');

  const menuBtn       = document.getElementById('mobileMenuBtn');
  const drawerOverlay = document.getElementById('mobileDrawerOverlay');
  const drawer        = document.getElementById('mobileDrawer');
  const drawerClose   = document.getElementById('mobileDrawerClose');

  const desktopModeInputs  = document.querySelectorAll('input[name="mode"]');
  const desktopTermModeSeg = document.getElementById('terminalModeSwitch');
  const desktopExecutorSeg = document.getElementById('executorSwitch');

  // ── State ────────────────────────────────────────────────
  let activeTab = 'terminal';
  let mobileWrapper = null;

  // ── Full-screen wrapper for non-terminal tabs ─────────────
  function ensureWrapper() {
    if (mobileWrapper) return mobileWrapper;
    mobileWrapper = document.createElement('div');
    mobileWrapper.id = 'mobileTabContent';
    mobileWrapper.style.cssText = [
      'display:none',
      'position:fixed',
      'top:44px',
      'bottom:calc(52px + 110px)',   /* above tab bar + composer height */
      'left:0',
      'right:0',
      'overflow:hidden',
      'background:var(--bg)',
      'z-index:50',
    ].join(';');
    document.body.appendChild(mobileWrapper);
    return mobileWrapper;
  }

  // ── Tab switching ─────────────────────────────────────────
  function showTab(tabName) {
    activeTab = tabName;
    tabBtns.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabName);
    });

    if (tabName === 'terminal') {
      if (terminalPane) terminalPane.style.display = '';
      if (mobileWrapper) mobileWrapper.style.display = 'none';
      // Re-fit xterm after becoming visible
      requestAnimationFrame(() => {
        if (window.fitAddon) window.fitAddon.fit();
      });
      return;
    }

    // Non-terminal tab: hide terminal pane, show wrapper with target panel
    if (terminalPane) terminalPane.style.display = 'none';
    const wrapper = ensureWrapper();
    wrapper.style.display = 'block';

    const panelMap = { agents: timelinePanel, plan: planPanel, audit: auditPanel };
    const panel = panelMap[tabName];
    if (!panel) return;

    if (panel.parentElement !== wrapper) {
      wrapper.appendChild(panel);
    }
    panel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:12px;';

    // Sync desktop side-tab state for plan dot and fit
    if (typeof switchSidePanel === 'function') {
      switchSidePanel(tabName === 'agents' ? 'timeline' : tabName);
    }
  }

  // ── Hamburger drawer ──────────────────────────────────────
  function openDrawer() {
    syncDrawerFromDesktop();
    drawer.classList.add('is-open');
    drawerOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    drawerOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function syncDrawerFromDesktop() {
    // AI mode radios
    const checkedMode = Array.from(desktopModeInputs).find(i => i.checked);
    if (checkedMode) {
      document.querySelectorAll('#mobileModeSeg .mobile-drawer-seg-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.mode === checkedMode.value);
      });
    }

    // Terminal mode segmented
    const activeTermBtn = desktopTermModeSeg
      ? desktopTermModeSeg.querySelector('.seg-btn.is-active') : null;
    if (activeTermBtn) {
      document.querySelectorAll('#mobileTermModeSeg .mobile-drawer-seg-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.termMode === activeTermBtn.dataset.termMode);
      });
    }

    // Executor segmented
    const activeExecBtn = desktopExecutorSeg
      ? desktopExecutorSeg.querySelector('.seg-btn.is-active') : null;
    if (activeExecBtn) {
      document.querySelectorAll('#mobileExecSeg .mobile-drawer-seg-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.exec === activeExecBtn.dataset.exec);
      });
    }
  }

  function wireDrawerButtons() {
    // AI mode
    document.querySelectorAll('#mobileModeSeg .mobile-drawer-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const radio = document.querySelector(`input[name="mode"][value="${btn.dataset.mode}"]`);
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
        syncDrawerFromDesktop();
        closeDrawer();
      });
    });

    // Terminal mode
    document.querySelectorAll('#mobileTermModeSeg .mobile-drawer-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const desktopBtn = desktopTermModeSeg
          ? desktopTermModeSeg.querySelector(`button[data-term-mode="${btn.dataset.termMode}"]`) : null;
        if (desktopBtn) desktopBtn.click();
        syncDrawerFromDesktop();
        closeDrawer();
      });
    });

    // Executor
    document.querySelectorAll('#mobileExecSeg .mobile-drawer-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const desktopBtn = desktopExecutorSeg
          ? desktopExecutorSeg.querySelector(`button[data-exec="${btn.dataset.exec}"]`) : null;
        if (desktopBtn) desktopBtn.click();
        syncDrawerFromDesktop();
        closeDrawer();
      });
    });

    // Action buttons — delegate to desktop counterparts
    const btnMap = {
      mobileResetBtn:    'reset',
      mobileRunbooksBtn: 'runbooks',
      mobileLlmBtn:      'llm',
      mobileExportBtn:   'export',
    };
    for (const [mId, dId] of Object.entries(btnMap)) {
      const mEl = document.getElementById(mId);
      const dEl = document.getElementById(dId);
      if (mEl && dEl) {
        mEl.addEventListener('click', () => {
          closeDrawer();
          setTimeout(() => dEl.click(), 150); // let drawer close before modal opens
        });
      }
    }
  }

  // ── Plan dot sync ─────────────────────────────────────────
  function observePlanDot() {
    const desktopDot = document.getElementById('planTabDot');
    if (!desktopDot || !mobPlanDot) return;
    const obs = new MutationObserver(() => {
      mobPlanDot.classList.toggle('hidden', desktopDot.classList.contains('hidden'));
    });
    obs.observe(desktopDot, { attributes: true, attributeFilter: ['class'] });
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    tabBtns.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
    if (menuBtn)       menuBtn.addEventListener('click', openDrawer);
    if (drawerClose)   drawerClose.addEventListener('click', closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
    wireDrawerButtons();
    observePlanDot();
    showTab('terminal');
  }

  // ── Restore panels to side-pane on desktop ────────────────
  function teardown() {
    [timelinePanel, planPanel, auditPanel].forEach(panel => {
      if (panel && mobileWrapper && panel.parentElement === mobileWrapper) {
        sidePaneEl.appendChild(panel);
        panel.style.cssText = '';
      }
    });
    if (mobileWrapper) mobileWrapper.style.display = 'none';
    if (terminalPane) terminalPane.style.display = '';
  }

  // ── Responsive activation ─────────────────────────────────
  const mq = window.matchMedia(`(max-width: ${MOBILE_BP}px)`);

  function onBreakpoint(e) {
    if (e.matches) {
      init();
    } else {
      teardown();
    }
  }

  mq.addEventListener('change', onBreakpoint);
  onBreakpoint(mq); // run immediately on load
})();
```

- [ ] **Step 2: Verify tab switching at 375px in DevTools**

- Tap 🧠 Agents tab → terminal disappears, Agent Collaboration panel fills screen
- Tap 🗺 计划 tab → plan DAG fills screen
- Tap 🧾 审计 tab → audit content fills screen
- Tap 🖥 终端 tab → terminal reappears, xterm fits correctly

- [ ] **Step 3: Verify hamburger drawer at 375px**

- Tap ≡ → drawer slides in from right with dark overlay
- Tap ✕ or overlay → drawer closes
- Mode/executor segmented buttons show current active state
- Tap "LLM设置" → drawer closes, then LLM modal opens as bottom sheet

- [ ] **Step 4: Verify desktop is unchanged at 1024px**

- Hamburger button invisible
- Tab bar invisible
- All original topbar controls visible and functional

- [ ] **Step 5: Commit**

```bash
git add frontend/static/mobile.js
git commit -m "feat: mobile tab switching and hamburger drawer"
```

---

## Chunk 4: Final Verification

### Task 7: Full acceptance test

- [ ] **Step 1: Test all success criteria from spec**

Open Chrome DevTools, iPhone SE preset (375×667):

| Check | Expected |
|-------|----------|
| Topbar does not overflow | Only brand, status, ≡ visible |
| 🖥 终端 tab | xterm.js terminal visible, composer below |
| 🧠 Agents tab | Agent Collaboration + timeline fills screen |
| 🗺 计划 tab | DAG graph fills screen |
| 🧾 审计 tab | Audit report or empty state fills screen |
| Composer textarea | Tapping shows keyboard, Enter submits |
| ≡ hamburger | Drawer opens with all settings |
| Drawer mode buttons | Click changes mode, drawer closes |
| LLM modal | Opens as bottom sheet (full width, rounded top) |
| Plan tab dot | Appears when desktop plan dot appears |
| Resize to 1024px | Layout reverts to original two-pane desktop |

- [ ] **Step 2: (Advisory) Test on a real phone**

Access via local network IP (e.g. `http://192.168.x.x:8000`) or ngrok. Verify touch scrolling in terminal and agents panel works naturally.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: mobile adaptation — bottom tab nav, hamburger drawer, responsive layout"
```

---

## Summary of Files Changed

| File | Type | Change |
|------|------|--------|
| `frontend/static/styles.css` | Modify | Three `@media (max-width: 480px)` blocks + new mobile component styles appended at end |
| `frontend/index.html` | Modify | Add hamburger btn to topbar, drawer HTML, tab bar HTML, `<script>` tag |
| `frontend/static/mobile.js` | **Create** | Tab switching, hamburger drawer, desktop sync (~200 lines) |
| `frontend/static/app.js` | Modify | Add `window.fitAddon = fitAddon;` after fitAddon instantiation (1 line) |
