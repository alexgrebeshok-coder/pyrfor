import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEvent } from "@/lib/calendar-events";

import { KIND_META, getStatusMeta, longDateFormatter } from "./calendar-view.utils";

export function CalendarEventDialog({
  selectedEvent,
  onClose,
  onOpenChange,
}: {
  selectedEvent: CalendarEvent | null;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(selectedEvent)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-[560px]">
        {selectedEvent ? (
          <>
            <DialogHeader>
              <DialogTitle>{selectedEvent.title}</DialogTitle>
              <DialogDescription>
                {selectedEvent.kind === "milestone"
                  ? "Milestone details from the live calendar feed."
                  : "Task details from the live calendar feed."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-soft)]">Type</p>
                  <div className="mt-2">
                    <Badge variant="neutral">{KIND_META[selectedEvent.kind].label}</Badge>
                  </div>
                </div>

                <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-soft)]">Status</p>
                  <div className="mt-2">
                    <Badge variant={getStatusMeta(selectedEvent.status).tone}>
                      {getStatusMeta(selectedEvent.status).label}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <p className="text-sm text-[var(--ink-soft)]">Project</p>
                <p className="mt-1 font-medium text-[var(--ink)]">
                  {selectedEvent.resource.projectName}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-soft)]">
                    {selectedEvent.kind === "milestone" ? "Milestone date" : "Due date"}
                  </p>
                  <p className="mt-1 font-medium text-[var(--ink)]">
                    {longDateFormatter.format(new Date(selectedEvent.start))}
                  </p>
                </div>
              </div>

              <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <p className="text-sm text-[var(--ink-soft)]">Event color</p>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className="h-4 w-4 rounded-full border border-white/30"
                    style={{ backgroundColor: selectedEvent.color }}
                  />
                  <span className="text-sm text-[var(--ink)]">
                    {selectedEvent.color.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={onClose} variant="secondary">
                Close
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
