# Coding workflow

- Commits are allowed without additional approval. Never push without explicit user approval;
  the user wants to test changes thoroughly before pushing.
- Summarize every file touched and the functions/helpers added, changed, or removed.
- Record changes in `CHANGELOG.md` under `[Unreleased]` during implementation.
- Update `docs/REFERENCE.md` and `docs/ARCHITECTURE.md` when relevant during documentation
  updates, alongside the changelog and implementation plans; do not defer them until pushing.

# Code discovery

Use the codebase-memory MCP graph before filesystem searches for structural code discovery.
Confirm the project/generation, discover symbols with `search_graph`, trace relevant callers and
callees, and read exact snippets. Check index coverage for evidence paths; read source directly
for gaps or stale results. Use text search for literals/configuration and insufficient graph results.
