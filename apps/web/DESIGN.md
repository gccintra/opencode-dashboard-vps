# Graphite — Visual Identity

Mac-native developer-tool aesthetic. This document is the source of truth for the app's visual language and for migrating the remaining Aurora Glass screens.

Stack: React + Tailwind v4 (`@theme` tokens in `src/index.css`), system font stack, JetBrains Mono via `@fontsource`. No CSS-in-JS, no external UI kit. Shared primitives live in `src/components/ui/`.

---

## 1. Concept

**Dark graphite mac chrome — dense, flat, quiet.**

- Two-tone chrome like Finder/Xcode: sidebar and panels sit on a slightly lighter neutral (`surface`) than the content canvas (`bg`).
- **Hairline dividers** (1px, low-alpha white) do the structural work — not shadows, not blur.
- Controls are small and dense: 28px default height, 24px compact, 13px text, 6px radius.
- A single **electric-lime** accent (`#b3e502`) used sparingly — primary buttons, active nav selection, focus rings, live dots.
- Semantic colors are the mac traffic lights: danger `#ff5f57`, warning `#febc2e`, success `#28c840`.

**What died with Aurora Glass** (do not reintroduce): aurora blooms, grid overlay, `backdrop-blur` glassmorphism, `kb-sheen` sweeps, `kb-rise` entrances, hover `-translate-y` lifts, lime glow shadows, Syne display font.

North star references: macOS system apps (Finder, Xcode source lists), Orca (stablyai), Linear (restraint).

---

## 2. Design Tokens

Defined in `src/index.css` `@theme`. **Always use the token class, never the raw hex.**

### 2.1 Surfaces

| Class | Value | Use |
|-------|-------|-----|
| `bg-bg` | `#0e0e11` | App canvas, page roots, toolbars. |
| `bg-surface` | `#16161a` | Sidebar, panels, cards, section headers. |
| `bg-surface-2` | `#1c1c21` | Raised controls, modals, profile tiles. |
| `bg-surface-3` | `#232329` | Hover of surface-2, menus, active segmented item. |
| `bg-black/20`–`/25` | — | Inset fields (inputs, segmented track). |

### 2.2 Borders

| Class | Use |
|-------|-----|
| `border-hairline` | Default 1px divider everywhere (`rgba(255,255,255,0.08)`). |
| `border-hairline-strong` | Hover emphasis (`0.14`). |
| `border-accent/30`–`/40` | Focus / active / drag-over. |

### 2.3 Text ladder

| Class | Value | Use |
|-------|-------|-----|
| `text-ink` | `#e8e8ea` | Titles, primary text, active nav. |
| `text-ink-2` | `#98989f` | Secondary text, inactive nav, descriptions. |
| `text-ink-3` | `#66666e` | Muted labels, timestamps, section headers. |
| `text-ink-4` | `#4a4a52` | Faint (dead-session dots, decorative glyphs). |

### 2.4 Brand + semantics

| Class | Value | Use |
|-------|-------|-----|
| `accent` | `#b3e502` | Primary buttons (`bg-accent text-black`), active selection tint (`bg-accent/12`), focus ring (`ring-accent/50`), live dots. |
| `accent-hover` | `#c2f516` | Hover of lime fills. |
| `danger` | `#ff5f57` | Destructive actions, errors. Tint pattern: `border-danger/25 bg-danger/10 text-danger`. |
| `warning` | `#febc2e` | Waiting states, counts. Same tint pattern. |
| `success` | `#28c840` | Connected/active/online. Same tint pattern. |

### 2.5 Radius

| Class | Value | Use |
|-------|-------|-----|
| `rounded-control` | 6px | Buttons, inputs, nav pills, chips-with-height. |
| `rounded-panel` | 8px | Cards, panels, empty-state tiles. |
| `rounded-modal` | 10px | Modals, menus. |
| `rounded-[4px]` | 4px | Badges, tiny chips. |

### 2.6 Elevation

Flat by default. Only two exceptions:
- Raised controls (default Button, active segmented item): `shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)]` — a subtle top bevel.
- Modals/menus: real drop shadow (`shadow-2xl`), scrim `bg-black/60` (no blur).

