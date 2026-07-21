# SASH-NOTES.md — fpd-js v6 API survey for com_sash Phase 2 engine swap

Branch: `sash` (forked from `genr8r/fpd-js` master, upstream `m20io/fpd-js`).
This document is the API source of truth for later Phase 2 tasks. All citations are
`path/from/repo/root:line` against this repo at the commit that introduces this file,
paths relative to `~/Projects/forks/fpd-js`.

## 0. Environment / build

- Node: `v26.5.0`, npm: `11.17.0` (whatever `node -v`/`npm -v` gave in this environment;
  no `engines` field is declared in `package.json`, so this is not a hard requirement,
  just what was used to bootstrap).
- `gh repo clone genr8r/fpd-js` auto-added the `upstream` remote pointing at
  `https://github.com/m20io/fpd-js.git` and fetched it (gh detected the fork
  relationship) — Step 1 of the brief's `git remote add upstream ...` was therefore a
  no-op; running it anyway is harmless (falls to `2>/dev/null`).
- `npm install`: clean install, 1024 packages, 54 vulnerabilities reported (8 low/19
  moderate/22 high/5 critical) — all in dev toolchain (webpack/gulp/babel chain), not
  runtime deps. No install-time errors. `fsevents`/`es5-ext` postinstall scripts are
  blocked by npm's `allow-scripts`; irrelevant to Linux/CI, macOS-only optimization.
