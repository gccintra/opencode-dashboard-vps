# ALF — Visual Identity

Monochrome, glass-accented developer-tool aesthetic. This document is the source of truth for the app's visual language and for migrating the remaining screens to it. Benchmark: **Linear** (restraint, framed content window, dark glass) — but strictly black/white with a single amber signal.

Stack: React + Tailwind v4 (`@theme` tokens in `src/index.css`), **Geist** (UI) + **JetBrains Mono** (data/terminal) via `@fontsource`. No CSS-in-JS, no external UI kit. Shared primitives live in `src/components/ui/`.

---

## 1. Concept

**Monochrome. Glass. One amber signal.**

- The entire interface is **black + white + neutral gray**. Every surface is strictly hue-free (R = G = B).
- **Amber `#ffb224` is the only color, and it is a SIGNAL, never chrome.** It appears only to say *look here*: a live/active session, a warning. It is never a button fill, a focus ring, a hover, or a selection.
- **Flat.** No glossy gradients, no drop-shadow "3D" on buttons. Depth comes from the **surface ladder**, **hairlines**, **dark frosted glass**, and a **light-catching rim** — never from skeuomorphic highlights.
- **Framed content window**: the sidebar sits borderless on the app shell; the content is a floating rounded panel whose border reads around the whole section (Linear).
- **Dense, quiet controls**: 34px default button/field height, 13px text, 6px radius. Mono for all data (paths, counts, IDs, timestamps).

**Do not reintroduce** (died across earlier iterations): the electric-lime/indigo accents, warm grays, aurora blooms, glossy `.control-raised` button gradients, `saturate()` on glass (it warms the neutral), amber anywhere in chrome.

North star: Linear (content window, dark glass popovers, monochrome), macOS vibrancy (frosted materials).

---

## 2. Design Tokens

Defined in `src/index.css` `@theme`. **Always use the token class, never the raw hex.** All color flows from these vars — recoloring the whole app is a one-file change.

### 2.1 Surfaces — neutral near-black ladder (hue-free)

| Class | Value | Use |
|-------|-------|-----|
| `bg-void` | `#000000` | App shell base, behind the framed window; sidebar ground. |
| `bg-bg` | `#090909` | The framed content window canvas. |
| `bg-surface` | `#101010` | Panels, cards. |
| `bg-surface-2` | `#171717` | Menus, raised surfaces. |
| `bg-surface-3` | `#242424` | Hover of surface-2. |
| `bg-white/[0.02]`–`[0.05]` | — | Preferred **translucent** fills for tiles & fields — settle onto any surface (glass or solid) instead of reading as a heavy block. |

### 2.2 Borders

| Class | Value | Use |
|-------|-------|-----|
| `border-hairline` | `rgba(255,255,255,0.09)` | Default 1px divider / field & panel border. |
| `border-hairline-strong` | `rgba(255,255,255,0.18)` | Secondary-button outline, emphasis edges. |
| `.rim-light` | gradient `::before` | The **signature edge** — see §3.2. Use instead of a flat border on floating elements. |

### 2.3 Text — white → neutral gray

| Class | Value | Use |
|-------|-------|-----|
| `text-ink` | `#fafafa` | Primary text, numbers, active nav. |
| `text-ink-2` | `#a6a6a6` | Secondary text, default control labels. |
| `text-ink-3` | `#737373` | Metadata, uppercase labels, muted. |
| `text-ink-4` | `#4d4d4d` | Placeholders, faint counts, disabled. |

### 2.4 Accent — amber (signal only)

| Token | Value | Use |
|-------|-------|-----|
| `--color-accent` / `text-accent` / `bg-accent` | `#ffb224` | **Signal only**: active status glyph, live counts, warnings. |
| `--color-accent-hover` | `#ffc250` | Hover of an amber signal. |
| `--color-accent-ink` | `#1a1100` | Dark foreground for the rare element sitting ON an amber fill. |

### 2.5 Semantics

| Token | Value | Use |
|-------|-------|-----|
| `--color-danger` | `#eb5757` | Errors, destructive actions, conflict. |
| `--color-warning` | `#f2c94c` | Warnings (amber family). |
| `--color-success` | `#4cb782` | Done / success / health only (the one place green is allowed). |

### 2.6 Radius & fonts

`--radius-control 6px` · `--radius-panel 8px` · `--radius-modal 12px`.
`--font-sans` = `'Geist Variable'` (fallback Inter). `--font-mono` = `'JetBrains Mono'`.

---

## 3. Materials & depth

Depth lives ONLY on floating/interactive layers. Base surfaces stay flat + tonal.

### 3.1 Glass (modals & command palette)

`.glass-panel` (modals) and `.glass-palette` (⌘K) — **identical material** (the New Project modal must match the command palette exactly):

- **Base**: `rgba(18,19,21,0.93)` — near-opaque dark, with a whisper of cool (B a hair above R) that cancels any warm cast without reading blue.
- **Filter**: `backdrop-filter: blur(16px) brightness(0.72)` — subtle blur, darkened backdrop.
- **No** white "milky" film, **no** `saturate()`.
- Pair with `.rim-light` for the edge and a deep drop shadow (`0 40px 90px -24px rgba(0,0,0,0.9)`).
- Scrims are light (`bg-black/35`–`/40`) with **no** blur of their own, so the glass does the frosting.

### 3.2 Light-catching rim — `.rim-light`

The signature edge of the system: a 1px **gradient** border (bright at the top-lit corner, fading down, a faint catch at the opposite corner) instead of a flat uniform hairline. Implemented as a masked `::before` so it hugs rounded corners and never fills the element.

