import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import './SequenceEditor.css';

const NODE_TYPE_COLORS = {
  ROOT: '#888',
  EVIDENCE: '#4fc3f7',
  REFERENCE: '#ab47bc',
  CONTEXT: '#ff8a65',
  EXAMPLE: '#66bb6a',
  COUNTERPOINT: '#ef5350',
  SYNTHESIS: '#fdd835',
};

const NODE_TYPES = ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'];

const SequenceEditor = ({ thread, onDone }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!thread?.id) return;
    loadSequence();
  }, [thread?.id]);

  const loadSequence = async () => {
    setLoading(true);
    try {
      const nodes = thread.nodes || [];
      const saved = await api.loadArticleSequence(thread.id);

      if (saved && Array.isArray(saved)) {
        // Build ordered list: saved order first, then any new nodes appended
        const savedSet = new Set(saved);
        const ordered = saved
          .map(id => nodes.find(n => n.id === id))
          .filter(Boolean);
        const remaining = nodes.filter(n => !savedSet.has(n.id));
        setItems([...ordered, ...remaining]);
      } else {
        setItems([...nodes]);
      }
    } catch (err) {
      console.error('Failed to load sequence:', err);
      setItems([...(thread.nodes || [])]);
    } finally {
      setLoading(false);
    }
  };

  const saveSequence = useCallback((orderedItems) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const sequence = orderedItems.map(n => n.id);
        await api.saveArticleSequence(thread.id, sequence);
      } catch (err) {
        console.error('Failed to save sequence:', err);
      }
    }, 400);
  }, [thread?.id]);

  const handleDragStart = (index) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    const copy = [...items];
    const [removed] = copy.splice(dragItem.current, 1);
    copy.splice(dragOverItem.current, 0, removed);
    setItems(copy);
    saveSequence(copy);

    dragItem.current = null;
    dragOverItem.current = null;
  };

  const getNodeType = (node) => {
    if (node.node_type) return node.node_type;
    if (typeof node.type === 'number') return NODE_TYPES[node.type] || 'ROOT';
    return node.type || 'ROOT';
  };

  if (loading) {
    return (
      <div className="se-page">
        <div className="se-loading">Loading sequence...</div>
      </div>
    );
  }

  return (
    <div className="se-page">
      <div className="se-container">
        <div className="se-header">
          <h2 className="se-title">Reading Order</h2>
          <button className="se-done-btn" onClick={onDone}>Done</button>
        </div>
        <p className="se-hint">Drag items to reorder. The article reader will follow this sequence.</p>

        {items.length === 0 ? (
          <div className="se-empty">No nodes in this thread yet.</div>
        ) : (
          <ul className="se-list">
            {items.map((node, index) => {
              const nodeType = getNodeType(node);
              const color = NODE_TYPE_COLORS[nodeType] || '#888';
              return (
                <li
                  key={node.id}
                  className="se-item"
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragEnter={() => handleDragEnter(index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <span className="se-handle">&#x2630;</span>
                  <span className="se-index">{index + 1}</span>
                  <span className="se-badge" style={{ background: color }}>
                    {nodeType}
                  </span>
                  <span className="se-node-title">{node.title || `Node ${node.id}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SequenceEditor;
