import { Project } from '@/lib/evm/types';
import { calculateEVM } from '@/lib/evm/calculator';

interface EVMMetricsProps {
  project: Project;
  currentDate: Date;
}

export const EVMMetrics = ({ project, currentDate }: EVMMetricsProps) => {
  const evm = calculateEVM(project, currentDate);

  const getStatusColor = (value: number, type: 'CPI' | 'SPI') => {
    if (value >= 1.0) return 'text-green-600 bg-green-50'; // 🟢 Good
    if (value >= 0.9) return 'text-yellow-600 bg-yellow-50'; // 🟡 Warning
    return 'text-red-600 bg-red-50'; // 🔴 Critical
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className={`p-4 rounded-lg ${evm.CPI >= 0.9 ? 'bg-green-50' : 'bg-red-50'}`}>
        <p className="text-sm font-medium">CPI (Эффективность затрат)</p>
        <p className="text-2xl font-bold">{evm.CPI.toFixed(2)}</p>
      </div>
      <div className={`p-4 rounded-lg ${evm.SPI >= 0.9 ? 'bg-green-50' : 'bg-red-50'}`}>
        <p className="text-sm font-medium">SPI (Эффективность сроков)</p>
        <p className="text-2xl font-bold">{evm.SPI.toFixed(2)}</p>
      </div>
      <div className="p-4 rounded-lg bg-gray-50">
        <p className="text-sm font-medium">CV (Отклонение стоимости)</p>
        <p className="text-2xl font-bold">{evm.CV.toLocaleString('ru-RU')} ₽</p>
      </div>
      <div className="p-4 rounded-lg bg-gray-50">
        <p className="text-sm font-medium">SV (Отклонение сроков)</p>
        <p className="text-2xl font-bold">{evm.SV.toLocaleString('ru-RU')} ₽</p>
      </div>
    </div>
  );
};
