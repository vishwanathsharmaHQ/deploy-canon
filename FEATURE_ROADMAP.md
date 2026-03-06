# Canon Feature Roadmap

> Updated March 2026. Builds on what Canon already has: graph + AI enrichment + spaced repetition + semantic search + ingestion + debate + Socratic + red team + snapshots + cross-thread links + timeline + confidence tracking.

---

## 1. Knowledge Autopilot — Continuous Background Enrichment

**What:** Instead of manual "enrich" clicks, Canon runs a background loop that watches your threads and proactively:
- Finds new evidence for low-confidence claims (web search -> ingest -> attach)
- Detects when two threads contradict each other and surfaces alerts
- Identifies "dead ends" — nodes with no children that could be expanded
- Monitors RSS feeds / arxiv / news for updates relevant to your threads

**Why it matters:** Knowledge curation is maintenance-heavy. This turns Canon from a tool you *use* into an agent that *works for you* while you sleep.

**Practical path:** Wire existing enrichment, web evidence, and contradiction detection endpoints into a cron-like queue (Bull/BullMQ + Redis, or even a simple `setInterval` with a priority queue). Add a "notifications" panel showing what Canon found overnight.

---

## 2. Collaborative Knowledge — Multi-User Threads with Contribution Attribution

**What:** Multiple users can:
- Fork and merge threads (like git for knowledge)
- Propose nodes that go through a review/accept flow
- See who contributed what (authorship on nodes, relationship attribution)
- Resolve disagreements through structured debate (debate mode, but between real people with AI mediating)

**Why it matters:** Knowledge is social. The best insights come from synthesis between different perspectives. Right now Canon is single-player.

**Practical path:** Add `created_by` on nodes/relationships, a `proposed` status on nodes (pending -> accepted/rejected), and a simple permissions model (owner, contributor, viewer). The merge flow can reuse the thread comparison view.

---

## 3. Learning Paths — Guided Journeys Through Knowledge

**What:** Canon generates a **learning path** from your knowledge graph:
- Pick a target concept -> Canon traces the prerequisite chain
- Generates a sequenced curriculum from your nodes (with review checkpoints)
- Adapts based on your spaced-repetition performance (skip mastered concepts, drill weak ones)
- Suggests external resources to fill gaps in your graph

**Why it matters:** Spaced repetition and sequencing exist but are disconnected. A learning path unifies them into "I want to deeply understand X — guide me."

**Practical path:** Use `DERIVES_FROM` and `SUPPORTS` relationships to build a dependency DAG. Topological sort gives the learning order. Integrate with the review system for adaptive scheduling.

---

## 4. Claim Provenance & Trust Chains

**What:** Every claim shows a visual "trust chain" — trace back through evidence -> sources -> original data. Features:
- **Source freshness indicators** — flag claims backed by outdated sources
- **Cascading confidence** — if a source is debunked, all downstream claims get flagged
- **Evidence diversity score** — how many independent sources support a claim?
- **Reproducibility markers** — tag evidence as "verified," "cited but unverified," "anecdotal"

**Why it matters:** The confidence system exists but is point-in-time. This makes confidence *dynamic* and *propagating* — debunk one source and see the ripple effect across your entire knowledge base.

**Practical path:** Add a Neo4j traversal query that follows CITES/SUPPORTS chains and computes cascading confidence. Show it as a heatmap overlay on the graph.

---

## 5. Natural Language Knowledge Entry — "Just Talk"

**What:** Instead of manually creating nodes and picking types, users can:
- Paste a paragraph -> Canon auto-decomposes it into claims, evidence, sources, relationships
- Voice-to-knowledge: dictate thoughts -> real-time structuring
- "I think X because Y, but Z complicates it" -> creates claim + evidence + counterpoint + QUALIFIES edge

**Why it matters:** The biggest friction is going from "I have a thought" to "structured knowledge." The ingest panel does this for URLs — extend it to raw text and speech.

**Practical path:** Build a dedicated "quick capture" mode that runs the same extraction pipeline but with a simpler UI — just a text box and a "structure this" button. The chat extraction prompt just needs to be tuned for unstructured personal notes.

---

## 6. Concept Map Layer — Emergent Ontology

**What:** Above individual threads, Canon builds an emergent **concept map**:
- Auto-extracts key concepts across all threads (concept extraction already exists)
- Clusters related threads by shared concepts
- Shows how your understanding of a concept *evolved* over time (via snapshots)
- Suggests "you've been thinking about X in threads A, B, C — want to synthesize?"

