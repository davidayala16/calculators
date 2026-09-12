# Sell & Buy

A calculator for the "sell my current home, buy the next one" decision:
models the selling side (realtor commission, seller closing costs,
capital gains tax, mortgage payoff) and the buying side (down payment
sourced from sale proceeds plus savings and an optional bridge loan,
buyer closing costs, PMI, discount points, fixed or ARM loans) together,
then compares the resulting new monthly payment against what you pay
today. Includes side-by-side rate scenarios, a full rate sensitivity
grid, year-by-year amortization for both loans, an equity-over-time
chart, a discount-points breakeven estimate, and an affordability panel
that turns your household income into a max qualifying home price (or
the reverse: the income a target price would require) under standard
front-end/back-end debt-to-income limits.

Everything is self-contained in the browser — inputs are encoded into a
shareable URL (`?d=...`) rather than stored on any backend, so there's no
account system and nothing to sign up for.

## Stack

- [Vite](https://vite.dev) + React 19
- [Recharts](https://recharts.org) for the equity chart

## Development

```bash
npm install
npm run dev       # local dev server with HMR
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

## Deployment

This is a static site — `npm run build` produces a `dist/` folder that can
be deployed to any static host (Netlify, Vercel, GitHub Pages, etc). A
`netlify.toml` is included for Netlify deploys.
