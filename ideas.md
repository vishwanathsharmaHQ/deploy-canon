# Canonthread — Product Ideas

Generated in conversation, 2026-02-27.

---

## High Impact, Achievable Now

### 1. Claim Confidence Meter ✅ *implemented*
AI reads the full thread — all evidence, counterpoints, synthesis — and renders a live 0–100% confidence score on the ROOT node with a breakdown (Evidence Strength, Counterpoint Coverage, Sourcing Quality, Logical Coherence). Shows a verdict ("Well-Supported", "Contested", etc.), key strengths, and gaps. Updates on demand with a refresh button. Turns a passive reading experience into an active argument-building game.

### 2. Smart Sequence Suggester ✅ *implemented*
On the Sequence page, an "AI Optimize" button calls GPT to analyze logical dependencies and restructure the sequence (foundation → evidence → counterpoints → synthesis). Shows the suggested order as a preview with the AI's reasoning. User can apply or dismiss.

### 3. Inline Source Verification ✅ *implemented*
EVIDENCE nodes with URLs get a live badge: fetch the URL, let AI verify whether the quoted content actually matches the source. A color-coded indicator (✓ Verified / ~ Partial / ✗ Unverified / ? Unavailable) with explanation on hover. Catches hallucinations, stale links, misquotes.

### 4. Reading Resume
Remember the last page a user was on per thread. On return: "Pick up where you left off — page 7/29." Simple localStorage entry per threadId.

---

## Creatively Surprising

### 5. "Red Team" Mode ✅ *implemented*
One button on any ROOT node: AI generates 3–5 COUNTERPOINT nodes attacking the weakest parts of your argument — evidence gaps, logical leaps, missing context. Forces you to strengthen the claim. Like having an adversarial peer reviewer baked in.

### 6. Steelman Generator ✅ *implemented*
On any COUNTERPOINT node, click "Steelman" — AI rewrites the opposing argument in its strongest possible form, then auto-links it back as a new node. Most people argue against strawmen. This forces intellectual honesty.

### 7. Thread Forking ✅ *implemented*
Like git branches. Fork a thread to explore an alternative ROOT claim ("What if the opposite were true?"). Both forks coexist in the graph. Later you can merge insights back. Turns the app into a genuine reasoning sandbox.

### 8. Socratic Dialogue Mode ✅ *implemented*
Instead of open chat, a structured mode where AI only asks questions — no answers. Each probing question (if good enough) auto-generates a node for you to fill. Based on the Socratic method: you arrive at the answer yourself, fully cited.

---

## Ambitious / Transformative

### 9. Cross-Thread Knowledge Graph
Today every thread is an island. Surface semantic connections across threads: "Your Coca-Cola thread shares 3 evidence patterns with your Marketing thread." Clicking the connection creates a REFERENCE node bridging them. Over time your entire knowledge base becomes a single interconnected graph — a second brain.

### 10. "Claim Chain" Meta-View
A full-canvas view showing how ROOT nodes across all threads build on each other. How ideas beget ideas. One ROOT's SYNTHESIS becomes another thread's COUNTERPOINT. A visual map of your thinking over time.

### 11. Pressure Test
Submit any ROOT claim: AI queries real academic databases, news sources, Wikipedia — surfaces actual papers and articles that contradict or support it, automatically drafting EVIDENCE and COUNTERPOINT nodes. Grounds the knowledge graph in the real world.

### 12. Export as Essay / Living Paper
One-click: article sequence → formatted essay. AI writes smooth transitions between nodes, auto-formats citations from EVIDENCE sources, exports to PDF or Markdown. Optionally: a shareable public URL that updates live as the thread updates ("living paper").

### 13. Audio Mode
AI narrates the full article sequence with generated transitions between nodes so it flows like a podcast episode. Listen to your own research on a walk. TTS with adjustable speed, node-by-node navigation.

---

## Wildcard

### 14. Devil's Advocate Toggle
A single switch on the whole article view: AI flips every claim to its opposing viewpoint in real-time — same structure, same node types, but inverted. Useful for identifying where your argument is weakest (wherever the flip sounds most convincing).

### 15. Node Genealogy Tree
A visual showing how nodes were born: which chat message spawned which node, which node inspired which follow-up question. The intellectual lineage of ideas. You can see the exact moment a thread's direction changed.
