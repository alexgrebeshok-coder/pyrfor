import React from 'react';

interface Recommendation {
  text: string;
  type: '🔴' | '🟡' | '🟢';
}

interface RecommendationsProps {
  items: Recommendation[];
}

export const RecommendationList: React.FC<RecommendationsProps> = ({ items }) => {
  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <h3 className="text-lg font-medium mb-4">💡 Рекомендации:</h3>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-center space-x-2">
            <span>{item.type}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
