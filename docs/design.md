# Design

Dyno is named after a dynamometer: the rolling road where a car runs at full throttle while instruments record what it does. The reporter is the instrument panel for that cell. Every run is a *pull*, the overview is the *dyno sheet* printed from it, and status marks come from the hardware in the room (gauges, rollers, sheet notes, hazard tape).

The same brand runs through the docs site, so reading about Dyno feels like standing in the same cell.

The app gets the screen while tests run. The reporter helps you find a failure, read its output, and get back to the app. Everything below serves those three jobs. When you add UI, start from this doc and [brand.css](../src/browser/brand.css), not from a UI kit.

## The rule

Borrow from the dyno cell, not from UI kits. Before you add an element, ask what a dyno operator would look at to learn the same thing. If the answer is a gauge, a printed note, or a roller, draw that. If the answer is "a badge," find another way.

Never use these patterns. They read as generic, generated UI:

- Pill badges, status chips, or tags with tinted backgrounds
- Glowing, haloed, or pulsing status dots
- Small-caps or all-caps eyebrow labels above headings
- Colored left-border rails on callouts, errors, or active lines
- Meta strings joined with middle dots (`A · B · C`)
- Decorative `›` or `→` glyphs on rows, links, or buttons
- Title Case headings, or a single highlighted word in a heading
- Identical rounded cards with soft grey shadows, or gradient washes

Do this instead:

- Put status in plain colored text next to a symbol: `Failed in 241 ms`.
- Join facts with words and commas: `6 test files, 2 workers, app at localhost:5173`.
- Mark an active or failing line with a tint plus a wavy underline, not a rail.
- Use structural lines only when they carry meaning: chart axes, table dividers, the readout table, and the tab underline.

## The dyno vocabulary

These are the brand's building blocks. Reuse them before you invent anything new.

| Element | What it is | Where |
| --- | --- | --- |
| Wordmark | `dyn` plus a roller drum standing in for the `o`, set wide, heavy, and skewed −9°. The roller spins only while tests run. | Desk, start page, saved report, favicon |
| Roller | A drum with a knurled ring and hub, in hazard yellow. It's also a CSS mask (`--roller`). | Wordmark, pending and running test rows, the in-app "Show test results" button |
| Dyno sheet | Finished tests (y) over summed test time (x), in run order. | Overview, saved report |
| Ghost | The previous matching pull, drawn as a dotted trace. | Dyno sheet |
| Sheet note | Plain text with a skewed leader line pointing at the curve, like the peak note on a printed sheet: `13 tests @ 1.90 s`. | Dyno sheet |
| Tachometer | A small analog gauge whose needle sweeps from 0 to all tests finished. | Beside the run title, saved report |
| Readouts | A peak table beside the sheet: passed, failed, pending, skipped, run time, and time per test. | Overview, saved report |
| Load trace | A thin bar on each row, scaled to the slowest test. | Result rows |
| Hazard stripes | Diagonal yellow and black tape. | The pause banner only |

### The dyno sheet

The overview leads with the sheet. The chart is drawn by pure functions in [dyno-chart.js](../src/browser/dyno-chart.js), so the live reporter and saved reports always match.

- Steep stretches are fast tests and flat stretches are slow ones. Copy under the chart says so: "Steep is fast. Flat stretches are slow tests."
- Passed points use the trace color. Failures are larger red points. Skipped and stopped points are faint. Each point links to its test.
- A dashed ceiling marks the full test count, and a faint area fill sits under the trace.
- While a test runs, a yellow head rides the end of the curve, and a sheet note shows the test's name in accent text.
- When the pull finishes, the note changes to `${total} tests @ ${duration}` in ink. Notes flip to the left side near the right edge so they never clip.
- The SVG uses `preserveAspectRatio="none"` with `vector-effect: non-scaling-stroke`, and points are zero-length round-cap paths. Draw axis labels and notes in HTML, positioned by percentage (`sheetHead`), so text never stretches.
- The ghost is the last completed pull with the same test count and files. It's stored per browser in `localStorage` under `dyno:last-pull:<count>:<files>`, and it keeps geometry only, never test names.
- While paused or debugging, the curve isn't moving. The sheet folds away and the readouts become one row, so the tests stay in view. Keep the first result rows above the fold on a 1280×800 window.

