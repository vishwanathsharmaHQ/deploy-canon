# Feature Roadmap: Knowledge Curation & Learning App

## 1. Spaced Repetition & Active Recall

**The problem:** You curate knowledge beautifully, but there's no mechanism to *retain* it.

- **Auto-generated flashcards** from nodes — each EVIDENCE, EXAMPLE, and SYNTHESIS node becomes a reviewable card
- **Spaced repetition scheduler** (SM-2 algorithm) that surfaces cards at optimal intervals
- **Quiz mode** — given a ROOT claim, can you recall the supporting evidence? Given a COUNTERPOINT, can you steelman it yourself before seeing the AI version?
- **Knowledge decay indicators** on the graph — nodes you haven't reviewed fade/dim over time

---

## 2. Cross-Thread Knowledge Web

**The problem:** Threads are islands. Real knowledge is interconnected.

- **Inter-thread links** — connect a node in one thread to a node in another (e.g., "this EVIDENCE also supports that other claim")
- **Global knowledge graph** — a meta-view showing all your threads as a connected network, with shared nodes as bridges
- **Auto-detected connections** — AI scans your threads and suggests "this node in Thread A is related to this node in Thread B"
- **Concept index** — automatic tagging/taxonomy that emerges from your content (not predefined categories)

---

## 3. Research Pipeline & Source Management

**The problem:** Sources are URLs attached to nodes, but there's no deep source workflow.

- **PDF/article ingestion** — drop a paper, and AI extracts claims, evidence, and counterpoints as proposed nodes
- **Annotation layer** — highlight passages in ingested documents, link highlights directly to nodes
- **Source reliability scoring** — track which sources you've verified, flag conflicting sources
- **Bibliography generation** — export all sources from a thread as a formatted bibliography (APA, Chicago, etc.)
- **"Read later" queue** — bookmark URLs during chat, triage them later into threads

---

## 4. Collaborative Knowledge Building

**The problem:** Knowledge curation is currently single-player.

- **Shared threads with real-time collaboration** (CRDT-based, like Figma for knowledge)
- **Comment threads on individual nodes** — "I disagree with this evidence because..."
- **Merge requests for knowledge** — propose changes to someone else's thread, they review and accept/reject
- **Public thread gallery** — browse and fork other people's well-structured arguments
- **Debate mode** — two users take opposing sides, each builds their argument tree, AI moderates

---

## 5. Learning Paths & Curriculum Builder

**The problem:** Individual threads are great; structured learning journeys don't exist yet.

- **Learning paths** — chain threads into a sequence with prerequisites (Thread A → Thread B → Thread C)
- **Skill trees** — visual map of what you know and what's next, built from your thread completions
- **Progress tracking** — "You've covered 60% of the evidence in this domain"
- **Adaptive sequencing** — AI suggests which thread to tackle next based on gaps in your knowledge graph
- **Milestones & synthesis checkpoints** — after N threads, AI prompts you to write a synthesis connecting them

---

## 6. Multi-Modal Knowledge Nodes

**The problem:** Nodes are text-only. Knowledge comes in many forms.

- **Image nodes** — diagrams, charts, photos with AI-generated descriptions
- **Audio nodes** — record voice memos, auto-transcribe, extract structure
- **Video clip nodes** — embed YouTube timestamps as evidence (you already support YouTube in articles)
- **Code nodes** — syntax-highlighted, runnable code snippets for technical learning
- **Math nodes** — LaTeX rendering for equations and proofs

---

## 7. Temporal & Versioning Intelligence

**The problem:** Knowledge evolves, but the app captures only the current state.

- **Thread timeline** — see how your understanding evolved (what nodes were added when, what was revised)
- **Claim versioning** — track how a ROOT claim was refined over time
- **"What changed" diffs** — compare two versions of a thread
- **Confidence history** — plot your claim confidence score over time as you add evidence
- **Journaling mode** — daily reflection prompts that connect back to your threads ("What did you learn today about X?")

---

## 8. Export & Integration

**The problem:** Knowledge trapped in the app has limited utility.

- **Export as essay/paper** — article view → polished document (Markdown, PDF, LaTeX)
- **Export as presentation** — nodes become slides, graph becomes a visual aid
- **Obsidian/Notion sync** — bidirectional sync with popular PKM tools
- **API for external integrations** — let users pipe in highlights from Kindle, Readwise, Hypothes.is
- **Share as interactive embed** — embed a read-only graph view in a blog post

---

## 9. AI Tutor Mode (Beyond Socratic)

**The problem:** Socratic mode asks questions. But sometimes you need explanations, analogies, and scaffolding.

- **Explain Like I'm 5 / Expert toggle** — AI adapts explanation depth per node
- **Analogy engine** — "Explain this concept using an analogy from [cooking/sports/programming]"
- **Gap analysis** — "Based on your threads, here's what you seem to understand well and where you have blind spots"
- **Devil's advocate scheduled challenges** — periodic push notifications: "It's been 2 weeks since you red-teamed your claim about X. New evidence has emerged..."
- **Teaching mode** — "Explain this thread to me as if you're teaching it" — the best way to learn is to teach

---

## 10. Smart Search & Discovery

**The problem:** As thread count grows, finding things becomes critical.

- **Semantic search** — search by meaning, not just keywords ("find my threads about cognitive biases" finds threads even if they never use that phrase)
- **Question-answering over your knowledge base** — "What do I know about X?" searches across all threads and synthesizes
- **Related threads suggestions** on every thread page
- **"Surprise me"** — surface a random thread you haven't revisited in a while
- **Contradictions detector** — "You claim X in Thread A but Y in Thread B — these may conflict"

---

## Top 5 "Build These First" Recommendations

| Priority | Feature | Why |
|----------|---------|-----|
| **1** | Cross-thread knowledge web | Transforms isolated threads into a true second brain |
| **2** | Spaced repetition & active recall | Closes the learn→retain gap — the #1 complaint with note-taking apps |
| **3** | PDF/article ingestion pipeline | Dramatically lowers the cost of adding knowledge — paste a URL, get structured nodes |
| **4** | Semantic search across all threads | Essential as content grows; makes the whole system more valuable over time |
| **5** | Confidence history + timeline | Makes the "thinking tool" aspect tangible and motivating |
