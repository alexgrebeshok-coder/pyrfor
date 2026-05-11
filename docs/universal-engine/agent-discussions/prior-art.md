Agent completed. agent_id: prior-art, agent_type: research, status: completed, description: Prior art autonomous agents, elapsed: 676s, total_turns: 0, model: gpt-5.4, duration: 671s

# Pyrfor Universal Engine: Prior Art Map (2025–2026)

## Executive synthesis

No existing agent stack fully closes the loop from **user concept → decomposition → tool discovery → tool synthesis → implementation → testing → deployment → durable operation**. The strongest coding agents (OpenHands, SWE-agent, Devin, Cursor, Claude Code, Aider) are best at **repo-grounded software work**, but are weaker on **durable workflows, persistent strategic memory, and governed cross-tool autonomy**. The strongest orchestration frameworks (LangGraph, AutoGen, CrewAI, Temporal, Restate, Inngest, Hatchet) are best at **durability, state, retries, and resume**, but do not themselves solve autonomous planning or verification. The strongest tool-synthesis work (Voyager, Cradle, Toolformer, Gorilla, ToolLLM, Riza’s self-learning-agent demo) shows that agents can **build or select tools**, but most systems still underinvest in **regression prevention**; the strongest recurring pattern is “generated tool + executable evaluation + memory of successful skills” rather than one-shot code generation. The best verifier patterns are not purely verbal: the most robust systems combine **LLM critique** with **executable acceptance tests**, **search/self-consistency**, and **durable replayable runs**. The main design gap Pyrfor must explicitly solve is **safe, durable, test-first autonomy across heterogeneous tool ecosystems**.

---

## 1) Systems for “universal autonomous deliverable”: what each does well, and where each fails

