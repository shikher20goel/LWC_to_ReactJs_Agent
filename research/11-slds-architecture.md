# SLDS CSS Architecture — Reference for LWC → React Migration

Research date: 11 Aug 2026. Package version checked: `@salesforce-ux/design-system` **2.264.0** (`latest`),
with `2.264.1` published under the `winter-27` dist-tag, and a `3.0.1-dev` line in flight
(source: jsDelivr package metadata).

Confidence markers used throughout: **[verified]** = read from an official Salesforce source
(SCSS in `salesforce-ux/design-system`, or developer.salesforce.com);
**[inference]** = my reasoning, not directly stated in a source;
**[UNVERIFIED]** = I could not confirm it in 2026 — do not encode it into a converter without checking.

---

## 1. The spacing scale — EXACT values (HIGHEST PRIORITY)

This is the canonical SLDS t-shirt spacing scale. Base unit is **4px (0.25rem)**; the scale is
non-linear (it is not a pure 4× multiple at every step — note `small` = 0.75rem and the jump from
`x-large` 2rem to `xx-large` 3rem).

Assuming the standard `1rem = 16px` root font size.

| Token name | SCSS var | Value (rem) | Value (px) |
|---|---|---|---|
| `none`      | `$spacing-none`      | `0`         | `0px`  |
| `xxx-small` | `$spacing-xxx-small` | `0.125rem`  | `2px`  |
| `xx-small`  | `$spacing-xx-small`  | `0.25rem`   | `4px`  |
| `x-small`   | `$spacing-x-small`   | `0.5rem`    | `8px`  |
| `small`     | `$spacing-small`     | `0.75rem`   | `12px` |
| `medium`    | `$spacing-medium`    | `1rem`      | `16px` |
| `large`     | `$spacing-large`     | `1.5rem`    | `24px` |
| `x-large`   | `$spacing-x-large`   | `2rem`      | `32px` |
| `xx-large`  | `$spacing-xx-large`  | `3rem`      | `48px` |

**[verified] — three independent official sources agree:**

1. `design-tokens/aliases/spacing.yml` in `salesforce-ux/design-system` (the source of truth for the
   SCSS `$spacing-*` variables):
   `SPACING_NONE: 0`, `SPACING_XXX_SMALL: 0.125rem`, `SPACING_XX_SMALL: 0.25rem`,
   `SPACING_X_SMALL: 0.5rem`, `SPACING_SMALL: 0.75rem`, `SPACING_MEDIUM: 1rem`,
   `SPACING_LARGE: 1.5rem`, `SPACING_X_LARGE: 2rem`, `SPACING_XX_LARGE: 3rem`.

2. The doc-comment header of `ui/utilities/padding/_index.scss`, quoted verbatim from the repo:

   ```scss
   /** Adds .125rem padding to the side specified
    * @selector .slds-p-*_xxx-small, .slds-var-p-*_xxx-small */
   /** Adds .25rem padding ...  @selector .slds-p-*_xx-small,  .slds-var-p-*_xx-small */
   /** Adds .5rem  padding ...  @selector .slds-p-*_x-small,   .slds-var-p-*_x-small  */
   /** Adds .75rem padding ...  @selector .slds-p-*_small,     .slds-var-p-*_small    */
   /** Adds 1rem   padding ...  @selector .slds-p-*_medium,    .slds-var-p-*_medium   */
   /** Adds 1.5rem padding ...  @selector .slds-p-*_large,     .slds-var-p-*_large    */
   /** Adds 2rem   padding ...  @selector .slds-p-*_x-large,   .slds-var-p-*_x-large  */
   /** Adds 3rem   padding ...  @selector .slds-p-*_xx-large,  .slds-var-p-*_xx-large */
   ```

