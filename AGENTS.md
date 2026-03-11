# AGENTS.md -- OpenClippy

## Shared Project Memory (NotebookLM)

Project notebook: `Project Memory - openclippy - local`
Notebook ID: `8ac84057-49bb-4ed2-aac0-1f94d3a237ce`

Required workflow:
1. Use `$project-kickoff-template` at task start.
2. Query NotebookLM context before implementation.
3. Use `project-update-history` at task end to append session memory.

## Context History

Local context lives in `./context_history/` — check `context_index.md` for orientation.
Decisions log: `./context_history/decisions.md`
Latest snapshot: `./context_history/snapshots/snapshot_2026-03-10_215000.md`

## Project State (as of 2026-03-10)

- **Phase 1-4 + 4.2**: Complete (632 tests, 36 suites)
- **Deferred**: Teams Bot (Task 2.3), Plugin system (Phase 4.1)
- **Repo**: https://github.com/revsmoke/openclippy
