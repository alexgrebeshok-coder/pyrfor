export type ClarificationStopReason =
  | 'resolved'
  | 'max_rounds'
  | 'non_interactive'
  | 'trivially_clear';

export type ClarificationDimension = 'scope' | 'ambiguity' | 'constraint' | 'priority';

export interface ClarificationQuestion {
  id: string;
  dimension: ClarificationDimension;
  prompt: string;
  defaultAnswer: string;
  required: boolean;
}

export interface ClarificationRound {
  round: number;
  questions: ClarificationQuestion[];
  answers: Record<string, string>;
  skipped: boolean;
}

export interface ClarificationResult {
  originalConcept: string;
  refinedConcept: string;
  rounds: ClarificationRound[];
  stoppedAt: ClarificationStopReason;
  totalRounds: number;
}

export interface ClarificationNeededResult {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
  clarity: number;
}

export interface ClarificationAdapter {
  ask(questions: ClarificationQuestion[]): Promise<Record<string, string> | null>;
}

export interface ConceptClarifierDeps {
  adapter: ClarificationAdapter;
  maxRounds?: number;
  nonInteractive?: boolean;
}

const MAX_ROUNDS_HARD_CAP = 3;
const MAX_QUESTIONS_PER_ROUND = 3;
const CLARITY_THRESHOLD = 0.75;

const VERB_RE = /\b(build|implement|create|design|research|analyze|analyse|fix|refactor|migrate|test|verify|document)\b/i;
const SCOPE_RE = /\b(api|service|cli|module|component|database|workflow|planner|researcher|test|suite|integration|feature|app)\b/i;
const ACCEPTANCE_RE = /\b(so that|in order to|which allows|acceptance|must|should|verify|test|without|with)\b/i;
const AMBIGUOUS_PRONOUN_RE = /\b(it|this|that|thing|stuff|something)\b/gi;

export function scoreClarify(concept: string): ClarificationNeededResult {
  const trimmed = concept.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasVerb = VERB_RE.test(trimmed);
  const hasScope = SCOPE_RE.test(trimmed);
  const hasAcceptance = ACCEPTANCE_RE.test(trimmed);
  const ambiguousMatches = trimmed.match(AMBIGUOUS_PRONOUN_RE) ?? [];
  const contradictoryScope = /\bsimple\b/i.test(trimmed) && /\b(enterprise|distributed|production-grade|mission-critical)\b/i.test(trimmed);

  let clarity = 0;
  if (hasVerb) clarity += 0.2;
  if (hasScope) clarity += 0.2;
  if (words.length >= 8 && words.length <= 60) clarity += 0.15;
  if (hasAcceptance) clarity += 0.15;
  if (ambiguousMatches.length <= 2) clarity += 0.1;
  if (!contradictoryScope) clarity += 0.1;
  if (hasVerb && hasScope && words.length >= 4) clarity += 0.1;
  clarity = Math.max(0, Math.min(1, Number(clarity.toFixed(2))));

  const questions = buildQuestions({ hasVerb, hasScope, hasAcceptance, contradictoryScope, ambiguousMatches });
  return {
    needsClarification: clarity < CLARITY_THRESHOLD,
    questions: clarity < CLARITY_THRESHOLD ? questions : [],
    clarity,
  };
}

export class ConceptClarifier {
  private readonly adapter: ClarificationAdapter;
  private readonly maxRounds: number;
  private readonly nonInteractive: boolean;

  constructor(deps: ConceptClarifierDeps) {
    this.adapter = deps.adapter;
    this.maxRounds = Math.max(1, Math.min(Math.floor(deps.maxRounds ?? 2), MAX_ROUNDS_HARD_CAP));
    this.nonInteractive = deps.nonInteractive ?? false;
  }

