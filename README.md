# Calculators

Small, self-contained calculators — financial planning and beyond. No
accounts, no backend — each one is a static site with a shareable-link
and/or local-autosave persistence model, deployed to GitHub Pages.

Live: https://davidayala16.github.io/calculators/

## Structure

Each calculator lives in its own directory under `apps/`, is a
standalone Vite project, and deploys to its own path (e.g.
`/retirement-runway/`). Adding a new one is just:

1. `apps/<name>/` — a new Vite project, `base: '/calculators/<name>/'` in `vite.config.js`
2. Nothing else — `.github/workflows/deploy-pages.yml` builds every directory under `apps/` automatically and republishes the landing page.

## Calculators

- [`apps/retirement-runway/`](apps/retirement-runway/) — projects portfolio growth and retirement drawdown at a chosen withdrawal rate.
- [`apps/rent-vs-buy/`](apps/rent-vs-buy/) — compares the long-run net worth of buying a home against renting and investing the difference, accounting for appreciation, rent growth, investment returns, and taxes.
- [`apps/carb-gel-calculator/`](apps/carb-gel-calculator/) — scales a DIY energy gel recipe to the carbs and sodium a run actually needs, accounting for what a sports drink already covers.
- [`apps/home-sale-purchase/`](apps/home-sale-purchase/) — models selling your current home and buying the next one together, comparing the new monthly payment against what you pay today across selling costs, closing costs, rate, and down-payment source, plus an income-based affordability check (max home price, or required salary, under standard DTI limits).

## Development

```bash
cd apps/<name>
npm install
npm run dev
```

## Usage analytics

Per-calculator traffic is tracked with [GoatCounter](https://www.goatcounter.com/)
(free for non-commercial use, no cookies, no consent banner). Because each
calculator is served from its own path, a single GoatCounter site gives a
per-calculator breakdown through its "Pages" report — there is nothing to
configure per app.

It is **off unless configured**. To turn it on:

1. Create a site at [goatcounter.com](https://www.goatcounter.com/) and note
   its code (the `<code>` in `<code>.goatcounter.com`).
2. In this repo: **Settings → Secrets and variables → Actions → Variables →
   New repository variable**, named `GOATCOUNTER_URL`, set to
   `https://<code>.goatcounter.com/count`.
3. Push to `main` (or re-run the deploy workflow). Every app and the landing
   page pick it up on the next build.

With the variable unset — local dev, the e2e suites, forks — the tracking
code compiles out entirely and no request is made off-box. The e2e suites
assert this, so the default build can't start phoning home by accident.

Note that this only counts traffic to the deployed site. The repo's own
Insights → Traffic tab measures clones and visits to the GitHub repo page
(mostly CI checkouts), which is unrelated to calculator usage.
