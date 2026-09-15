// Usage tracking is opt-in at build time: the deploy workflow passes VITE_GOATCOUNTER_URL
// (this site's GoatCounter /count endpoint) and Vite inlines it below. Leaving it unset —
// local dev, the e2e suite, a fork — compiles to a no-op, so no build phones home by
// default and the tests never depend on a third-party script loading.
const ENDPOINT = import.meta.env.VITE_GOATCOUNTER_URL

// Each calculator is served from its own path (/calculators/<name>/), so GoatCounter's
// per-path breakdown is what separates one calculator's traffic from another's — there is
// no per-app configuration to keep in sync here.
export function initAnalytics() {
  if (!ENDPOINT) return
  try {
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://gc.zgo.at/count.js'
    script.dataset.goatcounter = ENDPOINT
    document.head.appendChild(script)
  } catch {
    // A counter must never be able to take the calculator down with it.
  }
}
