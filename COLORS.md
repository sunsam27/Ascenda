# Ascenda Colour System

Single source of truth for colour. Agents MUST use these tokens, never raw hex values in components. Contrast ratios below were calculated against WCAG 2.1.

## 1. Brand and semantic palette
| Token | Hex | Use |
|---|---|---|
| `--color-primary` | `#1D4ED8` | Buttons, links, active navigation |
| `--color-primary-hover` | `#1E40AF` | Hover and pressed states |
| `--color-primary-light` | `#DBEAFE` | Selected rows, info backgrounds |
| `--color-secondary` | `#0F766E` | Calm accents, wellbeing, avatars |
| `--color-accent` | `#F59E0B` | Highlights, pending badges, small calls to action |
| `--color-success` | `#15803D` | Approved, active, complete |
| `--color-warning` | `#B45309` | Pending, needs review |
| `--color-error` | `#B91C1C` | Rejected, action needed |
| `--color-info` | `#1D4ED8` | Neutral information |
| `--color-text` | `#0F172A` | Headings and body |
| `--color-text-secondary` | `#334155` | Subheads |
| `--color-text-muted` | `#64748B` | Helper text |
| `--color-border` | `#E2E8F0` | Dividers, card edges (subtle) |
| `--color-border-strong` | `#CBD5E1` | Input borders, table lines |
| `--color-bg` | `#F8FAFC` | App background |
| `--color-surface` | `#FFFFFF` | Cards, modals |

Note: Primary and Info share `#1D4ED8`. Tell them apart by icon and context, never by colour alone.

## 2. Verified contrast (WCAG 2.1 AA needs 4.5:1 for normal text, 3:1 for large text and UI)
| Pair | Ratio | Verdict |
|---|---|---|
| White on Primary `#1D4ED8` | 6.7 | Pass |
| White on Primary hover `#1E40AF` | 8.7 | Pass |
| Primary on Primary light `#DBEAFE` | 5.5 | Pass |
| White on Secondary `#0F766E` | 5.5 | Pass |
| White on Success `#15803D` | 5.0 | Pass |
| White on Warning `#B45309` | 5.0 | Pass |
| White on Error `#B91C1C` | 6.5 | Pass |
| **White on Accent `#F59E0B`** | **2.2** | **Fail: use dark text** |
| Text `#0F172A` on Accent `#F59E0B` | 8.3 | Pass |
| Text `#0F172A` on Background `#F8FAFC` | 17.1 | Pass |
| Secondary text `#334155` on white | 10.4 | Pass |
| Muted `#64748B` on white / on `#F8FAFC` | 4.8 / 4.6 | Pass, barely: never go lighter |
| Border `#CBD5E1` on white | 1.5 | Decorative only. Inputs also need a visible focus state |

Rules that follow:
1. Text on Accent is always `--color-text` (dark), never white.
2. Muted text only on solid `--color-surface` or `--color-bg`, never on glass over colour (see DESIGN_SYSTEM.md).
3. Input borders use `--color-border-strong` plus a 2px primary focus ring, so the control boundary meets 3:1 through the focus state and a filled background.
4. Never use colour alone for status. Pair with an icon and a text label.

## 3. Status mapping
| Status | Colour | Tint background | Icon | Examples |
|---|---|---|---|---|
| Approved / Active / Paid / Complete | Success | `rgba(21,128,61,.12)` | check-circle | Leave approved, payslip paid |
| Pending / Needs review | Warning | `rgba(180,83,9,.12)` | clock | Pending approval, payroll in review |
| Attention / Highlight | Accent | `rgba(245,158,11,.18)` | star or dot | New, unfilled role, small CTA |
| Rejected / Failed / Action needed | Error | `rgba(185,28,28,.10)` | alert | Payment failed, missing bank details |
| Information | Info | `--color-primary-light` | info | Tips, system notices |
| Neutral / Inactive | Muted | `rgba(100,116,139,.12)` | minus | Terminated, draft |

Badge: tinted background, text in the status colour (Success, Warning, Error and Info all pass on their tints), 12px radius, icon plus label.

Warning versus Accent: Warning (`#B45309`) means a state that blocks or needs a decision. Accent (`#F59E0B`) is for emphasis and small calls to action only. Do not use Accent as body text or on white backgrounds for text.

## 4. Component colour rules
- **Primary button:** fill Primary, white text; hover Primary hover; focus ring 2px Primary with 2px offset; disabled 40% opacity, no hover.
- **Secondary button:** surface fill, 1px Primary border, Primary text; hover Primary light.
- **Destructive button:** fill Error, white text.
- **Links:** Primary, underlined on hover; visited unchanged.
- **Navigation:** active item Primary text on Primary light; inactive Secondary text.
- **Selected table row:** Primary light background and a 3px Primary marker (not colour alone).
- **Avatars:** Secondary background with white initials by default.
- **Charts:** series order Primary, Secondary, Accent, `#64748B`, `#7C3AED`. Always add labels or patterns; maximum 5 series.
- **Focus:** always visible, 2px Primary ring, never removed.

## 5. Dark mode (planned, not Release 1)
Reserve the same token names. Do not hard-code light values in components. Define a `[data-theme="dark"]` block later; contrast must be re-verified.

## 6. Tokens (copy into the project)
```css
:root {
  --color-primary: #1D4ED8;
  --color-primary-hover: #1E40AF;
  --color-primary-light: #DBEAFE;
  --color-secondary: #0F766E;
  --color-accent: #F59E0B;
  --color-success: #15803D;
  --color-warning: #B45309;
  --color-error: #B91C1C;
  --color-info: #1D4ED8;
  --color-text: #0F172A;
  --color-text-secondary: #334155;
  --color-text-muted: #64748B;
  --color-border: #E2E8F0;
  --color-border-strong: #CBD5E1;
  --color-bg: #F8FAFC;
  --color-surface: #FFFFFF;
}
```
