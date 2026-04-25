import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { homedir } from 'os';

export type GoalStatus = 'active' | 'done' | 'cancelled';

export interface Goal {
  id: string;
  description: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

function ulid(): string {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = Date.now();
  const ts: string[] = new Array(10);
  for (let i = 9; i >= 0; i--) {
    ts[i] = chars[t & 31]!;
    t = Math.floor(t / 32);
  }
  const rand: string[] = new Array(16);
  for (let i = 0; i < 16; i++) rand[i] = chars[Math.floor(Math.random() * 32)]!;
  return ts.join('') + rand.join('');
}

export class GoalStore {
  private filePath: string;

  constructor(dir?: string) {
    const d = dir ?? path.join(homedir(), '.pyrfor');
    mkdirSync(d, { recursive: true });
    this.filePath = path.join(d, 'goals.jsonl');
  }

  private readAll(): Goal[] {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean);
    return lines.map((l) => JSON.parse(l) as Goal);
  }

  private writeAll(goals: Goal[]): void {
    writeFileSync(this.filePath, goals.map((g) => JSON.stringify(g)).join('\n') + '\n', 'utf-8');
  }

  create(description: string): Goal {
    const goal: Goal = {
      id: ulid(),
      description,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appendFileSync(this.filePath, JSON.stringify(goal) + '\n', 'utf-8');
    return goal;
  }

  list(status?: GoalStatus): Goal[] {
    const all = this.readAll();
    return status ? all.filter((g) => g.status === status) : all;
  }

  get(id: string): Goal | undefined {
    return this.readAll().find((g) => g.id === id);
  }

  private updateStatus(id: string, status: GoalStatus): Goal | null {
    const goals = this.readAll();
    const idx = goals.findIndex((g) => g.id === id);
    if (idx === -1) return null;
    goals[idx] = { ...goals[idx]!, status, updatedAt: new Date().toISOString() };
    this.writeAll(goals);
    return goals[idx]!;
  }

  markDone(id: string): Goal | null {
    return this.updateStatus(id, 'done');
  }

  cancel(id: string): Goal | null {
    return this.updateStatus(id, 'cancelled');
  }
}