  async clarify(concept: string): Promise<ClarificationResult> {
    const originalConcept = concept.trim();
    const initial = scoreClarify(originalConcept);
    if (!initial.needsClarification) {
      return {
        originalConcept,
        refinedConcept: originalConcept,
        rounds: [],
        stoppedAt: 'trivially_clear',
        totalRounds: 0,
      };
    }

    if (this.nonInteractive) {
      return {
        originalConcept,
        refinedConcept: appendAnswers(originalConcept, defaultsFor(initial.questions)),
        rounds: [],
        stoppedAt: 'non_interactive',
        totalRounds: 0,
      };
    }

    let refinedConcept = originalConcept;
    const rounds: ClarificationRound[] = [];

    for (let round = 0; round < this.maxRounds; round += 1) {
      const scored = scoreClarify(refinedConcept);
      if (!scored.needsClarification || scored.questions.length === 0) {
        return {
          originalConcept,
          refinedConcept,
          rounds,
          stoppedAt: 'resolved',
          totalRounds: rounds.length,
        };
      }

      const questions = scored.questions
        .map((question) => ({ ...question, id: `${question.dimension}:${round}` }))
        .slice(0, MAX_QUESTIONS_PER_ROUND);
      const adapterAnswers = await this.adapter.ask(questions);
      if (adapterAnswers === null) {
        const answers = defaultsFor(questions);
        rounds.push({ round, questions, answers, skipped: true });
        return {
          originalConcept,
          refinedConcept: appendAnswers(refinedConcept, answers),
          rounds,
          stoppedAt: 'non_interactive',
          totalRounds: rounds.length,
        };
      }

      const answers = { ...defaultsFor(questions), ...nonEmptyAnswers(adapterAnswers) };
      const nextConcept = appendAnswers(refinedConcept, answers);
      rounds.push({ round, questions, answers, skipped: false });

      if (nextConcept === refinedConcept || requiredAnswered(questions, answers)) {
        return {
          originalConcept,
          refinedConcept: nextConcept,
          rounds,
          stoppedAt: 'resolved',
          totalRounds: rounds.length,
        };
      }
      refinedConcept = nextConcept;
    }

    return {
      originalConcept,
      refinedConcept,
      rounds,
      stoppedAt: 'max_rounds',
      totalRounds: rounds.length,
    };
  }
}

function buildQuestions(input: {
  hasVerb: boolean;
  hasScope: boolean;
  hasAcceptance: boolean;
  contradictoryScope: boolean;
  ambiguousMatches: string[];
}): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  if (!input.hasScope || input.ambiguousMatches.length > 0) {
    questions.push(question('scope', 'What is the smallest concrete scope that should be delivered?', true));
  }
  if (!input.hasVerb || input.ambiguousMatches.length > 2) {
    questions.push(question('ambiguity', 'Which interpretation of the request should be used?', true));
  }
  if (input.contradictoryScope) {
    questions.push(question('constraint', 'Which hard constraints override the conflicting scope signals?', true));
  }
  if (!input.hasAcceptance) {
    questions.push(question('priority', 'What outcome should be prioritized if trade-offs are required?', false));
  }
  return questions
    .sort((a, b) => Number(b.required) - Number(a.required))
    .slice(0, MAX_QUESTIONS_PER_ROUND);
}

function question(dimension: ClarificationDimension, prompt: string, required: boolean): ClarificationQuestion {
  const defaults: Record<ClarificationDimension, string> = {
    scope: 'Limit scope to the smallest safe deliverable that satisfies the request.',
    ambiguity: 'Use the most common interpretation and record assumptions.',
    constraint: 'Prefer reversible local changes with no external side effects.',
    priority: 'Prioritize safety, correctness, and tests.',
  };
  return {
    id: `${dimension}:0`,
    dimension,
    prompt,
    defaultAnswer: defaults[dimension],
    required,
  };
}

function defaultsFor(questions: ClarificationQuestion[]): Record<string, string> {
  return Object.fromEntries(questions.map((question) => [question.id, question.defaultAnswer]));
}

function nonEmptyAnswers(answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).filter(([, value]) => value.trim().length > 0));
}

function requiredAnswered(questions: ClarificationQuestion[], answers: Record<string, string>): boolean {
  return questions.every((question) => !question.required || Boolean(answers[question.id]?.trim()));
}

function appendAnswers(concept: string, answers: Record<string, string>): string {
  const answerLines = Object.values(answers).filter((answer) => answer.trim().length > 0);
  if (answerLines.length === 0) return concept;
  return `${concept}\n\nClarifications:\n${answerLines.map((answer) => `- ${answer}`).join('\n')}`;
}
