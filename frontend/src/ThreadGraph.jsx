nodes.push({
  id: `thread-${thread.id}`,
  type: 'thread',
  title: thread.metadata?.title || 'Untitled',
  description: thread.metadata?.description,
  content: thread.content?.content,
  radius: 25,
  hasVoted: thread.hasVoted,
  votesFor: thread.votesFor,
  votesAgainst: thread.votesAgainst,
  proposalDeadline: thread.proposalDeadline,
  hasActiveProposal: thread.hasActiveProposal,
  metadata: thread.metadata,
  originalData: { ...thread, type: 'thread', id: thread.id }
}); 