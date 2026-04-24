/**
 * AI Tool Definitions — OpenAI function calling format
 *
 * These tools enable the AI to directly create/modify resources
 * in the CEOClaw database through structured function calls.
 */
export const AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "create_task",
            description: "Create a new task in a project. Use when the user asks to add, create, or schedule a task.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Task title — short, actionable description",
                    },
                    description: {
                        type: "string",
                        description: "Detailed task description (optional)",
                    },
                    projectId: {
                        type: "string",
                        description: "Project ID to add the task to. If unknown, use the first available project.",
                    },
                    priority: {
                        type: "string",
                        enum: ["low", "medium", "high", "critical"],
                        description: "Task priority level. Default: medium",
                    },
                    dueDate: {
                        type: "string",
                        description: "Due date in ISO 8601 format (optional)",
                    },
                    status: {
                        type: "string",
                        enum: ["todo", "in_progress", "in_review", "done"],
                        description: "Initial task status. Default: todo",
                    },
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_risk",
            description: "Register a new project risk. Use when the user mentions a problem, threat, blocker, or concern.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Risk title — concise description of the threat",
                    },
                    description: {
                        type: "string",
                        description: "Detailed risk description and context",
                    },
                    projectId: {
                        type: "string",
                        description: "Project ID this risk belongs to",
                    },
                    severity: {
                        type: "string",
                        enum: ["low", "medium", "high", "critical"],
                        description: "Risk severity. Default: medium",
                    },
                    probability: {
                        type: "string",
                        enum: ["low", "medium", "high"],
                        description: "Probability of occurrence. Default: medium",
                    },
                    mitigation: {
                        type: "string",
                        description: "Proposed mitigation strategy (optional)",
                    },
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "update_task",
            description: "Update an existing task (change status, priority, due date, etc). Use when user asks to mark done, change priority, reschedule.",
            parameters: {
                type: "object",
                properties: {
                    taskId: {
                        type: "string",
                        description: "ID of the task to update",
                    },
                    title: { type: "string", description: "New title (optional)" },
                    status: {
                        type: "string",
                        enum: ["todo", "in_progress", "in_review", "done", "blocked"],
                    },
                    priority: {
                        type: "string",
                        enum: ["low", "medium", "high", "critical"],
                    },
                    dueDate: {
                        type: "string",
                        description: "New due date in ISO 8601 format",
                    },
                    description: { type: "string" },
                },
                required: ["taskId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_project_summary",
            description: "Get a summary of a project including task counts, risks, and progress. Use for status questions.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Project ID. If not specified, returns summary of all projects.",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_tasks",
            description: "List tasks with optional filters. Use when user asks about tasks, what needs to be done, what's overdue.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Filter by project ID (optional)",
                    },
                    status: {
                        type: "string",
                        enum: ["todo", "in_progress", "in_review", "done", "blocked"],
                        description: "Filter by status (optional)",
                    },
                    priority: {
                        type: "string",
                        enum: ["low", "medium", "high", "critical"],
                        description: "Filter by priority (optional)",
                    },
                    overdue: {
                        type: "boolean",
                        description: "If true, only return overdue tasks",
                    },
                    limit: {
                        type: "number",
                        description: "Max results to return. Default: 10",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_brief",
            description: "Generate a morning/status briefing for the user. Use when user asks for a brief, summary, or 'what happened'.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Focus on specific project (optional — default: all)",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_expense",
            description: "Create a project expense. Use when the user asks to record spending, cost, payment, or fact.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Project ID. If omitted, use the most recent active project.",
                    },
                    title: {
                        type: "string",
                        description: "Expense title",
                    },
                    amount: {
                        type: "number",
                        description: "Expense amount",
                    },
                    categoryCode: {
                        type: "string",
                        description: "Expense category code such as materials, labor, equipment, overhead",
                    },
                    categoryName: {
                        type: "string",
                        description: "Optional human-readable category name",
                    },
                    description: {
                        type: "string",
                        description: "Additional details",
                    },
                    date: {
                        type: "string",
                        description: "Expense date in ISO 8601 format",
                    },
                    status: {
                        type: "string",
                        enum: ["pending", "approved", "rejected", "paid"],
                        description: "Expense status. Default: approved",
                    },
                    supplierId: {
                        type: "string",
                        description: "Optional supplier ID",
                    },
                    taskId: {
                        type: "string",
                        description: "Optional linked task ID",
                    },
                    equipmentId: {
                        type: "string",
                        description: "Optional linked equipment ID",
                    },
                    currency: {
                        type: "string",
                        description: "Currency code. Default: RUB",
                    },
                },
                required: ["title", "amount"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_budget_summary",
            description: "Get expense and budget summary for one project or across active projects.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Optional project ID",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_equipment",
            description: "List equipment with optional availability or project filters.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Optional project ID filter",
                    },
                    status: {
                        type: "string",
                        description: "Optional equipment status filter",
                    },
                    availableOnly: {
                        type: "boolean",
                        description: "If true, only return equipment that is available",
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of items to return. Default: 10",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_material_movement",
            description: "Create a material stock movement such as receipt, consumption, return, or writeoff.",
            parameters: {
                type: "object",
                properties: {
                    materialId: {
                        type: "string",
                        description: "Material ID",
                    },
                    materialName: {
                        type: "string",
                        description: "Material name if ID is unknown",
                    },
                    projectId: {
                        type: "string",
                        description: "Project ID. If omitted, use the most recent active project.",
                    },
                    type: {
                        type: "string",
                        enum: ["receipt", "consumption", "return", "writeoff"],
                        description: "Movement type",
                    },
                    quantity: {
                        type: "number",
                        description: "Quantity moved",
                    },
                    unitPrice: {
                        type: "number",
                        description: "Optional unit price",
                    },
                    documentRef: {
                        type: "string",
                        description: "Optional document reference",
                    },
                    date: {
                        type: "string",
                        description: "Movement date in ISO 8601 format",
                    },
                },
                required: ["type", "quantity"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_critical_path",
            description: "Calculate the project critical path, finish date, and critical tasks.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Project ID. If omitted, use the most recent active project.",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_resource_load",
            description: "Calculate project resource load, overallocation conflicts, and suggested leveling adjustments.",
            parameters: {
                type: "object",
                properties: {
                    projectId: {
                        type: "string",
                        description: "Project ID. If omitted, use the most recent active project.",
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "sync_1c",
            description: "Run the existing 1C to expense synchronization and return created/updated/skipped counts.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            },
        },
    },
];
