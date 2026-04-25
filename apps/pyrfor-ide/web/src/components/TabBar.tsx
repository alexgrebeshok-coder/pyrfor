import React from 'react';
import type { TabData } from '../App';

interface TabBarProps {
  tabs: TabData[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export default function TabBar({ tabs, activeTab, onSelect, onClose }: TabBarProps) {
  return (
    <div className="tabs-bar">
      <div className="tabs-list">
        {tabs.map((tab) => {
          const name = tab.path.split('/').filter(Boolean).pop() || tab.path;
          return (
            <div
              key={tab.path}
              className={`tab${tab.path === activeTab ? ' active' : ''}`}
              title={tab.path}
              onClick={() => onSelect(tab.path)}
            >
              {tab.dirty && <span className="tab-dirty">•</span>}
              <span className="tab-name">{name}</span>
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.path);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