3. The Aura standard design tokens reference (`force:base`) on developer.salesforce.com:
   `spacingXxxSmall 0.125rem`, `spacingXxSmall 0.25rem`, `spacingXSmall 0.5rem`,
   `spacingSmall 0.75rem`, `spacingMedium 1rem`, `spacingLarge 1.5rem`, `spacingXLarge 2rem`.
   (That page's basic-spacing table stops at `spacingXLarge`; `xx-large = 3rem` is confirmed by
   sources 1 and 2, and by the `varSpacingXxLarge: 3rem` entry on the same page.)

### Ready-to-use converter map

```js
// SLDS t-shirt size -> CSS length. Exhaustive; no other size names exist in the scale.
const SLDS_SPACING = {
  'none':      '0',
  'xxx-small': '0.125rem', // 2px
  'xx-small':  '0.25rem',  // 4px
  'x-small':   '0.5rem',   // 8px
  'small':     '0.75rem',  // 12px
  'medium':    '1rem',     // 16px
  'large':     '1.5rem',   // 24px
  'x-large':   '2rem',     // 32px
  'xx-large':  '3rem',     // 48px
};
```

### Two gotchas the converter must handle

- **`_none` emits `!important`.** In the real SCSS, only the `none` step carries `!important`:
  `.slds-p-around_none { padding: 0 !important; }`. Every other step is a plain declaration.
  There is **no** `.slds-var-p-*_none` class — the `var-` family starts at `xxx-small`. **[verified]**
- **Legacy double-dash aliases.** Every static utility ships a `--` twin:
  `.slds-p-around_medium, .slds-p-around--medium { padding: 1rem; }`. The `--` form is the
  deprecated pre-2.x BEM syntax and the SLDS Linter rule `enforce-bem-usage` flags it as an error.
  A converter should accept both on input and only ever emit the `_` form. **[verified]**
  Note that the `slds-var-*` family has **no** `--` aliases. **[verified]**

---

## 2. `slds-var-*` vs `slds-*` — the precise difference

### Why both exist

