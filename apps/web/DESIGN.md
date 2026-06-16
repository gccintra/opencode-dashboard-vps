# Aurora Glass — Visual Identity

The design language introduced on the **/tasks** route. This document is the source of truth for rolling the same look out to every other screen.

Stack: React + Tailwind v4 (arbitrary values), self-hosted fonts via `@fontsource`. No CSS-in-JS, no external UI kit.

---

## 1. Concept

**Dark cosmic glassmorphism — minimal, technological, calm.**

- A near-black canvas with **ambient light blooms** drifting behind the content (the "aurora").
- Content sits on **frosted-glass panels**: translucent white fills + `backdrop-blur` + a 1px top highlight that reads as a real glass edge.
- A single **electric-lime** accent (`#b3e502`) used sparingly — primary actions, active states, focus, "live" signals.
- Restraint over decoration. Generous spacing, few borders, Linear-like clarity. The atmosphere lives in the background; the foreground stays clean.

North star references: Linear (structure/restraint), Grok & awwwards entries (atmosphere/glass/motion).

---

## 2. Design Tokens

### 2.1 Color

| Role | Value | Notes |
|------|-------|-------|
| **Canvas / page bg** | `#0a0a0f` | Every screen root. (`#0a0a0f]/80` for blurred bars.) |
| **Elevated solid surface** | `#111118` | Modals, dropdown menus, `<option>` backgrounds. |
| **Accent (lime)** | `#b3e502` | Primary buttons, active, focus, links-to-action. |
| **Accent hover** | `#c2f516` | Hover state of lime fills. |
| **Accent glow** | `rgba(179,229,2,X)` | Shadows/tints. `0.5` shadow, `0.1` chip bg, `0.06` ghost bg, `0.3`–`0.4` borders. |

**Glass fills** (translucent white over the canvas):

| Token | Use |
|-------|-----|
| `bg-white/[0.02]` | Quietest panel (textarea, nested boxes, list zones). |
| `bg-white/[0.03]` | Default glass (buttons, inputs, cards-in-context, headers). |
| `bg-white/[0.04]` | Resting card surface. |
| `bg-white/[0.05]` – `[0.06]` | Hover of cards/buttons. |
| `bg-white/[0.08]` – `[0.1]` | Active segmented item / pressed neutral toggle. |

**Borders:**

| Token | Use |
|-------|-----|
| `border-white/[0.06]` | Default hairline (panels, cards, dividers). |
| `border-white/[0.07]` | Inputs/buttons. |
| `border-white/[0.08]` | Modals, stronger dividers. |
| `border-white/[0.12]` – `[0.14]` | Hover. |
| `border-[#b3e502]/40` | Focus / active / drag-over. |

**Text ladder** (light → dark):

| Token | Use |
|-------|-----|
| `text-white` | Display headings (Syne). |
| `#f2f3f5` / `#f0f0f0` | Primary body text, card titles. |
| `#e6e8eb` | Brightened hover text, column names. |
| `#9aa3ad` | Secondary (button labels, values). |
| `#7a828c` | Muted (descriptions, counts, helper). |
| `#5a626c` | Faint (placeholders, section labels, icons). |
| `#454c55` | Faintest (empty hints, disabled copy). |

**Aurora bloom colors** (radial gradients, see §3):

- Lime `rgba(179,229,2,0.2)`
- Teal `rgba(45,212,191,0.16)`
- Violet `rgba(139,92,246,0.16–0.18)`

**Semantic:**

| Role | Value |
|------|-------|
| Danger | `red-500` family (`red-500/10` bg, `red-500/30` border, `red-400` text) |
| Warning / expired | `#fa0` (`rgba(250,160,0,0.08)` bg, `0.3` border) |
| Online / success dot | `#2dd` |
| External link (GitHub) | `#58a6ff` |
| Scrim / overlay | `black/40`, `black/60`, `black/70` + `backdrop-blur-sm` |

> **Do not** use the legacy `#121315` bg or `#af0` / `rgba(170,255,0,...)` accent on new work. Aurora Glass standardizes on `#0a0a0f` + `#b3e502`.

### 2.2 Typography

Three families, all self-hosted (`src/index.css` `@fontsource` imports):

