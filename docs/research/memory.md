# Long-term memory for agents: what the 2026 literature says, and which part of it applies here

Read for PLAN.md §9. One line per paper: what it measures, and what UniiChat
does about it. The point of keeping this file is that a later reader can
disagree with the reading instead of the prose.

| Paper | What it measures | What it says | What UniiChat does |
|---|---|---|---|
| *Context Collapse in Long-Horizon Agents* (SSRN 6976218, 2026) | hierarchical memory vs. flat RAG vs. summarization on long-horizon tasks | hierarchical, temporally-indexed memory holds up where flat retrieval and one-shot summarization collapse | the tree (`Memory.ts`) plus the temporal log read path (`Memory.search`) is the same shape |
| *Memora* (ACL 2026, arXiv 2604.20006) | recall **and** forgetting over weeks-to-months of conversation, with knowledge updates | agents fail by answering from a superseded value; credit is given for both remembering and forgetting | never forgets by design; the exposure is therefore staleness, not absence — see the supersession clause in `prompt.txt` |
| *RealMem* (ACL Findings 2026) | project-oriented interaction where goals evolve | agents keep acting on an earlier state of the project | `goal` and `work` in `view.json` are the only mutable memory; the prompt makes the latest word authoritative |
| *AgentMemBench* (arXiv 2608.00009) | five long-term memory strategies, reproducibly | strategy choice matters more than model choice at equal tokens | one strategy, measured by nothing yet: E2 is the gap |
| *HiMem* (arXiv 2601.06377) | hierarchical long-term memory for long-horizon agents | hierarchy beats flat windows on long-horizon recall | the tree's levels (`NODE`, `HIGH`) are this |
| *MemForest* (arXiv 2605.23986) | hierarchical **temporal** indexing for agent memory | the index, not the summary, is what makes old memory reachable | `search` over day files is the same idea without a dedicated index |

## What this file does not claim

- No numbers are reproduced here: the papers were read for their claims, not
  re-run. A claim that a design choice *wins* has to come from E2's fixtures.
- Nothing here justifies embeddings on the write path (`Memory.push`). The
  narrow version — vectors over immutable summary lines, built off the turn —
  is argued in PLAN.md §9 and is deliberately not built.
- The supersession clause in `prompt.txt` changes what every future line says.
  It needs E2 (recall of corrections, before vs. after) before it is called an
  improvement rather than a guess.
