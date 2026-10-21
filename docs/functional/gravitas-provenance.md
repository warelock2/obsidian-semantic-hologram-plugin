---
hologram-node: true
node-type: concept
groups: []
created: 2026-10-19
---

# Gravitas Provenance

> **Status:** REFERENCE — example. Wave 2026-10-19. See [`docs/README.md`](../README.md).

Plug-in-derived provenance section (replaces the legacy `## Gravitas` header on mechanism nodes; evidence notes keep their authored `## Gravitas` content, only the header migrates to `## Gravitas Provenance`). Lists source notes that lend gravitas to this node, with amounts scaled so the listed entries sum to `Math.min(1, gravitasReal)`. Direct entries are unmarked; inherited entries carry `(inherited)` after the strength value (weighted propagated share via `structural/subsumed-by`).

## Relationships

- structural/subsumed-by [[Linux Kernel Internals]] (0.50) :: Group parent

## Incoming relationships

- ([[CPU Ring]]) structural/subsumed-by (0.5)
- ([[Syscall]]) functional/supports (1)

## Gravitas Provenance

  - ([[Source A]]) epistemic/evidence (0.72)
  - ([[Source B]]) epistemic/evidence (0.24) (inherited)

## Confidence

  - local-confidence: 0.5
  - inherited-confidence: 0.5
  - total-confidence: 1
