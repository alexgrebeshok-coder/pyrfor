import React from 'react';

interface WorkloadTableProps {
  data: {
    memberName: string;
    allocated: number;
    capacity: number;
    projectsCount: number;
    status: '🟢' | '🟡' | '🔴' | '🟠';
  }[];
}

export const WorkloadTable: React.FC<WorkloadTableProps> = ({ data }) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th>Team Member</th>
            <th>Hours</th>
            <th>Projects</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {data.map((row, idx) => (
            <tr key={idx}>
              <td>{row.memberName}</td>
              <td>{row.allocated}/{row.capacity}</td>
              <td>{row.projectsCount}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
