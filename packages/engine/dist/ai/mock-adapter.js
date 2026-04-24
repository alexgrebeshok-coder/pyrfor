var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { addDays, format } from "date-fns";
import { applyAIProposal } from './action-engine';
import { attachRunGrounding } from './grounding';
const runStore = new Map();
const copy = {
    ru: {
        untitledRun: "AI Workspace Run",
        portfolioRun: "Портфельный бриф",
        projectRun: "Разбор проекта",
        tasksRun: "План задач",
        reportRun: "Черновик статуса",
        triageRun: "Разбор очереди задач",
        portfolioSummary: "Портфель держится на активных проектах, но зона риска остаётся в логистическом и северном контуре. Ниже кратко собраны самые заметные сигналы для управленческого решения.",
        projectSummary: "Проект требует точечного управленческого вмешательства: срок, бюджет и блокеры уже влияют на предсказуемость delivery. Ниже выделены основные узкие места и ближайшие действия.",
        taskPlanSummary: "Я собрал короткий план задач, который можно применить только после подтверждения. Он сфокусирован на ближайшей неделе и не меняет существующие сущности без approval.",
        reportSummary: "Ниже draft-версия статуса, которую можно использовать как основу для weekly update без ручного сбора всех сигналов.",
        triageSummary: "Очередь задач требует сортировки по блокерам и срокам. Я собрал краткий triage-пакет для текущего execution layer.",
        portfolioNextStep1: "Провести 20-минутный review по проектам со статусом at risk.",
        portfolioNextStep2: "Согласовать owner для просроченных задач на текущей неделе.",
        portfolioNextStep3: "Использовать статус-драфт как основу для weekly executive update.",
        projectNextStep1: "Закрепить один owner за главным blocker и обновить срок до конца дня.",
        projectNextStep2: "Сверить cash / budget variance перед следующим решением по приоритетам.",
        projectNextStep3: "Перевести AI proposal в реальные задачи только после проверки команды.",
        reportNextStep1: "Проверить цифры бюджета и health перед отправкой стейкхолдерам.",
        reportNextStep2: "Добавить один decision ask, если проект находится в зоне риска.",
        triageNextStep1: "Поднять blocked-задачи в отдельный ежедневный контроль.",
        triageNextStep2: "Перераспределить задачи с ближайшим сроком между доступными owners.",
        proposalTitle: "AI предлагает создать пакет задач",
        proposalSummary: "Пакет рассчитан на короткий recovery / execution cycle и не будет применён без вашего подтверждения.",
        updateProposalTitle: "AI предлагает обновить пакет задач",
        updateProposalSummary: "Изменения собраны как короткий execution patch и не будут применены без вашего подтверждения.",
        rescheduleProposalTitle: "AI предлагает пересобрать сроки задач",
        rescheduleProposalSummary: "Сдвиги по срокам подготовлены как управляемый replan и ждут approval.",
        riskProposalTitle: "AI предлагает поднять новые риски",
        riskProposalSummary: "Риски сформулированы для risk register и не будут внесены без подтверждения.",
        statusProposalTitle: "AI предлагает черновик статус-апдейта",
        statusProposalSummary: "Черновик статуса собран из текущих сигналов проекта и ждёт approval перед публикацией.",
        notifyProposalTitle: "AI предлагает уведомить команду",
        notifyProposalSummary: "Сообщения подготовлены для управляемой коммуникации и не будут отправлены без approval.",
        proposalReasonBlocked: "Снять blocker и вернуть поток в предсказуемый execution.",
        proposalReasonBudget: "Сверить бюджет и сроки до следующего управленческого окна.",
        proposalReasonReport: "Подготовить прозрачный статус для руководительского апдейта.",
        proposalReasonUpdate: "Уточнить owner, срок и приоритет до следующего execution review.",
        proposalReasonReschedule: "Пересобрать schedule вокруг blockеров и ближайших дедлайнов.",
        proposalReasonRisk: "Зафиксировать риск до того, как он уйдёт в скрытую зону.",
        proposalReasonNotify: "Синхронизировать команду вокруг следующего решения и окна исполнения.",
        reportAudience: "Руководство проекта",
        reportChannel: "weekly update",
        notifyChannel: "team-ops",
    },
    en: {
        untitledRun: "AI Workspace Run",
        portfolioRun: "Portfolio brief",
        projectRun: "Project diagnosis",
        tasksRun: "Task proposal pack",
        reportRun: "Status draft",
        triageRun: "Task triage",
        portfolioSummary: "The portfolio is carried by active workstreams, but the logistics and northern delivery tracks still concentrate most of the risk. The main management signals are summarized below.",
        projectSummary: "This project needs targeted intervention: schedule, budget, and blockers are already reducing delivery predictability. The main constraints and next moves are summarized below.",
        taskPlanSummary: "I prepared a short task package that can be applied only after explicit approval. It focuses on the next week and does not mutate existing entities automatically.",
        reportSummary: "Below is a draft status update that can be reused as the starting point for a weekly stakeholder report.",
        triageSummary: "The task queue needs triage around blockers and due dates. I assembled a compact execution package for the current task layer.",
        portfolioNextStep1: "Run a 20-minute review for every at-risk project.",
        portfolioNextStep2: "Assign a single owner to each overdue task this week.",
        portfolioNextStep3: "Use the status draft as the base for the executive weekly update.",
        projectNextStep1: "Assign one owner to the main blocker and refresh the due date today.",
        projectNextStep2: "Reconcile budget variance before the next prioritization decision.",
        projectNextStep3: "Apply the AI proposal only after the team reviews the task pack.",
        reportNextStep1: "Validate budget numbers and health before sending to stakeholders.",
        reportNextStep2: "Add one explicit decision ask if the project remains at risk.",
        triageNextStep1: "Track blocked tasks in a separate daily control loop.",
        triageNextStep2: "Rebalance the nearest due tasks across available owners.",
        proposalTitle: "AI suggests creating a task package",
        proposalSummary: "The package is designed for a short recovery / execution cycle and will not be applied without your approval.",
        updateProposalTitle: "AI suggests updating the task package",
        updateProposalSummary: "These changes are prepared as a short execution patch and will not be applied without approval.",
        rescheduleProposalTitle: "AI suggests rescheduling the task set",
        rescheduleProposalSummary: "The due date changes are prepared as a controlled replan and still require approval.",
        riskProposalTitle: "AI suggests raising new risks",
        riskProposalSummary: "The risks are drafted for the register and will not be recorded without approval.",
        statusProposalTitle: "AI suggests drafting a status update",
        statusProposalSummary: "The status draft is assembled from current project signals and waits for approval before sharing.",
        notifyProposalTitle: "AI suggests notifying the team",
        notifyProposalSummary: "The communication pack is prepared for a controlled rollout and will not be sent without approval.",
        proposalReasonBlocked: "Remove the blocker and return the workflow to predictable execution.",
        proposalReasonBudget: "Reconcile budget and schedule before the next decision window.",
        proposalReasonReport: "Prepare a transparent status update for leadership.",
        proposalReasonUpdate: "Tighten owner, due date, and priority before the next execution review.",
        proposalReasonReschedule: "Rebuild the schedule around blockers and the nearest deadlines.",
        proposalReasonRisk: "Log the risk before it turns into an unmanaged delivery problem.",
        proposalReasonNotify: "Align the team around the next decision and execution window.",
        reportAudience: "Project leadership",
        reportChannel: "weekly update",
        notifyChannel: "team-ops",
    },
    zh: {
        untitledRun: "AI Workspace Run",
        portfolioRun: "项目组合简报",
        projectRun: "项目诊断",
        tasksRun: "任务方案包",
        reportRun: "状态草稿",
        triageRun: "任务分流",
        portfolioSummary: "当前项目组合主要依赖活跃项目支撑，但物流与北方交付链路仍然聚集了大部分风险。下面汇总了最关键的管理信号。",
        projectSummary: "该项目需要定点干预：进度、预算和阻塞已经在削弱交付可预测性。下面是主要约束与下一步动作。",
        taskPlanSummary: "我准备了一组短周期任务方案，只会在你确认后应用。它聚焦未来一周，不会自动改写现有实体。",
        reportSummary: "下面是一份状态更新草稿，可以直接作为每周干系人汇报的起点。",
        triageSummary: "当前任务队列需要围绕阻塞与截止日期重新分流。我已经整理了一份紧凑的执行包。",
        portfolioNextStep1: "对所有风险中的项目进行 20 分钟管理复盘。",
        portfolioNextStep2: "为本周所有逾期任务指定唯一 owner。",
        portfolioNextStep3: "将状态草稿作为高层周报的基础版本。",
        projectNextStep1: "为主要 blocker 指定唯一 owner，并在今天更新目标日期。",
        projectNextStep2: "在下次优先级决策前核对预算偏差。",
        projectNextStep3: "仅在团队确认后再应用 AI 任务方案。",
        reportNextStep1: "发送给干系人前先确认预算和 health 数字。",
        reportNextStep2: "如果项目仍处于风险中，加入一个明确的决策请求。",
        triageNextStep1: "把 blocked 任务纳入单独的日控回路。",
        triageNextStep2: "在可用 owners 之间重分配最近到期的任务。",
        proposalTitle: "AI 建议创建一组任务",
        proposalSummary: "这组任务面向短周期恢复 / 执行，不会在未获批准前自动应用。",
        updateProposalTitle: "AI 建议更新任务包",
        updateProposalSummary: "这些变更被整理成短周期执行补丁，在批准前不会自动应用。",
        rescheduleProposalTitle: "AI 建议重排任务时间",
        rescheduleProposalSummary: "这些时间调整被作为可控 replan 准备好，仍需 approval。",
        riskProposalTitle: "AI 建议新增风险",
        riskProposalSummary: "这些风险已整理成 risk register 草稿，在批准前不会写入。",
        statusProposalTitle: "AI 建议生成状态更新草稿",
        statusProposalSummary: "状态草稿基于当前项目信号整理，在分享前仍需 approval。",
        notifyProposalTitle: "AI 建议通知团队",
        notifyProposalSummary: "沟通内容已准备为可控 rollout，在批准前不会发送。",
        proposalReasonBlocked: "解除 blocker，让执行流恢复可预测性。",
        proposalReasonBudget: "在下一个决策窗口前核对预算与进度。",
        proposalReasonReport: "为管理层准备透明的状态更新。",
        proposalReasonUpdate: "在下一次执行复盘前收紧 owner、日期和优先级。",
        proposalReasonReschedule: "围绕 blocker 和最近截止日期重排 schedule。",
        proposalReasonRisk: "在风险演变成失控交付问题前先记录下来。",
        proposalReasonNotify: "围绕下一次决策和执行窗口同步团队。",
        reportAudience: "项目管理层",
        reportChannel: "weekly update",
        notifyChannel: "team-ops",
    },
};
function createRunId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return `ai-run-${crypto.randomUUID()}`;
    }
    return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
}
function cloneRun(run) {
    return JSON.parse(JSON.stringify(run));
}
function resolveKind(input) {
    if (input.quickAction) {
        return input.quickAction.kind;
    }
    if ([
        "execution-planner",
        "resource-allocator",
        "timeline-optimizer",
    ].includes(input.agent.id) &&
        input.context.activeContext.type === "project") {
        return "suggest_tasks";
    }
    if ([
        "status-reporter",
        "telegram-bridge",
        "email-digest",
        "meeting-notes",
        "document-writer",
        "translator",
    ].includes(input.agent.id)) {
        return "draft_status_report";
    }
    if (["risk-researcher", "quality-guardian", "search-agent", "knowledge-keeper", "best-practices"].includes(input.agent.id)) {
        return input.context.activeContext.type === "tasks" ? "triage_tasks" : "analyze_project";
    }
    if (["budget-controller", "evm-analyst", "cost-predictor"].includes(input.agent.id)) {
        return "draft_status_report";
    }
    const prompt = input.prompt.toLowerCase();
    if (/task|задач|任务|plan|план/.test(prompt) && input.context.activeContext.type === "project") {
        return "suggest_tasks";
    }
    if (/report|status|отч[её]т|статус|报告/.test(prompt)) {
        return "draft_status_report";
    }
    if (input.context.activeContext.type === "tasks") {
        return "triage_tasks";
    }
    if (input.context.activeContext.type === "project") {
        return "analyze_project";
    }
    return "summarize_portfolio";
}
function getProjectSnapshot(context) {
    var _a;
    return ((_a = context.project) !== null && _a !== void 0 ? _a : (context.activeContext.projectId
        ? context.projects.find((project) => project.id === context.activeContext.projectId)
        : undefined));
}
function getProjectTasks(context, projectId) {
    return context.tasks.filter((task) => task.projectId === projectId);
}
function resolveProposalType(input, kind) {
    const prompt = input.prompt.toLowerCase();
    if (kind === "draft_status_report") {
        return "draft_status_report";
    }
    if (kind === "suggest_tasks") {
        if (/update|assign|priority|owner|обнови|переназнач|приоритет|调整/.test(prompt)) {
            return "update_tasks";
        }
        if (/resched|replan|move due|timeline|перенес|сдвиг|срок|重排|延期/.test(prompt)) {
            return "reschedule_tasks";
        }
        return "create_tasks";
    }
    if (/risk|risks|риск|риски|风险|blocker/.test(prompt) || kind === "analyze_project") {
        return "raise_risks";
    }
    if (/resched|replan|move due|timeline|перенес|сдвиг|срок|重排|延期/.test(prompt) ||
        kind === "triage_tasks") {
        return "reschedule_tasks";
    }
    if (/update|assign|priority|owner|обнови|переназнач|приоритет|调整/.test(prompt)) {
        return "update_tasks";
    }
    if (/notify|announce|message|команд|сообщ|уведом|通知/.test(prompt)) {
        return "notify_team";
    }
    return null;
}
function buildCreateTasksProposal(context) {
    var _a, _b, _c, _d, _e;
    const localeCopy = copy[context.locale];
    const project = getProjectSnapshot(context);
    if (!project)
        return null;
    const tasks = getProjectTasks(context, project.id);
    const openTasks = tasks.filter((task) => task.status !== "done");
    const primaryOwner = (_a = project.team[0]) !== null && _a !== void 0 ? _a : "Owner";
    const secondaryOwner = (_b = project.team[1]) !== null && _b !== void 0 ? _b : primaryOwner;
    const blockedTask = (_c = openTasks.find((task) => task.status === "blocked")) !== null && _c !== void 0 ? _c : openTasks[0];
    const latestRisk = context.risks.find((risk) => risk.projectId === project.id && risk.status === "open");
    return {
        id: `proposal-create-${project.id}`,
        type: "create_tasks",
        title: localeCopy.proposalTitle,
        summary: localeCopy.proposalSummary,
        state: "pending",
        tasks: [
            {
                projectId: project.id,
                title: blockedTask
                    ? `${blockedTask.title}: owner sync`
                    : `${project.name}: unblock main dependency`,
                description: (_d = blockedTask === null || blockedTask === void 0 ? void 0 : blockedTask.description) !== null && _d !== void 0 ? _d : localeCopy.proposalReasonBlocked,
                assignee: primaryOwner,
                dueDate: format(addDays(new Date(), 2), "yyyy-MM-dd"),
                priority: project.priority === "critical" ? "critical" : "high",
                reason: localeCopy.proposalReasonBlocked,
            },
            {
                projectId: project.id,
                title: `${project.name}: budget and milestone checkpoint`,
                description: (_e = latestRisk === null || latestRisk === void 0 ? void 0 : latestRisk.mitigation) !== null && _e !== void 0 ? _e : localeCopy.proposalReasonBudget,
                assignee: secondaryOwner,
                dueDate: format(addDays(new Date(), 4), "yyyy-MM-dd"),
                priority: "high",
                reason: localeCopy.proposalReasonBudget,
            },
            {
                projectId: project.id,
                title: `${project.name}: prepare decision update`,
                description: localeCopy.proposalReasonReport,
                assignee: primaryOwner,
                dueDate: format(addDays(new Date(), 6), "yyyy-MM-dd"),
                priority: "medium",
                reason: localeCopy.proposalReasonReport,
            },
        ],
    };
}
function buildUpdateTasksProposal(context) {
    var _a, _b;
    const localeCopy = copy[context.locale];
    const project = getProjectSnapshot(context);
    if (!project)
        return null;
    const openTasks = getProjectTasks(context, project.id).filter((task) => task.status !== "done");
    const primaryOwner = (_a = project.team[0]) !== null && _a !== void 0 ? _a : "Owner";
    const secondaryOwner = (_b = project.team[1]) !== null && _b !== void 0 ? _b : primaryOwner;
    const taskUpdates = openTasks.slice(0, 3).map((task, index) => {
        var _a, _b, _c;
        return ({
            taskId: task.id,
            title: task.title,
            description: (_a = task.blockedReason) !== null && _a !== void 0 ? _a : task.description,
            assignee: (_c = (_b = task.assignee) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : (index === 0 ? secondaryOwner : primaryOwner),
            dueDate: format(addDays(new Date(), index + 2), "yyyy-MM-dd"),
            priority: task.status === "blocked" ? "high" : task.priority,
            reason: localeCopy.proposalReasonUpdate,
        });
    });
    if (!taskUpdates.length) {
        return null;
    }
    return {
        id: `proposal-update-${project.id}`,
        type: "update_tasks",
        title: localeCopy.updateProposalTitle,
        summary: localeCopy.updateProposalSummary,
        state: "pending",
        tasks: [],
        taskUpdates,
    };
}
function buildRescheduleTasksProposal(context) {
    const localeCopy = copy[context.locale];
    const project = getProjectSnapshot(context);
    if (!project)
        return null;
    const projectTasks = getProjectTasks(context, project.id).filter((task) => task.status !== "done");
    const today = format(new Date(), "yyyy-MM-dd");
    const overdueTasks = projectTasks.filter((task) => task.dueDate <= today);
    const candidates = (overdueTasks.length ? overdueTasks : projectTasks).slice(0, 3);
    const taskReschedules = candidates.map((task, index) => {
        var _a, _b, _c, _d;
        return ({
            taskId: task.id,
            title: task.title,
            previousDueDate: task.dueDate,
            newDueDate: format(addDays(new Date(), index + 3), "yyyy-MM-dd"),
            assignee: (_d = (_c = (_b = (_a = task.assignee) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : project.team[index]) !== null && _c !== void 0 ? _c : project.team[0]) !== null && _d !== void 0 ? _d : "Owner",
            reason: localeCopy.proposalReasonReschedule,
        });
    });
    if (!taskReschedules.length) {
        return null;
    }
    return {
        id: `proposal-reschedule-${project.id}`,
        type: "reschedule_tasks",
        title: localeCopy.rescheduleProposalTitle,
        summary: localeCopy.rescheduleProposalSummary,
        state: "pending",
        tasks: [],
        taskReschedules,
    };
}
function buildRaiseRisksProposal(context) {
    var _a, _b;
    const localeCopy = copy[context.locale];
    const project = getProjectSnapshot(context);
    if (!project)
        return null;
    const openRisks = context.risks
        .filter((risk) => risk.projectId === project.id && risk.status === "open")
        .slice(0, 2)
        .map((risk) => ({
        projectId: project.id,
        title: risk.title,
        description: risk.mitigation,
        owner: risk.owner || project.team[0] || "Owner",
        probability: risk.probability,
        impact: risk.impact,
        mitigation: risk.mitigation,
        reason: localeCopy.proposalReasonRisk,
    }));
    const blockedTask = getProjectTasks(context, project.id).find((task) => task.status === "blocked");
    const risks = openRisks.length > 0
        ? openRisks
        : blockedTask
            ? [
                {
                    projectId: project.id,
                    title: `${project.name}: delivery slip risk`,
                    description: (_a = blockedTask.blockedReason) !== null && _a !== void 0 ? _a : blockedTask.description,
                    owner: (_b = project.team[0]) !== null && _b !== void 0 ? _b : "Owner",
                    probability: 75,
                    impact: 80,
                    mitigation: localeCopy.proposalReasonBlocked,
                    reason: localeCopy.proposalReasonRisk,
                },
            ]
            : [];
    if (!risks.length) {
        return null;
    }
    return {
        id: `proposal-risks-${project.id}`,
        type: "raise_risks",
        title: localeCopy.riskProposalTitle,
        summary: localeCopy.riskProposalSummary,
        state: "pending",
        tasks: [],
        risks,
    };
}
function buildStatusReportProposal(context) {
    var _a, _b;
    const localeCopy = copy[context.locale];
    const project = getProjectSnapshot(context);
    if (!project)
        return null;
    const openTasks = getProjectTasks(context, project.id).filter((task) => task.status !== "done");
    const blockedCount = openTasks.filter((task) => task.status === "blocked").length;
    const openRiskCount = context.risks.filter((risk) => risk.projectId === project.id && risk.status === "open").length;
    return {
        id: `proposal-report-${project.id}`,
        type: "draft_status_report",
        title: localeCopy.statusProposalTitle,
        summary: localeCopy.statusProposalSummary,
        state: "pending",
        tasks: [],
        statusReport: {
            projectId: project.id,
            title: `${project.name}: weekly status draft`,
            audience: localeCopy.reportAudience,
            channel: localeCopy.reportChannel,
            summary: `${project.name} is at ${project.progress}% progress with ${blockedCount} blocked tasks and ${openRiskCount} open risks.`,
            body: [
                `${project.name} currently tracks at ${project.progress}% progress and ${project.health}% health.`,
                `Open execution load: ${openTasks.length} tasks, ${blockedCount} blocked.`,
                `Risk posture: ${openRiskCount} open risks. Next milestone: ${(_b = (_a = project.nextMilestone) === null || _a === void 0 ? void 0 : _a.date) !== null && _b !== void 0 ? _b : project.dates.end}.`,
            ].join(" "),
            reason: localeCopy.proposalReasonReport,
        },
    };
}
function buildNotifyTeamProposal(context) {
    var _a, _b;
    const localeCopy = copy[context.locale];
    const project = getProjectSnapshot(context);
    if (!project)
        return null;
    const primaryOwner = (_a = project.team[0]) !== null && _a !== void 0 ? _a : "Owner";
    const secondaryOwner = (_b = project.team[1]) !== null && _b !== void 0 ? _b : primaryOwner;
    return {
        id: `proposal-notify-${project.id}`,
        type: "notify_team",
        title: localeCopy.notifyProposalTitle,
        summary: localeCopy.notifyProposalSummary,
        state: "pending",
        tasks: [],
        notifications: [
            {
                channel: localeCopy.notifyChannel,
                recipients: [primaryOwner, secondaryOwner].filter(Boolean),
                message: `${project.name}: sync on the main blocker, confirm owner, and refresh due dates before end of day.`,
                reason: localeCopy.proposalReasonNotify,
            },
            {
                channel: localeCopy.reportChannel,
                recipients: [localeCopy.reportAudience],
                message: `${project.name}: leadership summary is ready once the team confirms blocker status and next milestone confidence.`,
                reason: localeCopy.proposalReasonNotify,
            },
        ],
    };
}
function buildProposal(input, kind) {
    const proposalType = resolveProposalType(input, kind);
    switch (proposalType) {
        case "create_tasks":
            return buildCreateTasksProposal(input.context);
        case "update_tasks":
            return buildUpdateTasksProposal(input.context);
        case "reschedule_tasks":
            return buildRescheduleTasksProposal(input.context);
        case "raise_risks":
            return buildRaiseRisksProposal(input.context);
        case "draft_status_report":
            return buildStatusReportProposal(input.context);
        case "notify_team":
            return buildNotifyTeamProposal(input.context);
        default:
            return null;
    }
}
function buildHighlights(kind, context) {
    var _a, _b, _c, _d, _e, _f;
    const project = getProjectSnapshot(context);
    const openTasks = context.tasks.filter((task) => task.status !== "done");
    const overdueTasks = openTasks.filter((task) => task.dueDate <= format(new Date(), "yyyy-MM-dd"));
    const atRiskProjects = context.projects.filter((item) => item.status === "at-risk");
    if (kind === "summarize_portfolio") {
        return [
            `${context.projects.length} projects in scope, ${atRiskProjects.length} currently at risk.`,
            `${overdueTasks.length} overdue tasks require owner assignment this week.`,
            `Highest pressure point: ${(_d = (_b = (_a = atRiskProjects[0]) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : (_c = context.projects[0]) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : context.activeContext.title}.`,
        ];
    }
    if (kind === "triage_tasks") {
        return [
            `${overdueTasks.length} overdue tasks are competing with ${openTasks.length} active items.`,
            `${context.tasks.filter((task) => task.status === "blocked").length} tasks are blocked right now.`,
            `Best starting point: move one owner onto the nearest due critical item.`,
        ];
    }
    if (!project) {
        return [
            `No project snapshot found for ${context.activeContext.title}.`,
            `Run is limited to the current local dashboard state.`,
            `Switch to a project page for deeper analysis.`,
        ];
    }
    const projectTasks = context.tasks.filter((task) => task.projectId === project.id);
    const blockedCount = projectTasks.filter((task) => task.status === "blocked").length;
    const openRiskCount = context.risks.filter((risk) => risk.projectId === project.id && risk.status === "open").length;
    return [
        `${project.name}: health ${project.health}% with progress ${project.progress}%.`,
        `${projectTasks.filter((task) => task.status !== "done").length} open tasks, ${blockedCount} blocked.`,
        `${openRiskCount} open risks and next milestone ${(_f = (_e = project.nextMilestone) === null || _e === void 0 ? void 0 : _e.date) !== null && _f !== void 0 ? _f : project.dates.end}.`,
    ];
}
export function buildMockFinalRun(input, seed) {
    var _a, _b, _c, _d, _e;
    const localeCopy = copy[input.context.locale];
    const project = getProjectSnapshot(input.context);
    const kind = resolveKind(input);
    const timestamp = (_a = seed === null || seed === void 0 ? void 0 : seed.updatedAt) !== null && _a !== void 0 ? _a : new Date().toISOString();
    const baseRun = {
        id: (_b = seed === null || seed === void 0 ? void 0 : seed.id) !== null && _b !== void 0 ? _b : createRunId(),
        agentId: input.agent.id,
        title: localeCopy.untitledRun,
        prompt: input.prompt,
        quickActionId: (_c = seed === null || seed === void 0 ? void 0 : seed.quickActionId) !== null && _c !== void 0 ? _c : (_d = input.quickAction) === null || _d === void 0 ? void 0 : _d.id,
        status: "done",
        createdAt: (_e = seed === null || seed === void 0 ? void 0 : seed.createdAt) !== null && _e !== void 0 ? _e : timestamp,
        updatedAt: timestamp,
        context: input.context.activeContext,
    };
    const titles = {
        summarize_portfolio: localeCopy.portfolioRun,
        analyze_project: localeCopy.projectRun,
        suggest_tasks: localeCopy.tasksRun,
        draft_status_report: localeCopy.reportRun,
        triage_tasks: localeCopy.triageRun,
    };
    const summaries = {
        summarize_portfolio: localeCopy.portfolioSummary,
        analyze_project: localeCopy.projectSummary,
        suggest_tasks: localeCopy.taskPlanSummary,
        draft_status_report: localeCopy.reportSummary,
        triage_tasks: localeCopy.triageSummary,
    };
    const nextSteps = {
        summarize_portfolio: [
            localeCopy.portfolioNextStep1,
            localeCopy.portfolioNextStep2,
            localeCopy.portfolioNextStep3,
        ],
        analyze_project: [
            localeCopy.projectNextStep1,
            localeCopy.projectNextStep2,
            localeCopy.projectNextStep3,
        ],
        suggest_tasks: [
            localeCopy.projectNextStep1,
            localeCopy.projectNextStep2,
            localeCopy.projectNextStep3,
        ],
        draft_status_report: [localeCopy.reportNextStep1, localeCopy.reportNextStep2],
        triage_tasks: [localeCopy.triageNextStep1, localeCopy.triageNextStep2],
    };
    const proposal = buildProposal(input, kind);
    const summarySuffix = project && kind !== "summarize_portfolio" && kind !== "triage_tasks"
        ? ` ${project.name}.`
        : "";
    return Object.assign(Object.assign({}, baseRun), { title: titles[kind], status: proposal ? "needs_approval" : "done", updatedAt: timestamp, result: attachRunGrounding({
            title: titles[kind],
            summary: `${summaries[kind]}${summarySuffix}`,
            highlights: buildHighlights(kind, input.context),
            nextSteps: [...nextSteps[kind]],
            proposal,
        }, input) });
}
export function applyMockProposal(run, proposalId) {
    return applyAIProposal(run, proposalId);
}
export function createMockAIAdapter() {
    return {
        mode: "mock",
        runAgent(input) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                const now = new Date().toISOString();
                const runId = createRunId();
                const run = {
                    id: runId,
                    agentId: input.agent.id,
                    title: copy[input.context.locale].untitledRun,
                    prompt: input.prompt,
                    quickActionId: (_a = input.quickAction) === null || _a === void 0 ? void 0 : _a.id,
                    status: "queued",
                    createdAt: now,
                    updatedAt: now,
                    context: input.context.activeContext,
                };
                runStore.set(runId, {
                    input,
                    startedAt: Date.now(),
                    run,
                });
                return cloneRun(run);
            });
        },
        getRun(runId) {
            return __awaiter(this, void 0, void 0, function* () {
                const entry = runStore.get(runId);
                if (!entry) {
                    throw new Error(`AI run ${runId} not found`);
                }
                const elapsed = Date.now() - entry.startedAt;
                if (elapsed < 550) {
                    return cloneRun(Object.assign(Object.assign({}, entry.run), { status: "queued", updatedAt: new Date().toISOString() }));
                }
                if (elapsed < 1800) {
                    return cloneRun(Object.assign(Object.assign({}, entry.run), { status: "running", updatedAt: new Date().toISOString() }));
                }
                if (!entry.finalRun) {
                    const finalRun = buildMockFinalRun(entry.input);
                    finalRun.id = entry.run.id;
                    finalRun.createdAt = entry.run.createdAt;
                    finalRun.quickActionId = entry.run.quickActionId;
                    entry.finalRun = finalRun;
                }
                return cloneRun(entry.finalRun);
            });
        },
        applyProposal(_a) {
            return __awaiter(this, arguments, void 0, function* ({ proposalId, runId }) {
                const entry = runStore.get(runId);
                if (!entry) {
                    throw new Error(`AI run ${runId} not found`);
                }
                if (!entry.finalRun) {
                    entry.finalRun = buildMockFinalRun(entry.input);
                    entry.finalRun.id = entry.run.id;
                    entry.finalRun.createdAt = entry.run.createdAt;
                }
                entry.finalRun = applyMockProposal(entry.finalRun, proposalId);
                return cloneRun(entry.finalRun);
            });
        },
    };
}
