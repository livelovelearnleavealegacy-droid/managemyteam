# managemyteam.io — Design System v0.1

One-page reference for every feature agent. Code against these exact names.

## Fonts

- Headings: **Space Grotesk** (`var(--font-heading)`). Use for `.page-title`, `.section-title`, header brand.
- Body: **Inter** (`var(--font-body)`). Default for everything else.
- Mono: **JetBrains Mono** (`var(--font-mono)`). Times, codes, IDs, terminal-ish values only.

## CSS variables

```css
--bg: #16241c;      /* page background (deep green-black) */
--panel: #1e3128;   /* cards, sidebar */
--panel2: #24392e;  /* inputs, alt table rows, hover states */
--text: #f1ead9;    /* primary text (warm off-white) */
--text2: #afc2b3;   /* muted/secondary text */
--gold: #d9a441;
--teal: #47af9e;    /* primary actions, active nav */
--red: #e6745f;
--green: #6fbe8c;
```

## Classes (exact names — other code depends on them)

| Class | Use |
|---|---|
| `.btn` + `.btn-primary` / `.btn-danger` / `.btn-ghost` | Buttons. Primary = teal bg, dark text. |
| `.card` | Panel card, 12px radius, padding. |
| `.input` | Text inputs, selects, textareas (panel2 bg). |
| `.label` | Small-caps field label. |
| `.badge` + `.b-gold` / `.b-teal` / `.b-red` / `.b-green` | Status pills. |
| `.page-title` | Space Grotesk 28px page heading. |
| `.section-title` | Space Grotesk 18px section heading. |
| `.tbl` | Full-width table with panel/panel2 zebra rows. |
| `.toast` | Fixed bottom-center, `role="status"`. |
| `.fab` | Fixed bottom-right circular teal action button. |
| `.empty` | Muted centered empty state. |
| `.nav-cluster` | Uppercase sidebar cluster label. |
| `.nav-link` + `.active` | Sidebar links; `.active` gets teal left border. |

UI kit (`components/ui.tsx`): `Button`, `TextInput`, `TextArea`, `Select`, `Card`, `Badge`, `Modal`, `Toast`, `EmptyState`, `Field`. All accept `className` passthrough. Prefer these over raw elements.

## Status-color rules (locked)

- **Delinquent = red ONLY** (`.b-red`). Never use red for anything else.
- Overdue (not yet delinquent) = **gold** (`.b-gold`).
- Due today = **teal** (`.b-teal`).
- Completed = **green** (`.b-green`).

Task lifecycle colors follow the same rule: a pushed-past-max task is delinquent (red); approaching deadline is gold; due today teal; done green.

## Accessibility rules

- `:focus-visible` gets a 2px gold outline automatically — never remove it.
- Icon-only buttons (like the shift-log FAB) MUST have an `aria-label`.
- Toasts and async status messages use `role="status"`.
- Modals: `role="dialog"`, `aria-modal="true"`, labelled, Escape closes, focus moves inside on open.
- Active nav link uses `aria-current="page"`.
- **Calendar symbols**: use text/Unicode symbols (never emoji) for calendar glyphs — e.g. `●`, `○`, `◐`, `▲`, `✓`.

## Shell conventions

- Tenant business name is prominent in the app header; keep the small "powered by managemyteam.io" attribution.
- Left sidebar, clustered nav (see `components/AppNav.tsx` for the role-conditional cluster map).
- Manager+ sees a floating shift-log FAB on every app page.
- No kiosk/tap login anywhere. No client-side secrets. Copy is plain and professional.
