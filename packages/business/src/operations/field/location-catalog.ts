export type FieldMapMarkerKind = "project" | "geofence";
export type FieldMapMarkerStatus = "live" | "neutral" | "pending" | "watch";

export interface FieldMapMarker {
  id: string;
  kind: FieldMapMarkerKind;
  label: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  status: FieldMapMarkerStatus;
  count: number;
  items: string[];
  observedAt?: string | null;
  href?: string;
}

interface LocationAnchor {
  patterns: RegExp[];
  latitude: number;
  longitude: number;
  label: string;
  region: string;
}

const LOCATION_ANCHORS: LocationAnchor[] = [
  {
    patterns: [/моск/i],
    latitude: 55.7558,
    longitude: 37.6173,
    label: "Москва",
    region: "Центр",
  },
  {
    patterns: [/челябинск/i],
    latitude: 55.1644,
    longitude: 61.4368,
    label: "Челябинск",
    region: "Урал",
  },
  {
    patterns: [/казан/i],
    latitude: 55.7887,
    longitude: 49.1221,
    label: "Казань",
    region: "Поволжье",
  },
  {
    patterns: [/екатеринбург/i],
    latitude: 56.8389,
    longitude: 60.6057,
    label: "Екатеринбург",
    region: "Урал",
  },
  {
    patterns: [/новосибирск/i],
    latitude: 55.0084,
    longitude: 82.9357,
    label: "Новосибирск",
    region: "Сибирь",
  },
  {
    patterns: [/харп/i],
    latitude: 66.80,
    longitude: 65.84,
    label: "Харп",
    region: "ЯНАО",
  },
  {
    patterns: [/сургут/i],
    latitude: 61.2532,
    longitude: 73.3962,
    label: "Сургут",
    region: "ХМАО",
  },
  {
    patterns: [/янао/i, /ямал/i],
    latitude: 66.08,
    longitude: 66.61,
    label: "ЯНАО",
    region: "Северный контур",
  },
  {
    patterns: [/надым/i],
    latitude: 65.53,
    longitude: 72.52,
    label: "Надым",
    region: "ЯНАО",
  },
  {
    patterns: [/салехард/i, /labytnangi/i, /лабытнанг/i],
    latitude: 66.53,
    longitude: 66.61,
    label: "Салехард",
    region: "ЯНАО",
  },
  {
    patterns: [/казахстан/i],
    latitude: 48.02,
    longitude: 66.92,
    label: "Казахстан",
    region: "Центральная Азия",
  },
  {
    patterns: [/remote camp base/i, /remote storage yard/i, /remote/i],
    latitude: 66.12,
    longitude: 66.08,
    label: "Удалённая площадка",
    region: "Полевой контур",
  },
  {
    patterns: [/yamal earthwork zone/i],
    latitude: 66.54,
    longitude: 66.60,
    label: "Ямал: земляные работы",
    region: "Ямал",
  },
  {
    patterns: [/yamal earthwork south zone/i],
    latitude: 66.42,
    longitude: 66.35,
    label: "Ямал: южная зона земляных работ",
    region: "Ямал",
  },
  {
    patterns: [/salekhard-labytnangi earthwork zone/i],
    latitude: 66.56,
    longitude: 66.64,
    label: "Салехард—Лабытнанги: земляные работы",
    region: "Ямал",
  },
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveFieldLocationAnchor(value: string | null | undefined): LocationAnchor | null {
  if (!value?.trim()) {
    return null;
  }

  const normalized = normalizeText(value);
  return (
    LOCATION_ANCHORS.find((anchor) => anchor.patterns.some((pattern) => pattern.test(normalized))) ?? null
  );
}

export interface BuildFieldMapMarkersInput {
  projects: Array<{
    id: string;
    name: string;
    location: string | null;
    status: string;
    progress: number;
    health: number;
  }>;
  geofences: Array<{
    geofenceKey: string;
    geofenceId: string | null;
    geofenceName: string | null;
    sessionCount: number;
    equipmentCount: number;
    latestObservedAt: string | null;
  }>;
}

export function buildFieldMapMarkers(input: BuildFieldMapMarkersInput): FieldMapMarker[] {
  const projectGroups = new Map<string, FieldMapMarker>();
  const geofenceGroups = new Map<string, FieldMapMarker>();

  for (const project of input.projects) {
    const anchor = resolveFieldLocationAnchor(project.location ?? project.name);
    if (!anchor) {
      continue;
    }

    const markerId = `project:${anchor.label}`;
    const existing = projectGroups.get(markerId) ?? {
      id: markerId,
      kind: "project" as const,
      label: anchor.label,
      subtitle: anchor.region,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      status: mapProjectStatus(project.status, project.health),
      count: 0,
      items: [],
      observedAt: null,
    };

    existing.count += 1;
    existing.items.push(project.name);
    existing.subtitle = project.location?.trim() ? project.location.trim() : anchor.region;
    existing.status = mergeStatus(existing.status, mapProjectStatus(project.status, project.health));
    existing.href = existing.count === 1 ? `/projects/${project.id}` : undefined;

    projectGroups.set(markerId, existing);
  }

  for (const geofence of input.geofences) {
    const anchor = resolveFieldLocationAnchor(geofence.geofenceName ?? geofence.geofenceId ?? geofence.geofenceKey);
    if (!anchor) {
      continue;
    }

    const markerId = `geofence:${anchor.label}`;
    const existing = geofenceGroups.get(markerId) ?? {
      id: markerId,
      kind: "geofence" as const,
      label: anchor.label,
      subtitle: anchor.region,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      status: geofence.sessionCount > 0 ? "live" : "pending",
      count: 0,
      items: [],
      observedAt: geofence.latestObservedAt,
    };

    existing.count += 1;
    existing.items.push(geofence.geofenceName ?? geofence.geofenceId ?? geofence.geofenceKey);
    existing.subtitle = buildGeofenceSubtitle(geofence);
    existing.status = mergeStatus(existing.status, geofence.sessionCount > 0 ? "live" : "pending");
    existing.observedAt = latestTimestamp(existing.observedAt, geofence.latestObservedAt);

    geofenceGroups.set(markerId, existing);
  }

  return [...projectGroups.values(), ...geofenceGroups.values()].sort((left, right) =>
    left.kind === right.kind ? left.label.localeCompare(right.label) : left.kind.localeCompare(right.kind)
  );
}

function mapProjectStatus(status: string, health: number): FieldMapMarkerStatus {
  if (status === "at_risk") {
    return "watch";
  }

  if (status === "on_hold") {
    return "pending";
  }

  if (status === "completed") {
    return "neutral";
  }

  return health < 60 ? "watch" : "live";
}

function mergeStatus(left: FieldMapMarkerStatus, right: FieldMapMarkerStatus): FieldMapMarkerStatus {
  const ranking: Record<FieldMapMarkerStatus, number> = {
    pending: 0,
    neutral: 1,
    live: 2,
    watch: 3,
  };

  return ranking[right] > ranking[left] ? right : left;
}

function latestTimestamp(left: string | null | undefined, right: string | null | undefined) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function buildGeofenceSubtitle(geofence: BuildFieldMapMarkersInput["geofences"][number]) {
  const parts = [
    `${geofence.sessionCount} ${formatRussianPlural(geofence.sessionCount, "сессия", "сессии", "сессий")}`,
    `${geofence.equipmentCount} единиц техники`,
  ];

  if (geofence.latestObservedAt) {
    parts.push(`обновлено ${geofence.latestObservedAt.slice(0, 10)}`);
  }

  return parts.join(" · ");
}

function formatRussianPlural(value: number, one: string, few: string, many: string) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return many;
  }

  if (remainder10 === 1) {
    return one;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return few;
  }

  return many;
}
