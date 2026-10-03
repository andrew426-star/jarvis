// Sites Jarvis never reads. Checked by the background worker before
// anything is taken from a page, so a blocked site's text never leaves the
// browser. Three categories are on by default (Andrew's choice); each can
// be switched off in the popup, and single sites can be blocked or allowed
// on top. Incognito is excluded by the manifest itself.

export const CATEGORIES = {
  banking: {
    label: "Banking & payments",
    hosts: [
      "chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "citibank.com", "capitalone.com",
      "usbank.com", "pnc.com", "truist.com", "regions.com", "hancockwhitney.com", "origin.bank",
      "discover.com", "americanexpress.com", "ally.com", "sofi.com", "navyfederal.org", "schwab.com",
      "fidelity.com", "vanguard.com", "etrade.com", "robinhood.com", "webull.com", "alpaca.markets",
      "coinbase.com", "kraken.com", "paypal.com", "venmo.com", "cash.app", "zellepay.com", "dashboard.stripe.com",
      "plaid.com", "creditkarma.com", "experian.com", "equifax.com", "transunion.com", "irs.gov",
      "turbotax.intuit.com", "studentaid.gov", "affirm.com", "klarna.com",
    ],
    // Any bank or credit union, wherever it lives.
    hostWords: ["bank", "creditunion", "federalcu", "fcu."],
    // Checkout and payment pages on any shop.
    pathWords: ["/checkout", "/payment", "/billing", "/pay/", "/wallet"],
  },
  email: {
    label: "Email",
    hosts: [
      "mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.zoho.com",
      "mail.yahoo.com", "mail.proton.me", "mail.aol.com",
    ],
    hostWords: ["webmail."],
    pathWords: [],
  },
  health: {
    label: "Health & insurance",
    hosts: [
      "followmyhealth.com", "aetna.com", "cigna.com", "uhc.com", "myuhc.com", "humana.com", "anthem.com",
      "kaiserpermanente.org", "healthcare.gov", "medicare.gov", "goodrx.com", "teladoc.com", "zocdoc.com",
    ],
    hostWords: ["mychart", "patient", "bcbs", "bluecross"],
    pathWords: ["/mychart", "/patient"],
  },
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith("." + domain)
}

/** Why a URL is off-limits, or null when Jarvis may read it. */
export function blockedReason(rawUrl, settings) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return "not a web page"
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "not a web page"
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()

  // The console itself is Jarvis's own screen, not something to report.
  if (settings.api && url.origin === new URL(settings.api).origin) return "the Jarvis console"
  if ((settings.allowed || []).some((d) => hostMatches(host, d))) return null
  if ((settings.blocked || []).some((d) => hostMatches(host, d))) return "blocked by you"

  for (const [key, category] of Object.entries(CATEGORIES)) {
    if (settings.categories?.[key] === false) continue
    if (
      category.hosts.some((d) => hostMatches(host, d)) ||
      category.hostWords.some((w) => host.includes(w)) ||
      category.pathWords.some((w) => path.includes(w))
    ) {
      return category.label
    }
  }
  return null
}
