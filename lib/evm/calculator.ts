import { Project, EVMResult } from './types';

export function calculateEVM(project: Project, currentDate: Date): EVMResult {
  const totalDuration = project.end.getTime() - project.start.getTime();
  const elapsed = currentDate.getTime() - project.start.getTime();
  
  // Handle edge cases
  if (totalDuration <= 0) {
    return { BAC: 0, PV: 0, EV: 0, AC: 0, CV: 0, SV: 0, CPI: 1, SPI: 1, EAC: 0, ETC: 0, VAC: 0 };
  }

  const percentElapsed = Math.min(Math.max(elapsed / totalDuration, 0), 1);
  const percentComplete = Math.min(Math.max(project.progress / 100, 0), 1);

  // Core metrics
  const BAC = project.budgetPlan; // Budget at Completion
  const PV = BAC * percentElapsed; // Planned Value
  const EV = BAC * percentComplete; // Earned Value
  const AC = project.budgetFact; // Actual Cost

  // Variance
  const CV = EV - AC;
  const SV = EV - PV;

  // Indices
  const CPI = AC !== 0 ? EV / AC : 1;
  const SPI = PV !== 0 ? EV / PV : 1;

  // Forecasts
  const EAC = CPI !== 0 ? AC + (BAC - EV) / CPI : BAC;
  const ETC = EAC - AC;
  const VAC = BAC - EAC;

  return { BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC };
}
