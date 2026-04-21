/**
 * Agent Store - Session management for AI agents
 * Tracks agent runs, costs, tokens
 */

import {
  readJsonFile,
  writeJsonFile,
  queryJsonArray,
  findInJsonArray,
  updateInJsonArray,
} from '../data/file-manager';

// ============================================
// Types
// ============================================

export interface AgentSession {
  id: string;
  agentId: string; // "main" | "main-worker" | "quick-research" | ...
  status: 'idle' | 'running' | 'completed' | 'failed';
  task?: string;
  result?: unknown;
  model?: string; // "glm-5" | "gemini-3.1-lite" | "gpt-5.2"
  provider?: string; // "zai" | "openrouter" | "openai"
  tokens: number;
  cost: number;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  model: string;
  provider: string;
  description: string;
}

// ============================================
// Agent Configurations (OpenClaw-style)
// ============================================

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'main',
    name: 'Main',
    role: 'Оркестратор и коммуникатор',
    model: 'glm-5',
    provider: 'zai',
    description: 'Принимает задачи, делегирует workers, общается с пользователем',
  },
  {
    id: 'main-worker',
    name: 'Worker',
    role: 'Execution',
    model: 'glm-5',
    provider: 'zai',
    description: 'Выполняет действия (exec, write, edit)',
  },
  {
    id: 'quick-research',
    name: 'Research',
    role: 'Research, web поиск',
    model: 'gemini-3.1-flash-lite-preview',
    provider: 'openrouter',
    description: 'Быстрый поиск информации (в 3.5x быстрее)',
  },
  {
    id: 'quick-coder',
    name: 'Coder',
    role: 'Генерация кода',
    model: 'glm-5',
    provider: 'zai',
    description: 'Генерация и рефакторинг кода',
  },
  {
    id: 'writer',
    name: 'Writer',
    role: 'Тексты, документация',
    model: 'glm-5',
    provider: 'zai',
    description: 'Написание текстов и документации',
  },
  {
    id: 'planner',
    name: 'Planner',
    role: 'Планирование задач',
    model: 'glm-5',
    provider: 'zai',
    description: 'Планирование и декомпозиция задач',
  },
  {
    id: 'main-reviewer',
    name: 'Reviewer',
    role: 'QA, проверка качества',
    model: 'gpt-5.2',
    provider: 'openai',
    description: 'Критика, проверка качества, code review',
  },
];

// ============================================
// Agent Session Manager
// ============================================

const SESSIONS_FILE = 'agent-sessions.json';

export class AgentSessionManager {
  /**
   * Create new session
   */
  async createSession(data: {
    agentId: string;
    task?: string;
    model?: string;
    provider?: string;
  }): Promise<AgentSession> {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      agentId: data.agentId,
      status: 'idle',
      task: data.task,
      model: data.model,
      provider: data.provider,
      tokens: 0,
      cost: 0,
      createdAt: now,
    };

    const sessions = readJsonFile<AgentSession[]>(SESSIONS_FILE, []);
    sessions.push(session);
    writeJsonFile(SESSIONS_FILE, sessions);

    return session;
  }

  /**
   * Start session
   */
  async startSession(id: string): Promise<AgentSession | null> {
    return updateInJsonArray<AgentSession>(
      SESSIONS_FILE,
      (s) => s.id === id,
      (s) => ({
        ...s,
        status: 'running',
        startedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Complete session
   */
  async completeSession(
    id: string,
    result: unknown,
    tokens: number,
    cost: number
  ): Promise<AgentSession | null> {
    return updateInJsonArray<AgentSession>(
      SESSIONS_FILE,
      (s) => s.id === id,
      (s) => ({
        ...s,
        status: 'completed',
        result,
        tokens,
        cost,
        endedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Fail session
   */
  async failSession(id: string, error: string): Promise<AgentSession | null> {
    return updateInJsonArray<AgentSession>(
      SESSIONS_FILE,
      (s) => s.id === id,
      (s) => ({
        ...s,
        status: 'failed',
        result: { error },
        endedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<AgentSession | null> {
    return findInJsonArray<AgentSession>(SESSIONS_FILE, (s) => s.id === id);
  }

  /**
   * Get recent sessions
   */
  async getRecentSessions(limit = 20): Promise<AgentSession[]> {
    return queryJsonArray<AgentSession>(SESSIONS_FILE, {
      sort: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      limit,
    });
  }

  /**
   * Get sessions by agent
   */
  async getSessionsByAgent(agentId: string, limit = 10): Promise<AgentSession[]> {
    return queryJsonArray<AgentSession>(SESSIONS_FILE, {
      filter: (s) => s.agentId === agentId,
      sort: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      limit,
    });
  }

  /**
   * Get agent stats
   */
  async getAgentStats(agentId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    totalTokens: number;
    totalCost: number;
  }> {
    const sessions = await this.getSessionsByAgent(agentId, 1000);

    return {
      total: sessions.length,
      completed: sessions.filter((s) => s.status === 'completed').length,
      failed: sessions.filter((s) => s.status === 'failed').length,
      totalTokens: sessions.reduce((sum, s) => sum + s.tokens, 0),
      totalCost: sessions.reduce((sum, s) => sum + s.cost, 0),
    };
  }

  /**
   * Clear old sessions (older than days)
   */
  async clearOldSessions(days = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const sessions = readJsonFile<AgentSession[]>(SESSIONS_FILE, []);
    const initialLength = sessions.length;
    const filtered = sessions.filter(
      (s) => new Date(s.createdAt) >= cutoff
    );
    writeJsonFile(SESSIONS_FILE, filtered);

    return initialLength - filtered.length;
  }
}

// Process-wide singleton. The session manager wraps a JSON file on disk and
// must be shared — every `new AgentSessionManager()` read/write the same file
// so instantiating many is wasteful and makes in-memory caching impossible
// if/when this class ever grows one.
let _sessionManager: AgentSessionManager | null = null;
export function getAgentSessionManager(): AgentSessionManager {
  if (!_sessionManager) {
    _sessionManager = new AgentSessionManager();
  }
  return _sessionManager;
}
