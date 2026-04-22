export type DerivedSyncStatus = "idle" | "running" | "success" | "error";

export interface DerivedSyncMetadata {
  [key: string]: string | number | boolean | null;
}

export interface DerivedSyncCheckpointView {
  key: string;
  status: DerivedSyncStatus;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastResultCount: number | null;
  metadata: DerivedSyncMetadata;
  createdAt: string;
  updatedAt: string;
}
