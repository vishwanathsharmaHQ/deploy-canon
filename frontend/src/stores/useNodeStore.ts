import { create } from 'zustand';
import type { ThreadNode } from '../types';

interface NodeState {
  selectedNode: ThreadNode | null;
  graphSelectedNodeId: number | null;
  editorNode: ThreadNode | null;
  nodeContent: string;
  nodeType: number;

  setSelectedNode: (node: ThreadNode | null) => void;
  setGraphSelectedNodeId: (id: number | null) => void;
  setEditorNode: (node: ThreadNode | null) => void;
  setNodeContent: (content: string) => void;
  setNodeType: (type: number) => void;
  handleCloseModal: () => void;
}

export const useNodeStore = create<NodeState>((set) => ({
  selectedNode: null,
  graphSelectedNodeId: null,
  editorNode: null,
  nodeContent: '',
  nodeType: 0,

  setSelectedNode: (node) => set({ selectedNode: node }),
  setGraphSelectedNodeId: (id) => set({ graphSelectedNodeId: id }),
  setEditorNode: (node) => set({ editorNode: node }),
  setNodeContent: (content) => set({ nodeContent: content }),
  setNodeType: (type) => set({ nodeType: type }),
  handleCloseModal: () => set({ selectedNode: null }),
}));
