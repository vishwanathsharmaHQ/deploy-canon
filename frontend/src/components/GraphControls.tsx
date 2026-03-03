import React, { useState } from 'react';
import './GraphControls.css';

interface GraphSettings {
  isStatic: boolean;
  animate: boolean;
  showLabels: boolean;
  repelForce: number;
  linkDistance: number;
  centerForce: number;
  nodeSize: number;
  [key: string]: boolean | number | string;
}

interface GraphControlsProps {
  onSettingsChange: (settings: GraphSettings) => void;
  defaultSettings: GraphSettings;
}

const GraphControls: React.FC<GraphControlsProps> = ({ onSettingsChange, defaultSettings }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [settings, setSettings] = useState<GraphSettings>(defaultSettings);

  const handleChange = (key: string, value: boolean | number | string) => {
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
          {isExpanded ? '\u2212' : '+'}
        </button>
      </h3>

      <div className="controls-content">
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={settings.isStatic}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('isStatic', e.target.checked)}
            />
            Static Layout
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.animate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('animate', e.target.checked)}
            />
            Animate Changes
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.showLabels}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('showLabels', e.target.checked)}
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('repelForce', parseInt(e.target.value))}
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('linkDistance', parseInt(e.target.value))}
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('centerForce', parseFloat(e.target.value))}
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('nodeSize', parseInt(e.target.value))}
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
