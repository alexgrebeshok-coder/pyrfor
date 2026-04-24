/**
 * Generate recommendations based on projects, health, and AI insights
 *
 * Rule-based recommendations engine (no external AI API)
 * Analyzes:
 * - Project health scores
 * - Budget and schedule performance
 * - Resource utilization
 * - Risk levels
 */
export function generateRecommendations(projects, health, insights) {
    const recommendations = [];
    const now = new Date().toISOString();
    // 1. Critical Action: Projects at risk with low health
    const criticalProjects = projects.filter((p) => p.status === "at-risk" || p.health < 50);
    if (criticalProjects.length > 0) {
        const mostCritical = criticalProjects.reduce((prev, current) => prev.health < current.health ? prev : current);
        recommendations.push({
            id: `rec-critical-${mostCritical.id}`,
            type: "critical",
            priority: "critical",
            title: `Reallocate resources to ${mostCritical.name}`,
            description: `Project health is at ${mostCritical.health}%. Immediate intervention required.`,
            action: "Reallocate 2-3 resources to stabilize the project",
            projectId: mostCritical.id,
            projectName: mostCritical.name,
            createdAt: now,
        });
    }
    // 2. Optimization: Timeline adjustments for behind-schedule projects
    const behindScheduleProjects = projects.filter((p) => p.progress < 50 && p.status === "active");
    if (behindScheduleProjects.length > 0) {
        const target = behindScheduleProjects[0];
        const progressLag = 50 - target.progress;
        recommendations.push({
            id: `rec-optimize-${target.id}`,
            type: "optimization",
            priority: "warning",
            title: `Consider timeline adjustment for ${target.name}`,
            description: `Progress at ${target.progress}% with significant work remaining.`,
            action: `Adjust timeline or scope by ${progressLag}% to meet deadline`,
            projectId: target.id,
            projectName: target.name,
            createdAt: now,
        });
    }
    // 3. Resource: Overloaded teams
    if ((insights === null || insights === void 0 ? void 0 : insights.critical) && insights.critical > 0) {
        recommendations.push({
            id: "rec-resource-overload",
            type: "resource",
            priority: "warning",
            title: "Team utilization near capacity",
            description: `${insights.critical} projects are in critical state. Consider hiring additional resources.`,
            action: "Review team workload and add 1-2 team members",
            createdAt: now,
        });
    }
    // 4. Risk Mitigation: High-risk projects
    const highRiskProjects = projects.filter((p) => p.risks > 3);
    if (highRiskProjects.length > 0) {
        const target = highRiskProjects[0];
        recommendations.push({
            id: `rec-risk-${target.id}`,
            type: "risk-mitigation",
            priority: target.risks > 5 ? "critical" : "warning",
            title: `Address supply chain risks in ${target.name}`,
            description: `Project has ${target.risks} active risks requiring attention.`,
            action: "Conduct risk review and implement mitigation plan",
            projectId: target.id,
            projectName: target.name,
            createdAt: now,
        });
    }
    // 5. Budget optimization
    const overBudgetProjects = projects.filter((p) => p.budget.actual > p.budget.planned * 0.9);
    if (overBudgetProjects.length > 0) {
        const target = overBudgetProjects[0];
        const utilization = ((target.budget.actual / target.budget.planned) * 100).toFixed(1);
        recommendations.push({
            id: `rec-budget-${target.id}`,
            type: "optimization",
            priority: "warning",
            title: `Budget utilization at ${utilization}% for ${target.name}`,
            description: `Approaching budget limit. Consider cost optimization measures.`,
            action: "Review spend and identify cost-saving opportunities",
            projectId: target.id,
            projectName: target.name,
            createdAt: now,
        });
    }
    // 6. Portfolio-level recommendation
    if (health && health.overall < 70) {
        recommendations.push({
            id: "rec-portfolio-health",
            type: "critical",
            priority: "critical",
            title: "Portfolio health requires attention",
            description: `Overall portfolio health at ${health.overall}%. Multiple signals need management review.`,
            action: "Schedule portfolio review meeting this week",
            createdAt: now,
        });
    }
    // 7. Opportunity: Accelerate healthy projects
    const healthyProjects = projects.filter((p) => p.health > 80 && p.status === "active");
    if (healthyProjects.length > 0 && recommendations.length < 5) {
        const target = healthyProjects[0];
        recommendations.push({
            id: `rec-opportunity-${target.id}`,
            type: "optimization",
            priority: "info",
            title: `Accelerate ${target.name}`,
            description: `Project is healthy (${target.health}%). Opportunity to deliver ahead of schedule.`,
            action: "Consider adding resources to complete early",
            projectId: target.id,
            projectName: target.name,
            createdAt: now,
        });
    }
    // Limit to 5 recommendations max, prioritized by severity
    const priorityOrder = { critical: 0, warning: 1, info: 2 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    return recommendations.slice(0, 5);
}
