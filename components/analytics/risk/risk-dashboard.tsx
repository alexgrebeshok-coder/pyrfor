import { RiskMatrix } from './risk-matrix';
import { RiskList } from './risk-list';

export const RiskDashboard = ({ risks }: { risks: any[] }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
      <div className="col-span-1">
        <RiskMatrix />
      </div>
      <div className="col-span-1">
        <h2 className="text-xl font-bold mb-4">Обнаруженные риски</h2>
        <RiskList risks={risks} />
      </div>
    </div>
  );
};
