export interface Project {
  id: string;
  name: string;
  budgetPlan: number;
  budgetFact: number;
  progress: number; // 0-100
  start: Date;
  end: Date;
}

export interface EVMResult {
  BAC: number;
  PV: number;
  EV: number;
  AC: number;
  CV: number;
  SV: number;
  CPI: number;
  SPI: number;
  EAC: number;
  ETC: number;
  VAC: number;
}
