/**
 * Agent Store - Session management for AI agents
 * Tracks agent runs, costs, tokens
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { readJsonFile, writeJsonFile, queryJsonArray, findInJsonArray, updateInJsonArray, } from '../../data/file-manager';
// ============================================
// Agent Configurations (OpenClaw-style)
// ============================================
export const AGENT_CONFIGS = [
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
    createSession(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const now = new Date().toISOString();
            const session = {
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
            const sessions = readJsonFile(SESSIONS_FILE, []);
            sessions.push(session);
            writeJsonFile(SESSIONS_FILE, sessions);
            return session;
        });
    }
    /**
     * Start session
     */
    startSession(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return updateInJsonArray(SESSIONS_FILE, (s) => s.id === id, (s) => (Object.assign(Object.assign({}, s), { status: 'running', startedAt: new Date().toISOString() })));
        });
    }
    /**
     * Complete session
     */
    completeSession(id, result, tokens, cost) {
        return __awaiter(this, void 0, void 0, function* () {
            return updateInJsonArray(SESSIONS_FILE, (s) => s.id === id, (s) => (Object.assign(Object.assign({}, s), { status: 'completed', result,
                tokens,
                cost, endedAt: new Date().toISOString() })));
        });
    }
    /**
     * Fail session
     */
    failSession(id, error) {
        return __awaiter(this, void 0, void 0, function* () {
            return updateInJsonArray(SESSIONS_FILE, (s) => s.id === id, (s) => (Object.assign(Object.assign({}, s), { status: 'failed', result: { error }, endedAt: new Date().toISOString() })));
        });
    }
    /**
     * Get session by ID
     */
    getSession(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return findInJsonArray(SESSIONS_FILE, (s) => s.id === id);
        });
    }
    /**
     * Get recent sessions
     */
    getRecentSessions() {
        return __awaiter(this, arguments, void 0, function* (limit = 20) {
            return queryJsonArray(SESSIONS_FILE, {
                sort: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                limit,
            });
        });
    }
    /**
     * Get sessions by agent
     */
    getSessionsByAgent(agentId_1) {
        return __awaiter(this, arguments, void 0, function* (agentId, limit = 10) {
            return queryJsonArray(SESSIONS_FILE, {
                filter: (s) => s.agentId === agentId,
                sort: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                limit,
            });
        });
    }
    /**
     * Get agent stats
     */
    getAgentStats(agentId) {
        return __awaiter(this, void 0, void 0, function* () {
            const sessions = yield this.getSessionsByAgent(agentId, 1000);
            return {
                total: sessions.length,
                completed: sessions.filter((s) => s.status === 'completed').length,
                failed: sessions.filter((s) => s.status === 'failed').length,
                totalTokens: sessions.reduce((sum, s) => sum + s.tokens, 0),
                totalCost: sessions.reduce((sum, s) => sum + s.cost, 0),
            };
        });
    }
    /**
     * Clear old sessions (older than days)
     */
    clearOldSessions() {
        return __awaiter(this, arguments, void 0, function* (days = 30) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            const sessions = readJsonFile(SESSIONS_FILE, []);
            const initialLength = sessions.length;
            const filtered = sessions.filter((s) => new Date(s.createdAt) >= cutoff);
            writeJsonFile(SESSIONS_FILE, filtered);
            return initialLength - filtered.length;
        });
    }
}
// Process-wide singleton. The session manager wraps a JSON file on disk and
// must be shared — every `new AgentSessionManager()` read/write the same file
// so instantiating many is wasteful and makes in-memory caching impossible
// if/when this class ever grows one.
let _sessionManager = null;
export function getAgentSessionManager() {
    if (!_sessionManager) {
        _sessionManager = new AgentSessionManager();
    }
    return _sessionManager;
}
