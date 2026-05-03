// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIRunInput, AIRunResult } from './types';

vi.mock('server-only', () => ({}));
vi.mock('./memory/agent-memory-store', () => ({
  buildMemoryContext: vi.fn(async () => 'memory context'),
  storeMemory: vi.fn(async () => 'memory-1'),
}));
vi.mock('./rag/document-indexer', () => ({
  buildRAGContext: vi.fn(async () => ''),
}));

import { buildMemoryContext, storeMemory } from './memory/agent-memory-store';
import { buildAugmentedPromptForTest, rememberResultForTest } from './multi-agent-runtime';

const mockedBuildMemoryContext = vi.mocked(buildMemoryContext);
const mockedStoreMemory = vi.mocked(storeMemory);

describe('multi-agent runtime memory scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes workspaceId when reading project memory for prompts', async () => {
    const input = runInput();

    await buildAugmentedPromptForTest(input, 'Investigate memory');

    expect(mockedBuildMemoryContext).toHaveBeenCalledWith('agent-1', 'Investigate memory', {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      limit: 5,
    });
  });

  it('passes workspaceId when writing project-scoped run memory', async () => {
    const input = runInput();
    const result = { title: 'Done', summary: 'Completed project work' } as AIRunResult;

    await rememberResultForTest(input, result);

    expect(mockedStoreMemory).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      content: 'Completed project work',
    }));
  });
});

function runInput(): AIRunInput {
  return {
    agent: {
      id: 'agent-1',
      kind: 'analyst',
      nameKey: 'ai.agent.analyst.name',
      accentClass: '',
      icon: '',
      category: 'strategic',
    },
    prompt: 'Prompt',
    workspaceId: 'workspace-1',
    context: {
      locale: 'en',
      interfaceLocale: 'en',
      generatedAt: '2026-05-01T00:00:00.000Z',
      activeContext: {
        type: 'project',
        pathname: '/projects/project-1',
        title: 'Project',
        subtitle: '',
        projectId: 'project-1',
      },
      projects: [],
      tasks: [],
      team: [],
      risks: [],
      notifications: [],
    },
  } as AIRunInput;
}
