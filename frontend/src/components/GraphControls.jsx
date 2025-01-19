import React, { useState } from 'react';
import './GraphControls.css';

const GraphControls = ({ onSettingsChange, defaultSettings }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [settings, setSettings] = useState(defaultSettings);

  const handleChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    onSettingsChange(newSettings);
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    onSettingsChange(defaultSettings);
  };

  return (
    <div className={`graph-controls ${isExpanded ? '' : 'collapsed'}`}>
      <h3>
        Graph Controls
        <button 
          className="toggle-button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? 'Collapse controls' : 'Expand controls'}
        >
          {isExpanded ? '−' : '+'}
        </button>
      </h3>
      
      <div className="controls-content">
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={settings.isStatic}
              onChange={(e) => handleChange('isStatic', e.target.checked)}
            />
            Static Layout
          </label>
          
          <label>
            <input
              type="checkbox"
              checked={settings.animate}
              onChange={(e) => handleChange('animate', e.target.checked)}
            />
            Animate Changes
          </label>
          
          <label>
            <input
              type="checkbox"
              checked={settings.showLabels}
              onChange={(e) => handleChange('showLabels', e.target.checked)}
            />
            Show Labels
          </label>
        </div>

        <div className="control-group">
          <label>
            Repel Force
            <input
              type="range"
              min="-1000"
              max="-100"
              value={settings.repelForce}
              onChange={(e) => handleChange('repelForce', parseInt(e.target.value))}
            />
          </label>
        </div>

        <div className="control-group">
          <label>
            Attraction Force
            <input
              type="range"
              min="50"
              max="300"
              value={settings.linkDistance}
              onChange={(e) => handleChange('linkDistance', parseInt(e.target.value))}
            />
          </label>
        </div>

        <div className="control-group">
          <label>
            Center Force
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.centerForce}
              onChange={(e) => handleChange('centerForce', parseFloat(e.target.value))}
            />
          </label>
        </div>

        <div className="control-group">
          <label>
            Node Size
            <input
              type="range"
              min="5"
              max="20"
              value={settings.nodeSize}
              onChange={(e) => handleChange('nodeSize', parseInt(e.target.value))}
            />
          </label>
        </div>

        <button className="reset-button" onClick={handleReset}>
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};

export default GraphControls; 