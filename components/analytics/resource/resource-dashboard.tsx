import React from 'react';
import dynamic from 'next/dynamic';
import { WorkloadTable } from './workload-table';
import { RecommendationList } from './recommendations';

const CapacityChart = dynamic(
  () => import('./capacity-chart').then(m => ({ default: m.CapacityChart })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-100 rounded h-40" /> }
);

export const ResourceDashboard: React.FC = () => {
  // Demo state or props would be passed here
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
      <CapacityChart />
      <WorkloadTable data={[
        { memberName: 'Саша', allocated: 40, capacity: 85, projectsCount: 3, status: '🟢' },
        { memberName: 'Иван', allocated: 65, capacity: 30, projectsCount: 4, status: '🔴' },
        { memberName: 'Екатерина', allocated: 20, capacity: 40, projectsCount: 2, status: '🟢' },
      ]} />
      <RecommendationList items={[
        { text: 'Иван перегружен (65/30 часов) → Перераспределить задачи', type: '🔴' },
        { text: 'Бутылочное горлышко: Михаил → Нанять подрядчика', type: '🟡' },
        { text: 'Свободный ресурс: Екатерина (+20ч) → Назначить', type: '🟢' },
      ]} />
    </div>
  );
};
