// @freeclaude/coder — Provider routing
// Selects the best available provider given user preferences and availability

import type { FreeClaude_ProviderRoute, FreeClaude_QueryConfig, ProviderName } from './types'

/** Default provider preference order (cost-ascending) */
const DEFAULT_PREFERENCE: ProviderName[] = [
  'zai',        // cheapest (CEOClaw ZAI)
  'openrouter', // broad model coverage
  'gigachat',   // Russian market, good RU
  'yandexgpt',  // Russian market
  'openai',     // premium / fallback
]

/**
 * Select best route for a query config.
 * Returns the first available route matching provider preference.
 */
export function selectRoute(
  routes: FreeClaude_ProviderRoute[],
  config: FreeClaude_QueryConfig,
): FreeClaude_ProviderRoute | null {
  const available = routes.filter((r) => r.available)
  if (available.length === 0) return null

  if (config.provider !== 'auto') {
    return available.find((r) => r.provider === config.provider) ?? null
  }

  const preference = DEFAULT_PREFERENCE
  for (const p of preference) {
    const route = available.find((r) => r.provider === p)
    if (route) return route
  }
  return available[0] ?? null
}

/**
 * Estimate total cost in USD for a query.
 * @param tokens approximate token count
 */
export function estimateCost(route: FreeClaude_ProviderRoute, tokens: number): number {
  return (route.costPer1M / 1_000_000) * tokens
}

/**
 * Returns whether the requested model is available on the given provider route.
 */
export function isModelAvailable(
  routes: FreeClaude_ProviderRoute[],
  provider: ProviderName,
  model: string,
): boolean {
  return routes.some((r) => r.provider === provider && r.model === model && r.available)
}
