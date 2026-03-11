# OpenClippy

Autonomous AI work agent for Microsoft 365. OpenClippy connects to your M365 account via the Microsoft Graph API and manages email, calendar, tasks, Teams, files, and more through natural language.

## Quick Start

```bash
# Install
pnpm install

# Configure Azure AD credentials
mkdir -p ~/.openclippy
cat > ~/.openclippy/config.yaml << 'EOF'
azure:
  clientId: "your-application-client-id"
  tenantId: "common"
EOF

# Authenticate
openclippy login

# Ask a question
openclippy ask "What are my unread emails?"

# Or start an interactive chat
openclippy chat
```

See [docs/setup.md](docs/setup.md) for the full Azure AD app registration walkthrough.

## Features

OpenClippy provides **61 tools** across **10 Microsoft 365 services**:

| Service | What It Does |
|---------|-------------|
| **Outlook Mail** | List, read, search, send, reply, forward, flag, move, delete emails |
| **Outlook Calendar** | View, create, update, delete events; accept/decline invites; check free/busy |
| **To Do** | Manage task lists; create, update, complete, delete tasks |
| **Teams Chat** | Read and send messages in chats and channels |
| **OneDrive** | Browse, read, search, upload, delete, and share files |
| **People & Contacts** | Search for relevant people and browse Outlook contacts |
| **Presence** | Read Teams availability; set and clear presence overrides |
| **Planner** | View plans, tasks, and buckets; create and update Planner tasks |
| **OneNote** | Browse notebooks and sections; read and create pages |
| **SharePoint** | Search sites; browse lists, items, and document libraries |

## Configuration

OpenClippy reads its configuration from `~/.openclippy/config.yaml`:

```yaml
azure:
  clientId: "your-application-client-id"
  tenantId: "common"

services:
  mail: { enabled: true }
  calendar: { enabled: true }
  todo: { enabled: true }
  teams-chat: { enabled: true }
  onedrive: { enabled: true }
  planner: { enabled: false }
  onenote: { enabled: false }
  sharepoint: { enabled: false }
  people: { enabled: true }
  presence: { enabled: true }

agent:
  model: "claude-sonnet-4-5-20250514"
  toolProfile: "standard"
  identity:
    name: "Clippy"
```

Enable or disable services based on what you need. OpenClippy will only request Graph API scopes for enabled services.

## Tool Profiles

Tool profiles control which operations the agent can perform:

| Profile | Allowed Operations | Use Case |
|---------|-------------------|----------|
| **read-only** | List, read, search, free/busy | Safe browsing -- no changes to your data |
| **standard** | Read-only + create, update, draft, flag, move, reply, forward | Day-to-day work (default) |
| **full** | Standard + send, delete, share, upload | Full autonomy including destructive operations |
| **admin** | Full + organization-wide operations | IT admin scenarios |

Set the profile in your config:

```yaml
agent:
  toolProfile: "standard"  # read-only | standard | full | admin
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `openclippy login` | Authenticate with your Microsoft account (device code flow) |
| `openclippy ask "..."` | One-shot query to the agent |
| `openclippy chat` | Interactive terminal chat session |
| `openclippy status` | Check auth and service status |
| `openclippy services` | List services and their scopes |
| `openclippy config` | Show or edit configuration |
| `openclippy gateway start` | Start the long-running gateway daemon |
| `openclippy gateway stop` | Stop the gateway |
| `openclippy gateway status` | Check gateway status |

## Plugins

Extend OpenClippy with custom service integrations. Plugins are ESM modules loaded from `~/.openclippy/plugins/` and configured via your `config.yaml`:

```yaml
plugins:
  my-service:
    enabled: true
```

See the [Plugin Authoring Guide](docs/plugin-authoring.md) for the full reference, or check out the [example plugin](examples/example-plugin/).

## Architecture

```
CLI / TUI / Teams Bot
        |
   Gateway (WebSocket + HTTP)
        |
   Agent Runtime (Claude LLM + tool dispatch)
        |
   Service Modules (Mail, Calendar, ToDo, ...)
        |
   Graph API Client (typed fetch, pagination, batching)
        |
   Microsoft Graph API
```

- **Auth:** MSAL device code flow (public client, no secret required)
- **Graph client:** Custom fetch-based client -- lean and typed, not the heavy `@microsoft/microsoft-graph-client`
- **Gateway:** Long-running daemon with WebSocket (for CLI/TUI clients) and HTTP (for Graph change notifications and Teams bot webhooks)
- **Subscriptions:** Mail and Calendar support Graph change notifications for real-time updates

## Tech Stack

- TypeScript (strict, ESM), Node.js 22+
- pnpm package manager
- @azure/msal-node for authentication
- @anthropic-ai/sdk for agent LLM (Claude)
- Commander.js for CLI
- better-sqlite3 for memory and sessions
- ws for WebSocket gateway
- vitest for testing, tsdown for building

## Documentation

- [Azure AD Setup Guide](docs/setup.md) -- Register your app and configure permissions
- [Service Reference](docs/services.md) -- All 10 services with capabilities, scopes, and tools
- [Tool Reference](docs/tools.md) -- Detailed reference for all 61 tools with parameters
- [Plugin Authoring Guide](docs/plugin-authoring.md) -- Build custom service integrations

## Requirements

- Node.js >= 22.12.0
- A Microsoft 365 account (work/school or personal)
- An Azure AD app registration ([setup guide](docs/setup.md))

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build with tsdown
pnpm test             # Run tests with vitest
pnpm dev              # Run in dev mode with tsx
pnpm lint             # Lint with oxlint
pnpm typecheck        # Type-check with tsc
```

## License

MIT
