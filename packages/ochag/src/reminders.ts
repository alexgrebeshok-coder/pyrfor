// @ochag/family — Reminder helpers
// Utilities for scheduling and filtering family reminders

import type { FamilyReminderData } from './types'

/**
 * Returns reminders due within the next `withinMs` milliseconds.
 */
export function getUpcomingReminders(
  reminders: FamilyReminderData[],
  withinMs: number = 30 * 60 * 1000, // 30 min default
): FamilyReminderData[] {
  const now = Date.now()
  const cutoff = now + withinMs
  return reminders.filter(
    (r) => !r.sent && r.remindAt.getTime() >= now && r.remindAt.getTime() <= cutoff,
  )
}

/**
 * Returns overdue reminders (past remindAt, not yet sent).
 */
export function getOverdueReminders(reminders: FamilyReminderData[]): FamilyReminderData[] {
  const now = Date.now()
  return reminders.filter((r) => !r.sent && r.remindAt.getTime() < now)
}

/**
 * Format reminder message for Telegram/voice delivery.
 */
export function formatReminderMessage(reminder: FamilyReminderData): string {
  return `🔔 Напоминание: ${reminder.text}`
}
