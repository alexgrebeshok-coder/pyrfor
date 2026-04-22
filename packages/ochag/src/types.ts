// @ochag/family — Family types
// Domain types for ochag.prisma models (no Prisma client dependency)

export type FamilyPlan = 'free' | 'personal' | 'family' | 'family_plus'
export type FamilyRole = 'owner' | 'member' | 'child'
export type VaultCategory = 'password' | 'document' | 'note' | 'card'
export type ContentFilter = 'strict' | 'moderate'
export type CodingMode = 'chat' | 'agent' | 'vibe'

export interface FamilyAccountData {
  id: string
  userId: string
  plan: FamilyPlan
  createdAt: Date
  updatedAt: Date
}

export interface FamilyMemberData {
  id: string
  familyAccountId: string
  name: string
  role: FamilyRole
  telegramUserId?: string | null
  createdAt: Date
}

export interface FamilyEventData {
  id: string
  familyAccountId: string
  title: string
  description?: string | null
  startAt: Date
  endAt?: Date | null
  isRecurring: boolean
  rrule?: string | null
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface FamilyReminderData {
  id: string
  familyAccountId: string
  targetUserId: string
  text: string
  remindAt: Date
  sent: boolean
  createdAt: Date
}

export interface ChildSafetyPolicyData {
  id: string
  familyMemberId: string
  contentFilter: ContentFilter
  maxScreenTime?: number | null
  allowedTopics: string[]
  blockedTopics: string[]
  updatedAt: Date
}

export interface ConsentAction {
  userId: string
  action: 'voice_recording_enabled' | 'vault_created' | 'data_export' | 'family_account_created'
  consented: boolean
  ipAddress?: string
}
