// @ochag/family — Child safety policy helpers

import type { ChildSafetyPolicyData } from './types'

const STRICT_BLOCKED_TOPICS = [
  'violence',
  'adult_content',
  'gambling',
  'drugs',
  'weapons',
]

const MODERATE_BLOCKED_TOPICS = [
  'adult_content',
  'gambling',
]

/**
 * Returns merged blocked topic list (policy + content-filter defaults).
 */
export function getEffectiveBlockedTopics(policy: ChildSafetyPolicyData): string[] {
  const defaults =
    policy.contentFilter === 'strict' ? STRICT_BLOCKED_TOPICS : MODERATE_BLOCKED_TOPICS
  return Array.from(new Set([...defaults, ...policy.blockedTopics]))
}

/**
 * Returns true if topic is allowed by the policy.
 */
export function isTopicAllowed(topic: string, policy: ChildSafetyPolicyData): boolean {
  const blocked = getEffectiveBlockedTopics(policy)
  if (blocked.includes(topic)) return false
  if (policy.allowedTopics.length > 0) return policy.allowedTopics.includes(topic)
  return true
}

/**
 * Returns true if child has exceeded daily screen-time limit.
 */
export function hasExceededScreenTime(
  policy: ChildSafetyPolicyData,
  usedMinutes: number,
): boolean {
  if (!policy.maxScreenTime) return false
  return usedMinutes >= policy.maxScreenTime
}
