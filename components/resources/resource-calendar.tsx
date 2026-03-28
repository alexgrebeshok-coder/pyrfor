"use client";

/**
 * Resource Calendar — weekly/monthly view showing resource allocations per day
 * Green = available, Yellow = allocated, Red = overallocated
 */

import { useState, useEffect, useMemo } from "react";

interface DailyLoad {
  date: string;
  resourceId: string;
  resourceName: string;
  resourceType: "member" | "equipment";
  allocatedHours: number;
  capacityHours: number;
  overallocated: boolean;
}

interface ResourceCalendarProps {
  projectId: string;
}

export function ResourceCalendar({ projectId }: ResourceCalendarProps) {
  const [data, setData] = useState<DailyLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1 + weekOffset * 7);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d.toISOString().split("T")[0];
    });
  }, [weekStart]);

  useEffect(() => {
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);

    fetch(
      `/api/resources/daily-load?projectId=${projectId}&startDate=${weekStart.toISOString()}&endDate=${endDate.toISOString()}`
    )
      .then((r) => r.json())
      .then((d) => {
        setData(d.loads || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, weekStart]);

  const resources = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>();
    for (const d of data) {
      if (!map.has(d.resourceId)) {
        map.set(d.resourceId, {
          name: d.resourceName,
          type: d.resourceType,
        });
      }
    }
    return Array.from(map.entries());
  }, [data]);

  const getLoad = (resourceId: string, date: string) =>
    data.find(
      (d) => d.resourceId === resourceId && d.date === date
    );

  const getCellColor = (load: DailyLoad | undefined) => {
    if (!load || load.allocatedHours === 0)
      return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300";
    if (load.overallocated)
      return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300";
    return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300";
  };

  if (loading) {
    return (
      <div className="animate-pulse p-4 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Resource Calendar
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded px-2 py-1 text-xs hover:bg-muted"
          >
            ← ← Prev
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="rounded px-2 py-1 text-xs hover:bg-muted"
          >
            Today
          </button>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded px-2 py-1 text-xs hover:bg-muted"
          >
            Next → →
          </button>
        </div>
      </div>

      {resources.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No resource assignments for this period
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="w-40 py-2 text-left font-medium">
                  Resource
                </th>
                {weekDays.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-medium">
                    {new Date(d + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                    })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map(([id, info]) => (
                <tr key={id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{info.name}</div>
                    <div className="text-muted-foreground">
                      {info.type === "member" ? "👤" : "🔧"}{" "}
                      {info.type}
                    </div>
                  </td>
                  {weekDays.map((date) => {
                    const load = getLoad(id, date);
                    return (
                      <td
                        key={date}
                        className={`px-2 py-2 text-center ${getCellColor(load)}`}
                      >
                        {load ? (
                          <div>
                            <div className="font-medium">
                              {load.allocatedHours}h
                            </div>
                            <div className="text-[10px] opacity-70">
                              / {load.capacityHours}h
                            </div>
                          </div>
                        ) : (
                          <span className="opacity-50">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