| Family | Tailwind | Use |
|--------|----------|-----|
| **Syne** | `font-['Syne']` | Display only — page titles, section/empty-state headings, column names. Weights 600/700/800. Pair with tight tracking: `tracking-[-0.5px]` (large), `tracking-[0.2px]` (small bold). |
| **Inter** | `font-['Inter']` | All body/UI text. Weights 400/500/600/700. |
| **JetBrains Mono** | `font-['JetBrains_Mono']` | IDs, numeric counts (`tabular-nums`), code, textareas, badges. |

Scale used:

| Element | Class |
|---------|-------|
| Page title | `text-[24px] font-extrabold` → `sm:text-[26px]` (Syne) |
| Full-page hero title | `text-[26px]` → `sm:text-[30px]` font-extrabold (Syne) |
| Heading / modal title | `text-[17px]`–`text-[20px]` font-bold (Syne) |
| Card title | `text-[13.5px] font-semibold` (Inter), `leading-[1.4]`, `line-clamp-2` |
| Body | `text-[13px]`–`text-[14px]` (Inter) |
| **Section label** | `text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]` (Inter) |
| Meta / badge | `text-[10px]`–`text-[11px]` |

### 2.3 Radius

| Token | Use |
|-------|-----|
| `rounded-full` | Dots, pills, count badges, status indicators. |
| `rounded-[5px]` / `[6px]` | Chips, badges, small icon buttons. |
| `rounded-[8px]` / `[9px]` | Buttons, inputs, sidebar rows, segmented items. |
| `rounded-[10px]` | Search input, footer/action panels, error banners. |
| `rounded-[12px]` | Inner panels, mobile cards, empty zones. |
| `rounded-[14px]` | **Cards.** |
| `rounded-[16px]`–`[18px]` | Column drop zones, modals, large containers. |

### 2.4 Spacing

Tailwind arbitrary px on a 2-step scale: `4 6 8 10 12 14 16 18 20 24 28 32`. Page gutters: `px-[16px]` mobile → `sm:px-[28px]`/`sm:px-[32px]`. Card padding `p-[14px]`. Panel padding `px-[16px] py-[14px]`.

### 2.5 Elevation (glass)

Glass = translucent fill **+** `backdrop-blur-md` **+** inset top highlight **+** soft drop shadow.

```
/* Resting card */
shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)]
/* Hover card (lift) */
-translate-y-[2px]
shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_40px_-16px_rgba(0,0,0,0.7)]
/* Lime CTA */
shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)]   /* hover: -4px → -4px w/ 0.65 */
```

The `..._inset` top highlight is non-negotiable — it's what makes a panel read as glass rather than flat.

---

## 3. Atmosphere layer

Every Aurora Glass screen renders a fixed, non-interactive background behind `z-10` content. Blooms + a masked grid. CSS lives in `src/index.css` under the `kb-` prefix (reproduced in §9) and is screen-agnostic — reuse as-is.

```tsx
<div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f]">
  {/* Ambient atmosphere — canonical 3-bloom trio (lime + teal + violet) */}
  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="kb-aurora" style={{ top: '-180px', left: '-120px', width: 620, height: 620,
      opacity: 0.5, background: 'radial-gradient(circle, rgba(179,229,2,0.22), rgba(179,229,2,0) 70%)' }} />
    <div className="kb-aurora" style={{ top: '-220px', left: '38%', width: 680, height: 680,
      opacity: 0.4, animationDelay: '-7s', background: 'radial-gradient(circle, rgba(45,212,191,0.16), rgba(45,212,191,0) 70%)' }} />
    <div className="kb-aurora" style={{ top: '-160px', right: '-160px', width: 560, height: 560,
      opacity: 0.38, animationDelay: '-13s', background: 'radial-gradient(circle, rgba(139,92,246,0.18), rgba(139,92,246,0) 70%)' }} />
    <div className="kb-grid" />
  </div>

  {/* z-10 content goes here */}
</div>
```

Rules:
- **Prefer the full 3-bloom trio above** (lime → teal → violet) — it's the canonical atmosphere on `/tasks`, `/projects`, `/projectdetail`. A 2-bloom variant reads noticeably flatter; only drop to 2 in tight/embedded surfaces.
- Vary `width/height`, `opacity` (0.38–0.5), and `animationDelay` (stagger by several seconds) so blooms never pulse in unison. Anchor them off-screen (negative offsets) at the top.
- Always `pointer-events-none` + parent `overflow-hidden` so blooms never create scroll or block clicks.
- All real content must be `relative z-10`.

---

## 4. Motion

