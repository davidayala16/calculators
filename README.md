# Financial Calculators

Small, self-contained financial-planning calculators. No accounts, no
backend — each one is a static site with a shareable-link and/or
local-autosave persistence model, deployed to GitHub Pages.

Live: https://davidayala16.github.io/financial-calculators/

## Structure

Each calculator lives in its own directory under `apps/`, is a
standalone Vite project, and deploys to its own path (e.g.
`/retirement-runway/`). Adding a new one is just:

1. `apps/<name>/` — a new Vite project, `base: '/financial-calculators/<name>/'` in `vite.config.js`
2. Nothing else — `.github/workflows/deploy-pages.yml` builds every directory under `apps/` automatically and republishes the landing page.

## Calculators

- [`apps/retirement-runway/`](apps/retirement-runway/) — projects portfolio growth and retirement drawdown at a chosen withdrawal rate.

## Development

```bash
cd apps/<name>
npm install
npm run dev
```
