# Ascenda Design System: Glass

Read with `COLORS.md` and `TYPOGRAPHY.md`. This file defines the glass (frosted translucent) look, which is a visual layer. It does **not** belong in the PRD, which defines what the product does.

## 1. Principle
Glass is used for **structure and navigation** (sidebar, top bar, floating cards, modals, popovers), not for dense data. Anything a person must read carefully, such as payroll tables, payslips, forms and long text, sits on a solid white surface. Style must never cost readability or speed.

## 2. Surface levels
| Level | Use | Background | Blur | Border | Shadow |
|---|---|---|---|---|---|
| `solid` | Tables, forms, payslips, long text | `--color-surface` | none | 1px `--color-border` | `0 1px 2px rgba(15,23,42,.06)` |
| `glass` | Cards, dashboard widgets | `rgba(255,255,255,.72)` | 20px, saturate 160% | 1px `rgba(255,255,255,.8)` | `0 8px 28px rgba(15,23,42,.10)` plus inset top highlight `inset 0 1px 0 rgba(255,255,255,.9)` |
| `glass-nav` | Sidebar, top bar | `rgba(255,255,255,.65)` | 24px, saturate 180% | 1px `rgba(255,255,255,.75)` | `0 8px 28px rgba(15,23,42,.10)` |
| `glass-overlay` | Modals, menus, popovers | `rgba(255,255,255,.85)` | 28px | 1px `rgba(255,255,255,.9)` | `0 20px 60px rgba(15,23,42,.18)` |

Radii: cards 24px, nav 28px, modals 28px, buttons and inputs 12px, pills and badges 999px. Spacing on a 4px grid; card padding 20 to 24px.

## 3. Background (what the glass sits on)
Glass needs something behind it. Use `--color-bg` (`#F8FAFC`) plus soft radial colour fields built from the palette at low strength:
```css
.app-bg {
  background:
    radial-gradient(640px 440px at 8% 6%,  rgba(29,78,216,.16), transparent 70%),
    radial-gradient(560px 460px at 94% 10%, rgba(15,118,110,.14), transparent 70%),
    radial-gradient(620px 480px at 70% 100%, rgba(245,158,11,.12), transparent 70%),
    var(--color-bg);
}
```
Keep the fields subtle so text contrast stays predictable.

## 4. Glass CSS tokens
```css
:root {
  --glass-bg: rgba(255,255,255,.72);
  --glass-bg-nav: rgba(255,255,255,.65);
  --glass-bg-overlay: rgba(255,255,255,.85);
  --glass-border: rgba(255,255,255,.8);
  --glass-blur: 20px;
  --glass-saturate: 160%;
  --glass-shadow: 0 8px 28px rgba(15,23,42,.10), inset 0 1px 0 rgba(255,255,255,.9);
}
.glass {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  border-radius: 24px;
  box-shadow: var(--glass-shadow);
}
/* Accessibility and fallback: solid when blur is unsupported or reduced */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--color-surface); }
}
@media (prefers-reduced-transparency: reduce) {
  .glass { background: var(--color-surface); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  .glass { background: var(--color-surface); border-color: var(--color-border-strong); backdrop-filter: none; }
}
```

## 5. Readability rules (mandatory)
1. Text on glass is `--color-text` or `--color-text-secondary`. **Never `--color-text-muted` on glass**; use it only on solid surfaces (it only just passes AA there).
2. Glass opacity never goes below 0.65 where text sits.
3. Maximum 2 glass layers stacked. Never glass on glass on glass.
4. Do not apply blur to scrolling table bodies or large lists; it costs performance. Tables and forms use `solid`.
5. Limit glass elements with live blur to about 6 visible at once. Provide the solid fallback on low-end devices (Ascenda users are mobile-first on modest phones).
6. Colour of interactive elements stays the primary palette; glass is never used to carry meaning.
7. Test contrast against the darkest part of the background field behind each glass element.

## 6. Components
- **Sidebar and top bar:** `glass-nav`; active item Primary text on Primary light.
- **KPI card:** `glass`, `kpi` type, icon in a 38px rounded square tinted Primary light, caption in secondary text.
- **Data table card:** a `glass` header strip with title and filters, with the table itself on `solid`.
- **Forms and modals:** modal `glass-overlay`; form fields on solid white inside it; inputs have a clear 1px `--color-border-strong` border and a 2px Primary focus ring.
- **Buttons:** solid colours per COLORS.md. No glass buttons for primary actions.
- **Badges:** tinted solid backgrounds per the status mapping in COLORS.md.
- **Toasts:** `glass-overlay` with status icon and text.
- **Payslip, contracts, reports and print:** always solid white; print styles remove all glass and gradients.

## 7. Icons
- Use one consistent set of rounded **line icons** at 1.5 to 1.75px stroke, sized 16, 20 or 24px (Lucide is a good fit).
- **Do not use Apple SF Symbols.** Their licence limits use to Apple platforms and apps for Apple devices; they must not appear in a web product or exported assets.
- Icon-only buttons need `aria-label` and a 44px touch target.
- Icons inherit `currentColor`. Never use emoji as icons.

## 8. Motion
- 150 to 250ms ease-out for hover, press and panel transitions. No parallax or long animations.
- Respect `prefers-reduced-motion`: disable transforms and fades beyond opacity.

## 9. Responsive
- Mobile first. Sidebar collapses to a bottom or top bar on small screens; cards stack in one column; wide tables scroll inside their own container.
- Touch targets at least 44px. Text never smaller than the scale in TYPOGRAPHY.md.

## 10. Do and don't
| Do | Don't |
|---|---|
| Put glass on navigation and summary cards | Put glass behind dense payroll tables |
| Keep text dark and surfaces light | Use muted grey text on glass |
| Provide solid fallbacks | Rely on blur support |
| Pair colour with icon and label | Use colour alone for status |
| Use tokens | Use raw hex, px or ad-hoc shadows |

## 11. Definition of done (UI)
Uses tokens only; passes contrast in COLORS.md; has solid fallback and reduced-transparency support; keyboard and screen-reader usable; tested on a low-end phone width (360px); no glass on dense data.
