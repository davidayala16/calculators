# CLAUDE.md

Entry point for any Claude Code (or other agent) session working in
this repo. Read this before building a new calculator or touching an
existing one.

## What this repo is

A small collection of self-contained calculators — financial planning
and beyond, static sites, no backend, no accounts. See `README.md` for the current
list and the live URL. Each app lives under `apps/<name>/` as its own
Vite + React project; a single GitHub Actions workflow
(`.github/workflows/deploy-pages.yml`) builds every directory under
`apps/*` and deploys each to its own path automatically. **Adding a
new calculator never requires touching the workflow** — just follow
the structure below.

This file exists because the first calculator (`retirement-runway`)
went through several rounds of "ship it, it crashes on real input, fix
it, ship it, it loses input, fix it" before landing on the patterns
below. Apply them from the start on the next one and skip that cycle.

## Adding a new calculator: checklist

1. `apps/<name>/` — a new Vite + React project. Copy
   `apps/retirement-runway/` as a starting skeleton (config, `.gitignore`,
   error boundary in `main.jsx`) rather than starting from scratch.
2. Set `base: '/calculators/<name>/'` in `vite.config.js` —
   must match the directory name exactly, since the workflow deploys
   each app to a path of the same name.
3. Implement the **persistence pattern** and the **crash-proofing
   checklist** below — both are required, not optional, for any
   calculator that takes numeric input and projects it forward.
4. Write an e2e test suite at `apps/<name>/tests/`, modeled on
   `apps/retirement-runway/tests/app.e2e.test.mjs` (see "Testing
   requirement" below). Run it and get it green before calling the app
   done.
5. Add the app to the list in the root `README.md`. Nothing else needs
   updating — the landing page and deploy are automatic.

## Required: the persistence pattern

Every calculator must save the user's input without an account or
backend. Two layers, in priority order:

1. **Debounced (~400ms) autosave to `localStorage`**, under a
   versioned key like `<app-name>:autosave-v1`. This is what makes a
   refresh (or a crash) non-destructive — it should need zero action
   from the user. Wrap every read and write in `try/catch`: private
   browsing, storage quota, and corrupted/malformed saved data must
   all fall back to defaults silently, never throw.
2. **An explicit "Copy shareable link" action** that base64-encodes
   the full state into a `?d=` URL param. This is for cross-device use
   and sharing — it should only update when the user explicitly asks
   for it, and on load it always takes priority over the local
   autosave (so opening someone else's link, or an older link of your
   own, doesn't get silently overridden by whatever's sitting in that
   browser's `localStorage`).

**Do not auto-rewrite the URL bar on every keystroke** as a substitute
for #1. `retirement-runway` tried that first — it conflicted with how
the static build is served and caused blank-page reloads that lost
in-progress edits. See the persistence comments in
`apps/retirement-runway/src/App.jsx` for the specifics; the short
version is `localStorage` is the right tool for continuous autosave,
the URL is only for point-in-time sharing.

## Required: crash-proofing numeric inputs

Every calculator here does compounding/projection math over a "years"
or similar range driven directly by raw user-typed numbers. This is a
proven, repeatable crash vector — `retirement-runway` hit two distinct
failure modes from it in production:

- An extreme, malformed, or merely **transient** value (e.g. a
  retirement-age field temporarily exceeding a horizon-age field while
  both are mid-edit, which happens naturally while someone is typing)
  can send `Array(n)` a negative length and throw
  `RangeError: Invalid array length` — which, with no error boundary,
  unmounts the entire React tree and leaves a blank page.
- An extreme value with no ceiling (a fat-fingered extra digit is
  enough) can turn a ~60-iteration loop into a multi-billion-iteration
  one, freezing the tab synchronously — no error, just an unresponsive
  page that looks exactly like a crash to the person hitting it.

Guard against both, unconditionally:

- **Clamp every years/age-bounded loop to a sane ceiling** (e.g. 200
  years) **inside the low-level simulation function itself**, not just
  at the call site — every caller is then protected for free, instead
  of needing the same clamp copy-pasted everywhere the function is
  called.
- **Floor every derived loop range at 0.** `horizonAge - retireAge`
  and similar differences go negative whenever the two fields
  disagree, which is a normal mid-edit state, not an edge case.
- **Clamp compounding balances to a finite ceiling** (e.g. `1e12`) at
  every multiplication step, so an aggressive return/raise input can't
  overflow to `Infinity` before it reaches a chart. Charting libraries
  (recharts in particular) throw on non-finite domain values.
- **Add a top-level React error boundary** (see `main.jsx`) as a last
  resort, in case a failure mode wasn't anticipated. It should show a
  recoverable message with a reload action, not leave a blank page.

## Testing requirement

Before considering a calculator done, run an e2e sweep — don't rely on
manually clicking through it once. At minimum, adapt
`apps/retirement-runway/tests/app.e2e.test.mjs` and `tests/helpers.mjs`
to cover:

- Every numeric input, with extreme positive, extreme negative, and
  blank values, after expanding every collapsed section/toggle so all
  fields are actually mounted — assert no crash and no console errors.
- A multi-field editing scenario that deliberately hits a transient
  bad state (mirror whatever the equivalent of "retireAge > horizonAge
  mid-edit" is for the new calculator).
- Autosave: edit a field, wait past the debounce, confirm it's in
  `localStorage`; then restore it in a **fresh browser context**
  (`browser.newContext()` from a new launch, or `context.storageState()`
  round-tripped into a new context) — not just a same-tab reload, which
  doesn't prove anything closing and reopening the browser wouldn't
  also prove trivially.
- An explicit shared link overriding a newer local autosave.
- Any "reset"/"start fresh" action actually clearing the autosave.
- Corrupted `localStorage` content falling back to defaults instead of
  crashing.

Run with `npm run test:e2e` from the app's directory (builds first via
the `pretest:e2e` hook, then runs `node --test tests/*.test.mjs`
against `vite preview`). Playwright is a devDependency for this
reason — it's expected to be installed via normal `npm install`, and
in normal environments `npx playwright install chromium` provisions
its browser. `tests/helpers.mjs` reads an optional
`PLAYWRIGHT_CHROMIUM_PATH` env var for sandboxed environments that
pre-provision a browser at a fixed path instead — don't hardcode a
sandbox-specific path into the committed test code itself.

Each test launches and closes its own browser rather than sharing one
across the file, and every test carries an explicit `timeout` option.
A shared browser was found to occasionally leave later tests hanging
indefinitely with no clear error when the browser hiccuped during an
earlier, heavier test — the per-test launch/close plus explicit
timeout is a proven-more-reliable pattern, not a stylistic preference.

## Scope

Keep additions consistent with the rest of this repo: self-contained
static apps, no backend, no accounts, no external service dependencies
beyond what's already in a given app's `package.json`.