| System | What it does well | Where it fails for a universal end-to-end deliverable engine |
|---|---|---|
| **AutoGPT** (`Significant-Gravitas/AutoGPT`) | Strong on **workflow automation productization**: agent builder, workflow blocks, deployment controls, marketplace, and separate benchmark tooling via `agbenchmark` and Agent Protocol ([repo](https://github.com/Significant-Gravitas/AutoGPT), [docs](https://docs.agpt.co), [Agent Protocol](https://agentprotocol.ai/)). | Today’s platform emphasis is **automation workflows**, not a best-in-class repo-grounded software-delivery engine; coding/benchmark pieces exist, but the product center of gravity is workflow automation, not universal tested deliverables ([repo](https://github.com/Significant-Gravitas/AutoGPT)). |
| **BabyAGI** (`yoheinakajima/babyagi`) | Important prior art for **self-building function graphs**: `functionz`, dependency graphing, triggers, packs, and experimental self-building code-writing functions ([repo](https://github.com/yoheinakajima/babyagi)). | The author explicitly says it is **experimental**, “not meant for production use,” and generated code is “minimal and may need improvement” ([repo](https://github.com/yoheinakajima/babyagi)). Great idea seed; not a production architecture. |
| **OpenHands / OpenDevin** (`All-Hands-AI/OpenHands`) | Best open-source template for a **general software agent product**: SDK, CLI, local GUI, cloud, enterprise, and strong SWE-bench performance; built for local and cloud scaling ([repo](https://github.com/All-Hands-AI/OpenHands), [docs](https://docs.openhands.dev/sdk)). | Still primarily **AI-driven development**, not a universal business-process + coding + deployment + long-memory platform. It solves software tasks well, but Pyrfor needs broader deliverable orchestration. |
| **Devin** | Clear prior art for **long-horizon software autonomy** with browser, shell, editor, sandbox, progress reporting, and collaborative review loop ([Introducing Devin](https://www.cognition.ai/blog/introducing-devin)). | Closed system; limited inspectability of planner, verifier, memory, and rollback mechanisms. Public benchmark claims are older and narrower than the universal-deliverable target ([Introducing Devin](https://www.cognition.ai/blog/introducing-devin)). |
| **SWE-agent** | Strongest open prior art for **repo-grounded issue resolution** with tool use, YAML-configurable behavior, and explicit SWE-bench orientation ([repo](https://github.com/princeton-nlp/SWE-agent), [paper: *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*](https://arxiv.org/abs/2405.15793), [SWE-bench](https://swebench.com/)). | Excellent for **issue-fixing**, weaker for ambiguous “build me a whole product” starting from concept; it is benchmark-shaped around issue resolution rather than full product lifecycle. |
| **MetaGPT** (`FoundationAgents/MetaGPT`) | Best-known prior art for **role-specialized software-company simulation**: PM, architect, PM, engineer, SOP-driven decomposition from one-line requirement to repo/artifacts ([repo](https://github.com/FoundationAgents/MetaGPT), [paper: *MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework*](https://openreview.net/forum?id=VtmBAGCN7o)). | Heavy on role-play and artifact generation; weaker evidence on hardened, regression-safe real-world execution than coding-agent stacks. Good decomposition, weaker operational grounding. |
| **AutoGen** (`microsoft/autogen`) | Strong framework prior art for **event-driven multi-agent systems**, with AgentChat, Core, extensions, MCP support, and Docker code execution ([docs](https://microsoft.github.io/autogen/stable/), [repo](https://github.com/microsoft/autogen)). | It is a **framework**, not an opinionated universal engine. You still need to design planner/verifier/memory/safety/durability yourself. |
| **CrewAI** (`crewAIInc/crewAI`) | Strong on **production-friendly orchestration**: agents, crews, flows, guardrails, memory, knowledge, observability, triggers, state, and enterprise automations ([docs](https://docs.crewai.com/), [Flows](https://docs.crewai.com/en/concepts/flows), [repo](https://github.com/crewAIInc/crewAI)). | Better as an orchestration shell than as a universal autonomous builder. Verification, tool synthesis, and hard failure recovery still need custom architecture. |
| **LangGraph** (`langchain-ai/langgraph`) | Best open prior art for **durable, stateful agent graphs**: durable execution, HITL interrupts, memory, long-running workflows, and deployment visibility ([repo](https://github.com/langchain-ai/langgraph)). | Intentionally low-level; it gives Pyrfor the substrate, not the product logic. It does not answer “how should the agent plan/verify/build tools?” |
| **Cursor agents** | Strong product prior art for **parallel autonomous coding surfaces**: agents run on their own machines, build/test/demo end-to-end, and work in terminal, Slack, and GitHub ([features](https://cursor.com/features)). | Primarily a coding surface, not a durable autonomous platform with explicit memory architecture, workflow replay, or open verifier design. |
| **Aider** (`Aider-AI/aider`) | Best prior art for **tight git-centered edit/test loop**: repo map, automatic commits, auto-lint, auto-test, and surgical code editing ([repo](https://github.com/Aider-AI/aider), [lint/test docs](https://aider.chat/docs/usage/lint-test.html)). | Deliberately a **pair programmer**, not a universal multi-agent orchestrator. Excellent subcomponent, insufficient whole. |
| **Claude Code** | Strong prior art for **single-engine multi-surface coding**: CLI, VS Code, Cursor extension, desktop, web, GitHub Actions, channels, routines, agent SDK, shared CLAUDE.md and MCP across surfaces ([overview](https://docs.anthropic.com/en/docs/claude-code/overview)). | Mainly optimized for coding workflows; not an explicit durable multi-agent plan graph with formal rollback/compensation semantics. |
| **smolagents** (`huggingface/smolagents`) | Excellent prior art for **small, hackable code-first agents** with MCP support and multiple sandbox backends (E2B, Modal, Docker, Pyodide+Deno) ([repo](https://github.com/huggingface/smolagents), [docs](https://huggingface.co/docs/smolagents)). | Great building block; intentionally minimal. Not a full universal engine. |
| **Manus** | Strong prior art for **broad task delegation**: browser operator, wide research via parallel multi-agent orchestration, and conversational full-stack app building with code export ([webapp](https://manus.im/features/webapp), [browser operator](https://manus.im/features/manus-browser-operator), [wide research](https://manus.im/features/wide-research)). | Closed and lightly auditable; public materials emphasize product experience over inspectable planner/verifier/runtime details. Useful directional prior art, weak systems transparency. |

### Bottom line from section 1

The closest “universal deliverable” prototypes are **OpenHands + Devin + Manus**, but each is missing something Pyrfor needs:
- **OpenHands/SWE-agent**: strongest open coding execution.
- **Cursor/Claude Code/Aider**: strongest human-loop developer ergonomics.
- **LangGraph/Temporal/Restate**: strongest durability.
- **MetaGPT/CrewAI/AutoGen**: strongest orchestration patterns.
- **Manus**: strongest broad delegation UX.
- None unify all of them.

---

## 2) Tool synthesis / “agents that build their own tools”

### The strongest prior art patterns

| Pattern | Core idea | Validation pattern | Regression prevention lesson |
|---|---|---|---|
| **Voyager** — *An Open-Ended Embodied Agent with Large Language Models* | Build an **ever-growing skill library of executable code**, retrieved by task similarity, with automatic curriculum and iterative prompting ([paper site](https://voyager.minedojo.org/), [ICLR journal track](https://openreview.net/forum?id=ehfRiF0R3a)). | Uses **environment feedback**, **execution errors**, and **self-verification** to improve programs before storing mastered skills ([Voyager](https://voyager.minedojo.org/)). | Don’t just store text memories; store **validated executable skills** with retrieval metadata. |
| **Cradle** — *Empowering Foundation Agents Towards General Computer Control* | Computer-use agent with **skill curation**, self-reflection prompts, and auto-generated skill JSON over a unified screenshot→mouse/keyboard interface ([repo](https://github.com/BAAI-Agents/Cradle), [paper](https://arxiv.org/abs/2403.03186)). | Public repo shows **self_reflection** and skill registries, but less formal public evidence on regression harnesses than Voyager/ToolLLM ([repo](https://github.com/BAAI-Agents/Cradle)). | Tool-synthesis for computer use needs **skill registries + reflection**, but Pyrfor should add stronger automated regression checks. |
| **Toolformer** — *Toolformer: Language Models Can Teach Themselves to Use Tools* | Self-supervised learning of **when to call tools, which API, and with what arguments** from a few demonstrations ([paper](https://arxiv.org/abs/2302.04761)). | Validation is mainly **improved downstream task performance**, not lifecycle management of generated tools ([paper](https://arxiv.org/abs/2302.04761)). | Great for tool-use policy learning, weaker for production tool lifecycle. |
| **Gorilla** — *Large Language Model Connected with Massive APIs* | Reduce hallucinated API use via **retrieval over API docs** and function-calling evaluation ([paper](https://arxiv.org/abs/2305.15334), [site](https://gorilla.cs.berkeley.edu/)). | Validation via **APIBench** and function-calling leaderboards; retrieval adapts to changing docs ([paper](https://arxiv.org/abs/2305.15334), [site](https://gorilla.cs.berkeley.edu/)). | For tool synthesis/discovery, ground models in **live docs/retrieval**, not static prompt memory. |
| **ToolLLM / ToolBench / ToolEval** | Build/tool-select over **16k+ real APIs**, annotate solution paths, use DFS over decision trees, and automatically evaluate tool use ([paper](https://arxiv.org/abs/2307.16789), [OpenReview](https://openreview.net/forum?id=dHng2O0Jjr)). | Strongest explicit validation pattern here: **ToolEval** + OOD generalization to unseen APIs ([paper](https://arxiv.org/abs/2307.16789)). | Pyrfor should have a **ToolEval-like harness** for every generated tool. |
| **LATM / LLMs as Tool Makers** | Separate **tool maker** and **tool user**; build reusable tools once, then amortize them across future tasks ([paper: *LLMs as Tool Makers*](https://arxiv.org/abs/2305.17126), [code](https://github.com/ctlllll/LLM-ToolMaker)). | Validation is task performance/cost tradeoff; the key systems idea is **functional caching** ([paper](https://arxiv.org/abs/2305.17126)). | Cache **functions**, not just answers. Pyrfor should persist reusable task-specific tools. |
| **Riza self-learning agent demo** | Start with only `create_tool` plus basic UX tools; agent writes TypeScript tools on demand, with JSON Schema input definitions, then executes them in Riza ([blog](https://riza.io/blog/self-learning-agent), [product](https://riza.io/)). | Generated tools must have **schema + executable code**, then run in isolated infra ([blog](https://riza.io/blog/self-learning-agent), [product](https://riza.io/)). | A minimal bootstrap set can be enough if the runtime safely supports **tool creation as a first-class action**. |

### OpenAI / MCP / marketplace patterns

- **OpenAI Agents SDK** treats tools as a first-class taxonomy: hosted tools, runtime tools, wrapped Python functions, agents-as-tools, and hosted MCP; it also adds **tool search** and **deferred loading** so the model loads only the relevant tool surface at runtime ([OpenAI Agents tools](https://openai.github.io/openai-agents-python/tools/), [Building agents](https://developers.openai.com/tracks/building-agents)).  
  **Lesson:** Pyrfor should separate **tool declaration**, **tool discovery**, and **tool loading**.

- **MCP** standardizes tool/data/workflow access as a universal connector protocol across clients and servers ([MCP intro](https://modelcontextprotocol.io/introduction), [Anthropic MCP launch](https://www.anthropic.com/news/model-context-protocol)).  
  **Lesson:** Pyrfor should prefer **protocol-level interoperability** over bespoke adapters.

- **OpenAI Apps SDK / MCP server pattern** makes tool servers explicit about **schemas, idempotent handlers, UI bundles, auth boundaries, structured output, and CSP allowlists** ([Apps SDK](https://developers.openai.com/apps-sdk/build/mcp-server)).  
  **Lesson:** Tool generation should emit not just code, but **schema, permissions, UI contract, and idempotency expectations**.

- **Smithery** shows the emerging **MCP marketplace** pattern: searchable servers, managed connections, OAuth/session lifecycle, tool introspection, token scoping, and request-level policy restriction ([Smithery](https://smithery.ai/)).  
  **Lesson:** Tool discovery is becoming a **marketplace/runtime concern**, not merely prompt engineering.

### What actually works for validation?

The strongest recurring patterns are:
1. **Executable environment feedback** (Voyager, Aider, SWE-bench, AlphaCodium).
2. **Schema-level validation** (OpenAI Apps SDK, Riza, MCP).
3. **Doc-grounded tool retrieval** (Gorilla).
4. **Explicit tool eval harnesses** (ToolEval).
5. **Persistent skill library of only successful tools** (Voyager).

The weak pattern is “generate a tool and trust it.”

---

## 3) Verifier patterns

### The best verification stack is layered

1. **Executable acceptance tests**
   - **Aider** can auto-run lint/test after every edit and attempt fixes on failures ([docs](https://aider.chat/docs/usage/lint-test.html)).
   - **SWE-bench** evaluates whether a generated patch actually resolves the issue in real repos ([SWE-bench](https://swebench.com/)).
   - **AlphaCodium** is explicitly **test-based**, multi-stage, and code-oriented; its gains come from flow engineering around tests, not a single better prompt ([paper: *Code Generation with AlphaCodium: From Prompt Engineering to Flow Engineering*](https://arxiv.org/abs/2401.08500)).

2. **LLM-as-judge with rubrics**
   - Langfuse’s docs capture the current production pattern: provide **criteria/rubric + input + output + optional reference**, get **structured score + reasoning**, and run it over observations, traces, or experiments ([Langfuse LLM-as-a-Judge](https://langfuse.com/docs/scores/model-based-evals)).
   - Best use: soft qualities (helpfulness, completeness, policy adherence), not source-of-truth correctness.

3. **Debate / critique**
   - **AI Safety via Debate** proposes adversarial two-agent argument with a judge ([paper](https://arxiv.org/abs/1805.00899)).
   - **Constitutional AI** uses self-critique and revision under explicit principles, then RLAIF ([paper](https://arxiv.org/abs/2212.08073)).
   - **Constitutional Classifiers** add input/output classifier defenses trained on synthetic constitutional data; Anthropic reports strong automated jailbreak reductions, but still notes limitations and later demo jailbreak successes ([research post](https://www.anthropic.com/research/constitutional-classifiers)).

4. **Search over multiple reasoning paths**
   - **Self-consistency** samples multiple chains and chooses the most consistent answer ([paper](https://arxiv.org/abs/2203.11171)).
   - **Tree of Thoughts** explicitly branches, self-evaluates, and backtracks ([paper](https://arxiv.org/abs/2305.10601)).
   - **ToolLLM** uses DFS-style decision-tree search over tool trajectories ([paper](https://arxiv.org/abs/2307.16789)).

5. **Reflection with memory**
   - **Reflexion** stores verbal reflections in episodic memory to improve subsequent attempts ([paper](https://arxiv.org/abs/2303.11366)).
   - Good for iterative repair; bad if reflections become noisy or stale.

6. **Property-based testing**
   - **Hypothesis** shows the gold-standard pattern for discovering edge cases by generating many valid inputs and shrinking failures to minimal counterexamples ([Hypothesis](https://hypothesis.works/)).
   - This is still underused in agent loops; Pyrfor should use it for generated parsers, transformers, planners, and tools.

### Design takeaway for Pyrfor

A strong verifier is not one thing; it is a **ladder**:
- **schema checks** → **unit/integration tests** → **property tests** → **LLM rubric judge** → **human approval for high-risk steps**.

---

## 4) Sandboxed code execution: trade-offs

| Runtime | Isolation model | Strengths | Weaknesses / fit |
|---|---|---|---|
| **E2B** | On-demand **Linux VMs** for agents ([docs](https://e2b.dev/docs)) | Agent-native, simple SDK, purpose-built for code/tool execution. | Adds vendor dependency; less low-level control than self-hosted microVMs. |
| **Modal Sandboxes** | Secure **containers** created at runtime ([docs](https://modal.com/docs/guide/sandbox)) | Good developer experience, volumes/images/readiness, timeouts, snapshots. | Strong product ergonomics; weaker isolation boundary than microVMs if your threat model is hostile code from the open web. |
| **Firecracker** | **MicroVMs** on KVM ([site](https://firecracker-microvm.github.io/)) | Strong tenant isolation, tiny footprint, fast start, proven in Lambda/Fargate. | More infra work; ideal for high-risk execution. |
| **gVisor** | User-space **application kernel** / OCI runtime ([docs](https://gvisor.dev/docs/)) | Stronger-than-container isolation with Docker/K8s compatibility. | Syscall-heavy workloads can pay overhead; compatibility lower than vanilla containers. |
| **Wasmtime / Wasmer** | **Wasm runtime** sandboxes ([Wasmtime](https://wasmtime.dev/), [Wasmer](https://wasmer.io/)) | Very strong confinement for supported workloads; excellent for portable, narrow tools. | Not a general “run arbitrary repo” answer; best for sandboxed toollets/plugins. |
| **Daytona** | Stateful AI-dev sandboxes / virtual desktops ([site](https://www.daytona.io/)) | Fast sandbox creation, file/git/LSP/execute APIs, Linux/macOS/Windows computer-use sandboxes. | Excellent agent runtime substrate; younger ecosystem than Docker/Firecracker. |
| **Riza** | API-first remote code execution ([site](https://riza.io/)) | Very fast startup, network/env controls, designed for agent-written code. | More execution API than full durable workflow system. |
| **Docker-in-Docker** | Nested privileged Docker daemon ([dind repo](https://github.com/jpetazzo/dind), [Docker security](https://docs.docker.com/engine/security/)) | Operationally familiar. | Weak security story for hostile workloads: `--privileged`, daemon attack surface, and explicit warnings from dind’s maintainer. Good CI hack; poor universal-agent security boundary. |

### Practical choice

- **Low-risk local dev / CI**: Modal or Docker.
- **Production agent code from untrusted instructions**: **Firecracker** or **gVisor**.
- **Portable fine-grained generated tools**: **Wasm**.
- **Computer use / interactive repos**: **Daytona** or similar stateful workspace runtime.
- **Agent-generated utility code at scale**: **Riza** or **E2B**-style execution services.

---

## 5) Plan graphs / durable workflows / resume & rollback

| System | What it contributes |
|---|---|
| **Temporal** | Best-in-class durable execution for application code: persists workflow state at each step, retries Activities, resumes exactly where it left off, supports long-running workflows and Sagas/compensations ([Temporal](https://temporal.io/)). |
| **Restate** | “Code your happy path” durable services/workflows/agents; stores progress and automatically resumes after failure, with durable steps via normal code ([Restate](https://restate.dev/)). |
| **Inngest** | Event-driven durable execution platform with steps, scheduling, concurrency, throttling, rate limiting, and observability ([docs](https://www.inngest.com/docs)). |
| **Hatchet** | Tasks/workflows as code with retries, dependencies, scheduling, and workers in your own infra ([site](https://hatchet.run/)). |
| **LangGraph** | Durable execution for agent graphs, persistent state, HITL interrupts, and memory for long-running agents ([repo](https://github.com/langchain-ai/langgraph)). |
| **CrewAI Flows** | Event-driven flows with state, listeners, branching, loops, and persisted flow state; useful app-layer workflow shell ([Flows](https://docs.crewai.com/en/concepts/flows)). |

### What Pyrfor should copy

- Use a **durable state machine / workflow runtime** for all side-effectful work.
- Separate:
  - **planner state**
  - **workspace state**
  - **tool side effects**
  - **human approvals**
- Model every real-world action as either:
  - **retryable**
  - **idempotent**
  - **compensatable**
  - or **approval-gated**

The key lesson from Temporal/Restate is that “agent loop” logic should not be ephemeral chat state; it should be **replayable program state**.

---

## 6) Memory architectures

### Strong prior art

- **MemGPT** frames memory as **virtual context management**, inspired by operating systems with multiple memory tiers and interrupts ([paper: *MemGPT: Towards LLMs as Operating Systems*](https://arxiv.org/abs/2310.08560)).
- **Letta** (formerly MemGPT) productizes this as **memory-first persistent agents** with long-lived identity, skills, subagents, and continual learning ([repo](https://github.com/letta-ai/letta), [site](https://www.letta.com/)).
- **Mem0** pushes a production memory layer with **multi-level memory (user/session/agent)**, **entity linking**, and **hybrid retrieval** (semantic + BM25 + entity matching) ([repo](https://github.com/mem0ai/mem0)).
- Classic conversational memory patterns still matter as baselines: raw history buffers are easy but token-expensive and degrade with scale ([Pinecone conversational memory overview](https://www.pinecone.io/learn/series/langchain/langchain-conversational-memory/)).

### The architecture Pyrfor should use

1. **Episodic memory**  
   Past runs, traces, failures, task history.  
   Prior art: Reflexion’s episodic buffer ([paper](https://arxiv.org/abs/2303.11366)).

2. **Semantic memory**  
   Facts about the user, product, codebase, dependencies, tool affordances.  
   Prior art: Mem0 hybrid/entity retrieval ([repo](https://github.com/mem0ai/mem0)).

3. **Strategic memory**  
   What plans worked, which decomposition patterns are reliable, which validators catch which failures.  
   This remains the least standardized and most important missing layer.

4. **Workspace memory**  
   Files, artifacts, open branches, deployment handles, env snapshots.

### Core lesson

Vector memory alone is not enough. The best pattern is a **vector + relational + artifact** hybrid:
- vectors for fuzzy recall,
- relational state for entities/IDs/dependencies,
- durable artifact store for prompts, plans, tools, tests, and outputs.

---

## 7) Multi-agent coordination protocols

### Coordination patterns that matter

- **Actor model / virtual actors**  
  Best for scalable concurrent stateful workers. Orleans shows the important property: actors/grains are always addressable, lifecycle-managed, and recoverable ([Orleans overview](https://learn.microsoft.com/en-us/dotnet/orleans/overview)).  
  **Use for**: long-lived specialists, per-project agents, per-tool supervisors.

- **Blackboard pattern**  
  Shared workspace where specialists contribute partial results.  
  **Use for**: research aggregation, design synthesis, evaluation fan-in.  
  **Risk**: context bloat and write contention.

- **Contract Net Protocol**  
  Manager broadcasts task, contractors bid, manager awards work ([overview](https://en.wikipedia.org/wiki/Contract_Net_Protocol), original paper cited there: Smith 1980).  
  **Use for**: dynamic worker selection when capabilities/costs vary.  
  **Risk**: too much negotiation overhead.

- **MCP**  
  Standard tool/data/workflow connectivity layer ([MCP](https://modelcontextprotocol.io/introduction)).  
  **Use for**: tool interoperability.

- **ACP**  
  Standard **agent-to-agent** communication via REST, supporting sync/async, discovery, long-running tasks, stateful/stateless patterns ([ACP](https://agentcommunicationprotocol.dev/)).  
  **Use for**: inter-agent interoperability across teams/frameworks.

### How to avoid infinite consultation and context bloat

Anthropic’s “Building Effective Agents” implicitly points to the right answer: use the **simplest pattern that works**, prefer workflows when possible, and cap agent loops with stopping conditions ([Building Effective Agents](https://www.anthropic.com/index/building-effective-agents)).

Pyrfor should enforce:
- **hard consultation budgets** (max subagents, max rounds, max tokens),
- **typed handoff artifacts** instead of raw transcripts,
- **summaries + evidence pointers**, not full chat replay,
- **single-writer ownership** for each mutable state area,
- **contract-net only for expensive/high-variance tasks**.

---

## 8) Safety patterns for autonomous agents

### High-value patterns

- **Capability-based security / least privilege**
  - Smithery’s **token scoping** and request-level restrictions are a strong concrete pattern: scope tokens by namespace/resource/operation/metadata and even RPC path ([Smithery](https://smithery.ai/)).
  - OpenAI Apps SDK emphasizes tool auth boundaries, CSP allowlists, and idempotent handlers ([Apps SDK MCP server guide](https://developers.openai.com/apps-sdk/build/mcp-server)).

- **Prompt-injection / jailbreak defenses**
  - Anthropic’s **many-shot jailbreaking** shows long-context prompt injection remains serious ([research](https://www.anthropic.com/research/many-shot-jailbreaking)).
  - **Constitutional Classifiers** show partial mitigation via synthetic classifier defenses, but not perfect immunity ([research](https://www.anthropic.com/research/constitutional-classifiers)).

- **Egress/network allowlists**
  - OpenAI Apps SDK requires explicit `connectDomains`, `resourceDomains`, `frameDomains` for app widgets ([Apps SDK MCP server guide](https://developers.openai.com/apps-sdk/build/mcp-server)).
  - Riza exposes per-execution network access configuration ([Riza](https://riza.io/)).

- **Budget controls / timeouts / stop conditions**
  - Modal Sandboxes support `timeout` and `idle_timeout` ([Modal Sandboxes](https://modal.com/docs/guide/sandbox)).
  - Anthropic’s agent guidance recommends explicit stopping conditions and max iterations for autonomous runs ([Building Effective Agents](https://www.anthropic.com/index/building-effective-agents)).

- **Tiered trust models**
  - Separate actions into:
    1. read-only,
    2. reversible writes,
    3. costly/externally visible writes,
    4. destructive or regulated actions.
  - Only the first class should be fully autonomous by default.

- **Human kill-switch / interruptibility**
  - LangGraph’s interrupts/HITL are a direct pattern ([repo](https://github.com/langchain-ai/langgraph)).
  - Durable runtimes make interruption meaningful because work can resume safely later.

### Safety conclusion

Pyrfor should assume:
- researched web content **will** contain prompt injection,
- generated tools **will** sometimes be wrong,
- some side effects **must not** be left to pure autonomy.

---

## 9) Open problems still unsolved in 2025–2026

1. **Reliable autonomy over long horizons is still fragile.**  
   Strong results exist on issue-fixing and bounded workflows, but not on truly open-ended “build the whole thing” tasks with consistent deployment-grade correctness ([SWE-bench](https://swebench.com/), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Devin](https://www.cognition.ai/blog/introducing-devin)).

2. **Tool synthesis is ahead of tool lifecycle management.**  
   Agents can now generate tools, but most systems do not yet enforce strong regression contracts, versioning, deprecation, rollback, and reuse quality control ([Voyager](https://voyager.minedojo.org/), [ToolLLM](https://arxiv.org/abs/2307.16789), [Riza self-learning agent](https://riza.io/blog/self-learning-agent)).

3. **Prompt injection from web/computer-use environments remains unresolved.**  
   Long context and browser/computer-use increase attack surface; even strong defenses remain imperfect ([many-shot jailbreaking](https://www.anthropic.com/research/many-shot-jailbreaking), [Constitutional Classifiers](https://www.anthropic.com/research/constitutional-classifiers), [Cradle](https://github.com/BAAI-Agents/Cradle), [Manus Browser Operator](https://manus.im/features/manus-browser-operator)).

4. **Memory quality is still the bottleneck, not memory quantity.**  
   Systems can store lots of data; deciding what to retain, update, forget, and elevate into strategy remains hard ([MemGPT](https://arxiv.org/abs/2310.08560), [Letta](https://www.letta.com/), [Mem0](https://github.com/mem0ai/mem0)).

5. **Benchmarks still undermeasure real deliverables.**  
   SWE-bench is about issue resolution, not UX, deployment health, stakeholder acceptance, or business validity ([SWE-bench](https://swebench.com/)). Pyrfor needs a broader eval harness.

6. **Interoperability is improving but still fragmented.**  
   MCP, ACP, provider-native tools, and marketplace systems overlap but do not yet yield a single universal control plane ([MCP](https://modelcontextprotocol.io/introduction), [ACP](https://agentcommunicationprotocol.dev/), [OpenAI Agents tools](https://openai.github.io/openai-agents-python/tools/), [Smithery](https://smithery.ai/)).

7. **Rollback/compensation for agent side effects is underdeveloped.**  
   Workflow engines solve this better than agent frameworks; most agent products still lack first-class compensation semantics ([Temporal](https://temporal.io/), [Restate](https://restate.dev/)).

8. **Parallel multi-agent systems still struggle with cost and context explosion.**  
   Manus explicitly markets “hundreds” of sub-agents for research, but broad evidence on governance and cost-quality scaling remains thin ([Wide Research](https://manus.im/features/wide-research)).

---

## 10) “What to steal from each” cheat sheet

- **AutoGPT** — steal the **workflow builder + benchmark separation**.  
- **BabyAGI** — steal the **function graph with dependencies/triggers**.  
- **OpenHands** — steal the **full product surface (SDK/CLI/GUI/cloud) around one core agent engine**.  
- **Devin** — steal the **progress-reporting collaborative autonomy loop**.  
- **SWE-agent** — steal the **repo-grounded issue-solving discipline and benchmark-first culture**.  
- **MetaGPT** — steal the **role-specialized decomposition**, not the full role-play overhead.  
- **AutoGen** — steal the **event-driven multi-agent substrate** and extension model.  
- **CrewAI** — steal the **flows + guardrails + observability** packaging.  
- **LangGraph** — steal the **durable state graph with interrupts**.  
- **Cursor** — steal the **parallel autonomous workers with reviewable outputs**.  
- **Aider** — steal the **auto-commit + auto-lint + auto-test loop**.  
- **Claude Code** — steal the **same engine across terminal/editor/web/mobile + persistent project instructions**.  
- **smolagents** — steal the **code-first tool execution style and tiny hackable core**.  
- **Manus** — steal the **broad delegation UX** and **parallel subagent research pattern**.  
- **Voyager** — steal the **validated executable skill library**.  
- **Cradle** — steal the **computer-use skill registry + self-reflection scaffolding**.  
- **Toolformer** — steal the idea that **tool-use itself can be learned**, not just hardcoded.  
- **Gorilla** — steal **doc-grounded tool retrieval**.  
- **ToolLLM** — steal the **ToolEval-style automatic evaluator**.  
- **LATM** — steal **function/tool caching** as a reusable asset.  
- **OpenAI Agents / tool search** — steal **deferred tool loading + namespaces**.  
- **MCP** — steal **protocol-first interoperability**.  
- **ACP** — steal **agent-to-agent interoperability independent of framework**.  
- **Temporal** — steal **durable replayable workflow state**.  
- **Restate** — steal the **“write happy-path code, get durability underneath”** model.  
- **MemGPT / Letta** — steal **multi-tier memory with interrupts**.  
- **Mem0** — steal **hybrid retrieval with entity linking and multi-level memory**.  
- **Reflexion** — steal **episodic self-critique memory**.  
- **Tree of Thoughts / self-consistency** — steal **multiple-path verification before commitment**.  
- **AlphaCodium** — steal the **test-based multi-stage flow engineering**.  
- **Hypothesis** — steal **property-based edge-case generation for generated tools**.  
- **Firecracker / gVisor** — steal **real isolation boundaries**, not just containers.  
- **Smithery** — steal **scoped credentials and marketplace-style tool discovery**.

---

## Recommended Pyrfor synthesis

A credible Pyrfor architecture would combine:

1. **OpenHands/SWE-agent/Aider-style software execution**
2. **LangGraph or Temporal/Restate durability**
3. **Voyager-style validated skill library**
4. **MCP + ACP interoperability**
5. **Mem0/Letta-style multi-tier memory**
6. **AlphaCodium + Aider + Hypothesis verification**
7. **Firecracker/gVisor-class isolation**
8. **Smithery/OpenAI-style scoped tool discovery and loading**
9. **strict budget, trust tier, and HITL controls**

That combination is the clearest path beyond today’s “good coding agent” into a true **universal autonomous deliverable engine**.