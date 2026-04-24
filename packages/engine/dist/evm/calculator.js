export function calculateEVM(project, currentDate) {
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
export function calculateTaskEVM(task, currentDate) {
    var _a, _b, _c, _d, _e;
    const BAC = Math.max((_a = task.estimatedCost) !== null && _a !== void 0 ? _a : 0, 0);
    const AC = Math.max((_b = task.actualCost) !== null && _b !== void 0 ? _b : 0, 0);
    const percentComplete = clampPercent((_c = task.percentComplete) !== null && _c !== void 0 ? _c : 0);
    const plannedPercent = calculatePlannedPercent((_d = task.startDate) !== null && _d !== void 0 ? _d : null, (_e = task.dueDate) !== null && _e !== void 0 ? _e : null, currentDate);
    const PV = BAC * plannedPercent;
    const EV = BAC * (percentComplete / 100);
    const metrics = calculateEVMFromValues({ BAC, PV, EV, AC });
    return Object.assign(Object.assign({ taskId: task.id, title: task.title }, metrics), { percentComplete, plannedPercent: Math.round(plannedPercent * 1000) / 10 });
}
export function calculateEVMFromValues(input) {
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