They exist because of **Lightning Experience Display Density** (the user-level "Comfy" / "Compact"
setting, shipped Winter '19). Salesforce needed spacing to be *runtime-switchable per user* without
recompiling CSS. So the utility layer was forked:

- `slds-*` = **static / constant** — resolves to a hard-coded length at build time. Immune to density.
- `slds-var-*` = **variable** — resolves to a CSS custom property that the density theme rewrites at
  runtime. Adapts to density.

The Salesforce developer blog announcing density states it directly (quoted):
> "Every spacing token that reacts to a user's density preference is prefixed with `var`. If you want
> your component to adapt to densification, instead of using a token with a static value like
> `t(spacingMedium)`, you would change to a token that begins with `var`" — i.e. `t(varSpacingMedium)`.

And the behavioural consequence, also quoted from that post:
> "`t(varSpacingMedium)` defaults to `1rem/16px` in Comfy mode and adapts to `0.5rem/8px` in Compact mode."

**This is the whole point.** `slds-p-around_medium` is always 16px. `slds-var-p-around_medium` is
16px in Comfy and 8px in Compact. A converter that collapses `var-` to a literal `1rem` silently
deletes density support. **[verified]**

Density affects exactly three things per that post: **spacing** (padding/margin between elements, and
line-height for text blocks), **form element alignment** (top-aligned in Comfy, left-aligned in
Compact), and **title font size** (higher-level text elements, not body copy). **[verified]**

### The emitted CSS

From `ui/utilities/padding/_index.scss`, verbatim:

```scss
// Constant
.slds-p-around_medium,
.slds-p-around--medium {
  padding: $spacing-medium;          // -> padding: 1rem;
}

// Variable
.slds-var-p-around_medium {
  padding: $var-spacing-medium;      // -> padding: var(--lwc-varSpacingMedium, 1rem);
}
```

The `$spacing-*` side is confirmed literal. The exact expansion of `$var-spacing-medium` into
`var(--lwc-varSpacingMedium, 1rem)` is **[inference]** — I confirmed the *token name*
`varSpacingMedium` and its `1rem` default from the `force:base` token reference, and confirmed the
general `var(--lwc-<token>, <fallback>)` emission shape from the LWC styling docs (which show
`padding: var(--slds-g-spacing-4, var(--lwc-spacingMedium, 1rem))` and describe `--lwc-spacingMedium`
as "a fallback value for SLDS 1 themes" with "the static value `1rem`... a fallback value for an
environment without SLDS"). I did **not** fetch a compiled CSS bundle to read the literal
`--lwc-varSpacingMedium` declaration. Treat the custom-property *name* as high-confidence and the
exact fallback chain as unconfirmed.

### The axis subtlety — do not miss this

The `var-` family uses **three different token groups depending on the axis of the property**, while
the static family uses one. From the SCSS, verbatim:

| Class | Variable used |
|---|---|
| `.slds-var-p-top_medium` / `.slds-var-p-bottom_medium` | `$var-spacing-vertical-medium` |
| `.slds-var-p-vertical_medium` | `$var-spacing-vertical-medium` (both sides) |
| `.slds-var-p-left_medium` / `.slds-var-p-right_medium` | `$var-spacing-horizontal-medium` |
| `.slds-var-p-horizontal_medium` | `$var-spacing-horizontal-medium` (both sides) |
| `.slds-var-p-around_medium` | `$var-spacing-medium` (the *general* group) |

So there are 3 parallel token groups: general (`varSpacingMedium`), vertical
(`varSpacingVerticalMedium`), horizontal (`varSpacingHorizontalMedium`). All three default to the
same rem values in Comfy density; they diverge under Compact so vertical and horizontal can compress
independently. **[verified]** — the class→variable mapping is read directly from the SCSS; the
"diverge under Compact" rationale is **[inference]**.

Comfy/default values, from the `force:base` token reference **[verified]**:
`varSpacing{,Vertical,Horizontal}` × `XxSmall 0.25rem`, `XSmall 0.5rem`, `Small 0.75rem`,
`Medium 1rem`, `Large 1.5rem`, `XLarge 2rem`, `XxLarge 3rem`.
That page does **not** list a `varSpacingXxxSmall` even though `.slds-var-p-*_xxx-small` classes
exist in the SCSS. **[UNVERIFIED]** whether an `xxx-small` var token is published; assume `0.125rem`
by symmetry but flag it.

### What real components use

Empirically, real LWC/Aura component markup overwhelmingly uses `slds-var-*` for padding and margin —
that is the documented guidance for anything that should densify. **[inference]** — I did not do a
corpus count; this matches the guidance and the user's own stated observation.

### Converter recommendation

```
slds-p-around_medium      -> padding: 1rem
slds-var-p-around_medium  -> padding: var(--lwc-varSpacingMedium, 1rem)
```

Emit the `var()` form with the rem fallback for `var-` classes. If your React target has no
density system, resolving `var-` to its Comfy rem value is an acceptable lossy shortcut — but make it
an explicit, documented, flag-controlled decision, not an accident. Preserving the custom property
costs nothing and keeps a future density hookup possible.

---

## 3. Class taxonomy — families that must be converted DIFFERENTLY

Five structurally distinct families. Detect them in this order; the grammars overlap.

### 3.1 Component BEM (blueprints)

Grammar: `slds-<block>[__<element>][_<modifier>]`

- `__` (double underscore) = **element** — a part inside the block.
- `_` (single underscore) = **modifier** — a variant of the block or element.
- `--` (double dash) = **deprecated legacy modifier syntax**, still shipped as an alias on most
  static classes. `enforce-bem-usage` in the SLDS Linter errors on it. **[verified]**

Examples: `slds-card`, `slds-card__header`, `slds-card__header-title`, `slds-card__body`,
`slds-card__footer`, `slds-button`, `slds-button_brand`, `slds-button_neutral`,
`slds-button__icon`, `slds-modal__container`.

**Conversion strategy:** these are *not* utilities. Each block maps to a React component with its own
structure and props (`slds-button_brand` → `<Button variant="brand">`). Do not translate them to
inline styles. `__` becomes internal structure; `_` becomes a prop/variant.

### 3.2 Spacing utilities

Grammar: `slds-[var-]<p|m>-<side>_<size>`

- Property: `p` = padding, `m` = margin.
- Side: `top` | `right` | `bottom` | `left` | `horizontal` | `vertical` | `around`.
- Size: the scale from §1, plus `none`.
- Optional `var-` infix per §2, sitting between `slds-` and the property letter.

Examples: `slds-p-around_medium`, `slds-var-p-around_medium`, `slds-m-top_x-small`,
`slds-var-m-bottom_large`, `slds-p-horizontal_small`, `slds-m-right_none`.

Margin adds sizes the padding scale does not have: `slds-m-*_auto` and, for negative pull,
`slds-m-*_xx-small` etc. **[UNVERIFIED]** — I read the padding SCSS in full but only inferred the
margin file's shape by symmetry with `ui/utilities/margin/_index.scss` being the sibling module.
Verify `_auto` and any negative-margin classes against that file before shipping.

Also in this family: `slds-has-cushion` (a global padding helper using `$component-spacing-padding`).
**[verified]**

**Conversion strategy:** pure CSS property emission. Fully mechanical. This is where the §1 table pays off.

### 3.3 Grid / layout

Flexbox-based, not CSS Grid despite the name. **[verified]** — full class list read from
`ui/utilities/grid/_index.scss`.

- Container: `slds-grid`, `slds-grid_frame` (viewport-height frame), `slds-grid_vertical`,
  `slds-grid_vertical-reverse`, `slds-grid_reverse`, `slds-grid_overflow`
- Wrapping: `slds-wrap`, `slds-nowrap`
- Main-axis alignment: `slds-grid_align-center`, `slds-grid_align-space`, `slds-grid_align-spread`,
  `slds-grid_align-end`
- Cross-axis alignment: `slds-grid_vertical-align-start`, `slds-grid_vertical-align-center`,
  `slds-grid_vertical-align-end`, `slds-grid_vertical-stretch`
- Per-item cross-axis: `slds-align-top`, `slds-align-middle`, `slds-align-bottom`
- Column: `slds-col`, `slds-col_rule-{top,right,bottom,left}`,
  `slds-col_bump-{top,right,bottom,left}` (auto-margin push)
- Flex behaviour: `slds-grow`, `slds-grow-none`, `slds-shrink`, `slds-shrink-none`, `slds-no-flex`,
  `slds-no-space`, `slds-has-flexi-truncate`
- Gutters: `slds-gutters`, `slds-gutters_<size>`, `slds-gutters_direct`,
  `slds-gutters_direct-<size>` (over the full t-shirt scale)
- Negative pull: `slds-grid_pull-padded`, `slds-grid_pull-padded-<size>`
- Containers: `slds-container_{small,medium,large,x-large,fluid}`,
  `slds-container_{center,left,right}`

**Sizing** is a separate module (`ui/utilities/sizing/_index.scss`) but converts alongside grid:

- Fractional: `slds-size_<n>-of-<d>` where `d` ∈ {1,2,3,4,5,6,7,8,9,10,11,12} and n ≤ d.
  Real examples: `slds-size_1-of-3`, `slds-size_2-of-3`, `slds-size_8-of-12`.
- Absolute: `slds-size_xxx-small` … `slds-size_xx-large`, plus `slds-size_full` (100%).
- Responsive min-width: `slds-<bp>-size_<n>-of-<d>`, e.g. `slds-medium-size_1-of-2`.
- Responsive max-width: `slds-max-<bp>-size_<n>-of-<d>`.
- Order: `slds-order_1` … `slds-order_12`, plus `slds-<bp>-order_*` / `slds-max-<bp>-order_*`.

Breakpoint names come from the `$breakpoints` SCSS map (`x-small`, `small`, `medium`, `large`,
`x-large`). **[UNVERIFIED]** — I confirmed the *names* but not the exact px breakpoint values.

**Conversion strategy:** these map cleanly onto flexbox props in a React layout primitive
(`<Grid align="spread" verticalAlign="center">`) or straight to flex CSS. Fractions → `width: 33.333%`
style rules — but note that whether SLDS emits `flex-basis` vs `width` for `slds-size_*` is
**[UNVERIFIED]** (the SCSS delegates to a `width()` mixin I did not read).

### 3.4 Text / typography

**[verified]** from `ui/utilities/text/_index.scss`.

| Class | Value |
|---|---|
| `slds-text-heading_large` | 28px |
| `slds-text-heading_medium` | 20px |
| `slds-text-heading_small` | 16px |
| `slds-text-heading_label` | **deprecated** |
| `slds-text-heading_label-normal` | **deprecated** |
| `slds-text-body_regular` | body default |
| `slds-text-body_small` | smaller body |

Other members: `slds-text-title`, `slds-text-title_caps`, `slds-text-title_bold`,
`slds-line-height_reset`, `slds-text-longform`, `slds-text-font_monospace`,
`slds-text-align_{left,center,right}`,
`slds-text-color_{default,weak,error,destructive,success,inverse,inverse-weak}`.

`slds-truncate` lives in its own module (`ui/utilities/truncation/`) and expands a `truncate` mixin —
i.e. `overflow: hidden; white-space: nowrap; text-overflow: ellipsis;` **[inference]** on the exact
declarations, **[verified]** that it is `@include truncate;`. Companions:
`slds-truncate_container_{25,33,50,66,75}` → `max-width: 25%|33%|50%|66%|75%`. **[verified]**

`slds-text-link` and its variants (`slds-text-link_reset`, `slds-text-link_faux`) were **not** found
in the text utilities file — they live elsewhere in the tree. **[UNVERIFIED]** — the class names are
in wide real-world use and are certainly valid SLDS, but I did not locate their source file, so I
cannot state their exact declarations. `slds-text-link_reset` is the important one for converters: it
strips link styling from an `<a>` used as a structural wrapper.

**Conversion strategy:** heading classes are semantic-ish but not tied to `<h1>`–`<h6>`. A converter
must keep the source element's tag and apply the size class separately — SLDS deliberately decouples
heading level from heading size.

### 3.5 Visibility / accessibility

**[verified]** from `ui/utilities/visibility/_index.scss`.

- `slds-assistive-text` — screen-reader-only text. Expands `@include assistive-text;`
  (clip/position-absolute technique). **The single most important a11y class to preserve** — dropping
  it either exposes hidden text visually or removes the accessible name.
- `slds-assistive-text_focus` — visible on focus (skip-link pattern).
- `slds-hide` → `display: none !important;` (note the `!important`)
- `slds-show` → `display: block;` (**no** `!important` — asymmetric with `slds-hide`; this matters
  for specificity when converting)
- `slds-show_inline`, `slds-show_inline-block`
- `slds-hidden` / `slds-visible` — `visibility`-based, preserves layout box (distinct from
  `slds-hide`/`slds-show`)
- `slds-is-collapsed` / `slds-is-expanded` — disclosure state
- `slds-transition-hide` / `slds-transition-show`
- `slds-is-visually-empty`
- Responsive: `slds-hide_<bp>` and `slds-show_<bp>` for bp ∈ {x-small, small, medium, large, x-large},
  each with a `--` legacy alias.

`slds-is-relative` (`position: relative`) was **not** in the visibility file — it belongs to a
positioning module I did not read. **[UNVERIFIED]** as to source, though the class is real and its
effect is unambiguous.

**Conversion strategy:** `slds-hide`/`slds-show` are usually driven by LWC template conditionals
(`if:true`) and should become React conditional rendering, *not* a CSS class — but only when the class
is bound dynamically. Statically-applied `slds-hide` must stay a class. `slds-assistive-text` should
map to your React equivalent (a `<VisuallyHidden>` component or `.sr-only`), never be dropped.

### 3.6 Theme

**[verified]** from `ui/utilities/themes/_index.scss`:
`slds-theme_default`, `slds-theme_shade`, `slds-theme_inverse`, `slds-theme_alt-inverse`,
`slds-theme_success`, `slds-theme_info`, `slds-theme_warning`, `slds-theme_error`,
`slds-theme_offline`, `slds-theme_alert-texture`, `slds-theme_inverse-text`.

Each is `@include theme(<name>);` — the mixin sets background-color, text color, and link color
together. The concrete color for `slds-theme_shade` is **[UNVERIFIED]**; it is not a literal in that
file. (Commonly `#f3f3f3` in SLDS 1 — the LWC docs reference `--slds-g-color-surface-3` as the SLDS 2
replacement for "surface light grey `#F3F3F3`", which is consistent — but I did not confirm the
`theme(shade)` mixin's own value.) **Look it up in the compiled CSS rather than trusting the guess.**

**Conversion strategy:** theme classes set a *bundle* of properties, not one. Do not decompose them
into a single `background-color`. Map to a themed wrapper component or copy the full rule set from
compiled CSS.

---

## 4. Styling hooks / design tokens

### The two namespaces

**Component-level hooks — `--slds-c-*`**

Grammar (per the brief, and consistent with what I saw):
`--slds-c-[component]-[category]-[property]-[state]`

Confirmed real examples: `--slds-c-card-color-background`, `--slds-c-button-brand-color-background`,
`--slds-c-badge-color-background`, `--slds-c-breadcrumbs-spacing-inline-end`.

The LWC docs show usage as `var(--slds-c-badge--color-background, #ecebea)` — note that example uses a
**double dash** before `color`, which is the older component-hook syntax. The SLDS Linter rule
`enforce-component-hook-naming-convention` now errors on deprecated component-hook shapes and
normalizes them (its own documented example: `--slds-c-breadcrumbs-spacing-inlineend` →
`--slds-c-breadcrumbs-spacing-inline-end`). **[verified]** that the rule exists and normalizes;
**[UNVERIFIED]** whether `--slds-c-badge--color-background` (double dash) is currently canonical or
legacy — the docs and the linter appear inconsistent here. **Treat the single-dash form
`--slds-c-<component>-<category>-<property>[-<state>]` as canonical and accept both on input.**

**Global hooks — `--slds-g-*`**

Grammar: `--slds-g-[category]-[property]-[numeric identifier]`, where the number increments from 1 and
"lower numbers typically represent smaller/lighter values, higher numbers larger/darker". **[verified]**

Categories and confirmed examples:
- Color: `--slds-g-color-surface-1`, `--slds-g-color-surface-3`, `--slds-g-color-accent-container-1`,
  `--slds-g-color-on-surface-3`, `--slds-g-color-border-error-1`
- Spacing: `--slds-g-spacing-4` — documented as "equivalent to 16px or 1rem in most browsers",
  i.e. **the numeric suffix is the 4px-multiple count**: `spacing-4` = 4 × 4px = 16px. **[verified]**
  **[inference]**: `--slds-g-spacing-1` = 4px, `-2` = 8px, `-3` = 12px, `-6` = 24px, `-8` = 32px,
  `-12` = 48px. This is a clean mapping from the t-shirt scale, but I confirmed **only** the `-4` = 1rem
  data point. Verify the rest before encoding.
- Typography: `--slds-g-font-size-base`, `--slds-g-font-weight-4`
- Shadow: `--slds-g-shadow-<n>`
- Radius: `--slds-g-radius-border-<n>`
- Sizing: `--slds-g-sizing-<property>-<n>`

There is also a legacy `--sds-g-*` namespace; `enforce-sds-to-slds-hooks` migrates
`--sds-g-color-brand-base-100` → `--slds-g-color-brand-base-100`. **[verified]**

And the deprecated `--lwc-*` namespace (the compiled output of Aura design tokens):
`lwc-token-to-slds-hook` replaces `--lwc` tokens with `--slds` hooks "while retaining the `--lwc`
token as the fallback value". **[verified]**

### Recommended approach as of 2026 — unambiguous

**Styling hooks. Design tokens are out.** Three converging pieces of evidence:

1. The SLDS 1 vs SLDS 2 comparison page states plainly: **"Design tokens are no longer supported in
   SLDS 2 themes."** **[verified]**
2. The recommended migration is to replace original global color hooks with the semantic UI color
   global styling hooks, with SLDS Linter / SLDS Validator automating the move off design tokens. **[verified]**
3. CSS overrides of SLDS classes are explicitly unsupported: *"CSS overrides are not supported because
   SLDS classes and base component internals can change in future releases."* Hooks are the sanctioned
   customization surface. **[verified]**

The canonical fallback-chain pattern, quoted verbatim from the LWC docs:

```css
.my-button-padding {
  padding: var(--slds-g-spacing-4, var(--lwc-spacingMedium, 1rem));
}
```

Reading: SLDS 2 global hook first → SLDS 1 `--lwc` token as fallback → static rem as final fallback
"for an environment without SLDS". **[verified]** The linter rule `no-slds-var-without-fallback`
makes hooks-without-fallbacks an **error**. For a React target with no Salesforce runtime, that final
static fallback is what actually renders — which is another reason to emit the full chain rather than
resolve to a literal.

### The critical catch for this migration

**SLDS 2 does not yet support component-level styling hooks.** The comparison page says component-level
`--slds-c-*` hooks "are not currently supported" in SLDS 2, and advises that if your components use
`--slds-c-*`, you should **"stay on SLDS 1 for now"** until support lands. Salesforce says it is working
on it. **[verified] as of the doc revision I read** — **[UNVERIFIED]** whether this is still true in
Aug 2026, and it is exactly the kind of thing that changes between releases. **Re-check this before
committing to an architecture.** It is the single highest-risk unverified item in this document.

---

## 5. Version state in 2026

### Is the classic `slds-*` class API still current?

**Yes — with a caveat I could not fully close.** Evidence:

- `@salesforce-ux/design-system` is at **2.264.0** with a **`winter-27`** dist-tag on 2.264.1. The 2.x
  line — the line that ships the `slds-*` utilities and blueprints — is actively published for a release
  cycle that is still in the future as of today. **[verified]**
- The SLDS Linter's flagship rule is `no-deprecated-classes-slds2`: "classes that aren't available in
  SLDS 2" must be updated "to supported alternatives". This is a rule about a **subset** of classes
  being dropped, not the class API being retired. **[verified]** **[inference]**: if the whole `slds-*`
  API were gone, the rule would not be scoped to specific deprecated classes.
- A `3.0.1-dev` version exists in the registry. **[UNVERIFIED]** what SLDS 3 / v3 of the package is or
  whether it changes the class API. I found no documentation for it.

**[UNVERIFIED]:** I could not obtain the actual list behind `no-deprecated-classes-slds2`. That list is
the single most valuable artifact for this migration and you should fetch it directly from the SLDS
Linter package before building the converter's deny-list.

### Does SLDS 2 exist, and what changed?

Yes. Timeline **[verified]**:

- **Spring '25** — SLDS 2 introduced as **Beta**. Themes could be created and used in orgs.
- **Winter '26** — SLDS 2 reached **General Availability** in all Salesforce editions.
- **2026** — actively shipping; monthly-release ecosystem notes (e.g. a Feb 2026 ISV release note
  referencing SLDS 2 features) confirm it is in production use.
- **Dark mode** remains **Beta**, available in Starter Suite orgs.

What changed:

1. **New CSS framework that separates structure from visual design using styling hooks.** The
   architecture is decoupled from Salesforce's default visual style. **[verified]**
2. **Salesforce Cosmos** is the new default theme — "adaptable spacing, at-a-glance views, an enriched
   color palette, reader-friendly typography scale, and reduced cognitive load". SLDS 2 activates when
   you turn on Cosmos (Setup → Themes and Branding). **[verified]**
3. **Design tokens removed** from SLDS 2 themes. **[verified]**
4. **Component-level hooks not yet supported** (see §4 catch). **[verified]** at doc-read time.
5. **Global hooks are the compatibility surface**: "All styling hooks that are SLDS 2 compatible are
   global styling hooks and start with `--slds-g`." **[verified]**

### What I could NOT verify — explicit list

1. **The literal expansion of `$var-spacing-*`** into `var(--lwc-varSpacing*, <fallback>)`. I did not
   read a compiled CSS bundle. The token *names* and *values* are verified; the emission shape is inferred.
2. **`--slds-g-spacing-<n>` for n ≠ 4.** Only `--slds-g-spacing-4` = 1rem is confirmed.
3. **The `no-deprecated-classes-slds2` deny-list contents.** Not obtained.
4. **Whether component-level `--slds-c-*` hooks are supported in SLDS 2 as of Aug 2026.** The doc I read
   says no; this may be stale.
5. **`slds-theme_shade`'s actual background color.** Behind a mixin.
6. **`slds-text-link` / `slds-text-link_reset` source and declarations.** Not located.
7. **`slds-is-relative` source module.** Not located.
8. **Breakpoint px values** behind the `$breakpoints` map.
9. **The margin utilities file** (`_auto`, negative margins). Inferred from padding by symmetry only.
10. **Whether `slds-size_*` emits `width` or `flex-basis`.** Behind a `width()` mixin.
11. **What `@salesforce-ux/design-system` 3.x is.** No docs found.
12. **The `--slds-c-*` double-dash vs single-dash canonical form.** Docs and linter disagree.

### Migration posture recommendation

Target **SLDS 1 class semantics** for the converter's input grammar (that is what existing LWC markup
contains) and emit **hook-aware CSS with static fallbacks** on the output side. That gives correct
rendering today with zero Salesforce runtime, and leaves a path to wire up `--slds-g-*` later.
Do not build the converter against SLDS 2 global hooks alone until items 2, 3, and 4 above are closed.
**[inference]**

---

## Sources

Every URL below was actually fetched during this research.

- https://raw.githubusercontent.com/salesforce-ux/design-system/master/design-tokens/aliases/spacing.yml
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/padding/_index.scss
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/grid/_index.scss
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/sizing/_index.scss
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/text/_index.scss
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/truncation/_index.scss
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/visibility/_index.scss
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/utilities/themes/_index.scss
- https://developer.salesforce.com/docs/atlas.en-us.lightning.meta/lightning/tokens_standard_force_base.htm
- https://developer.salesforce.com/docs/platform/lwc/guide/create-components-css-slds.html
- https://developer.salesforce.com/docs/platform/lwc/guide/create-components-css-custom-properties.html
- https://developer.salesforce.com/docs/platform/lwc/guide/create-components-css-slds1-slds2.html
- https://developer.salesforce.com/docs/platform/slds-linter/guide/reference-rules.html
- https://developer.salesforce.com/blogs/2018/08/new-density-settings-for-the-lightning-experience-ui-in-winter-19
- https://v1.lightningdesignsystem.com/platforms/lightning/new-global-styling-hooks-guidance/
- https://data.jsdelivr.com/v1/packages/npm/@salesforce-ux/design-system

Fetched but returned no usable content (SPA — client-rendered, not readable by fetch):

- https://www.lightningdesignsystem.com/2e1ef8501/p/93a8e1-padding
- https://www.lightningdesignsystem.com/2e1ef8501/p/03d6b0

Fetch failed (DNS — archive subdomains appear retired):

- https://archive-2_7_0.lightningdesignsystem.com/utilities/padding/
- https://raw.githubusercontent.com/salesforce-ux/design-system/master/design-tokens/aliases/var-spacing.yml (404)
