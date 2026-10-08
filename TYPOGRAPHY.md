# Ascenda Typography

Typeface: **Space Grotesk** for all product UI. Agents MUST use these tokens, never ad-hoc font sizes.

## 1. Font
- Family: Space Grotesk (open source, SIL OFL licence, free for commercial use). Weights used: 400, 500, 600, 700.
- Loading: self-host the WOFF2 files for speed, privacy and reliability on slow networks. Fallback is Google Fonts only if self-hosting is not yet set up.
- Fallback stack: `"Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- `font-display: swap`, preload the 400 and 600 weights, and subset to Latin (add Latin Extended if you support more languages).
- Monospace (code, IDs, bank-file previews only): `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.

```css
@font-face {
  font-family: "Space Grotesk";
  src: url("/fonts/SpaceGrotesk-Variable.woff2") format("woff2");
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
}
:root {
  --font-sans: "Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
body { font-family: var(--font-sans); font-feature-settings: "tnum" 1; }
```

## 2. Why this matters for Ascenda
Space Grotesk has a distinct, geometric character, so keep it disciplined. In payroll and tables, readability beats personality:
- Use **tabular figures** for all money, dates, durations and table columns so digits line up: `font-variant-numeric: tabular-nums;`.
- Right-align numeric columns. Always show the currency symbol or code, for example `₦32,500,000`. Confirm the Naira sign (₦) renders in the font file you ship; if it falls back, the weights will look inconsistent.
- Never use weights under 400 for text, and avoid Light (300) entirely on glass surfaces.

## 3. Type scale
Base size 16px (1rem). Sizes are rem, line-heights unitless.

| Token | Size | Weight | Line height | Letter spacing | Use |
|---|---|---|---|---|---|
| `display` | 40px / 2.5rem | 700 | 1.1 | -0.03em | Marketing hero only |
| `h1` | 32px / 2rem | 700 | 1.2 | -0.02em | Page titles |
| `h2` | 24px / 1.5rem | 600 | 1.25 | -0.015em | Section titles |
| `h3` | 20px / 1.25rem | 600 | 1.3 | -0.01em | Card titles |
| `h4` | 18px / 1.125rem | 600 | 1.35 | 0 | Subsections |
| `body-lg` | 18px | 400 | 1.55 | 0 | Intro text |
| `body` | 16px | 400 | 1.5 | 0 | Default text |
| `body-sm` | 14px | 400 | 1.5 | 0 | Table cells, secondary text |
| `label` | 14px | 500 | 1.4 | 0 | Form labels, buttons |
| `caption` | 12.5px | 400 | 1.4 | 0.01em | Helper text, timestamps |
| `overline` | 12px | 600 | 1.3 | 0.08em uppercase | Section eyebrows |
| `kpi` | 38px / 2.375rem | 700 | 1.05 | -0.03em, tabular | Dashboard numbers |
| `kpi-sm` | 24px | 600 | 1.1 | -0.02em, tabular | Card totals |

Minimum text size: 12px, and only for captions. Mobile: scale `h1` to 28px and `kpi` to 32px under 640px width.

## 4. Usage rules
1. One `h1` per page. Do not skip heading levels.
2. Headings use `--color-text`, subheads `--color-text-secondary`, helper text `--color-text-muted` (see COLORS.md).
3. Body line length 60 to 80 characters. Tables and cards are exempt.
4. Do not use all caps except `overline`. Do not underline except links.
5. Do not mix in a second display font. Emphasis is bold or colour with an icon, never italics for UI.
6. Buttons use `label` at weight 600. Form inputs use `body` at 16px so mobile browsers do not zoom on focus.
7. Truncate long names with an ellipsis and a tooltip, never shrink text below the scale.
8. Support user text-size increases to 200% without clipping or horizontal scroll.

## 5. Tokens
```css
:root {
  --text-display: 2.5rem; --text-h1: 2rem; --text-h2: 1.5rem; --text-h3: 1.25rem;
  --text-h4: 1.125rem; --text-body-lg: 1.125rem; --text-body: 1rem; --text-body-sm: .875rem;
  --text-caption: .78rem; --text-kpi: 2.375rem; --text-kpi-sm: 1.5rem;
  --weight-regular: 400; --weight-medium: 500; --weight-semibold: 600; --weight-bold: 700;
  --leading-tight: 1.2; --leading-normal: 1.5;
}
```

If you use Tailwind, map these into `theme.extend.fontFamily` and `fontSize` so classes like `text-h2` exist and raw sizes are discouraged.