CSS-only. Defined in `index.css`. **Always gated by `prefers-reduced-motion`** (the block disables every animation).

| Class | Effect | Use |
|-------|--------|-----|
| `kb-aurora` | 22s drift loop | Background blooms. |
| `kb-rise` | 460ms fade-up, `cubic-bezier(0.22,1,0.36,1)` | Entrance for cards/lists/hero icons. Stagger with `style={{ animationDelay: `${Math.min(i,8)*45}ms` }}`. |
| `kb-sheen` | Light sweep on hover (720ms) | Primary CTAs. Requires `relative overflow-hidden` on the element. |

UI feedback transitions: `transition-... duration-150` (controls) to `duration-200` (cards/columns). Keep ≤ 300ms. Hover lift on cards = `-translate-y-[2px]`.

---

## 5. Layout primitives

### 5.1 Page shell

```tsx
<div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f]">
  <header className="relative z-10 shrink-0 border-b border-white/[0.06] ... backdrop-blur-md">…</header>
  <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">…scroll region…</div>
  <footer className="relative z-10 shrink-0 border-t border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-md">…</footer>
</div>
```

### 5.2 Height/scroll chain (critical)

- The page shell fills its parent with `h-full` + `min-h-0`. **Never** `min-h-screen` inside the app shell (it escapes the flex box and creates page-level scrollbars).
- Header/footer are `shrink-0`; the middle is `flex-1 min-h-0` and owns the scroll (`overflow-y-auto`, or `overflow-x-auto` for horizontal lanes).
- **Every flex ancestor in a scroll subtree needs `min-h-0`** (and `min-w-0` for horizontal). Tailwind's flex children default to `min-width:auto`/`min-height:auto` and refuse to shrink, which breaks `overflow-*`.

### 5.3 The `min-w-0` rule (the horizontal-scroll fix)

The shared `AppLayout` content column (the flex-row sibling of the Sidebar) **must keep `min-w-0`**. Without it, any wide child forces the whole page wider than the viewport → a page-level horizontal scrollbar instead of a contained one. The same applies to any new flex item that holds horizontally-scrolling content: add `min-w-0`.

Containment pattern: confine horizontal scroll to one element (`overflow-x-auto`); all ancestors stay `overflow-hidden` / `min-w-0`.

---

## 6. Component recipes

Copy-paste starting points. Adjust spacing, keep tokens.

**Secondary / ghost button**
```
flex h-[34px] items-center gap-[6px] rounded-[9px] border border-white/[0.07] bg-white/[0.03]
px-[12px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md transition-all
hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb]
```

**Primary CTA (lime + sheen)**
```
kb-sheen relative flex h-[34px] items-center gap-[6px] overflow-hidden rounded-[9px] bg-[#b3e502]
px-[14px] font-['Inter'] text-[13px] font-bold text-[#0a0a0f]
shadow-[0_4px_16px_-4px_rgba(179,229,2,0.5)] transition-all
hover:bg-[#c2f516] hover:shadow-[0_6px_22px_-4px_rgba(179,229,2,0.65)]
```

**Input / search**
```
h-[36px] w-full rounded-[10px] border border-white/[0.07] bg-white/[0.03] px-[12px]
font-['Inter'] text-[13px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none
backdrop-blur-md transition-colors focus:border-[#b3e502]/40 focus:bg-white/[0.05]
```
(Leading icon: absolute, `text-[#5a626c]`, `group-focus-within:text-[#b3e502]`.)

**Segmented control** — container `rounded-[10px] border border-white/[0.07] bg-white/[0.03] p-[3px] backdrop-blur-md`, `role="tablist"`. Item `rounded-[7px] px-[12px] py-[5px] text-[12px] font-semibold`, `role="tab"` + `aria-selected`:
- Active **emphasis**: `bg-[#b3e502] text-[#0a0a0f] shadow-[0_2px_8px_-2px_rgba(179,229,2,0.5)]`
- Active **neutral** (mode toggles): `bg-white/[0.1] text-[#f0f0f0]`
- Inactive: `text-[#7a828c] hover:text-[#d1d5db]`

**Card** (glass + hover lift + accent edge)
```
group relative isolate flex flex-col gap-[10px] overflow-hidden rounded-[14px]
border border-white/[0.06] bg-white/[0.04] p-[14px] backdrop-blur-md
shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)]
transition-[transform,border-color,background-color,box-shadow] duration-200
hover:-translate-y-[2px] hover:border-white/[0.12] hover:bg-white/[0.05]
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b3e502]/40
```
Optional left accent edge: an absolute `w-[2px]` bar, `opacity-0 group-hover:opacity-100`, colored by context.

