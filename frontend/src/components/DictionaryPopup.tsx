import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import './DictionaryPopup.css';

interface LookupResult {
  word: string;
  definition: string;
  partOfSpeech: string;
  pronunciation: string;
  example: string;
  etymology: string;
}

const DictionaryPopup: React.FC = () => {
  const [selectedText, setSelectedText] = useState('');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [showLookup, setShowLookup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    // Ignore selections inside the popup itself
    if (popupRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';

    if (text && text.length > 0 && text.length < 200) {
      const range = selection!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectedText(text);
      setPosition({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
      setLookup(null);
      setSaved(false);
      setAlreadyExists(false);
      setShowLookup(false);
    } else {
      // Small delay to allow clicking the popup button
      setTimeout(() => {
        if (!popupRef.current?.contains(document.activeElement) && !buttonRef.current?.contains(document.activeElement)) {
          setSelectedText('');
          setPosition(null);
          setShowLookup(false);
        }
      }, 200);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  // Adjust position if popup would go off-screen
  useEffect(() => {
    if (!popupRef.current || !position) return;
    const rect = popupRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = position;
    if (rect.right > vw - 16) x = vw - rect.width / 2 - 16;
    if (rect.left < 16) x = rect.width / 2 + 16;
    if (rect.bottom > vh - 16) y = position.y - rect.height - 50;
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [lookup, showLookup]);

  const handleLookup = async () => {
    setShowLookup(true);
    setLoading(true);
    try {
      const result = await api.vocabLookup(selectedText, '');
      setLookup(result);
    } catch (err) {
      console.error('Dictionary lookup error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!lookup) return;
    try {
      const result = await api.vocabSave({
        word: lookup.word,
        definition: lookup.definition,
        partOfSpeech: lookup.partOfSpeech,
        pronunciation: lookup.pronunciation,
        example: lookup.example,
        etymology: lookup.etymology,
        context: selectedText !== lookup.word ? selectedText : '',
      });
      if (result.alreadyExists) {
        setAlreadyExists(true);
      } else {
        setSaved(true);
      }
    } catch (err) {
      console.error('Save word error:', err);
    }
  };

  const handleClose = () => {
    setSelectedText('');
    setPosition(null);
    setShowLookup(false);
    setLookup(null);
  };

  if (!selectedText || !position) return null;

  return (
    <>
      {/* Small "Define" button shown on text selection */}
      {!showLookup && (
        <div
          ref={buttonRef}
          className="dict-trigger"
          style={{ left: position.x, top: position.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleLookup}
        >
          Define
        </div>
      )}

      {/* Full dictionary popup */}
      {showLookup && (
        <div
          ref={popupRef}
          className="dict-popup"
          style={{ left: position.x, top: position.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="dict-close" onClick={handleClose}>&times;</button>

          {loading ? (
            <div className="dict-loading">
              <div className="dict-spinner" />
              Looking up "{selectedText}"...
            </div>
          ) : lookup ? (
            <div className="dict-content">
              <div className="dict-header">
                <span className="dict-word">{lookup.word}</span>
                {lookup.pronunciation && <span className="dict-pronunciation">{lookup.pronunciation}</span>}
                {lookup.partOfSpeech && <span className="dict-pos">{lookup.partOfSpeech}</span>}
              </div>

              <p className="dict-definition">{lookup.definition}</p>

              {lookup.example && (
                <p className="dict-example">"{lookup.example}"</p>
              )}

              {lookup.etymology && (
                <p className="dict-etymology">{lookup.etymology}</p>
              )}

              <div className="dict-actions">
                {saved ? (
                  <span className="dict-saved">Added to vocabulary</span>
                ) : alreadyExists ? (
                  <span className="dict-exists">Already in your vocabulary</span>
                ) : (
                  <button className="dict-save-btn" onClick={handleSave}>
                    + Add to Vocabulary
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="dict-error">Failed to look up definition.</div>
          )}
        </div>
      )}
    </>
  );
};

export default DictionaryPopup;
