import type { EntityType, RelationType, ThreadType } from '../types';

// ── Entity Types ──────────────────────────────────────────────────────────

export const ENTITY_TYPES: EntityType[] = [
  'claim',
  'evidence',
  'source',
  'context',
  'example',
  'counterpoint',
  'synthesis',
  'question',
  'note',
];

/** Legacy compat -- components still import NODE_TYPES */
export const NODE_TYPES = ENTITY_TYPES;

/** Display names for entity types (shown in UI). */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  claim: 'root',
  evidence: 'evidence',
  source: 'source',
  context: 'context',
  example: 'example',
  counterpoint: 'counterpoint',
  synthesis: 'synthesis',
  question: 'question',
  note: 'note',
};
export type NodeTypeName = EntityType;

/** All entity types can have relationships (no more leaf restriction). */
export const EXPANDABLE_NODE_TYPES = ENTITY_TYPES;

/** No restrictions in the graph model. */
export const LEAF_NODE_TYPES: EntityType[] = [];

// ── Relationship Types ────────────────────────────────────────────────────

export const RELATIONSHIP_TYPES: readonly RelationType[] = [
  'SUPPORTS',
  'CONTRADICTS',
  'QUALIFIES',
  'DERIVES_FROM',
  'ILLUSTRATES',
  'CITES',
  'ADDRESSES',
  'REFERENCES',
] as const;

// ── Colors ────────────────────────────────────────────────────────────────

/** Canonical color mapping for entity types. */
export const NODE_TYPE_COLORS: Record<string, string> = {
  // New lowercase entity types
  claim: '#ffd700',
  evidence: '#4fc3f7',
  source: '#aaa',
  context: '#ff8a65',
  example: '#66bb6a',
  counterpoint: '#ef5350',
  synthesis: '#fdd835',
  question: '#ce93d8',
  note: '#90a4ae',
  thread: '#00ff9d',
  root: '#ffd700',
  // Uppercase aliases for backward compat
  ROOT: '#ffd700',
  EVIDENCE: '#4fc3f7',
  REFERENCE: '#aaa',
  CONTEXT: '#ff8a65',
  EXAMPLE: '#66bb6a',
  COUNTERPOINT: '#ef5350',
  SYNTHESIS: '#fdd835',
};

/** Color mapping for relationship types. */
export const RELATION_TYPE_COLORS: Record<string, string> = {
  SUPPORTS: '#4fc3f7',
  CONTRADICTS: '#ef5350',
  QUALIFIES: '#ff8a65',
  DERIVES_FROM: '#ce93d8',
  ILLUSTRATES: '#66bb6a',
  CITES: '#aaa',
  ADDRESSES: '#fdd835',
  REFERENCES: '#00ff9d',
};

// ── Thread Types ──────────────────────────────────────────────────────────

/** Available thread types. */
export const THREAD_TYPES: { key: string; label: string; description: string }[] = [
  { key: 'argument', label: 'Argument', description: 'Build and defend a thesis' },
  { key: 'research', label: 'Research', description: 'Collect and organize findings' },
  { key: 'timeline', label: 'Timeline', description: 'Chronological sequence of events' },
  { key: 'comparison', label: 'Comparison', description: 'Compare multiple positions' },
  { key: 'collection', label: 'Collection', description: 'General knowledge collection' },
];

// ── Misc ──────────────────────────────────────────────────────────────────

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
