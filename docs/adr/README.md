# Architecture Decision Records

Decisions that are expensive to reverse, and the reasoning that produced them. We are a small team with a real bus-factor problem — an ADR is how a decision survives the person who made it.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./ADR-0001-component-api-design-standard.md) | Component API design standard | Accepted |

## When to write one

Write an ADR when a choice is costly to undo or binds work that doesn't exist yet: a public API convention, a storage or persistence contract, a runtime dependency, a semver or support commitment, or anything touching the headless / storage-agnostic boundary in ADR-0001 §0.

Don't write one for reversible implementation details. A code comment is cheaper and closer to the truth.

## Process

1. Copy the template below to `ADR-NNNN-kebab-case-title.md`, next number, no gaps.
2. Open it as `Proposed` in a PR. The discussion belongs in the PR, the outcome belongs in the file.
3. On merge, set `Accepted`.
4. **ADRs are superseded, never rewritten.** To change an accepted decision, write a new ADR that says what changed and why, and mark the old one `Superseded by ADR-NNNN`. Editing history to look correct in hindsight destroys the only thing that makes these worth keeping.

Statuses: `Proposed` · `Accepted` · `Superseded by ADR-NNNN`.

## Template

```markdown
# ADR-NNNN: Title

**Status:** Proposed · **Date:** YYYY-MM-DD · **Author:** · **Reviewer:**

## Context
The forces at play. What makes this decision necessary, and what constraints
bound it. Written so someone who wasn't in the room can follow it.

## Decision
What we're doing, in the active voice. Specific enough to be checkable.

## Consequences
What this costs us, what it rules out, and what gets harder. An ADR with only
upside in this section hasn't been thought through.
```
