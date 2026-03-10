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
  let initialized = false;

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
    if (!initialized) {
      tabBtns.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
      if (menuBtn)       menuBtn.addEventListener('click', openDrawer);
      if (drawerClose)   drawerClose.addEventListener('click', closeDrawer);
      if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
      wireDrawerButtons();
      observePlanDot();
      initialized = true;
    }
    showTab('terminal');
  }

  // ── Restore panels to side-pane on desktop ────────────────
  function teardown() {
    [timelinePanel, planPanel, auditPanel].forEach(panel => {
      if (panel && mobileWrapper && panel.parentElement === mobileWrapper && sidePaneEl) {
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
