# CLAUDE.md -- OpenClippy

## Overview
OpenClippy is an autonomous AI work agent for Microsoft 365, built with TypeScript/Node.js.
It uses the Microsoft Graph API to manage email, calendar, tasks, Teams, files, and more.

## Tech Stack
- TypeScript (strict, ESM), Node.js 22+
- pnpm package manager
- @azure/msal-node for auth
- @anthropic-ai/sdk for agent LLM (Claude)
- Custom fetch-based Graph API client (not @microsoft/microsoft-graph-client)
- vitest for testing, tsdown for building

## Azure AD App
- Client ID: bfe7dd6e-ed60-4bf4-8396-801a8eada469
- Tenant ID: ddd9f933-04a5-43f0-8673-5933da46cdcb
- Auth flow: Device code (public client, no secret)

## Key Patterns
- ServiceModule interface: Each M365 service (mail, calendar, etc.) implements this
- Tool profiles: read-only, standard, full, admin
- Config: YAML file at ~/.openclippy/config.yaml
- State dir: ~/.openclippy/

## Commands
- `pnpm build` -- Build with tsdown
- `pnpm test` -- Run vitest
- `pnpm dev` -- Run in dev mode with tsx
- `openclippy login` -- Authenticate
- `openclippy ask "..."` -- One-shot query
