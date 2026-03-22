import React from 'react';
import { Risk } from '../../../lib/risk/calculator';

interface RiskListProps {
  risks: Risk[];
}

export const RiskList = ({ risks }: RiskListProps) => {
  return (
    <div className="space-y-4">
      {risks.map((risk, index) => (
        <div key={index} className={`p-4 border rounded shadow-sm ${risk.severity === 'critical' ? 'border-red-500 bg-red-50' : 'border-orange-300 bg-orange-50'}`}>
          <h3 className="font-bold">
            {risk.severity === 'critical' ? '🔴 КРИТИЧЕСКИЙ' : '🟠 ВЫСОКИЙ'}: {risk.description}
          </h3>
          <p className="text-sm mt-1">Score: {(risk.probability * risk.impact * risk.urgency).toFixed(1)} | Urgency: {risk.urgency === 3 ? 'High' : 'Medium'}</p>
          <div className="mt-2 text-sm italic">
            <strong>Рекомендации:</strong> {risk.mitigation?.join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
};