Apply to: glass modals/palette, **stat tiles**, **list panels**, menu popovers. Reusable — add `rim-light` alongside the element's `rounded-*` class.

### 3.3 Flat rule

`.control-raised` is a plain fill (no gradient/gloss). `.btn-primary` is a flat white fill. Inputs are a flat translucent fill. No inset gloss, no button drop shadows.

---

## 4. Buttons (`ui/Button.tsx`)

| Variant | Look |
|---------|------|
| `primary` | **Solid white `#fafafa` fill, black text, flat** (`.btn-primary`). The single high-contrast action per view. No gradient/glow. |
| `default` (secondary) | **Outline only** — `border-hairline-strong`, transparent, hover `bg-white/[0.05]`. |
| `ghost` | No border, `text-ink-3`, hover `bg-white/[0.05]`. |
| `danger` | Red outline, transparent, hover `bg-danger/10`. |

Sizes: `sm` = h-28 / px-10, `md` = h-34 / px-14. Focus-visible ring is neutral white.

---

## 5. Fields (`ui/Input.tsx`, DirectoryPicker)

- Fill = **`bg-white/[0.03]`** (hover `0.05`, focus `0.04`) + `border-hairline`. Never a solid `surface-2` block (too heavy on glass).
- **Focus = white**: `border-white/70` + `ring-1 ring-white/20`. (Amber is signal-only, never focus.)
- Height 34 default (38 in the New Project modal for a more generous form). Mono font for path fields.
- Labels: uppercase mono `text-ink-3`; append an "Optional" tag as a **sibling** (not inside the `<label>`, so the accessible name stays clean).

---

## 6. App shell (`layout/AppLayout.tsx`, `layout/Sidebar.tsx`)

**Framed content window (Linear):**
- Root = `app-vignette` on `bg-void`.
- **Sidebar has no border/bg of its own** on desktop: `bg-void lg:bg-transparent`, no `border-r`. It sits on the shell.
- **Content = floating framed window**: `main` = `rounded-[12px] border border-hairline bg-bg overflow-hidden`, with a gap around it (column `p-[8px] lg:py-[10px] lg:pl-[4px] lg:pr-[10px]`). The border reads around the whole section — not as a sidebar divider.

**One header per screen** (no stacked bars):
- AppLayout renders NO mobile top bar. Instead a **floating hamburger** (`absolute left-[16px] top-[16px] z-30 lg:hidden`) dispatches `sidebar:open`.
- Each page owns a single sticky header that reserves a left gutter so the hamburger tucks in. The gutter must persist until `lg` (where the hamburger hides): `pl-[52px] pr-[16px] sm:pr-[24px] lg:pl-[24px]`. **Do not** use `sm:px-*` — it wipes the gutter between sm–lg and the hamburger overlaps the title.

**Sidebar contents:**
- Top = **workspace menu button** (`AlfLogo` + "ALF" + chevron-down) → dropdown popover (`elevated rim-light`): user identity header · **Settings** (`/settings`) · **Log out** (`useAuth().logout()`). Beside it, a **search IconButton** that opens ⌘K.
- Nav items: neutral pill selection (`bg-white/[0.06] text-ink`), inactive `text-ink-2`.
- Bottom: "daemon online" status dot (green).
- Mobile: a `fixed` drawer (`bg-void`) behind a `bg-black/60` overlay; opens on the `sidebar:open` event.

---

## 7. Patterns

**Stat tiles** (Linear big-number): `rim-light` + `bg-white/[0.02]` + `rounded-panel`, a small uppercase `ink-3` label (+ optional `StatusGlyph`), then a big `text-[26px]/sm:32px` semibold tabular number.

**List panel**: `rim-light overflow-hidden rounded-panel bg-white/[0.015]` with a header strip (uppercase title + count pill + sort button, `border-b`), then rows separated by `border-b border-hairline last:border-b-0` — no gaps, no per-row rounding. Row hover `row-hover`; focus `bg-white/[0.05]`.

**Modal** (`ProjectFormModal` pattern): `glass-panel rim-light rounded-modal`, a clean title + subtitle header, well-defined labeled fields, a `border-t` footer with a ghost Cancel + white primary action.

**Command palette** (`ui/CommandPalette.tsx`): `glass-palette rim-light`, monochrome rows, neutral selection fill, a single amber status dot as the only color.

**Status glyph** (`ui/StatusGlyph.tsx`): active = amber ring + faint amber fill (+ glow); waiting = hollow amber ring; done = solid green; idle = hollow gray.

---

## 8. Amber discipline

Amber is rationed to **signals**. Allowed: `StatusGlyph` active/waiting, live-session counts, warnings. **Not allowed**: buttons, focus rings, hovers, selections, links, avatars, icons-as-decoration. When in doubt, it's white/neutral.

---

## 9. Motion

Restrained. `fadeIn` (120ms) for scrims/menus, `paletteIn` (140ms spring-ish) for modals/palette entrance. `row-hover` 140ms color transition. Respect `prefers-reduced-motion` (`motion-safe:`). No `-translate-y` lifts, no glow pulses except the active status pulse.

---

## 10. Migration status

- **Done** (the reference implementation): tokens, glass + rim, buttons, fields, `AppLayout` framed shell, `Sidebar`, **Projects** screen (header, stat tiles, list panel), New Project modal, command palette, DirectoryPicker.
- **Pending**: Sessions, Tasks, Files, Templates, Settings — still carry legacy indigo `#5e6ad2` hardcodes (~140 refs) and lack the `pl-[52px]→lg` header gutter. Redesign them against this doc, using Projects as the template. `CanvasToolbar.test.tsx` still asserts the old indigo (update when Canvas is migrated).
- Dashboard / Emergency are dead screens — skip.
