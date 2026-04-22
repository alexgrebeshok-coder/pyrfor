// @freeclaude/coder — Session adapter
// Maps FreeClaude CLI session state to/from CodeSession Prisma model

import type {
  FreeClaude_SessionState,
  FreeClaude_SessionMessage,
  FreeCloudeMode,
  ProviderName,
} from './types'

export interface CodeSessionRaw {
  id: string
  userId: string
  projectId?: string | null
  provider: string
  model: string
  mode: string
  messages: unknown
  cost: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Convert a raw Prisma CodeSession row into FreeClaude session state.
 */
export function toSessionState(raw: CodeSessionRaw): FreeClaude_SessionState {
  const messages = Array.isArray(raw.messages)
    ? (raw.messages as FreeClaude_SessionMessage[])
    : []

  return {
    sessionId: raw.id,
    userId: raw.userId,
    projectId: raw.projectId,
    provider: raw.provider as ProviderName,
    model: raw.model,
    mode: raw.mode as FreeCloudeMode,
    messages,
    totalCost: raw.cost,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

/**
 * Prepare update payload for Prisma when saving session progress.
 */
export function toSessionUpdate(
  state: FreeClaude_SessionState,
): { messages: FreeClaude_SessionMessage[]; cost: number; updatedAt: Date } {
  return {
    messages: state.messages,
    cost: state.totalCost,
    updatedAt: new Date(),
  }
}

/**
 * Append a message to session state (immutable).
 */
export function appendMessage(
  state: FreeClaude_SessionState,
  message: Omit<FreeClaude_SessionMessage, 'timestamp'>,
): FreeClaude_SessionState {
  return {
    ...state,
    messages: [...state.messages, { ...message, timestamp: Date.now() }],
    updatedAt: new Date(),
  }
}
