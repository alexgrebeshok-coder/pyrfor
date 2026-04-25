import React from 'react';

interface HelpModalProps {
  onClose: () => void;
}

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="modal-overlay visible" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Keyboard Shortcuts</h2>
        <table className="shortcuts-table">
          <tbody>
            <tr>
              <td>
                <kbd>Ctrl/⌘ S</kbd>
              </td>
              <td>Save current file</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/⌘ P</kbd>
              </td>
              <td>Focus file tree search</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/⌘ E</kbd>
              </td>
              <td>Focus chat input</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/⌘ `</kbd>
              </td>
              <td>Toggle command runner</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Close modal / dismiss</td>
            </tr>
            <tr>
              <td>
                <kbd>↑ / ↓</kbd>
              </td>
              <td>Command history (in runner)</td>
            </tr>
            <tr>
              <td>
                <kbd>Enter</kbd>
              </td>
              <td>Send chat message</td>
            </tr>
            <tr>
              <td>
                <kbd>Shift+Enter</kbd>
              </td>
              <td>New line in chat</td>
            </tr>
          </tbody>
        </table>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
