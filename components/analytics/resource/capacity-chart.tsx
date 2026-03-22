import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const COLORS = ['#22c55e', '#3b82f6', '#ef4444'];

export const CapacityChart: React.FC = () => {
  const { data, isLoading } = useSWR('/api/capacity', fetcher);

  if (isLoading) return <div className="h-64 flex items-center justify-center">Загрузка...</div>;
  if (!data) return null;

  const chartData = [
    { name: 'Allocated', value: data.allocated },
    { name: 'Available', value: data.available },
    { name: 'Overloaded', value: data.overloaded },
  ];

  return (
    <div className="h-64">
      <h3 className="text-lg font-medium p-4">Team Capacity</h3>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={chartData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};
