# Context History

This directory stores structured context for the OpenClippy project, enabling future agents to quickly find and understand past work.

## Structure

```
context_history/
  context_index.md    # Master index — start here
  decisions.md        # Architectural decisions log
  contexts/           # Summaries of completed work
  transcripts/        # Verbatim session logs
  plans/              # Implementation designs
  snapshots/          # Point-in-time state captures
  handoffs/           # Session transfer documents
```

## Usage

- **Orientation:** Read `context_index.md` first
- **Search:** `grep -r "keyword" context_history/contexts/`
- **Decisions:** Check `decisions.md` for why things were built a certain way
