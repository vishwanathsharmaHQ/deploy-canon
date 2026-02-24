import React, { useState, useEffect, useRef } from 'react';
import './InputModal.css';

const InputModal = ({ label, placeholder, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="im-overlay" onMouseDown={onCancel}>
      <div className="im-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <label className="im-label">{label}</label>
        <input
          ref={inputRef}
          className="im-input"
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="im-actions">
          <button className="im-cancel" onClick={onCancel}>Cancel</button>
          <button className="im-submit" disabled={!value.trim()} onClick={handleSubmit}>Add</button>
        </div>
      </div>
    </div>
  );
};

export default InputModal;
