import React from 'react';

const MatrixCell = ({ probability, impact }: { probability: number, impact: number }) => {
  const score = probability * impact;
  let color = 'bg-gray-100';
  
  // Adjusted logic to match requirements
  if (score >= 4) color = 'bg-red-500';
  else if (score >= 2.4) color = 'bg-orange-500';
  else if (score >= 1.2) color = 'bg-yellow-400';
  else color = 'bg-green-500';

  return <div className={`w-8 h-8 ${color} rounded-sm`} />;
};

export const RiskMatrix = () => {
  const impacts = [1, 2, 3, 4, 5];
  const probabilities = [1.0, 0.8, 0.6, 0.4, 0.2];

  return (
    <div className="p-4 bg-white rounded-lg shadow-sm border">
      <h3 className="font-bold mb-4">Матрица рисков (Влияние →)</h3>
      <div className="grid grid-cols-6 gap-2">
        <div />
        {impacts.map(i => <div key={i} className="text-center font-bold text-sm">{i}</div>)}
        {probabilities.map(p => (
          <React.Fragment key={p}>
            <div className="font-bold text-sm text-right pr-2">{p}</div>
            {impacts.map(i => <MatrixCell key={`${p}-${i}`} probability={p} impact={i} />)}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