### The tachometer

`tachometer({ phase, failed, progress })` returns the gauge. Its needle angle comes from the CSS variable `--progress` (0 to 1), and it eases with a little overshoot. The arc color follows the run:

- Yellow while discovering, running, pausing, paused, or debugging
- Green when a run completes clean
- Red only when a finished or stopped run has failures, or the run errored. Never red mid-run.

### Status marks

| Status | Row mark | Detail text |
| --- | --- | --- |
| Pending | A still roller in faint grey, with `—` for the duration | none |
| Running | A spinning yellow roller | `Running` in accent text |
| Passed | A plain `✓` in pass green | `Passed in 18 ms` |
| Failed | A plain `✕` in fail red, with the error's first line under the name | `Failed in 241 ms` |
| Skipped or stopped | A muted mark, with `—` for the duration | muted text |

Never put a circle, chip, or background behind these marks. Always pair color with a symbol or a word.

## Tokens

All colors live in [brand.css](../src/browser/brand.css), which the reporter, the control room, saved reports, and the docs site all load. Each token is a `light-dark()` pair, so a page picks its theme by setting `color-scheme`. The reporter follows the system preference, the control room stays dark, and the docs follow their theme toggle. Use the tokens and don't hard-code hex values in components.

`brand.css` also holds the shared pieces: the wordmark, roller, tach, sheet, sheet notes, legend, `--roller` (the roller as a CSS mask), and `--hazard` (the stripe). Pages size these for their layout but don't restyle them.

Dark is the night-shift dyno cell, in deep steel blue. Light is the printed sheet: cool paper with a blue grid.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#141f2a` | `#edf1f5` | Page background; also the reporter iframe background in `bridge.js` |
| `--surface` | `#1a2835` | `#ffffff` | Sheet, search, source excerpts, menus |
| `--raised` | `#223444` | `#f5f8fa` | Buttons and the pressed filter |
| `--line` | `#2a3d4f` | `#ccd6e0` | Dividers and borders |
| `--grid` | `#20303f` | `#e1e8ef` | Chart grid, tach track, empty load bars |
| `--ink` | `#e9eff4` | `#0f1f2e` | Body text and the tach needle |
| `--muted` | `#90a5b7` | `#536a7e` | Secondary text |
| `--faint` | `#62778b` | `#8496a8` | Axes, pending marks, placeholders |
| `--trace` | `#63a9ff` | `#1a5bc4` | The pull trace, passed points, links, focus rings |
| `--accent` | `#ffc629` | `#ffc629` | Hazard yellow: the roller, primary buttons, anything live |
| `--accent-text` | `#ffc629` | `#845e00` | Yellow used as text, readable on paper |
| `--accent-hover` | `#ffd457` | `#ffd457` | Primary buttons on hover |
| `--on-accent` | `#1d1600` | `#1d1600` | Text on yellow, and the dark band of the hazard stripe |
| `--mark` | `#ffc629` | `#e0a400` | The roller, a little deeper on paper |
| `--pass` | `#4fd08a` | `#11804a` | Passed |
| `--fail` | `#ff5c61` | `#c8192e` | Failed |
| `--fail-tint` | `--fail` at 8% | `--fail` at 5% | The background of the failing source line |

Hazard yellow is the brand. Use it for the roller, primary actions, the tab underline, the pressed filter's underline, and anything live or running. Don't use it as a general highlight.

## Type

Archivo is the only typeface. It's a variable font (OFL), vendored in [src/browser/fonts](../src/browser/fonts), served at `/__dyno__/archivo.woff2`, and base64-inlined into saved reports so they work offline. Width and weight carry the personality, so use the `font-stretch` axis on purpose.

