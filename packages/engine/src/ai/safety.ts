import type {
  AIActionProposal,
  AIApplySafetySummary,
  AIProposalSafetyProfile,
} from "@/lib/ai/types";

export function getProposalSafetyProfile(
  proposal: AIActionProposal
): AIProposalSafetyProfile {
  switch (proposal.type) {
    case "create_tasks":
      return {
        level: "medium",
        executionMode: "guarded_patch",
        liveMutation: false,
        mutationSurface: "Task backlog draft",
        checks: [
          "Confirm assignees, deadlines, and priority before pushing any draft into the live board.",
          "Make sure duplicate tasks are not being created for the same field blocker.",
        ],
        compensationMode: "follow_up_patch",
        compensationSummary:
          "If the draft is wrong, issue a follow-up task patch or discard the draft before it reaches the live board.",
        compensationSteps: [
          "Review each draft task against the field report and escalation queue.",
          "Supersede incorrect drafts with a corrected proposal before any downstream publication.",
        ],
      };
    case "update_tasks":
      return {
        level: "high",
        executionMode: "guarded_patch",
        liveMutation: false,
        mutationSurface: "Existing task execution patch",
        checks: [
          "Verify that every referenced task still exists and belongs to the active project context.",
          "Check owner and due-date changes against the latest approved work report and current blockers.",
        ],
        compensationMode: "follow_up_patch",
        compensationSummary:
          "If the patch is wrong, issue an explicit corrective patch that restores owner, priority, or due-date intent.",
        compensationSteps: [
          "Capture which task fields would change before publishing the patch.",
          "Prepare a reverse patch or superseding patch if operators reject the execution change after review.",
        ],
      };
    case "reschedule_tasks":
      return {
        level: "high",
        executionMode: "guarded_patch",
        liveMutation: false,
        mutationSurface: "Schedule commitments and due dates",
        checks: [
          "Validate the new dates against contract milestones and predecessor constraints.",
          "Confirm that the schedule slip is already reflected in the latest operating evidence.",
        ],
        compensationMode: "follow_up_patch",
        compensationSummary:
          "If the reschedule is wrong, send a compensating patch that restores the prior date or proposes a corrected recovery date.",
        compensationSteps: [
          "Record the original due date before publishing the reschedule downstream.",
          "Attach the recovery rationale to any compensating schedule patch.",
        ],
      };
    case "raise_risks":
      return {
        level: "medium",
        executionMode: "guarded_patch",
        liveMutation: false,
        mutationSurface: "Risk register additions",
        checks: [
          "Confirm owner, mitigation, probability, and impact against the current evidence set.",
          "Avoid duplicating an already open risk with the same blocker signature.",
        ],
        compensationMode: "close_or_correct",
        compensationSummary:
          "If a risk is overstated or duplicate, close it explicitly or correct its severity and owner rather than hiding it.",
        compensationSteps: [
          "Link the raised risk to the packet and evidence that justified it.",
          "If operators disagree, downgrade or close the incorrect risk with a documented reason.",
        ],
      };
    case "draft_status_report":
      return {
        level: "low",
        executionMode: "preview_only",
        liveMutation: false,
        mutationSurface: "Executive narrative draft",
        checks: [
          "Review the audience, channel, and message freshness before any delivery step.",
          "Ensure the draft reflects the latest approved facts, not only pending observations.",
        ],
        compensationMode: "replace_draft",
        compensationSummary:
          "If the narrative is wrong, replace the draft with a corrected version before delivery; no rollback engine is needed.",
        compensationSteps: [
          "Keep the generated text in draft state until a human approves wording and recipients.",
          "Generate a superseding draft instead of editing delivered text in place.",
        ],
      };
    case "notify_team":
      return {
        level: "high",
        executionMode: "guarded_communication",
        liveMutation: false,
        mutationSurface: "Outbound team communication draft",
        checks: [
          "Validate recipients, channel, and operational urgency before any send action.",
          "Confirm that the message does not outrun the approved evidence or owner decision.",
        ],
        compensationMode: "send_correction_notice",
        compensationSummary:
          "If the message is wrong, send a correction notice and document the operator decision that superseded the draft.",
        compensationSteps: [
          "Hold the draft until a human confirms recipients and timing.",
          "If a wrong message leaves the system, issue a correction notice referencing the superseding instruction.",
        ],
      };
  }
}

export function buildApplySafetySummary(
  proposal: AIActionProposal
): AIApplySafetySummary {
  const profile = getProposalSafetyProfile(proposal);

  return {
    ...profile,
    operatorDecision: "manual_apply",
    postApplyState:
      profile.executionMode === "preview_only" ? "draft_only" : "guarded_execution",
  };
}
