# Three-Vertical Device UX — Research Evidence Base

> **Purpose.** Persisted evidence for the Three-Vertical Device Standard (TVDS) and the
> Mobile Web IDE cockpit refactor. Captured so the data-gathering expenditure is durable,
> not lost to screen output.
>
> **Captured:** 2026-06-22 · **Method:** 3× `web_search` (recency=year) on mobile, tablet,
> and desktop web-app UX expectations for 2026 → +6 months.
>
> **Van Helsing source-quality note (read before trusting any line below).**
> The searches returned a mix of (a) **authoritative** primary sources — W3C/WCAG, MDN,
> Apple Human Interface Guidelines, web.dev — and (b) **SEO trend listicles** (Medium,
> agency blogs). Only (a) is load-bearing. Trend phrases from (b) ("invisible interfaces",
> "radical reachability", "bottom sheets are dominant") are recorded as *commentary*, NOT
> as requirements, and MUST NOT be enshrined as standard law. Every prescriptive rule in
> the TVDS is anchored to an authoritative source or to a falsifiable a11y/security
> criterion — never to a listicle trend.

---

## 1. Mobile (phones — iOS Safari + Android Chrome)

**Authoritative findings**
- **PWA installability** (MDN, web.dev, Chrome): served over HTTPS or localhost; manifest
  with `name`, `short_name`, `start_url`, `display: standalone|fullscreen`,
  `background_color`, `theme_color`, icons **192×192 + 512×512** (192 required for the
  Chrome install prompt; 512 for splash/high-DPI); service worker registered **with a
  `fetch` listener**. Android adaptive icons need **maskable** variants with content in the
  central **80% safe zone**.
  - https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
  - https://web.dev/articles/install-criteria
- **Touch target size** (W3C/WCAG): WCAG 2.2 SC **2.5.8 = 24×24 CSS px (AA)** minimum;
  WCAG 2.1 SC 2.5.5 = **44×44 CSS px (AAA)**. Practical mobile guidance: **≥44px, ideally
  48px, with ≥8px spacing**, primary actions **≥16px from edges**.
  - https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
  - https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
- **Safe-area insets** (MDN, W3C CSS Env L1): `viewport-fit=cover` + `env(safe-area-inset-*)`
  to avoid notches/cutouts/home-indicator overlap.
  - https://developer.mozilla.org/en-US/docs/Web/CSS/env
  - https://www.w3.org/TR/css-env-1/
- **Haptics** (Haptics API talk, web-haptics): only `navigator.vibrate()` exists; **Android
  only — no Safari/WebKit support**; iOS "works" only via a fragile hidden-switch hack.
  Use as subtle confirmation, never required.
  - https://liminzhu.github.io/BlinkOn21HapticsTalk/

**Commentary (NOT requirements):** bottom-nav for 3–5 destinations and bottom-sheets for
secondary content (Material/HIG-aligned, widely cited); "radical reachability" / thumb-zone
framing; <2s load / <3s interactive targets (cited Google study, treat as a perf goal).

## 2. Tablet (iPad / Android tablets — iPadOS Safari + Android Chrome)

**Authoritative findings**
- **Multi-column / split view** (Apple HIG, SAP Fiori): regular size class shows columns
  side-by-side (sidebar = primary nav, list = supplementary, content = secondary); collapse
  to a stack in compact size class (iPhone, **Slide Over**, narrow). Modality differs by
  size class (popovers/form-sheets in regular; full/modal sheets in compact).
  - https://developer.apple.com/design/human-interface-guidelines/split-views
  - https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados
- **Pointer / hover** (Apple WWDC20 "Build for the iPadOS pointer"): trackpad pointer morphs
  over controls; hover changes appearance. Web analog: `(hover: hover)` + `(pointer: fine)`
  feature queries to enable hover affordances when a trackpad/mouse is attached.
  - https://developer.apple.com/videos/play/wwdc2020/10093/
- **Trackpad + secondary click** (Apple Support): secondary click = context menu; standard
  scroll/zoom gestures.
  - https://support.apple.com/en-us/105004
- **Keyboard shortcuts** (Apple Support): iPad uses **⌘-based** shortcuts; Full Keyboard
  Access exists for a11y.
  - https://support.apple.com/en-us/102393

**Commentary (NOT requirements):** "show more context, reduce nav friction, support
multitasking" (agency/Medium synthesis of HIG intent).

## 3. Desktop (laptop / standard / wide / monitors)

**Authoritative-ish findings**
- **Keyboard shortcuts** (ui-patterns, Golsteyn): cover common actions (copy/cut/paste,
  open, save, close) + app-specific; **platform modifier** — Ctrl on Windows/Linux, ⌘ on
  macOS; **never override browser/OS defaults**.
  - https://ui-patterns.com/patterns/keyboard-shortcuts
  - https://golsteyn.com/writing/designing-keyboard-shortcuts/
- **Command palette** (Mobbin, UX Patterns for Developers): `⌘K`/`Ctrl+K` (or `⌘P`) entry;
  search + quick actions; best when there are many destinations and power-user commands.
  - https://mobbin.com/glossary/command-palette
  - https://uxpatterns.dev/patterns/advanced/command-palette
