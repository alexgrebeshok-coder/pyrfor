export {
  getEscalationItemById,
  getEscalationQueueOverview,
  summarizeEscalations,
  syncEscalationQueue,
  updateEscalationItem,
} from "@/lib/escalations/service";
export type {
  EscalationListResult,
  EscalationMetadata,
  EscalationOwnerView,
  EscalationQuery,
  EscalationQueueStatus,
  EscalationRecordView,
  EscalationSlaState,
  EscalationSourceStatus,
  EscalationSummary,
  EscalationUpdateInput,
  EscalationUrgency,
} from "@/lib/escalations/types";
