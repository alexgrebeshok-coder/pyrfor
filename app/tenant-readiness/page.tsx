import { TenantReadinessPage } from "@/components/tenant-readiness/tenant-readiness-page";
import { buildAccessProfile } from "@/lib/auth/access-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TenantReadinessRoute() {
  const accessProfile = buildAccessProfile();
  
  // Safe defaults
  const report = {
    overall: 0,
    categories: [],
    generatedAt: new Date().toISOString(),
  };

  return <TenantReadinessPage report={report} accessProfile={accessProfile} />;
}