- **Deviation from brief Step 2**: `npm run build` (`package.json:9`) runs
  `webpack --progress --watch --config webpack.config.js` — this is **dev-mode,
  file-watching, non-terminating**. It never exits, so it cannot be used as a one-shot
  CI/verification build. The real one-shot production build is the **gulp default
  task**: `npx gulp` (`gulpfile.js:97`, `exports.default = series(buildVendorCSS,
  copyFontFiles, buildJS, minifyJS, buildCSS, combineCSS)`). Ran `npx gulp` successfully
  in 3.52s, output:
  - `dist/js/FancyProductDesigner.js` (800KB, webpack production build of
    `src/classes/FancyProductDesigner.js`, `gulpfile.js:11-49`)
  - `dist/js/FancyProductDesigner.min.js` (789KB, uglified, `gulpfile.js:51-58`)
  - `dist/css/FancyProductDesigner.css`, `vendor.css`, `FancyProductDesigner.min.css`,
    `dist/css/fonts/*` (`gulpfile.js:60-91`)
  - Webpack emits 3 non-fatal size-limit warnings (asset >244KiB); expected for a
    single-bundle library, not a build failure.
  - `dist/` was already committed in the repo from a prior maintainer build; a clean
    rebuild reproduced it almost byte-for-byte (800494 vs 800401 bytes — trivial
    non-determinism from webpack's build hash/timestamps, not a functional diff).
  - **Task 2 (webpack bundling for the Joomla component) should target
    `src/classes/FancyProductDesigner.js` as entry, following `gulpfile.js`'s babel/less
    loader config, not the dev `webpack.config.js` (`webpack.config.js:7`, which points
    at `demos/dev/` and is watch-only).**
- No automated test suite exists. `package.json:11` `"test": "echo \"Error: no test
  specified\" && exit 1"` is a placeholder. `tests/` contains static HTML demo pages
  (`curved-text`, `rtl`) and a reference `fabric-5.3.1.js` build, not a Jest/Mocha suite.

## 1. Main class: `FancyProductDesigner`

- File: `src/classes/FancyProductDesigner.js:39`
  `export default class FancyProductDesigner extends EventTarget`
- Static version: `src/classes/FancyProductDesigner.js:40` — `static version = "6.3.5"`
- **Constructor**: `src/classes/FancyProductDesigner.js:310`
  `constructor(elem, opts = {})`
  - `elem`: an `HTMLElement` container (required; logs and returns early if falsy,
    `:313-316`). Sets `this.container.instance = this` (`:328`) — the FPD instance is
    reachable from the DOM node via `.instance`.
  - `opts`: merged over `Options.defaults` via `Options.merge` (`:329`,
    `src/classes/Options.js:1867` `static merge(defaults, merge)` → `deepMerge`).
  - Constructor is **not** synchronously ready: it kicks off async language-JSON load
    (`this.translator.loadLangJSON(..., this.#langLoaded.bind(this))`, `:362`) →
    `#langLoaded` (`:365`) loads fonts → constructs `UIManager` → fires `ready`
    (`#ready`, `:378`, event fired at `:385`). **Any call into the instance must wait
    for the `ready` event** (see §5).
  - Because it extends `EventTarget`, subscribe with the standard DOM API:
    `fpd.addEventListener('ready', () => {...})` — **not** a jQuery/fabric-style
    `.on()`. (v3's engine7 jQuery build used `.on()`/custom pub-sub; this is a real
    behavioral divergence for the Joomla glue code, not just a naming one.)
  - `EventTarget` custom events are dispatched via the `fireEvent(target, name, detail)`
    helper (`src/helpers/utils.js:218-229`) which does
    `target.dispatchEvent(new CustomEvent(eventName, {detail: eventDetail}))` — so
    handlers receive payload at `evt.detail`, e.g.
    `fpd.addEventListener('productCreate', (evt) => {})`.

## 2. Product / View / Element JSON schema

### 2.1 Outer envelope — confirmed IDENTICAL shape to v3 golden master

`FancyProductDesigner.getProduct()` (`src/classes/FancyProductDesigner.js:2061-2115`)
returns an array of view objects:

```js
{
  title: viewInst.title,
  thumbnail: viewInst.thumbnail,
  elements: viewInst.fabricCanvas.getElementsJSON(onlyEditableElements),
  options: viewInst.options,
  names_numbers: viewInst.names_numbers,
  mask: viewInst.mask,       // NEW in v6, no v3 equivalent
  locked: viewInst.locked,   // NEW in v6, no v3 equivalent
}
```
(`FancyProductDesigner.js:2097-2105`)

Compare to the golden master `engine7_data[0]` shape
(`tests/golden-masters/designs/163298.json:63-308`):
`{title, thumbnail, elements[], options: {stageWidth, stageHeight, customAdds},
names_numbers}`. **The view envelope (title/thumbnail/elements/options/names_numbers)
is structurally unchanged.** `mask` and `locked` are new v6-only view fields (no data to
migrate; will simply be absent/default on import).

Each element, from `getElementsJSON` (`src/fabricjs/Canvas.js:1081-1112`):

```js
{
  title: element.title,
  source: element.source,
  parameters: element.getElementJSON(),   // fabricjs/Element.js:637
  type: element.getType(),                 // fabricjs/Element.js:251, "text"|"image"
  printingBoxCoords: { left, top },         // NEW, only if view has a printingBox
}
```
(`Canvas.js:1087-1102`)

This is **also structurally identical** to the golden master's per-element shape
(`title, source, parameters, type` — `163298.json:68-124`). **The mapping problem is
entirely inside `parameters`, not the envelope.** This significantly de-risks Task 2/3:
the outer JSON walking code barely changes.

### 2.2 `parameters` schema — defaults source of truth

`src/classes/Options.js`:
- `elementParameters` (all element types): `Options.js:1113-1410`
- `textParameters` (merged on top of elementParameters for text elements):
  `Options.js:1418-1602`
- `imageParameters` (merged on top of elementParameters for image elements):
  `Options.js:1610-1697`
- `customImageParameters` / `customTextParameters` (extra merge layer for
  user-uploaded/added elements only, not initial product elements):
  `Options.js:1705-1772`

`getElementJSON` (`fabricjs/Element.js:637-692`) builds the exported `parameters` object
from exactly the keys in `elementParameters` + (`textParameters` or `imageParameters`)
depending on `getType()`, plus a fixed extra list (`width, height, isEditable,
hasUploadZone, evented, isCustom, currentColorPrice, _isPriced, originParams,
originSource, _printingBox, _optionsSet, _isQrCode, cropMask, isCustomImage`,
`Element.js:667-681`).

### 2.3 `addElement` / `loadElements` input — same fields, different call shape

- `fabric.Canvas.prototype.addElement(type, source, title, params = {})`
  (`src/fabricjs/Canvas.js:617-...`) — single-element imperative API.
- `fabric.Canvas.prototype.addElements(elements, callback)`
  (`src/fabricjs/Canvas.js:544-605`) — bulk loader, iterates `elements` (each
  `{type, source, title, parameters}`, note: `element.parameters` not `element.params`,
  `Canvas.js:555`) and calls `addElement(element.type, element.source, element.title,
  element.parameters)` one at a time, waiting for the `elementAdd` event between each
  (`Canvas.js:548-567`) — **this is inherently async/serial, not a synchronous bulk
  load**, important for Task 3's progress UI / completion detection.
- `FancyProductDesignerView.loadElements(elements, callback)`
  (`src/classes/FancyProductDesignerView.js:283-290`) is the per-view wrapper that
  calls `fabricCanvas.addElements`.
- Invalid element objects (missing `type`/`source`/`title`) are silently skipped with a
  `console.log` warning (`Canvas.js:569-580`), not a thrown error — a migration bug in
  the adapter will not fail loudly.

## 3. Product-load API (top level)

- `FancyProductDesigner.setupProducts(products = [])` (`FancyProductDesigner.js:703`)
  — registers the products catalog (category-aware), optionally auto-selects the first
  one (`loadFirstProductInStage` option, `Options.js:304`).
- `FancyProductDesigner.selectProduct(index, categoryIndex)`
  (`FancyProductDesigner.js:789`) — resolves a product from `this.products` and calls
  `loadProduct`.
- `FancyProductDesigner.loadProduct(views, replaceInitialElements = false,
  mergeMainOptions = false)` (`FancyProductDesigner.js:823-886`) — **this is the direct
  v3-`loadProduct`-equivalent entry point for com_sash**: pass the array of views
  (the same shape as `getProduct()` returns / the golden master's `engine7_data`).
  Fires `productSelect` (`:835`, before load) then asynchronously adds each view via
  `addView` (`:884`), listening for the `viewCreate` event to chain to the next view
  (`:881`, `#onViewCreated` at `:1224`). Fires `productCreate` when the last view is
  fully built (`:1273`).
- `FancyProductDesigner.addView(view)` (`FancyProductDesigner.js:894-1222`) — creates a
  `FancyProductDesignerView` instance per view; this is where all the fabric-canvas-level
  event wiring happens (see §5.2).
- **v3 golden master directly usable as `views` argument to `loadProduct`, modulo the
  `parameters` field mapping in §6.** No envelope transform is needed to get from
  `163298.json:engine7_data` to a v6 `loadProduct()` call — only per-element `parameters`
  need the mapping table applied.

## 4. Export API (canvas/image)

All export methods are **callback-based (async), not Promise-based, and return a data
URL string** (`data:image/png;base64,...` or per `options.format`).

- `FancyProductDesignerView.toDataURL(callback, options = {}, deselectElement = true)`
  (`src/classes/FancyProductDesignerView.js:323-372`) — single-view export.
  - `options` is passed straight through to fabric.js's
    `fabric.Canvas.prototype.toDataURL` (fabric.js 5.3.0 API:
    `{format: 'png'|'jpeg', quality, multiplier, left, top, width, height,
    enableRetinaScaling}`), plus FPD-specific keys documented at
    `FancyProductDesignerView.js:317-320`:
    - `onlyExportable` (bool, default `false`) — exclude elements flagged
      `excludeFromExport` (`Options.js:1313`).
    - `backgroundColor` (default `"transparent"`).
    - `watermarkImg` (a `fabric.Image` instance, not a URL).
  - Return path: `callback(this.fabricCanvas.toDataURL(options))`
    (`FancyProductDesignerView.js:357`) — synchronous fabric call wrapped in an async
    flow because of the `setBackgroundColor` callback (`:349`).
- `FancyProductDesigner.getProductDataURL(callback, options = {}, viewRange = [])`
  (`FancyProductDesigner.js:2126-2195`) — stitches **all views into one tall canvas**
  (views stacked vertically, `:2157-2161`), for a single combined product export.
  `viewRange` (`[startIdx, endIdx]`) optionally restricts which views are included
  (`:2147`).
- `FancyProductDesigner.getViewsDataURL(callback, options = {})`
  (`FancyProductDesigner.js:2205-2220`) — returns an **array** of per-view data URLs via
  the callback (one entry per view, order preserved).
- `FancyProductDesigner.getProduct(onlyEditableElements = false,
  customizationRequired = false)` (`FancyProductDesigner.js:2061-2115`) — **this one IS
  synchronous** and returns the JSON array directly (not callback-based); do not
  confuse with the *DataURL methods. If `customizationRequired` is `true` and no view
  has been customized, returns `false` and shows a Snackbar warning instead
  (`:2069-2072`); also returns `false` if any element is out of its bounding box
  (`:2083-2087`) — **callers must check for `false`, not assume an array.**
- `FancyProductDesigner.print()` (`FancyProductDesigner.js:2227+`) opens a print-dialog
  popup window using `getViewsDataURL`'s results — not relevant to server-side PDF/print
  generation but confirms there is no native "export to PDF" method; that stays a
  server-side concern (as under v3/engine7 today).

## 5. Lifecycle / events

Two distinct event systems exist in v6 — **conflating them will silently no-op**:

### 5.1 Instance-level (DOM `CustomEvent` via `EventTarget`, subscribe with `addEventListener`)

All fired via the `fireEvent(this, name, detail)` helper
(`src/helpers/utils.js:218-229`) on the `FancyProductDesigner` instance itself.

| Event | Fired at | Detail payload |
|---|---|---|
| `ready` | `FancyProductDesigner.js:385` | `{}` — designer fully initialized, first safe point to call any method |
| `productsSet` | `:731` | `{}` |
| `designsSet` | `:749` | `{}` |
| `productAdd` | `:782` | `{views, category, catIndex}` |
| `productSelect` | `:835` | `{product: views}` — fired at the *start* of `loadProduct`, before any view is built |
| `viewCreate` | `:1369` | `{viewInstance}` — fired once per view as it's added |
| `productCreate` | `:1273` | `{}` — fired once, after the **last** view of the product finishes loading; the v6 equivalent of "designer ready to interact with this product" |
| `layoutsSet` | `:1253`/`:1264` | `{}` |
| `beforeElementAdd` | `:952` | `{element}` (raw opts, not yet a fabric object) |
| `elementAdd` | `:1030` | `{element}` (fabric object) |
| `elementRemove` | `:1055` | `{element}` |
| `elementSelect` | `:1096` | `{}` (read `fpd.currentElement`) |
| `multiSelect` | `:1118` | `{activeSelection}` |
| `elementFillChange` | `:1155` | `{element, colorLinking}` |
| `elementChange` | `:1173` | `{type, element}` |
| `elementModify` | `:1191` | `{options, element}` |
| `viewCanvasUpdate` | `:1034/1059/1196` | `{viewInstance}` — fired alongside add/remove/modify, for "re-render thumbnails" style hooks |
| `historyAction` | `:1288` | `{type: 'append'\|'clear'\|'undo'\|'redo'}` |
| `textLinkApply` | `:1608/1622` | `{element, options}` |
| `imageDPIWarningOn` / `imageDPIWarningOff` | `:1507`/`:1518` | `{element, dpi}` |

### 5.2 Canvas-level (fabric.js `.on()`/`.fire()`, NOT DOM events)

Wired inside `addView` at `FancyProductDesigner.js:919-1215` on
`viewInstance.fabricCanvas`. These are fabric.js's own observer pattern
(`canvas.on({elementAdd: fn, ...})`); most are re-broadcast as the instance-level
`CustomEvent`s in §5.1 by the same handler block, so **integration code should
subscribe at the instance level (§5.1) unless it specifically needs a per-canvas/
per-view hook** (e.g. `mouse:move`, `sizeUpdate` at `:1340`, `text:changed` at `:1200`,
`history:append/clear/undo/redo` at `:1203-1214`, `elementCheckContainemt` at `:1120`
— these have **no** instance-level DOM-event equivalent and must be subscribed via
`viewInstance.fabricCanvas.on(...)` directly).

## 6. v3 → v6 field-mapping table

Legend: **v3 source** = `com_sash/media/lib/engine7/js/FancyProductDesigner.js` (the
legacy engine7 consumer bundled with com_sash; note this is FPD ~v4.x-era code, already
itself forked/modified — line numbers below are in that file). **v6 source** = this
repo (paths relative to `~/Projects/forks/fpd-js`).

| v3 name | v6 name | Transform | v6 source | Notes |
|---|---|---|---|---|
| `currentColor` | `fill` | **Already renamed in v3 itself** — engine7's `rekeyDeprecatedKeys` (v3 `FancyProductDesigner.js:915-939`, entry at `:921`) auto-migrates `currentColor`→`fill` on load since "FPD 4.0.0". The golden master already stores `fill` (`163298.json:89`), not `currentColor`. **No transform needed going v3→v6**; this row exists only because the brief expected it — confirmed a non-issue for this dataset. | `Options.js:1399` (`elementParameters.fill: false` default); `fabricjs/Element.js:380-439` (`changeColor` sets `.fill` directly, unifying text/image/svg) | Verify no *older* un-migrated golden masters exist before assuming this for all 163k+ designs; spot-check a sample in Task 2. |
| `filter` (string filter-name, or `false` sentinel for "none") + `availableFilters` (array of filter name strings offered in UI) | `filter` (string filter-name, or `null` sentinel for "none") | **Mostly aligned, just a different "none" sentinel** — despite v3's JSDoc claiming `@type Boolean` for `filter` (v3 `FancyProductDesigner.js:2415-2422`), the runtime code sets it to an actual filter-name string (e.g. `fpdInstance.currentViewInstance.setElementParameters({filter: $this.data('filter')})`, v3 `:5211`; consumed at v3 `:4122-4135` `if(parameters.filter) { var fabricFilter = _getFabircFilter(parameters.filter); }`). The golden master shows the "none" state as `filter: false` (`163298.json:90`). v6 keeps the same string-name-or-"none" semantics but uses `null` as the "none" sentinel (`Options.js:1628` `filter: null`), consumed identically at `fabricjs/Canvas.js:1546-1547` (`if (parameters.filter) { const fabricFilter = getFilter(parameters.filter); }`). **Only transform needed: coerce `false`→`null` (or just leave `false` since both are falsy and the guard is a truthiness check, not a strict-type check).** v6 has **no `availableFilters` concept at all** — grep confirms zero references in `src/`; that part of the row is a true gap, not a rename. | `Options.js:1621-1628`; `fabricjs/Canvas.js:1546-1547`; filter implementations in `src/helpers/Filters.js` (`FPDFilters`, exported `src/helpers/Filters.js:95`) | Sash's per-product `availableFilters` UI list (which filters the customer may pick) has **no v6 home** — stash under `parameters.__v3.availableFilters` for now; Task 3+ must decide whether to rebuild this as app-level UI config instead of per-element data. |
| `boundingBox` (string title reference, or object `{x,y,width,height}`) | `boundingBox` (same two shapes) | **No rename** — same field name, same two accepted shapes (string = title of a same-view element to use as bounds; object = literal rect). v3: `getBoundingBoxCoords` (v3 `FancyProductDesigner.js:4227-4267`) resolves the same way v6 does. | `Options.js:1198-1211` (default `false`); `fabricjs/Element.js:562-... getBoundingBoxCoords` (title-lookup logic identical to v3, matches on `object.title === this.boundingBox`) | **Data-quality flag, not an API divergence**: the golden master's `boundingBox: "Base"` (`163298.json:77` etc., all 4 elements) does not match any element `title` in the same design (titles are `Sash`, `Base Image`, `Outer Border`, `Inner Border` — none is literally `"Base"`). Both v3 and v6 resolve an unmatched title reference to nothing (loop falls through, no bounding box applied) — harmless here because every element in this design has `resizable:false, draggable:false` (locked background layers), but **flag for Task 2**: audit whether any *editable* elements across the corpus have a similarly-dangling `boundingBox` title, which would newly manifest as "unconstrained drag" after the swap if v6's resolution differs in an edge case. |
| `boundingBoxMode` | `boundingBoxMode` | No rename. Same 4 values: `none`, `clipping`, `limitModify`, `inside`. | `Options.js:1213-1220` (default `"clipping"`) | Golden master uses `"inside"` throughout (`163298.json:78`) — supported identically. |
| `sash_color`, `sash_font`, `sash_stroke` | *(no v6 field)* | **Sash-specific custom parameters, not part of upstream FPD at all** (confirmed via grep: zero hits for `sash_color`/`sash_font`/`sash_stroke` anywhere in `src/`). These were bolted onto engine7's parameter object by Sash's own customization, not a v3-vs-v6 vendor divergence. | n/a | Must be stashed under `parameters.__v3.sash_color` etc. per the brief's fallback convention; Task 2/3 needs to identify the actual consumer of these (likely PHP-side pricing/print logic, not the JS engine) and decide whether they migrate to a first-class v6 concept (e.g. `colorLinkGroup`/`colors`) or stay in `__v3` permanently. |
| `basePrice`, `extraFees` | *(no v6 field — only `price` exists)* | v3 element parameters include `basePrice: 0` and `extraFees: 0` alongside `price` (v3 `FancyProductDesigner.js:2283-2284`). v6's `elementParameters` has only a single `price` field (`Options.js:1127-1132`). Confirmed zero hits for `basePrice`/`extraFees` in v6 `src/`. | `Options.js:1113-1410` (no matching keys) | If Sash's pricing logic reads `basePrice`/`extraFees` as separate line items (vs. `price` being pre-summed), that split is **lost** unless preserved via `__v3`. Needs a PHP-side pricing-logic read before Task 3 decides whether to fold these into `price` at import time or keep them stashed. |
| `uploadZoneScaleMode` | `scaleMode` | **Rename** — v3's upload-zone-specific scale mode key becomes the general per-image `scaleMode` in v6 (applies to upload zones AND `resizeToW`/`resizeToH` resizing generally, not upload-zone-only). Same two values observed: `'fit'`/`'cover'`. | `Options.js:1640-1647` (`imageParameters.scaleMode: "fit"`); consumed at `fabricjs/Canvas.js:1263,1266,1300` | Golden master doesn't populate an upload zone in this sample (`uploadZone: false` throughout), so untested against real data here — flag for Task 2 to find a golden master WITH an upload zone element for a live comparison. |
| `notes` | *(no v6 field)* | Free-text per-element notes field present on every element in the golden master (`163298.json:96` etc., always `""` in this sample). Zero hits for a `notes` property in v6 `src/`. | n/a | Likely an admin-only annotation field (never seen populated in this sample) — low risk, stash under `__v3.notes` if ever non-empty. |
| `z` | `z` | No rename, same semantics (`-1` = append to top of stack; explicit non-negative = literal z-order). | `Options.js:1117-1123` (default `-1`) | Confirmed identical in both; golden master mixes `-1` (background) and explicit `1,3,4` (`163298.json:120,177,235,291`). |
| `originX`/`originY` | `originX`/`originY` | No rename, same default (`"center"`/`"center"`), same fabric.js semantics in both (element's `left`/`top` describe the position of this origin point, not the top-left corner). | `Options.js:1396-1397` | v3 default is the same `'center'`/`'center'` (v3 `FancyProductDesigner.js:2265-2266`) — **coordinate origin is NOT a divergence for this pair of engines** (brief flagged it as an open question; confirmed non-issue since both are fabric.js-based with matching defaults). |
| Coordinate system (canvas origin, units) | Same | Both v3 (engine7) and v6 are built on **fabric.js**, so canvas-space is identical: origin top-left of canvas, y-axis down, all values in CSS pixels at the view's `stageWidth`/`stageHeight`. | n/a | **However**: v3 bundles **fabric.js 1.6.3** (`com_sash/media/lib/engine7/js/fabric.js:4`, `var fabric = fabric \|\| { version: "1.6.3" }`) vs. v6's **fabric.js 5.3.0** (`package.json:54`). This is a 4-major-version jump in the underlying canvas library, not just FPD — expect internal API differences (filter API, `toObject`/serialization internals, group/path handling, event names) even where FPD's own wrapper methods have identical names. Flag as an architectural risk for Task 2's rendering-parity testing, independent of the FPD-level field mapping above. |
| `fontSize` (units) | `fontSize` | No rename, no unit change. Both default to `18`, both are plain numbers in canvas px (fabric.js `Text`/`IText` semantics unchanged across versions for this property). | `Options.js:1592` (`fontSize: 18`); v3 `FancyProductDesigner.js:2388` (`fontSize: 18`) | Brief flagged "font size units" as an expected divergence — **confirmed non-issue**; no unit conversion needed. |
| `title` (element identity) | `title` | No rename. Both v3 and v6 resolve elements by exact string match on `.title` scoped to the *current view's* fabric objects only (v3: `FancyProductDesigner.js:3847` `getElementByTitle`; v6: `fabricjs/Canvas.js:1123-1131`). Neither engine enforces uniqueness across views, only within a view's canvas. Auto-generated titles use `Date.now().toString()` when title is empty in both (v6: `fabricjs/Canvas.js:620`). | `fabricjs/Canvas.js:1123-1131` | No transform needed; just confirm Sash's title values remain unique-enough within each view after migration (same requirement as today). |
| `availableFilters` | *(see `filter` row above)* | duplicate of the filter-row split; listed separately here for cross-reference. | | |
| Element envelope `{title, source, parameters, type}` | Same | **No divergence** — confirmed identical field names/order-independent shape on both sides (v3 golden master vs. v6 `getElementsJSON`, §2.1). | `fabricjs/Canvas.js:1087-1092` | This is the good news: the outer walk (view→elements→{title,source,type}) needs no adapter logic at all, only `parameters` needs field-level translation per the rows above. |

### Fields to stash under `parameters.__v3` (no v6 home found)

- `sash_color`, `sash_font`, `sash_stroke` (Sash-custom, not upstream FPD)
- `basePrice`, `extraFees` (v6 only has unified `price`)
- `availableFilters` (v6's `filter` is single-value, no picklist concept)
- `notes` (admin annotation, always empty in the sampled golden master, but preserve
  in case other designs populate it)

## 7. Concerns / open questions for later tasks

1. **`fill` type is not always a string.** `Canvas.addElement` explicitly guards
   `if (typeof params.fill !== "string" && !Array.isArray(params.fill)) params.fill =
   false;` (`fabricjs/Canvas.js:657-659`) — the golden master's `fill: false` boolean
   sentinel is preserved as-is by v6, not coerced. Adapter code must treat `false` as
   "no fill/no colorization", not attempt to parse it as a color string.
2. **`getProduct()`/export-method option arity differs (sync vs callback)** — flagged
   in §4; a naive port that treats all these methods uniformly will break on
   `getProduct()`, which is the one synchronous method in the group.
3. Only one golden master (`163298.json`, a `stole`/`traditional_standard` product) was
   examined in depth per the brief's "read ONE" instruction. The `sash_color`/
   `sash_font`/`sash_stroke`/`boundingBox:"Base"` observations above are validated
   against this single sample; Task 2 should spot-check a handful more golden masters
   (different `base_type`/`selected_type` combinations) before assuming the mapping
   table is complete — e.g. designs with populated upload zones, non-empty `notes`, or
   `ctext_left*`/`ctext_right*` custom text fields (present in `f_data` but not inside
   any `engine7_data[].elements[].parameters` in this sample — these appear to be
   separate PHP-side form fields, not FPD element parameters at all; confirm this in
   Task 2 rather than assuming).
4. fabric.js 1.6.3 → 5.3.0 is a much larger compatibility gap than the FPD wrapper
   surface suggests (§6, coordinate-system row). Task 2's rendering-parity test plan
   should include actual pixel/visual regression, not just JSON-schema diffing.