**Chip / badge** — `rounded-[5px] px-[6px] py-[2px] text-[10px]`. ID badge: mono, `border-white/[0.07] bg-black/40 text-[#9aa3ad]`. Status chip: tint by a single color → `borderColor: c+'40'`, `background: c+'1a'`, `color: c`, with a `size-[5px]` dot.

**Select** — same as input + `appearance-none`; give each `<option>` `className="bg-[#111118]"` (native dropdowns ignore translucency).

**Count pill** — `rounded-full border border-white/[0.07] bg-white/[0.03] px-[8px] py-[1px] font-['JetBrains_Mono'] text-[11px] text-[#7a828c] tabular-nums`.

**Section label** — `font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]`.

**Modal / dialog** — scrim `fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm`; panel `rounded-[14px] border border-white/[0.08] bg-[#111118] p-[24px] shadow-2xl`. (Modals use the **solid** `#111118`, not glass, for readability.) Reserve true modals for confirmations/quick forms — primary detail views are **routes/pages**, not modals.

**"Live" / pulsing signal** — lime dot with `animate-ping` halo:
```tsx
<span className="relative flex size-[5px]">
  <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b3e502] opacity-60" />
  <span className="relative inline-flex size-[5px] rounded-full bg-[#b3e502]" />
</span>
```

### 6.1 State patterns

- **Loading**: pulsing glass skeletons (`animate-pulse rounded-[14px] bg-white/[0.03]`) in the real layout shape — not spinners (except route-level full-page: lime ring spinner).
- **Empty**: centered, glass icon tile (`size-[64px] rounded-[18px]` glass + inset top highlight), **lime-stroked icon** (`stroke="#b3e502"` — never muted gray), Syne heading, muted line, lime CTA. Wrap in `kb-rise`.
- **Error**: `rounded-[10px] border border-red-500/30 bg-red-500/10 px-[14px] py-[10px] text-[13px] text-red-400 backdrop-blur-md` + inline Retry.
- **No-results** (filtered empty): muted line + lime "Clear filters" text button.

### 6.2 Polish bar — the difference between "on-token" and "beautiful"

A screen can use every token and still read flat. These are the moves that close the gap to the `/tasks` reference. Check them on every migrated screen:

- **Content surfaces are GLASS, not solid.** Cards, stat tiles, sidebar rows → `bg-white/[0.03]`–`[0.04]` + `backdrop-blur-md` + inset top highlight. Solid `#111118` is reserved for **modals, dropdown menus, and `<option>`** only. Using `#111118` on a card is the #1 reason a screen looks flat despite correct tokens.
- **Everything enters.** Card grids, stat strips, list items, empty states get `kb-rise` with a stagger: `style={{ animationDelay: \`${Math.min(i,8)*45}ms\` }}`. No entrance = lifeless.
- **Empty-state icons are lime, in a glass tile** — not gray glyphs floating on the bg (see §6.1).
- **Full 3-bloom atmosphere** (§3), not 2. The teal middle bloom is what makes the background feel alive.
- **Primary CTAs are real lime buttons** — `kb-sheen` + `rounded-[9px]`/`[10px]` + lime glow shadow. A flat `bg-[#b3e502] rounded-[6px]` with no sheen/shadow is a downgrade.
- **Headings are Syne**, including modal/dialog titles (`text-[17px]`–`[20px] font-bold text-white`). Inter-only headings read generic.

---

## 7. Responsiveness

- Mobile-first. Verify at **375px** before scaling. Breakpoints: `sm` 640, `lg` 1024.
- Buttons hide text labels on small screens (`<span className="hidden sm:inline">`), keep the icon.
- Multi-column/lane layouts: horizontal lanes at `lg`; below that, collapse to a tabbed single column or stacked grid.
- Detail/two-pane: `grid grid-cols-1 gap-[24px] lg:grid-cols-[minmax(0,1fr)_300px]` — stacks on mobile, sidebar (300px) on `lg`. Use `minmax(0,1fr)` (not `1fr`) so the main column can shrink.
- Footer action bars: `flex-col` → `sm:flex-row`. Primary action full-width on mobile (`w-full sm:w-auto`).

---

