import { useMemo } from 'react';
import { diffLines } from 'diff';
import './DiffView.css';

interface DiffViewProps {
  oldText: string;
  newText: string;
}

export default function DiffView({ oldText, newText }: DiffViewProps) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  const hasChanges = parts.some(p => p.added || p.removed);

  if (!hasChanges) {
    return <div className="dv-no-changes">No changes</div>;
  }

  return (
    <div className="dv-container">
      {parts.map((part, i) => {
        const lines = part.value.replace(/\n$/, '').split('\n');
        const cls = part.added ? 'dv-added' : part.removed ? 'dv-removed' : 'dv-unchanged';
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        return lines.map((line, j) => (
          <div key={`${i}-${j}`} className={`dv-line ${cls}`}>
            <span className="dv-prefix">{prefix}</span>
            <span className="dv-text">{line || ' '}</span>
          </div>
        ));
      })}
    </div>
  );
}
