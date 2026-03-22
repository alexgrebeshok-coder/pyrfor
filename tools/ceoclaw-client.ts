const SEOCLAW_API_BASE =
  process.env.SEOCLAW_API_BASE ?? "http://localhost:3002/api";

export interface CEOClawProject {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  direction: string;
  priority: string;
  health: string;
  progress: number;
  budgetPlan?: number | null;
  budgetFact?: number | null;
  location?: string | null;
  start: string;
  end: string;
  createdAt: string;
  updatedAt: string;
}

export interface CEOClawTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate: string;
  projectId: string;
  assigneeId?: string | null;
  order: number;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CEOClawRisk {
  id: string;
  title: string;
  description?: string | null;
  probability: string;
  impact: string;
  severity: number;
  status: string;
  projectId: string;
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CEOClawTeamMember {
  id: string;
  name: string;
  initials?: string | null;
  role: string;
  email?: string | null;
  avatar?: string | null;
  capacity: number;
  createdAt: string;
  updatedAt: string;
  activeTasks?: number;
  capacityUsed?: number;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // Expected: response may not be valid JSON, use default message
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export class CEOClawClient {
  constructor(private readonly baseUrl: string = SEOCLAW_API_BASE) {}

  async getProjects(filters?: { status?: string; direction?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.direction) params.set("direction", filters.direction);
    const query = params.toString();
    return request<CEOClawProject[]>(
      `${this.baseUrl}/projects${query ? `?${query}` : ""}`
    );
  }

  async getProject(id: string) {
    return request<CEOClawProject>(`${this.baseUrl}/projects/${id}`);
  }

  async createProject(data: {
    name: string;
    description?: string;
    status?: string;
    direction: string;
    start: string;
    end: string;
    budgetPlan?: number;
    budgetFact?: number;
    progress?: number;
    location?: string;
    priority?: string;
    health?: string;
    teamIds?: string[];
  }) {
    return request<CEOClawProject>(`${this.baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateProject(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      status: string;
      direction: string;
      priority: string;
      health: string;
      progress: number;
      budgetPlan: number;
      budgetFact: number;
      start: string;
      end: string;
      location: string;
      teamIds: string[];
    }>
  ) {
    return request<CEOClawProject>(`${this.baseUrl}/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string) {
    await request<{ deleted: true }>(`${this.baseUrl}/projects/${id}`, {
      method: "DELETE",
    });
  }

  async getTasks(filters?: {
    status?: string;
    priority?: string;
    projectId?: string;
    assigneeId?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.priority) params.set("priority", filters.priority);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.assigneeId) params.set("assigneeId", filters.assigneeId);
    const query = params.toString();
    return request<CEOClawTask[]>(
      `${this.baseUrl}/tasks${query ? `?${query}` : ""}`
    );
  }

  async getTask(id: string) {
    return request<CEOClawTask>(`${this.baseUrl}/tasks/${id}`);
  }

  async createTask(data: {
    title: string;
    description?: string;
    projectId: string;
    assigneeId?: string;
    dueDate: string;
    status?: string;
    priority?: string;
    order?: number;
  }) {
    return request<CEOClawTask>(`${this.baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateTask(
    id: string,
    data: Partial<{
      title: string;
      description: string;
      status: string;
      priority: string;
      assigneeId: string | null;
      dueDate: string;
      order: number;
    }>
  ) {
    return request<CEOClawTask>(`${this.baseUrl}/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteTask(id: string) {
    await request<{ deleted: true }>(`${this.baseUrl}/tasks/${id}`, {
      method: "DELETE",
    });
  }

  async reorderTasks(projectId: string, columns: Record<string, string[]>) {
    await request<{ reordered: true; count: number }>(
      `${this.baseUrl}/tasks/reorder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, columns }),
      }
    );
  }

  async getRisks(filters?: { projectId?: string; status?: string }) {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.status) params.set("status", filters.status);
    const query = params.toString();
    return request<CEOClawRisk[]>(
      `${this.baseUrl}/risks${query ? `?${query}` : ""}`
    );
  }

  async getRisk(id: string) {
    return request<CEOClawRisk>(`${this.baseUrl}/risks/${id}`);
  }

  async createRisk(data: {
    title: string;
    description?: string;
    projectId: string;
    ownerId?: string;
    probability?: string;
    impact?: string;
    status?: string;
  }) {
    return request<CEOClawRisk>(`${this.baseUrl}/risks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateRisk(
    id: string,
    data: Partial<{
      title: string;
      description: string | null;
      status: string;
      ownerId: string | null;
      projectId: string;
      probability: string;
      impact: string;
    }>
  ) {
    return request<CEOClawRisk>(`${this.baseUrl}/risks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteRisk(id: string) {
    await request<{ deleted: true }>(`${this.baseUrl}/risks/${id}`, {
      method: "DELETE",
    });
  }

  async getTeam() {
    return request<CEOClawTeamMember[]>(`${this.baseUrl}/team`);
  }

  async getTeamMember(id: string) {
    return request<CEOClawTeamMember>(`${this.baseUrl}/team/${id}`);
  }

  async createTeamMember(data: {
    name: string;
    role: string;
    initials?: string;
    email?: string;
    avatar?: string;
    capacity?: number;
  }) {
    return request<CEOClawTeamMember>(`${this.baseUrl}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateTeamMember(
    id: string,
    data: Partial<{
      name: string;
      role: string;
      initials: string | null;
      email: string | null;
      avatar: string | null;
      capacity: number;
    }>
  ) {
    return request<CEOClawTeamMember>(`${this.baseUrl}/team/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/projects`, { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const ceoclaw = new CEOClawClient();