**Why it matters:** Individual threads are trees. The real power is the *forest*. This gives users a bird's-eye view of their entire knowledge landscape.

**Practical path:** Add a `Concept` node type in Neo4j, link concepts to nodes via `TAGGED_WITH`, and build a force-directed visualization at the concept level. The synthesis suggestion is a simple query: "find concepts appearing in 3+ threads with no synthesis node."

---

## 7. Hypothesis Workspace — What-If Reasoning

**What:** A sandbox mode where users can:
- Temporarily assume a claim is true/false and see cascading effects on the graph
- Run "what if Source X is unreliable?" — highlight all affected claims
- Compare two competing hypotheses side-by-side with shared evidence
- Score hypotheses by how much evidence they explain vs. leave unexplained

**Why it matters:** Critical thinking isn't just building arguments — it's stress-testing them. This turns Canon into a reasoning laboratory.

**Practical path:** Extend fork to accept "assume X is true" as a parameter, then run the analysis/validation pipeline on the forked version. The comparison view shows the delta.

---

## 8. Annotation & Highlight Layer for External Content

**What:** A browser extension that lets you:
- Highlight text on any webpage -> creates a node in Canon with source auto-linked
- Right-click -> "Challenge this claim in Canon" (opens debate mode)
- See Canon annotations overlaid on pages you've previously ingested
- Clip entire articles with one click (enhanced version of URL ingest)

**Why it matters:** Knowledge doesn't start in Canon — it starts on the web. Meeting users where they read dramatically increases capture rate.

**Practical path:** A Chrome extension that calls `/api/ingest/url` and `/api/threads/:id/nodes` endpoints. The highlight -> node flow is just a POST with selected text + URL + position metadata.

---

## 9. Temporal Intelligence — How Knowledge Evolves

**What:** Enhanced timeline that shows:
- When claims were added, challenged, and updated
- Confidence trends over time (was this claim getting stronger or weaker?)
- "Knowledge velocity" — how fast is a thread growing/stabilizing?
- Predictive: "This thread hasn't been reviewed in 30 days and has 3 unaddressed counterpoints"

**Why it matters:** Snapshots and timeline events exist. Surfacing *trends* turns raw history into actionable insight about your learning trajectory.

**Practical path:** Query snapshot confidence history, compute deltas, and render as sparklines next to each thread in the dashboard. The "stale thread" alert is a simple filter on `last_modified` + unaddressed counterpoints.

---

## 10. Export as Publishable Artifacts

**What:** One-click export to:
- **Research paper** structure (intro -> lit review -> argument -> conclusion) from article view
- **Slide deck** (key claims as slides, evidence as speaker notes)
- **Blog post** (narrative synthesis from thread)
- **Anki deck** (from review cards)
- **Obsidian/Notion** import (preserve graph structure as wiki-links)

**Why it matters:** Knowledge is only valuable if it goes somewhere. Right now export is MD/JSON — but users want *finished artifacts*.

**Practical path:** Summary and article view already produce structured text. Add templates that wrap this content in format-specific markup (reveal.js for slides, Anki XML for flashcards, wikilink syntax for Obsidian).

---

## Priority Matrix

| Feature | Impact | Effort | Do First? |
|---------|--------|--------|-----------|
| Natural Language Entry (#5) | Very High | Low | Yes — biggest friction reducer |
| Concept Map Layer (#6) | High | Medium | Yes — leverages existing infra |
| Claim Provenance (#4) | High | Medium | Yes — deepens core value prop |
| Learning Paths (#3) | High | Medium | Yes — unifies existing features |
| Knowledge Autopilot (#1) | Very High | High | Next — transformative but complex |
| Publishable Export (#10) | Medium | Low | Quick win |
| Hypothesis Workspace (#7) | High | Medium | Next |
| Collaboration (#2) | Very High | High | Later — architectural shift |
| Browser Extension (#8) | High | High | Later — separate codebase |
| Temporal Intelligence (#9) | Medium | Low | Quick win alongside #4 |

---

## Strategic Summary

Canon already has the *engine* (graph + AI + review). The next leap is making it:

- **Effortless to put knowledge in** (#5, #8)
- **Automatic in maintaining it** (#1, #4)
- **Powerful in getting knowledge out** (#3, #10)

The graph is the moat — lean into it.
