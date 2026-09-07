# Coding workflow

- Commits are allowed without additional approval. Never push without explicit user approval;
  the user wants to test changes thoroughly before pushing.
- Summarize every file touched and the functions/helpers added, changed, or removed.
- Record changes in `CHANGELOG.md` under `[Unreleased]` during implementation.
- Defer relevant `docs/REFERENCE.md` and `docs/ARCHITECTURE.md` updates until the user approves
  pushing or says they have pushed. At that point, update them to describe the implemented changes.

# Code discovery

Use the codebase-memory MCP graph before filesystem searches for structural code discovery.
Confirm the project/generation, discover symbols with `search_graph`, trace relevant callers and
callees, and read exact snippets. Check index coverage for evidence paths; read source directly
for gaps or stale results. Use text search for literals/configuration and insufficient graph results.
