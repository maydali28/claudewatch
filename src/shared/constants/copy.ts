// Every currency amount ClaudeWatch shows is priced from recorded token
// counts at the configured API rates (list prices unless overridden), not a
// real bill from any plan. These three strings are the single source of that
// wording — every cost label, tooltip and explanatory note across the
// renderer quotes one of them rather than restating the idea in its own
// words, so the promise stays exactly the same everywhere it appears.

export const COST_ESTIMATE_LABEL = 'Est. cost'

export const COST_ESTIMATE_NOTE =
  'Estimated from recorded tokens using the configured API rates. ' +
  'This is not your bill or your remaining plan allowance: subscription inclusions, usage credits, ' +
  "discounts and charges the app doesn't price can make what you actually pay differ."

export const COST_ESTIMATE_NOTE_SHORT =
  'Estimate at configured API rates — not your bill or plan allowance.'
