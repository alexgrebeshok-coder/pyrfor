"use client";

import { Card } from "@/components/ui/card";
import { DataErrorState } from "@/components/ui/data-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamMemberCard } from "@/components/team/team-member-card";
import { useLocale } from "@/contexts/locale-context";
import { useTeam } from "@/lib/hooks/use-api";

function TeamSkeleton() {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid gap-2 grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} className="p-2">
            <Skeleton className="h-4 w-16 mb-1" />
            <Skeleton className="h-6 w-10" />
          </Card>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Card key={index} className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-24 mb-1" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-1.5 w-full mb-2" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function TeamPage() {
  const { t } = useLocale();
  const { error, isLoading, mutate, team } = useTeam();

  if (isLoading && team.length === 0) {
    return <TeamSkeleton />;
  }

  if (error && team.length === 0) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={error instanceof Error ? error.message : t("error.loadDescription")}
        onRetry={() => {
          void mutate();
        }}
        title={t("error.loadTitle")}
      />
    );
  }

  // Calculate team stats
  const criticalCount = team.filter(m => m.allocated >= 90).length;
  const highLoadCount = team.filter(m => m.allocated >= 70 && m.allocated < 90).length;
  const normalCount = team.filter(m => m.allocated < 70).length;

  return (
    <div className="grid gap-3">
      {/* Compact Stats Row */}
      <div className="grid gap-2 grid-cols-3">
        <Card className="p-2 border-green-500/20 bg-green-500/5">
          <p className="text-[10px] uppercase text-green-600 dark:text-green-300">Normal Load</p>
          <p className="text-lg font-bold text-green-600 dark:text-green-300">{normalCount}</p>
        </Card>
        <Card className="p-2 border-amber-500/20 bg-amber-500/5">
          <p className="text-[10px] uppercase text-amber-600 dark:text-amber-300">High Load</p>
          <p className="text-lg font-bold text-amber-600 dark:text-amber-300">{highLoadCount}</p>
        </Card>
        <Card className="p-2 border-red-500/20 bg-red-500/5">
          <p className="text-[10px] uppercase text-red-600 dark:text-red-300">Critical</p>
          <p className="text-lg font-bold text-red-600 dark:text-red-300">{criticalCount}</p>
        </Card>
      </div>

      {/* Team Grid - Compact Cards */}
      <Card className="p-3">
        <h2 className="text-sm font-medium mb-3">{t("team.title")} ({team.length})</h2>
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
          {team.map((member) => (
            <TeamMemberCard key={member.id} member={member} />
          ))}
        </div>
      </Card>
    </div>
  );
}
