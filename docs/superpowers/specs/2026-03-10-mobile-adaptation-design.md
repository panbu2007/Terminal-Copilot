# Mobile Adaptation Design — Terminal Copilot

**Date:** 2026-03-10
**Status:** Approved
**Scope:** `frontend/index.html` + `frontend/static/styles.css` + `frontend/static/app.js`

---

## Overview

Add mobile-first responsive layout for Terminal Copilot targeting phones (≤ 480px). The desktop two-pane grid layout is replaced on mobile with a bottom navigation + full-screen tab switching pattern.

---

## Target

- **Primary:** Phone (≤ 480px, ~375–430px iPhones and Android)
- **Existing 768px rules:** Keep and refine (tablet)
- **Desktop:** Unchanged

---

## Layout Architecture

### Desktop (> 768px) — Unchanged

```
┌─────────────────────────────────────────────────┐
│  Topbar (brand + modes + switches + buttons)    │
├───────────────────────────┬─────────────────────┤
│  Terminal Pane            │  Side Pane (360px)  │
│  (xterm.js + composer)   │  (tabs: Plan/Agents) │
└───────────────────────────┴─────────────────────┘
```

### Mobile (≤ 480px) — New Layout

```
┌─────────────────────────┐
│  Topbar (simplified)    │  ~44px
│  Brand · Status · ≡     │
├─────────────────────────┤
│                         │
│   Active Tab Content    │  fills remaining space
│   (terminal / agents /  │
│    plan / audit)        │
│                         │
├─────────────────────────┤
│  Composer               │  ~110px
│  (input + state pill)   │
├─────────────────────────┤
│  Bottom Tab Bar         │  ~52px
│  🖥 终端  🧠 Agents      │
│  🗺 计划  🧾 审计        │
└─────────────────────────┘
```

---

## Component Changes

### 1. Topbar

**Desktop:** Brand + mode radios + 2 segmented switches + 4 buttons (新会话/知识库/LLM设置/导出) + LLM guide + Status

**Mobile:** Collapsed to three elements:
- Left: Brand "TC"
- Center/Right: Status pill (compact)
- Right: Hamburger button `≡` → slides open `.mobile-drawer`

**Hidden on mobile via CSS:** `.modes`, `.segmented`, `.btn-export`, `#llmGuide`

### 2. Mobile Drawer (新增)

Full-height slide-in panel from right (or top overlay), triggered by `≡`:
- Mode radios (只建议 / 建议+执行)
- Terminal mode segmented (真实终端 / 计划模式)
- Executor segmented (simulate / local)
- Buttons: 新会话 · 知识库 · LLM设置 · 导出回放
- Close button `✕`

### 3. Bottom Tab Bar (新增)

Fixed `bottom: 0`, full width, height 52px:

| Tab | Icon | Content |
|-----|------|---------|
| 终端 | 🖥 | xterm.js terminal (default active) |
| Agents | 🧠 | `#timelinePanel` (agent steps + timeline + suggestions) |
| 计划 | 🗺 | `#planPanel` (DAG graph + op bar) |
| 审计 | 🧾 | `#auditPanel` |

Active tab shows purple underline indicator. Tab switching is CSS class toggle (no page reload).

### 4. Tab Content Areas

On mobile, each tab is `display: flex; flex-direction: column; height: 100%` occupying all space between Topbar and Composer. Only one tab is visible at a time.

- **终端 tab:** xterm.js fills full area. The existing `#terminalNotice`, `#terminalOverlay`, toolbar (Ask AI button) are retained. `terminal-toolbar-hint` hidden on mobile.
- **Agents/Plan/Audit tabs:** The existing `#timelinePanel`, `#planPanel`, `#auditPanel` elements reused as-is inside tab wrappers. Side tabs (`.side-tabs`) hidden — replaced by bottom tab bar.

### 5. Composer

Retained as-is structurally, with mobile tweaks:
- `min-height: 52px` (single line default), expands on focus
- `composer-shortcuts` hidden on mobile (keyboard shortcut hints irrelevant on touch)
- `composer-guide` hidden on mobile

### 6. Node Popover

Desktop: `position: fixed` floating card (300px wide)

Mobile: Bottom sheet — `position: fixed; bottom: 0; left: 0; right: 0; width: 100%; border-radius: 16px 16px 0 0; max-height: 60vh; overflow-y: auto`

### 7. Modals (LLM + Runbook)

Desktop: Centered card (`min(560px, 92vw)`)

Mobile: Near-fullscreen — `width: 100vw; max-height: 100dvh; border-radius: 16px 16px 0 0; position: fixed; bottom: 0; left: 0`

### 8. Onboarding Card

Already has responsive rules (2-col at 768px, 1-col at 480px). No change needed.

### 9. Plan Graph

On the Plan tab on mobile, the `#planGraph` SVG uses `touch-action: pan-x pan-y` (already set as `none`). Override to allow pinch-zoom: `touch-action: pinch-zoom`.

---

## CSS Approach

All changes go into `styles.css` under a new `@media (max-width: 480px)` block at the bottom (overrides the existing `768px` rules where needed).

New CSS classes to add:
- `.mobile-tab-bar` — fixed bottom nav bar
- `.mobile-tab-btn` — individual tab button
- `.mobile-tab-btn.is-active` — active state with purple underline
- `.mobile-drawer` — slide-in settings drawer
- `.mobile-drawer-overlay` — semi-transparent backdrop
- `.mobile-drawer.is-open` — visible state

---

## JS Approach

Add a `MobileNav` module in `app.js` (~60 lines):

```js
// Responsibilities:
// 1. Detect mobile breakpoint (matchMedia ≤ 480px)
// 2. Inject .mobile-tab-bar HTML into DOM
// 3. Inject .mobile-drawer HTML into DOM (clone settings from topbar)
// 4. Tab switching: toggle active class on tab buttons + show/hide content panels
// 5. Hamburger open/close: toggle .mobile-drawer.is-open
// 6. Sync state: when topbar segmented buttons change, sync drawer buttons (and vice versa)
// 7. On resize: if crosses 480px threshold, reset layout
```

The module activates only when `window.innerWidth ≤ 480`. On wider screens it's a no-op.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/static/styles.css` | Add `@media (max-width: 480px)` block + new mobile classes |
| `frontend/static/app.js` | Add `MobileNav` module (~60 lines) at end of file |
| `frontend/index.html` | No structural changes needed (JS injects mobile elements dynamically) |

---

## Out of Scope

- iOS soft keyboard handling (complex, deferred)
- PWA / Add to Home Screen
- Touch gestures for xterm.js (swipe to scroll is native browser behavior)
- Tablet (768px) improvements beyond existing rules

---

## Success Criteria

- [ ] Topbar does not overflow at 375px
- [ ] All 4 tabs reachable and display correct content
- [ ] Composer input usable on mobile keyboard
- [ ] Hamburger menu shows all settings options
- [ ] Modals display full-screen on mobile
- [ ] Node popover displays as bottom sheet
- [ ] Desktop layout completely unchanged
