"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateEVM = calculateEVM;
exports.calculateTaskEVM = calculateTaskEVM;
exports.calculateEVMFromValues = calculateEVMFromValues;
function calculateEVM(project, currentDate) {
    const totalDuration = project.end.getTime() - project.start.getTime();
    const elapsed = currentDate.getTime() - project.start.getTime();
    if (totalDuration <= 0) {
        return {
            BAC: 0,
            PV: 0,
            EV: 0,
            AC: 0,
            CV: 0,
            SV: 0,
            CPI: 1,
            SPI: 1,
            EAC: 0,
            ETC: 0,
            VAC: 0,
            TCPI: null,
            TCPI_EAC: null,
        };
    }
    const percentElapsed = Math.min(Math.max(elapsed / totalDuration, 0), 1);
    const percentComplete = Math.min(Math.max(project.progress / 100, 0), 1);
    const BAC = project.budgetPlan;
    const PV = BAC * percentElapsed;
    const EV = BAC * percentComplete;
    const AC = project.budgetFact;
    return calculateEVMFromValues({ BAC, PV, EV, AC });
}
function calculateTaskEVM(task, currentDate) {
    const BAC = Math.max(task.estimatedCost ?? 0, 0);
    const AC = Math.max(task.actualCost ?? 0, 0);
    const percentComplete = clampPercent(task.percentComplete ?? 0);
    const plannedPercent = calculatePlannedPercent(task.startDate ?? null, task.dueDate ?? null, currentDate);
    const PV = BAC * plannedPercent;
    const EV = BAC * (percentComplete / 100);
    const metrics = calculateEVMFromValues({ BAC, PV, EV, AC });
    return {
        taskId: task.id,
        title: task.title,
        ...metrics,
        percentComplete,
        plannedPercent: Math.round(plannedPercent * 1000) / 10,
    };
}
function calculateEVMFromValues(input) {
    const BAC = sanitizeMetric(input.BAC);
    const PV = sanitizeMetric(input.PV);
    const EV = sanitizeMetric(input.EV);
    const AC = sanitizeMetric(input.AC);
    const CV = EV - AC;
    const SV = EV - PV;
    const CPI = AC !== 0 ? EV / AC : 1;
    const SPI = PV !== 0 ? EV / PV : 1;
    const EAC = CPI !== 0 ? AC + (BAC - EV) / CPI : BAC;
    const ETC = EAC - AC;
    const VAC = BAC - EAC;
    const TCPI = BAC !== EV && BAC !== AC ? (BAC - EV) / (BAC - AC) : null;
    const TCPI_EAC = EAC !== AC ? (BAC - EV) / (EAC - AC) : null;
    return {
        BAC,
        PV,
        EV,
        AC,
        CV,
        SV,
        CPI,
        SPI,
        EAC,
        ETC,
        VAC,
        TCPI: sanitizeNullableMetric(TCPI),
        TCPI_EAC: sanitizeNullableMetric(TCPI_EAC),
    };
}
function calculatePlannedPercent(startDate, dueDate, currentDate) {
    if (!startDate || !dueDate) {
        return 0;
    }
    const totalDuration = dueDate.getTime() - startDate.getTime();
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
        return currentDate.getTime() >= dueDate.getTime() ? 1 : 0;
    }
    const elapsed = currentDate.getTime() - startDate.getTime();
    return Math.min(Math.max(elapsed / totalDuration, 0), 1);
}
function clampPercent(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(100, value));
}
function sanitizeMetric(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.round(value * 100) / 100;
}
function sanitizeNullableMetric(value) {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(value * 1000) / 1000;
}
