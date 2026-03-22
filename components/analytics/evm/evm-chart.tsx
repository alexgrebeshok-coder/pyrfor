import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { Project } from '@/lib/evm/types';
import { calculateEVM } from '@/lib/evm/calculator';

interface EVMChartProps {
  project: Project;
}

export const EVMChart = ({ project }: EVMChartProps) => {
  const generateSChartData = (project: Project) => {
    const points = [];
    const totalDays = (project.end.getTime() - project.start.getTime()) / (1000 * 60 * 60 * 24);
    
    for (let i = 0; i <= 100; i += 10) {
      const daysToAdd = totalDays * (i / 100);
      const date = new Date(project.start.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
      const evm = calculateEVM(project, date);
      
      points.push({
        date: date.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }),
        PV: Math.round(evm.PV),
        EV: Math.round(evm.EV),
        AC: Math.round(evm.AC)
      });
    }
    return points;
  };

  const data = generateSChartData(project);

  return (
    <div className="h-80 w-full bg-white p-4 rounded-xl shadow-sm border">
      <h3 className="text-lg font-semibold mb-4">S-Кривая освоения бюджета</h3>
      <ResponsiveContainer width="100%" height="80%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="PV" stroke="#8884d8" name="PV (План)" />
          <Line type="monotone" dataKey="EV" stroke="#82ca9d" name="EV (Освоено)" />
          <Line type="monotone" dataKey="AC" stroke="#ff7300" name="AC (Факт)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
