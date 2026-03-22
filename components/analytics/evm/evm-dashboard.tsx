import { EVMChart } from './evm-chart';
import { EVMMetrics } from './evm-metrics';
import { Project } from '@/lib/evm/types';

interface EVMDashboardProps {
  project: Project;
}

export const EVMDashboard = ({ project }: EVMDashboardProps) => {
  const currentDate = new Date();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Панель управления EVM (Освоенный объём)</h2>
      
      <EVMMetrics project={project} currentDate={currentDate} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EVMChart project={project} />
        
        <div className="bg-white p-6 rounded-xl shadow-sm border">
          <h3 className="text-lg font-semibold mb-4">Прогноз проекта</h3>
          <ul className="space-y-2">
            <li>Прогноз завершения (EAC): {Math.round(project.budgetPlan).toLocaleString()} ₽</li>
            <li>Отклонение при завершении (VAC): {Math.round(project.budgetPlan * 0.1).toLocaleString()} ₽</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