## 8. Accessibility (required)

- Contrast ≥ 4.5:1 body text on `#0a0a0f` (the text ladder above is tuned for it; don't go lighter-muted than `#5a626c` for meaningful text).
- Focus visible: `focus-visible:ring-2 focus-visible:ring-[#b3e502]/40` on interactive cards/controls.
- Icon-only buttons: `aria-label`. Toggles: `aria-pressed`. Segmented: `role="tablist"`/`role="tab"`/`aria-selected`.
- Clickable cards: `tabIndex={0}` + `onKeyDown` Enter handler.
- Never signal state by color alone — pair with a dot, icon, or label.
- Honor `prefers-reduced-motion` (the `kb-` block already does; don't add JS animations that bypass it).
- Touch targets ≥ 44×44 (pad small icon buttons).

---

## 9. The `kb-` CSS block (source: `src/index.css`)

Screen-agnostic. Reuse as-is on any screen; do not rename per-screen.

```css
@keyframes kb-aurora-drift {
  0%   { transform: translate3d(-4%, -2%, 0) scale(1); }
  50%  { transform: translate3d(4%, 3%, 0) scale(1.12); }
  100% { transform: translate3d(-4%, -2%, 0) scale(1); }
}
@keyframes kb-rise {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes kb-sheen {
  0%        { transform: translateX(-120%) skewX(-12deg); }
  60%, 100% { transform: translateX(220%) skewX(-12deg); }
}
.kb-aurora { position: absolute; pointer-events: none; border-radius: 50%; filter: blur(90px);
  will-change: transform; animation: kb-aurora-drift 22s ease-in-out infinite; }
.kb-grid { position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 78%);
          mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 78%); }
.kb-rise { animation: kb-rise 460ms cubic-bezier(0.22,1,0.36,1) both; }
.kb-sheen::after { content: ''; position: absolute; top: 0; left: 0; height: 100%; width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
  transform: translateX(-120%) skewX(-12deg); pointer-events: none; }
.kb-sheen:hover::after { animation: kb-sheen 720ms ease-out; }
.kb-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.kb-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 999px; }
.kb-scroll::-webkit-scrollbar-thumb:hover { background: rgba(179,229,2,0.25); }

@media (prefers-reduced-motion: reduce) {
  .kb-aurora, .kb-rise, .kb-sheen:hover::after { animation: none; }
  .kb-rise { opacity: 1; transform: none; }
}
```

---

## 10. Migration checklist (per screen)

When converting an existing screen to Aurora Glass:

- [ ] Root → page shell (`relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f]`). Drop any `min-h-screen`.
- [ ] Add the atmosphere layer (§3); wrap real content in `relative z-10`.
- [ ] Swap bg `#121315`/`#0d0d14` → `#0a0a0f`; accent `#af0`/`rgba(170,255,0,*)` → `#b3e502`.
- [ ] Headings → Syne; keep body Inter, IDs/counts JetBrains Mono (`tabular-nums`).
- [ ] Surfaces → glass recipe (translucent fill + `backdrop-blur-md` + inset top highlight + soft shadow). **No solid `#111118` on cards/stat tiles** — that's modals/`<option>` only (§6.2).
- [ ] Borders/text → the token ladders (§2.1).
- [ ] Primary action → lime CTA (+ `kb-sheen`); secondary → ghost glass button.
- [ ] Inputs/selects/segmented → recipes (§6); `<option>` gets `bg-[#111118]`.
- [ ] Entrance motion via `kb-rise` (+ stagger); confirm `prefers-reduced-motion` still calm.
- [ ] Fix the scroll chain: `min-h-0` on flex ancestors, `min-w-0` where horizontal, one scroll owner.
- [ ] States: loading skeletons, empty, error, no-results (§6.1).
- [ ] a11y pass (§8): focus rings, aria-labels, keyboard, contrast.
- [ ] Verify at 375px, then `sm`, then `lg`.
- [ ] **Polish bar (§6.2)** — run it last: glass not solid, everything enters, lime empty icons, 3 blooms, Syne headings. This is what separates "on-token" from "beautiful".

> Reference implementation: `src/components/KanbanBoard/*` (board, card, column, filters) and `src/components/KanbanBoard/TaskDetail.tsx` + `src/pages/TaskDetail.tsx` (full-page detail). Migrated page examples: `src/pages/Projects.tsx` and `src/pages/ProjectDetail.tsx`.
