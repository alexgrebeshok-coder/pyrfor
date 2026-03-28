import { ErrorBoundary } from "@/components/error-boundary";
import { PilotReviewPage } from "@/components/pilot-review/pilot-review-page";
import { buildAccessProfile } from "@/lib/auth/access-profile";
import { getPilotReviewScorecard } from "@/lib/pilot-review";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildPilotReviewRuntimeTruth } from "@/lib/server/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PilotReviewRoute() {
  const runtimeState = getServerRuntimeState();
  const accessProfile = buildAccessProfile();
  const scorecard = await getPilotReviewScorecard({
    accessProfile,
    runtime: runtimeState,
  });

  const runtimeTruth = buildPilotReviewRuntimeTruth({
    runtime: runtimeState,
    scorecard,
  });

  return (
    <ErrorBoundary resetKey="pilot-review">
      <PilotReviewPage
        deliveryAvailabilityNote="Функция в разработке"
        deliveryHistory={scorecard.delivery.entries}
        deliveryPolicies={[]}
        runtimeTruth={runtimeTruth}
        scorecard={scorecard}
      />
    </ErrorBoundary>
  );
}
