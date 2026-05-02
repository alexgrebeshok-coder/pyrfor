import React, { useState, useRef, useEffect } from 'react';
import { setBearerToken } from '../lib/authStorage';

interface AuthModalProps {
  onClose: () => void;
}

export default function AuthModal({ onClose }: AuthModalProps) {
  const [token, setToken] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = async () => {
    await setBearerToken(token);
    onClose();
  };

  return (
    <div className="modal-overlay visible" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Authentication Required</h2>
        <p className="modal-desc">Enter your Bearer token to access the Pyrfor gateway.</p>
        <input
          ref={inputRef}
          type="password"
          className="input-field"
          placeholder="Bearer token…"
          autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
        />
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Save &amp; Retry
          </button>
        </div>
      </div>
    </div>
  );
}
