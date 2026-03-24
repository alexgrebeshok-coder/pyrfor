"use client";

import type { UserProfile } from "@/types/map";

interface XPProgressProps {
  user: UserProfile;
}

export function XPProgress({ user }: XPProgressProps) {
  const percentage = Math.round((user.xp / user.maxXp) * 100);

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur-sm px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-base">🏆</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-blue-400">L{user.level}</span>
            <span className="text-slate-400">
              {user.xp}/{user.maxXp} XP
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