| Role | Size | Weight | Width | Notes |
| --- | --- | --- | --- | --- |
| Wordmark | 27px (22px on mobile) | 860 | 125% | Skewed −9°, tracking −.035em |
| Run title (`#status`) | 26–38px, fluid | 760 | 116% | Tracking −.02em |
| Test title | 28px (22px on mobile) | 760 | 116% | |
| Readout numbers | 22px; 17px for times | 720 | 122% | Tabular numerals |
| Section heading | 17px | 640 | 100% | |
| Body and UI | 14px | 400–600 | 100% | Line height 1.5 |
| Small text and axes | 11–12px | 400–550 | 100% | |
| Code, logs, file paths | 12–13px | 400–500 | n/a | `--mono` only |

Use sentence case everywhere. Use tabular numerals for every count and duration. Use monospace for code, logs, file paths, and seeds only, never for labels.

## Layout and behavior

- The control desk is a sticky, 60px bar (54px on mobile) that holds the wordmark and run actions. Keep `scroll-padding-top` in sync with its height so scrolled-to targets stay clear.
- The overview reads top to bottom: the run title with the tach, a plain meta line, the sheet with readouts, then search, filters, and results grouped by file and suite. Slowest tests and run info stay in collapsed sections at the end.
- Keep one combined result list across workers. Label the selected worker, so inspection and app controls clearly target that worker's app.
- Each test gets its own Output, Timings, and Application routes. Put details on those routes, not in new panels on the overview.
- On Output, the failure message comes first, then where it happened ("In the test body at file:line:col"), then the source excerpt, then the stack. Console output and screenshots stay together.
- Timings shows where the time went as a phase split bar, then a waterfall of operations, then the full table.
- Show app reveals the actual tested app. Don't replace it with a scaled preview, and don't move it while the reporter navigates.
- Open inspection at a test boundary. Keep pause, continue, stop, and rerun clear about what happens next.
- Routes use stable test IDs. Search and filters live in the URL and survive back and forward navigation.
- Show connection state and screenshot availability. A command stays pending until the test browser replies; if it fails, show a retry action.
- When a toggle or filter reveals content below the fold, scroll it into view with `block: 'nearest'`.
- Saved reports are the printed sheet: the same chart, tach, readouts, and tokens, read top to bottom without live controls.

### Shape and spacing

- Radii: 6px for buttons and rows, 7–8px for inputs, menus, and the source excerpt. Nothing is fully rounded.
- Rows are spacious (52px minimum). Buttons stay compact (34px).
- Use dividers and whitespace to separate sections, not cards. The sheet and readouts form one instrument panel, not a grid of tiles.
- Mobile content must be readable without horizontal page scrolling. Below 640px the readouts wrap into rows of three and load traces hide.

## Motion

Motion means something is live. There are only a few moving parts:

- The wordmark roller and the running row's roller spin while tests run.
- The sheet head throbs while a test runs.
- The running row's load trace sweeps back and forth.
- The tach needle and sweep ease to new progress.

In the reporter, nothing animates on page load, and nothing moves on hover except color. The docs site gets two playful exceptions, described below. `prefers-reduced-motion` turns all of it off.

## The docs site