Nothing else gets a shadow. No glows.

---

## 3. Typography

- **UI:** system stack (`--font-sans`: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto`). Body inherits automatically — no font class needed.
- **Mono:** `font-['JetBrains_Mono']` for IDs, counts, paths, code, terminal, badges with numerals.
- Scale: `text-[11px]` captions/labels (uppercase + `tracking-[0.5px]` for section labels), `text-[12px]` compact controls, `text-[13px]` default UI, `text-[15px]` section/modal titles, `text-[17px] sm:text-[20px]` page titles. Titles use `font-semibold tracking-[-0.2px]` — never extrabold, never Syne.

---

## 4. Motion

- `transition-colors duration-150` — the only standard transition.
- Drawers/slides keep their existing `transition-transform duration-200`.
- `animate-pulse` allowed for live dots; `animate-spin` for spinners. No `animate-ping` halos.
- No entrance animations, no hover lifts, no sheens. Keep everything ≤ 300ms and respect `prefers-reduced-motion`.

---

## 5. Layout primitives

### 5.1 Page shell

```tsx
<div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-bg">
  <header className="shrink-0 border-b border-hairline bg-bg">…</header>
  <div className="min-h-0 flex-1 overflow-y-auto">…scroll region…</div>
</div>
```

No atmosphere layer, no `relative z-10` wrappers — content sits directly on `bg-bg`.

### 5.2 Scroll chain (unchanged, still critical)

- The page shell fills its parent with `h-full` + `min-h-0`. **Never** `min-h-screen` inside the app shell.
- Header/footer are `shrink-0`; the middle is `flex-1 min-h-0` and owns the scroll.
- **Every flex ancestor in a scroll subtree needs `min-h-0`** (and `min-w-0` for horizontal).

### 5.3 Structural dimensions (do not change)

Terminal-dimension estimators hard-code chrome sizes: global sidebar 240px, ProjectDetail sessions sidebar 220px, mobile top bar 48px, terminal header ~50px, tab bar ~42px, status bar ~26px. See `estimateSidebarTerminalDims` (Sidebar.tsx) and `estimateTerminalDims` (ProjectDetail.tsx). Changing any of these requires updating the estimators.

### 5.4 Terminal resize timing (unchanged)

Any `fit()` call must happen ≥300ms after a layout change (200ms CSS transition + 100ms buffer). Dual-shot pattern: 500ms + 1800ms after session switch.

---

## 6. Components — import from `src/components/ui`

```ts
import { Button, IconButton, Panel, Modal, Input, Textarea, Select, Badge, SegmentedControl, Toolbar, EmptyState, cx } from '../components/ui';
```

| Component | Props | Notes |
|-----------|-------|-------|
| `Button` | `variant: 'primary'\|'default'\|'ghost'\|'danger'`, `size: 'sm'(24px)\|'md'(28px)` | primary = flat lime, text-black; default = mac push button (surface-2 + bevel); ghost = transparent; danger = red tint. |
| `IconButton` | `size`, **`aria-label` required** | Square ghost button for icons. |
| `Panel` | `padding: 'none'\|'sm'\|'md'`, `interactive` | The card. `interactive` adds hover border + focus ring — no lift. |
| `Modal` | `open, onClose, title?, footer?, maxWidth?` | Scrim without blur, Escape-to-close built in. |
| `Input`/`Textarea`/`Select` | native props | 28px, inset dark fill, accent focus. `<option className="bg-surface-2">`. |
| `Badge` | `tone: neutral\|accent\|success\|warning\|danger`, `dot?`, `mono?` | Tint chip. Static dot (no ping). |
| `SegmentedControl` | `items, value, onChange` | `role="tablist"`; active item is neutral (surface-3), not lime. |
| `Toolbar` | `end?` | 44px header row with bottom hairline. |
| `EmptyState` | `icon?, title, description?, action?` | Neutral icon tile; accent only on the action button. |

**Raw recipes** (not componentized):

- Source-list row (sidebars): `h-[28px] mx-[8px] rounded-control px-[8px] text-[13px]`; active = `bg-accent/12 text-ink` + icon `text-accent`; inactive = `text-ink-2 hover:bg-white/[0.04] hover:text-ink`. Selection is a pill — no left bar.
- Section label: `text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-3`.
- Error banner: `rounded-control border border-danger/30 bg-danger/10 px-[16px] py-[12px] text-[13px] text-danger`.
- Status dots: `size-[6px] rounded-full` + `bg-success`/`bg-warning`/`bg-ink-4` (dead). `animate-pulse` when live. No glow shadows.

---

## 7. States

- **Loading:** flat skeletons — `animate-pulse` blocks of `bg-white/[0.04]`–`[0.06]` inside a `Panel`. Spinners: `animate-spin` circle in `text-ink-3` or `border-accent`.
- **Empty:** `EmptyState` component.
- **Error:** danger banner (above) with inline Retry.
- **Focus:** `focus-visible:ring-2 ring-accent/50` on all interactive elements.

---

## 8. Responsiveness & accessibility

- Mobile-first: everything works at 375px. Breakpoints `sm` 640 / `md` 768 / `lg` 1024.
- Touch targets ≥ 44px on mobile (visual size may be smaller; extend hit area with padding).
- Contrast: `ink` on `bg`/`surface` ≥ 12:1; `ink-2` ≥ 5:1; `ink-3` only for non-essential text. Lime `#b3e502` on black passes AA at all sizes.
- `aria-label` on all icon-only buttons; `role="tablist"`/`aria-selected` on tabs/segments.

---

## 9. Migration map (Aurora → Graphite)

Remaining waves: KanbanBoard cluster, FilesPage, HarnessesPage, Dashboard, Emergency, Login, TaskDetail, and shared modals (CanvasPickerModal, RecoverConversationModal, Harnesses modals). Apply this table, then hand-polish:

| Aurora | Graphite |
|---|---|
| `bg-[#0a0a0f]` page root | `bg-bg` |
| Atmosphere block (`kb-aurora` + `kb-grid` + wrapper) | delete; drop now-useless `relative z-10` |
| `bg-[#111118]` | `bg-surface-2` |
| Glass (`bg-white/[0.02-0.04]` + `backdrop-blur-md` + inset shadow) | `bg-surface border border-hairline`, no blur |
| `border-white/[0.06-0.08]` / `[0.12-0.14]` | `border-hairline` / `border-hairline-strong` |
| `#f0f0f0`/`#f2f3f5`/`#e6e8eb`/`text-white` | `text-ink` |
| `#9aa3ad` | `text-ink-2` |
| `#7a828c`, `#5a626c` | `text-ink-3` |
| `#454c55`, `#445566` | `text-ink-4` |
| `#b3e502` arbitrary classes | `accent` tokens |
| `kb-sheen`, glow shadows, `hover:-translate-y`, `kb-rise` | delete; `transition-colors duration-150` |
| `rounded-[14-18px]` / `[8-10px]` | `rounded-panel`(cards) or `rounded-modal`(modals) / `rounded-control` |
| `red-500/*`, `#f54`, `#f56` | `danger` |
| `#fa0`, `#ffaa00` | `warning` |
| `#2dd`, `#2d8`, `#22dd88` | `success` |
| Syne/extrabold headings | `text-[17px] sm:text-[20px] font-semibold tracking-[-0.2px] text-ink` |
| Local Modal/button/input markup | `ui/` primitives |

Per-screen checklist:
- [ ] Root → Graphite page shell; delete atmosphere.
- [ ] Apply the mapping table.
- [ ] Replace local modals/buttons/inputs with `ui/` primitives.
- [ ] Fix scroll chain (`min-h-0`).
- [ ] Update any class-string test assertions in the same commit.
- [ ] Eyeball at 375px and desktop.

---

## 10. Legacy: the `kb-` CSS block

The `kb-` classes (aurora, grid, rise, sheen) remain in `src/index.css` **only** because unmigrated screens still use them. They are **deprecated** — never use them in new or migrated code. Delete the block when the last Aurora screen migrates (tracked by the migration map above).