- **Information density** (LogRocket / Tufte "data-ink"): tune density to balance context vs
  clarity; complex info-rich tools often need a *separate* layout rather than a scaled-down
  mobile one — direct support for purpose-built verticals over one reflowed layout.
  - https://blog.logrocket.com/balancing-information-density-in-web-development/
- **Multi-pane resizable** (Syncfusion, BMC): resizable / collapsible / nestable panes
  (Outlook/Explorer/IDE style) with min/max constraints.
  - https://www.syncfusion.com/react-components/react-splitter

**Commentary (NOT requirements):** "minimalism", "clean/consistent/responsive" (uxpilot,
Minimum Code) — good defaults, not falsifiable rules.

---

## 4. Synthesized per-vertical baselines

Build-applied matrix lives in `Docs/MWIDE_GITHUB_COCKPIT_EXECUTION.md`; the durable,
app-agnostic standard lives in `skill://three-vertical-device-standard`. Summary:

| Vertical | MIN (acceptance floor) | ADVANCEMENTS (above-and-beyond) |
|---|---|---|
| **Mobile** | single-column, content-first; bottom tab nav (thumb-reach, ≥44px, 8px gaps, 16px edges); safe-area insets; no hover-only controls; works 360–414px; dirty/status by color **+ icon + text**; arm→confirm with stderr/stdout visible; reuse `<Terminal>` | pull-to-refresh (with button fallback); `navigator.vibrate` enhancement (graceful no-op); drag-dismiss bottom-sheet results; skeleton loaders; offline banner |
| **Tablet** | two/three-column split landscape, push-nav portrait; hover affordances behind `(hover:hover)`; ⌘ shortcuts; secondary-click context menu; iPad portrait+landscape & Android tablet | resizable/persisted split; hover-reveal quick actions; non-modal popover results (regular) vs sheet (compact); reflow to mobile vertical on Slide Over widths |
| **Desktop** | persistent multi-pane (sidebar + detail + info panel); full keyboard nav (platform modifier); command palette `⌘/Ctrl+K`; dense tables; tooltips + focus rings | resizable/collapsible/persisted panes; fuzzy palette over repos+actions+routes; keyboard-driven arm/confirm; sortable tables; wide-screen multi-repo dashboard; live action-output console |

---

## 5. Footgun audit (Van Helsing) — DO NOT bake these into the standard

1. **Width-only classification.** Hardcoded px breakpoints rot (foldables, split-view,
   external displays). → Classify by **capability first** (`pointer`/`hover`/touch + UA
   hints); width is a tiebreaker only. Specific numbers live in the app, not the standard.
2. **`maxTouchPoints>1 ⇒ tablet`.** **WRONG** for touchscreen Windows/ChromeOS laptops →
   they MUST classify **desktop**. Rule: `(pointer:fine) && (hover:hover)` ⇒ desktop even
   with touch. `navigator.platform` is deprecated; the iPad-as-Mac shim
   (`platform==='MacIntel' && maxTouchPoints>1`) is a **documented fragile compatibility
   shim**, not a universal law.
3. **Forking business logic 3×.** Three presentation trees is the directive; triplicating
   API/validation/state logic is a bug farm. → Standard mandates **shared logic + types +
   design tokens; fork presentation only.**
4. **Mandatory haptics / iOS hack.** iOS web has no real vibrate; the hidden-switch hack is
   brittle. → Haptics are **optional progressive enhancement, never the sole signal.**
5. **Gesture-only actions (pull-to-refresh, swipe).** Can hijack native scroll / strand
   users. → Gestures **augment**, never replace, a visible control.
6. **Color-only status.** Fails colorblind users. → Always color **+ icon + text**.
7. **Palette/app shortcuts clobbering browser/OS defaults.** → Never override defaults;
   always provide a visible affordance alongside any shortcut.
8. **"Must be an installable PWA" everywhere.** SW caching causes stale shells; not every
   app should be a PWA. → PWA recommended for mobile, **not universally mandated**; if used,
   require an update flow.
9. **Uniform 44px targets on desktop.** Wastes density desktop users want. → Target sizes
   are **per-vertical** (desktop may be denser but ≥24px AA + adequate spacing).
10. **Whole-tree swap on every resize.** Loses local state, thrashes on drag-resize. →
    Classify with **hysteresis + debounce**; swap only on class-boundary crossing; keep
    transient state (e.g., action arming) in the shared layer so it survives a swap.
11. **Time-bound list as eternal truth.** "2026 / +6mo" rots. → Standard is **versioned +
    dated with a review-by date**; the +6mo horizon is the floor at capture time, a living
    baseline to re-verify — never frozen.
12. **Listicle trends as requirements.** → Anchor rules to W3C/MDN/Apple HIG/Material or to
    falsifiable a11y/security criteria; record trends as commentary only.

**Build-side security footguns (cockpit) — mitigations are mandatory, not optional:**
allowlisted commands only; `spawn` not `exec`; reject shell-control arg tokens; `path.resolve`
inside `workspaceRoots`; confirm-gate destructive actions; cap timeout (≤900000ms); no
shell (`bash`/`zsh`) unless `shellScript:true` AND script inside repo path; GitHub/secret
tokens never cross to the client; keep `127.0.0.1` bind default.
