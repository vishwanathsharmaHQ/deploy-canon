import type { NodeTypeName } from '../types';

export const NODE_TYPES: NodeTypeName[] = [
  'ROOT',
  'EVIDENCE',
  'REFERENCE',
  'CONTEXT',
  'EXAMPLE',
  'COUNTERPOINT',
  'SYNTHESIS',
];

/** Canonical color mapping for node types. */
export const NODE_TYPE_COLORS: Record<NodeTypeName | 'thread', string> = {
  ROOT: '#ffd700',
  EVIDENCE: '#4fc3f7',
  REFERENCE: '#aaa',
  CONTEXT: '#ff8a65',
  EXAMPLE: '#66bb6a',
  COUNTERPOINT: '#ef5350',
  SYNTHESIS: '#fdd835',
  thread: '#00ff9d',
};

export const YT_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export const QUALITY_BUTTONS = [
  { quality: 0, label: 'Forgot', color: '#ef5350' },
  { quality: 2, label: 'Hard', color: '#ff8a65' },
  { quality: 3, label: 'Good', color: '#fdd835' },
  { quality: 4, label: 'Easy', color: '#66bb6a' },
  { quality: 5, label: 'Perfect', color: '#00ff9d' },
] as const;

export const VIEW_TABS = [
  { key: 'graph', label: 'Graph' },
  { key: 'global', label: 'Global' },
  { key: 'article', label: 'Article' },
  { key: 'sequence', label: 'Sequence' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'chat', label: 'Chat' },
  { key: 'review', label: 'Review' },
  { key: 'ingest', label: 'Ingest' },
  { key: 'timeline', label: 'Timeline' },
] as const;

export const EVENT_ICONS: Record<string, string> = {
  thread_created: 'T',
  node_added: '+',
  snapshot: 'S',
  confidence: 'C',
};

export const EVENT_COLORS: Record<string, string> = {
  thread_created: '#00ff9d',
  node_added: '#00ff9d',
  snapshot: '#888',
  confidence: '#fdd835',
};

/** Views that require authentication to access. */
export const AUTH_REQUIRED_VIEWS = new Set([
  'sequence',
  'editor',
  'canvas',
  'review',
  'ingest',
  'timeline',
]);
