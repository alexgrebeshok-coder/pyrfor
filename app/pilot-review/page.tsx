import { ErrorBoundary } from "@/components/error-boundary";
import { PilotReviewPage } from "@/components/pilot-review/pilot-review-page";
import { buildAccessProfile } from "@/lib/auth/access-profile";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildPilotReviewRuntimeTruth } from "@/lib/server/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PilotReviewRoute() {
  const runtimeState = getServerRuntimeState();
  const accessProfile = buildAccessProfile();
  
  // Safe defaults for missing data (using any to bypass complex types)
  const scorecard: any = {
    readiness: { overall: 0, checks: [] },
    deliveryPolicies: [],
    deliveryHistory: [],
    summary: {
      openExceptions: 0,
      openFeedback: 0,
      totalChecks: 0,
      passedChecks: 0,
    },
    outcome: "pending",
  };
  
  const runtimeTruth = buildPilotReviewRuntimeTruth({
    runtime: runtimeState,
    scorecard,
  });

  return (
    <ErrorBoundary resetKey="pilot-review">
      <PilotReviewPage
        deliveryAvailabilityNote="Функция в разработке"
        deliveryHistory={[]}
        deliveryPolicies={[]}
        runtimeTruth={runtimeTruth}
        scorecard={scorecard}
      />
    </ErrorBoundary>
  );
}