The docs are a [Starlight](https://starlight.astro.build) site in [site](../site). They import [brand.css](../src/browser/brand.css), so they use the same tokens, type, wordmark, roller, tach, and sheet as the reporter. [docs.css](../site/src/styles/docs.css) maps Starlight's variables onto the brand.

- **Tokens:** Starlight's grays map to the reporter's ink, muted, faint, line, surface, and background. `--sl-color-accent` is hazard yellow and `--sl-color-text-accent` is the trace blue, so links stay blue and primary buttons are yellow plates. Dark is the dyno cell and light is the printed sheet. Only the few shades Starlight needs that the reporter doesn't (two extra grays, the page background, and accent tints) live in docs.css.
- **Wordmark:** the site title is the shared wordmark from [markup.js](../src/browser/markup.js). Its roller turns as you scroll, like the drum under a car on the dyno, using a scroll-driven animation where the browser supports one.
- **Homepage:** a splash hero with the title and two actions, next to an example pull drawn by the real `dyno-chart.js`. On load, the trace draws in left to right, the tach sweeps, and the sheet note prints. That's the site's one orchestrated moment. **Run it again** replays the suite after its slow test got faster, with the first pull as a ghost, so the hero teaches the ghost feature by doing it. A faint sheet grid sits behind the hero.
- **404:** "Not on the sheet," with a big tach whose needle never left zero. The tach is the hero image, passed as data, so the 404 uses Starlight's own hero.
- **Sidebar:** the current page sits on a small roller, the same mark as a running test. Group labels are wide and heavy. There are no left border lines on nested lists.
- **Callouts:** tinted plates with a border and no left rail. Caution and danger callouts get the hazard tape along the top, the cell's "stop and look" sign. This is the only other place hazard stripes appear.
- **Tables and code:** row dividers only, muted header text, and tabular numerals. Code frames keep Starlight's Expressive Code with an 8px radius and no shadow.

[Hero.astro](../site/src/components/Hero.astro) draws the example pull for a hero without its own image, and defers to Starlight's hero otherwise. The generator in [generate.js](../site/scripts/generate.js) writes the homepage and 404 frontmatter, so the overview copy still comes from source JSDoc. Selectors in docs.css that follow Starlight's internal markup are grouped together, so check them after a Starlight upgrade.

## Copy

Write like you're helping another developer: short, specific, and plain. Name actions by what happens (Run all, Run failed, Show application, Continue run), and keep an action's name the same everywhere.

A little dyno flavor is fine when the meaning stays obvious: a pull, the rollers, "Stops on the rollers at the first failure." Don't push it into labels people need to scan.

Explain a failure and the next useful step without hype: "The test controller closed. Start a new run to reconnect."

## Accessibility

- Use real buttons, links, labels, headings, and `details` elements.
- Focus rings are a 2px trace-blue outline. Never remove them.
- Decorative SVGs (the chart, the tach, the roller, the waterfall) are `aria-hidden`. Their meaning is also in text: an sr-only sheet summary, a `progress` element, the readouts, and the timings table.
- Color is never the only signal.

## Adding something new

1. Check the dyno vocabulary table. Reuse an element if one fits.
2. If nothing fits, borrow from the dyno cell: gauges, printouts, rollers, straps, warning tape. Keep it to one idea, drawn simply.
3. Use only the tokens and type roles above.
4. Check it against the never list.
5. Look at it in dark and light, at 1280×800 and at phone width, while running, paused, failed, and passed.
6. Run `npm test`. The suite drives the real reporter in a browser, so layout regressions (an element below the fold, or hidden behind the desk) show up as failures.

## Source files

| File | What it owns |
| --- | --- |
| [brand.css](../src/browser/brand.css) | Tokens, the wordmark, roller, tach, and sheet, shared by every Dyno page and the docs |
| [reporter.css](../src/browser/reporter.css) | The reporter's type, components, and responsive layout |
| [reporter.html](../src/browser/reporter.html) and [reporter.js](../src/browser/reporter.js) | The reporter's views and rendering |
| [dyno-chart.js](../src/browser/dyno-chart.js) | The sheet, ghost, sheet-note position, and tachometer, for live and saved reports |
| [timing-format.js](../src/browser/timing-format.js) | Durations, phases, and failure location text |
| [report-format.js](../src/report-format.js) and [saved-report.css](../src/browser/saved-report.css) | Saved HTML reports |
| [host.html](../src/browser/host.html) and [host.css](../src/browser/host.css) | The control room page that hosts the app |
| [bridge.js](../src/browser/bridge.js) | The reporter iframe and the in-app "Show test results" button |
| [reporter-client.js](../src/browser/reporter-client.js) and [shell.js](../src/browser/shell.js) | Reporter navigation and messages, keeping the app and overlay separate |
| [markup.js](../src/browser/markup.js) | The shared wordmark and HTML escaping |
| [docs.css](../site/src/styles/docs.css), [SiteTitle.astro](../site/src/components/SiteTitle.astro), and [Hero.astro](../site/src/components/Hero.astro) | The docs site's theme, wordmark, homepage hero, and 404 |
