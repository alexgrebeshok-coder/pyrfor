// Map Types
export type ProjectStatus = "ok" | "warning" | "critical";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  progress: number;
  budget: number;
  risks: number;
  status: ProjectStatus;
  coordinates: [number, number]; // [lat, lng]
  description: string;
}

export interface MapObject {
  id: string;
  type: "project" | "person" | "equipment";
  name: string;
  coordinates: [number, number];
  status: ProjectStatus;
  data: Project | Person | Equipment;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  location: string;
  coordinates?: [number, number];
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
  location: string;
  coordinates?: [number, number];
}

export interface UserProfile {
  id: string;
  name: string;
  level: number;
  xp: number;
  maxXp: number;
  achievements: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  xp: number;
  icon: string;
  unlockedAt?: Date;
}
