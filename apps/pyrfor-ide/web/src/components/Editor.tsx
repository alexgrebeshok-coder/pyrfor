import React, { useCallback } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { TabData } from '../App';

interface EditorProps {
  tab: TabData;
  onChange: (path: string, content: string) => void;
  onSave: () => void;
}

export default function Editor({ tab, onChange, onSave }: EditorProps) {
  const handleMount = useCallback(
    (editor: any, monaco: any) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave());
    },
    [onSave]
  );

  return (
    <div className="monaco-wrapper">
      <MonacoEditor
        key={tab.path}
        height="100%"
        language={tab.language}
        value={tab.content}
        theme="vs-dark"
        options={{
          wordWrap: 'on',
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          smoothScrolling: true,
        }}
        onChange={(val) => onChange(tab.path, val ?? '')}
        onMount={handleMount}
      />
    </div>
  );
}
