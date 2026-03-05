import React from 'react';
import type { ConfidenceRecord } from '../types';
import './ConfidenceChart.css';

interface ConfidenceChartProps {
  data: ConfidenceRecord[];
}

const MARGIN = { top: 20, right: 20, bottom: 30, left: 40 };
const HEIGHT = 150;
const CHART_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

function scoreColor(score: number): string {
  if (score >= 70) return '#00ff9d';
  if (score >= 40) return '#fdd835';
  return '#ef5350';
}

const ConfidenceChart: React.FC<ConfidenceChartProps> = ({ data }) => {
  if (!data?.length) return null;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(400);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const chartWidth = width - MARGIN.left - MARGIN.right;

  const times = data.map(d => new Date(d.created_at).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = maxT - minT || 1;

  const xScale = (t: number) => ((t - minT) / rangeT) * chartWidth;
  const yScale = (score: number) => CHART_HEIGHT - (score / 100) * CHART_HEIGHT;

  const points = data.map(d => ({
    x: xScale(new Date(d.created_at).getTime()),
    y: yScale(d.score),
    score: d.score,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  // Y-axis ticks
  const yTicks = [0, 25, 50, 75, 100];

  // X-axis: show a few date labels
  const xTickCount = Math.min(data.length, 5);
  const step = Math.max(1, Math.floor(data.length / xTickCount));
  const xTicks = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <div className="confidence-chart" ref={containerRef}>
      <h4>Confidence Over Time</h4>
      <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Color zones */}
          <rect x={0} y={yScale(100)} width={chartWidth} height={yScale(70) - yScale(100)} fill="#00ff9d08" />
          <rect x={0} y={yScale(70)} width={chartWidth} height={yScale(40) - yScale(70)} fill="#fdd83508" />
          <rect x={0} y={yScale(40)} width={chartWidth} height={yScale(0) - yScale(40)} fill="#ef535008" />

          {/* Y axis */}
          {yTicks.map(tick => (
            <g key={tick}>
              <line x1={0} y1={yScale(tick)} x2={chartWidth} y2={yScale(tick)} stroke="#333" strokeWidth={0.5} />
              <text x={-6} y={yScale(tick) + 3} textAnchor="end" fill="#666" fontSize={10}>{tick}</text>
            </g>
          ))}

          {/* X axis */}
          <line x1={0} y1={CHART_HEIGHT} x2={chartWidth} y2={CHART_HEIGHT} stroke="#333" />
          {xTicks.map(d => {
            const t = new Date(d.created_at);
            const x = xScale(t.getTime());
            const label = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return (
              <text key={d.created_at} x={x} y={CHART_HEIGHT + 16} textAnchor="middle" fill="#666" fontSize={10}>
                {label}
              </text>
            );
          })}

          {/* Line */}
          <path d={linePath} fill="none" stroke="#00ff9d" strokeWidth={2} />

          {/* Dots + Labels */}
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={4} fill={scoreColor(p.score)} stroke="#1a1a1a" strokeWidth={2} />
              <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#aaa" fontSize={10}>{p.score}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
};

export default ConfidenceChart;
