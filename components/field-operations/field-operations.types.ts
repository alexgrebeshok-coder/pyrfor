export type FieldProject = {
  id: string;
  name: string;
  location: string | null;
  status: string;
  progress: number;
  health: string;
  team: Array<{
    id: string;
    name: string;
    role: string;
    initials: string | null;
    capacity: number;
  }>;
};

export type FieldTeamMember = {
  id: string;
  name: string;
  role: string;
  initials: string | null;
  capacity: number;
  projects: Array<{
    id: string;
    name: string;
    location: string | null;
    status: string;
    progress: number;
  }>;
};

export type FieldMapProject = {
  id: string;
  name: string;
  location: string | null;
  status: string;
  progress: number;
  health: number;
};
