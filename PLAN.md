# OpenClippy — Implementation Plan

## Context

**Problem:** Bryan needs a personal AI work agent for the Microsoft 365 ecosystem — one that can manage email, calendar, tasks, Teams messages, files, and more via the Microsoft Graph API, the same way OpenClaw manages messaging channels (WhatsApp, Telegram, Discord, etc.).

**Solution:** Build **OpenClippy**, a standalone TypeScript/Node.js autonomous agent modeled after OpenClaw's architecture but substituting the entire channel/messaging ecosystem with Microsoft 365 Graph API services. The user authenticates with their M365 credentials and Clippy becomes their work agent — reading mail, scheduling meetings, managing tasks, chatting in Teams, and more.

**Key decisions from user input:**
- Standalone project (not an OpenClaw plugin)
- Anthropic Claude as default LLM provider
- Teams serves as BOTH a communication channel (user talks to Clippy) AND a managed service
- Priority services: Mail, Calendar, ToDo, Teams Chat
- Architecture mirrors OpenClaw's patterns but is independent

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   OPENCLIPPY GATEWAY                        │
│              (localhost:4100, WebSocket + HTTP)              │
├─────────────────────────────────────────────────────────────┤
│  INTERACTION LAYER (how the user talks to Clippy)           │
│  ├── CLI (one-shot commands)                                │
│  ├── TUI (interactive terminal chat)                        │
│  └── Teams Bot Channel (chat with Clippy in Teams)          │
├─────────────────────────────────────────────────────────────┤
│  AGENT RUNTIME                                              │
│  ├── Anthropic Claude (default LLM)                         │
│  ├── System prompt with M365 context                        │
│  ├── Tool dispatcher (routes to service modules)            │
│  ├── Session management                                     │
│  └── Memory (conversation + vector search)                  │
├─────────────────────────────────────────────────────────────┤
│  SERVICE MODULES (what Clippy can do)                       │
│  ├── Mail (Outlook)        ├── Calendar                     │
│  ├── ToDo                  ├── Teams Chat                   │
│  ├── OneDrive              ├── Planner                      │
│  ├── OneNote               ├── SharePoint                   │
│  ├── People/Contacts       └── Presence                     │
├─────────────────────────────────────────────────────────────┤
│  GRAPH API LAYER                                            │
│  ├── Custom fetch-based client (lean, typed)                │
│  ├── OData query builder                                    │
│  ├── Pagination helpers                                     │
│  ├── $batch request support                                 │
│  └── Rate limiting + retry logic                            │
├─────────────────────────────────────────────────────────────┤
│  AUTH LAYER (MSAL)                                          │
│  ├── Device code flow (CLI login)                           │
│  ├── Token cache (file-based, 0o600 permissions)            │
│  ├── Silent token renewal                                   │
│  ├── Incremental consent (add scopes per service)           │
│  └── Multi-account support                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
openclippy/
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts
├── openclippy.mjs              # CLI bin entry
├── CLAUDE.md
├── README.md
│
├── src/
│   ├── index.ts                # Main exports + CLI bootstrap
│   ├── entry.ts                # Entry wrapper (respawn logic)
│   │
│   ├── auth/                   # Microsoft identity / MSAL
│   │   ├── msal-client.ts      # PublicClientApplication wrapper
│   │   ├── token-cache.ts      # ICachePlugin file persistence
│   │   ├── credentials.ts      # Credential resolution (config + env)
│   │   └── scope-manager.ts    # Incremental consent tracking
│   │
│   ├── graph/                  # Microsoft Graph API client
│   │   ├── client.ts           # graphRequest, graphPaginate, graphBatch
│   │   ├── types.ts            # GraphResponse, GraphError
│   │   ├── odata.ts            # OData filter/query/select helpers
│   │   └── rate-limit.ts       # 429 handling, retry-after, throttle
│   │
│   ├── services/               # M365 service modules (replaces channels)
│   │   ├── types.ts            # ServiceModule interface
│   │   ├── registry.ts         # Service registry + discovery
│   │   │
│   │   ├── mail/               # Outlook Mail
│   │   │   ├── module.ts       # ServiceModule impl
│   │   │   ├── tools.ts        # mail_list, mail_read, mail_send, etc.
│   │   │   └── types.ts        # GraphMessage, GraphMailFolder
│   │   │
│   │   ├── calendar/           # Calendar / Events
│   │   │   ├── module.ts
│   │   │   ├── tools.ts        # calendar_list, calendar_create, etc.
│   │   │   └── types.ts        # GraphEvent, GraphCalendar
│   │   │
│   │   ├── todo/               # Microsoft To Do
│   │   │   ├── module.ts
│   │   │   ├── tools.ts        # todo_lists, todo_create, todo_update, etc.
│   │   │   └── types.ts        # TodoTaskList, TodoTask
│   │   │
│   │   ├── teams-chat/         # Teams Chat (managed service side)
│   │   │   ├── module.ts
│   │   │   ├── tools.ts        # teams_list_chats, teams_send, etc.
│   │   │   └── types.ts        # ChatMessage, Chat, Team
│   │   │
│   │   ├── onedrive/           # OneDrive files
│   │   │   ├── module.ts
│   │   │   ├── tools.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── planner/
│   │   │   ├── module.ts
│   │   │   ├── tools.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── onenote/
│   │   │   ├── module.ts
│   │   │   ├── tools.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── sharepoint/
│   │   │   ├── module.ts
│   │   │   ├── tools.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── people/
│   │   │   ├── module.ts
│   │   │   ├── tools.ts
│   │   │   └── types.ts
│   │   │
│   │   └── presence/
│   │       ├── module.ts
│   │       ├── tools.ts
│   │       └── types.ts
│   │
│   ├── agents/                 # Agent runtime
│   │   ├── runtime.ts          # Agent loop (Anthropic SDK tool calling)
│   │   ├── prompt-builder.ts   # System prompt construction
│   │   ├── tool-registry.ts    # Collect tools from enabled services
│   │   ├── tool-profiles.ts    # read-only / standard / full / admin
│   │   ├── model-config.ts     # LLM provider config (Claude default)
│   │   └── session.ts          # Agent session state
│   │
│   ├── channels/               # Interaction channels (how user talks to Clippy)
│   │   ├── types.ts            # Channel interface
│   │   ├── teams-bot/          # Teams Bot Framework channel
│   │   │   ├── bot.ts          # Bot adapter + activity handler
│   │   │   ├── auth.ts         # Bot registration + token
│   │   │   └── webhook.ts      # Incoming webhook handler
│   │   └── webchat/            # Future: web UI channel
│   │       └── ...
│   │
│   ├── gateway/                # Long-running daemon
│   │   ├── server.ts           # Gateway start/stop/reload
│   │   ├── server-http.ts      # HTTP: Graph webhooks + Teams bot endpoint
│   │   ├── server-ws.ts        # WebSocket: CLI/TUI client connections
│   │   ├── subscriptions.ts    # Graph change notification lifecycle
│   │   └── heartbeat.ts        # Polling for non-webhook services
│   │
│   ├── cli/                    # CLI commands
│   │   ├── program.ts          # Commander.js program definition
│   │   ├── login.ts            # `openclippy login` (device code flow)
│   │   ├── status.ts           # `openclippy status`
│   │   ├── ask.ts              # `openclippy ask "..."` (one-shot)
│   │   ├── gateway.ts          # `openclippy gateway start/stop`
│   │   ├── config.ts           # `openclippy config`
│   │   └── services.ts         # `openclippy services`
│   │
│   ├── tui/                    # Terminal UI (interactive chat)
│   │   ├── tui.ts              # Main TUI app
│   │   ├── chat.ts             # Chat input/output
│   │   └── status-bar.ts       # Service status display
│   │
│   ├── config/                 # Configuration
│   │   ├── config.ts           # loadConfig, validateConfig
│   │   ├── defaults.ts         # Default values
│   │   ├── paths.ts            # ~/.openclippy/ paths
│   │   ├── types.ts            # Barrel export
│   │   ├── types.azure.ts      # Azure AD config
│   │   ├── types.services.ts   # Per-service config
│   │   ├── types.agent.ts      # Agent config
│   │   ├── types.tools.ts      # Tool profile config
│   │   ├── types.gateway.ts    # Gateway config
│   │   └── types.secrets.ts    # Secret resolution
│   │
│   ├── memory/                 # Memory / context
│   │   ├── store.ts            # SQLite-backed store
│   │   └── search.ts           # Vector + keyword search
│   │
│   ├── secrets/                # Secret management
│   │   ├── resolve.ts          # SecretRef resolution
│   │   └── types.ts            # SecretInput, SecretRef
│   │
│   └── utils/                  # Shared helpers
│       ├── odata.ts            # OData query builder
│       ├── dates.ts            # Date/time formatting
│       └── format.ts           # Output formatting
│
├── tests/                      # Test suites
│   ├── auth/
│   ├── graph/
│   ├── services/
│   │   ├── mail/
│   │   ├── calendar/
│   │   ├── todo/
│   │   └── teams-chat/
│   ├── agents/
│   ├── gateway/
│   └── cli/
│
└── docs/                       # Documentation
    ├── setup.md                # Azure AD app registration guide
    ├── services.md             # Service reference
    └── tools.md                # Tool reference
```

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript (strict, ESM) | Matches OpenClaw |
| Runtime | Node.js 22+ | Built-in fetch, ESM support |
| Package mgr | pnpm | Matches OpenClaw |
| Build | tsdown | Matches OpenClaw, fast |
| Tests | vitest | Matches OpenClaw, ESM-native |
| CLI | Commander.js | Matches OpenClaw |
| Auth | @azure/msal-node | Official MS auth library |
| Graph client | Custom fetch-based | Lean, typed, full control (not @microsoft/microsoft-graph-client) |
| LLM | @anthropic-ai/sdk | Claude as default agent brain |
| Schema | @sinclair/typebox | Tool input schemas, matches OpenClaw |
| Config validation | zod | Runtime validation |
| Config format | YAML (yaml package) | Human-readable |
| Database | better-sqlite3 | Memory, sessions, token cache |
| Vector search | sqlite-vec | Embedded vector search |
| WebSocket | ws | Gateway communication |
| Teams Bot | botbuilder (Bot Framework SDK) | Teams channel integration |

---

## Core Interfaces

### ServiceModule (replaces OpenClaw's ChannelPlugin)

```typescript
type ServiceModule = {
  id: ServiceId;
  meta: {
    label: string;
    description: string;
    requiredScopes: string[];
    optionalScopes?: string[];
  };
  capabilities: {
    read: boolean;
    write: boolean;
    delete: boolean;
    search: boolean;
    subscribe: boolean;  // Graph change notifications
  };
  tools: (params: { token: string }) => AgentTool[];
  status?: {
    probe: (params: { token: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  subscriptions?: {
    resources: string[];        // e.g. ["/me/messages"]
    changeTypes: string[];      // ["created", "updated"]
    handle: (notification) => Promise<void>;
  };
  promptHints?: () => string[];  // Context hints for agent system prompt
};
```

### Graph API Client

```typescript
// Lean fetch wrapper — NOT the heavy @microsoft/microsoft-graph-client
async function graphRequest<T>(params: {
  token: string;
  path: string;            // e.g. "/me/messages"
  method?: string;         // default "GET"
  body?: unknown;
  version?: "v1.0" | "beta";
}): Promise<T>;

// Auto-pagination
async function graphPaginate<T>(params): Promise<T[]>;

// Batch (up to 20 requests)
async function graphBatch(params): Promise<BatchResponse[]>;
```

### Tool Profiles

```typescript
type ToolProfile = "read-only" | "standard" | "full" | "admin";

// read-only:  list, read, search across all services
// standard:   + create, update, draft, flag, move
// full:       + send, delete, share (destructive ops)
// admin:      + org-wide operations, SharePoint manage
```

---

## Graph API Endpoints by Service

### Mail (Priority: Phase 1)
| Tool | Method | Endpoint | Scopes |
|------|--------|----------|--------|
| mail_list | GET | /me/messages | Mail.Read |
| mail_read | GET | /me/messages/{id} | Mail.Read |
| mail_search | GET | /me/messages?$search= | Mail.Read |
| mail_send | POST | /me/sendMail | Mail.Send |
| mail_draft | POST | /me/messages | Mail.ReadWrite |
| mail_reply | POST | /me/messages/{id}/reply | Mail.Send |
| mail_forward | POST | /me/messages/{id}/forward | Mail.Send |
| mail_move | POST | /me/messages/{id}/move | Mail.ReadWrite |
| mail_flag | PATCH | /me/messages/{id} | Mail.ReadWrite |
| mail_delete | DELETE | /me/messages/{id} | Mail.ReadWrite |
| mail_folders | GET | /me/mailFolders | Mail.Read |

### Calendar (Priority: Phase 1)
| Tool | Method | Endpoint | Scopes |
|------|--------|----------|--------|
| calendar_list | GET | /me/calendarView?start=&end= | Calendars.Read |
| calendar_read | GET | /me/events/{id} | Calendars.Read |
| calendar_create | POST | /me/events | Calendars.ReadWrite |
| calendar_update | PATCH | /me/events/{id} | Calendars.ReadWrite |
| calendar_delete | DELETE | /me/events/{id} | Calendars.ReadWrite |
| calendar_accept | POST | /me/events/{id}/accept | Calendars.ReadWrite |
| calendar_decline | POST | /me/events/{id}/decline | Calendars.ReadWrite |
| calendar_freebusy | POST | /me/calendar/getSchedule | Calendars.Read |

### ToDo (Priority: Phase 1)
| Tool | Method | Endpoint | Scopes |
|------|--------|----------|--------|
| todo_lists | GET | /me/todo/lists | Tasks.Read |
| todo_tasks | GET | /me/todo/lists/{id}/tasks | Tasks.Read |
| todo_create | POST | /me/todo/lists/{id}/tasks | Tasks.ReadWrite |
| todo_update | PATCH | /me/todo/lists/{id}/tasks/{taskId} | Tasks.ReadWrite |
| todo_complete | PATCH | /me/todo/lists/{id}/tasks/{taskId} | Tasks.ReadWrite |
| todo_delete | DELETE | /me/todo/lists/{id}/tasks/{taskId} | Tasks.ReadWrite |

### Teams Chat (Priority: Phase 1)
| Tool | Method | Endpoint | Scopes |
|------|--------|----------|--------|
| teams_list_chats | GET | /me/chats | Chat.Read |
| teams_read_chat | GET | /me/chats/{id}/messages | Chat.Read |
| teams_send | POST | /me/chats/{id}/messages | ChatMessage.Send |
| teams_list_channels | GET | /teams/{id}/channels | Channel.ReadBasic.All |
| teams_channel_messages | GET | /teams/{id}/channels/{id}/messages | ChannelMessage.Read.All |
| teams_send_channel | POST | /teams/{id}/channels/{id}/messages | ChannelMessage.Send |

### OneDrive (Priority: Phase 2)
| Tool | Method | Endpoint | Scopes |
|------|--------|----------|--------|
| files_list | GET | /me/drive/root/children | Files.Read |
| files_read | GET | /me/drive/items/{id}/content | Files.Read |
| files_search | GET | /me/drive/root/search(q='') | Files.Read |
| files_upload | PUT | /me/drive/root:/{path}:/content | Files.ReadWrite |
| files_mkdir | POST | /me/drive/root/children | Files.ReadWrite |
| files_delete | DELETE | /me/drive/items/{id} | Files.ReadWrite |
| files_share | POST | /me/drive/items/{id}/createLink | Files.ReadWrite |

### People (Phase 2), Presence (Phase 2), Planner (Phase 3), OneNote (Phase 3), SharePoint (Phase 3)
_(Deferred — same pattern, endpoints documented in Microsoft Graph API reference)_

---

## Authentication Flow

### Azure AD App Registration (prerequisite)

```
1. Go to https://portal.azure.com → Azure Active Directory → App registrations
2. New registration:
   - Name: "OpenClippy"
   - Supported account types: "Accounts in any org directory + personal MS accounts"
   - Redirect URI: select "Mobile and desktop" → https://login.microsoftonline.com/common/oauth2/nativeclient
3. Note the Application (client) ID
4. API permissions → Add permission → Microsoft Graph → Delegated:
   - User.Read, offline_access (minimum)
   - Mail.Read, Mail.Send, Mail.ReadWrite
   - Calendars.Read, Calendars.ReadWrite
   - Tasks.Read, Tasks.ReadWrite
   - Chat.Read, ChatMessage.Send
5. No client secret needed (public client, device code flow)
```

### Login Flow

```
$ openclippy login

To sign in, use a web browser to open https://microsoft.com/devicelogin
and enter the code XXXXXXXX to authenticate.

✓ Signed in as bryan@example.com
✓ Token cached at ~/.openclippy/token-cache.json
✓ Granted scopes: User.Read, offline_access, Mail.Read, ...

Enable services:
  ✓ Mail (Mail.Read, Mail.Send)
  ✓ Calendar (Calendars.Read, Calendars.ReadWrite)
  ✓ ToDo (Tasks.Read, Tasks.ReadWrite)
  ✓ Teams Chat (Chat.Read, ChatMessage.Send)
```

---

## Agent System Prompt (abbreviated)

```
You are Clippy, a personal AI work assistant for Microsoft 365. You help
the user manage their email, calendar, tasks, Teams messages, and files.

You have access to the following M365 services:
- Mail: Read, search, send, reply, forward, flag, move, delete emails
- Calendar: View, create, update, accept/decline events and meetings
- ToDo: List, create, update, complete, delete tasks
- Teams Chat: Read and send Teams chat messages

Current context:
- User: Bryan Rice (bryan@example.com)
- Time: 2026-03-10 10:30 AM CST
- Unread emails: 12
- Today's events: 3 (next: "Sprint Planning" at 11:00 AM)
- Overdue tasks: 2

Guidelines:
- Always confirm before sending emails or messages
- Always confirm before deleting anything
- For meetings, check free/busy before scheduling
- Summarize long email threads rather than dumping raw content
- Use the user's timezone for all date/time displays
```

---

## Configuration (openclippy.yaml)

```yaml
azure:
  clientId: "your-app-registration-client-id"
  tenantId: "common"

services:
  mail: { enabled: true }
  calendar: { enabled: true }
  todo: { enabled: true }
  teams-chat: { enabled: true }
  onedrive: { enabled: false }
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
    emoji: "📎"

gateway:
  port: 4100

teams-bot:
  enabled: false
  appId: ""         # Bot Framework app ID
  appPassword: ""   # Bot Framework app password
```

---

## Implementation Phases

### Phase 1: Core + Auth + Mail + Calendar + ToDo + Teams Chat
**Goal:** Working CLI agent that can authenticate and manage the priority M365 services.

- [x] **1.1 Project scaffold**
  - package.json (pnpm, ESM, Node 22+)
  - tsconfig.json (strict, ES2022 target, NodeNext module)
  - tsdown.config.ts
  - vitest.config.ts
  - openclippy.mjs CLI entry point
  - CLAUDE.md

- [ ] **1.2 Configuration system** (`src/config/`)
  - Config types (azure, services, agent, gateway, secrets)
  - Config loader (YAML + env vars + defaults)
  - Config validation (zod schemas)
  - Paths (state dir: ~/.openclippy/)

- [ ] **1.3 Secret management** (`src/secrets/`)
  - SecretInput type (env, file, exec sources) — port from OpenClaw
  - Secret resolution

- [ ] **1.4 Authentication** (`src/auth/`)
  - MSALClient wrapper (PublicClientApplication)
  - TokenCachePlugin (file persistence, 0o600)
  - Credential resolution (config → env → defaults)
  - ScopeManager (incremental consent tracking)
  - Tests: mock device code flow, token cache read/write

- [ ] **1.5 Graph API client** (`src/graph/`)
  - graphRequest (typed fetch wrapper)
  - graphPaginate (auto-follow @odata.nextLink)
  - graphBatch ($batch support, up to 20 ops)
  - GraphApiError class
  - Rate limit handling (429 + Retry-After)
  - Tests: mock responses, pagination, error handling

- [ ] **1.6 Service module interface** (`src/services/`)
  - ServiceModule type definition
  - Service registry
  - Service discovery (list enabled, check scopes)

- [ ] **1.7 Mail service** (`src/services/mail/`)
  - Tools: mail_list, mail_read, mail_search, mail_send, mail_draft, mail_reply, mail_forward, mail_move, mail_flag, mail_delete, mail_folders
  - Graph type definitions
  - Tests: each tool with mocked Graph responses

- [ ] **1.8 Calendar service** (`src/services/calendar/`)
  - Tools: calendar_list, calendar_read, calendar_create, calendar_update, calendar_delete, calendar_accept, calendar_decline, calendar_freebusy
  - Tests

- [ ] **1.9 ToDo service** (`src/services/todo/`)
  - Tools: todo_lists, todo_tasks, todo_create, todo_update, todo_complete, todo_delete
  - Tests

- [ ] **1.10 Teams Chat service** (`src/services/teams-chat/`)
  - Tools: teams_list_chats, teams_read_chat, teams_send, teams_list_channels, teams_channel_messages, teams_send_channel
  - Tests

- [ ] **1.11 Agent runtime** (`src/agents/`)
  - Anthropic SDK integration (tool_use / function calling)
  - Tool registry (collect tools from enabled services)
  - Tool profiles (read-only, standard, full, admin)
  - System prompt builder (identity + services + context)
  - Agent session (conversation state)
  - Tests: prompt building, tool dispatch

- [ ] **1.12 CLI** (`src/cli/`)
  - `openclippy login` — device code flow
  - `openclippy status` — auth + service status
  - `openclippy ask "..."` — one-shot agent query
  - `openclippy services` — list services + scopes
  - `openclippy config` — show/edit config
  - Tests: CLI argument parsing

- [ ] **1.13 Integration tests**
  - End-to-end: login → list mail → send reply
  - End-to-end: ask agent → agent uses mail tool → returns answer
  - Mock Graph API server for integration testing

### Phase 2: Gateway + Teams Bot Channel + OneDrive + People + Presence
**Goal:** Long-running daemon, Teams as a channel, expanded services.

- [x] **2.1 Gateway server** (`src/gateway/`)
  - WebSocket server for CLI/TUI clients
  - HTTP server for webhooks (Graph notifications + Teams bot)
  - Token management (silent renewal loop)
  - Session store

- [x] **2.2 Graph change notifications** (`src/gateway/subscriptions.ts`)
  - [x] Read existing patterns (client.ts, server.ts, types.ts, server-http.ts)
  - [x] Define subscription types (SubscriptionResource, GraphSubscription, etc.)
  - [x] Write tests FIRST (TDD red):
    - [x] Create subscription (mock Graph API)
    - [x] Renew subscription
    - [x] Delete subscription
    - [x] Process notification payload → NotificationEvent
    - [x] Auto-renew scheduling logic (fake timers)
    - [x] Error handling (Graph API failures)
    - [x] Start/stop lifecycle
    - [x] Multiple subscriptions (mail + calendar + todo)
    - [x] Client state validation
    - [x] Resource path mapping
  - [x] Implement SubscriptionManager (TDD green):
    - [x] createSubscription() — POST /subscriptions
    - [x] renewSubscription() — PATCH /subscriptions/{id}
    - [x] deleteSubscription() — DELETE /subscriptions/{id}
    - [x] processNotification() — parse payload → NotificationEvent
    - [x] start() / stop() — lifecycle with auto-renew timers
  - [x] Run full test suite — no regressions (412 tests pass, 34 new)
  - [x] Quality assurance review

- [ ] **2.3 Teams Bot channel** (`src/channels/teams-bot/`)
  - Bot Framework adapter (botbuilder SDK)
  - Activity handler (message → agent → reply)
  - Bot registration + manifest
  - Proactive messaging support

- [x] **2.4 OneDrive service** (`src/services/onedrive/`)
  - Tools: files_list, files_read, files_search, files_upload, files_mkdir, files_delete, files_share

- [x] **2.5 People service** (`src/services/people/`)
  - Tools: people_search, contacts_list, contacts_read

- [x] **2.6 Presence service** (`src/services/presence/`)
  - Tools: presence_read, presence_set

- [x] **2.7 Heartbeat runner** (`src/gateway/heartbeat.ts`)
  - Morning briefing (unread count, today's events, overdue tasks)
  - Meeting prep (5 min before: attendees, agenda, files)
  - Configurable triggers and schedules

### Task 2.7 — Heartbeat Runner Implementation Plan (COMPLETE)
- [x] Read existing patterns (server.ts, server-ws.ts, runtime.ts, types.ts, session.ts)
- [x] Create `src/gateway/heartbeat-types.ts` — HeartbeatConfig and related types
- [x] Write `src/gateway/heartbeat.test.ts` — TDD red tests (21 tests):
  - [x] Config defaults applied correctly
  - [x] Merges partial config with defaults
  - [x] Morning briefing triggers at configured time
  - [x] Morning briefing broadcasts result to clients
  - [x] Morning briefing uses correct agent prompt
  - [x] Morning briefing triggers at custom time
  - [x] Meeting prep triggers before upcoming event
  - [x] Meeting prep includes meeting title in prompt
  - [x] Meeting prep does not fire twice for same event
  - [x] Meeting prep respects configurable check interval
  - [x] Meeting prep broadcasts result to clients
  - [x] Disabled heartbeats don't trigger (enabled=false)
  - [x] Disabled morning briefing doesn't trigger
  - [x] Disabled meeting prep doesn't trigger
  - [x] Start/stop lifecycle
  - [x] Double-start is idempotent
  - [x] Double-stop is safe
  - [x] Error in runAgent doesn't crash briefing
  - [x] Error in runAgent doesn't crash meeting prep
  - [x] Error in fetchUpcomingEvents doesn't crash heartbeat
  - [x] No triggers fire after stop()
- [x] Create `src/gateway/heartbeat.ts` — HeartbeatRunner implementation (TDD green)
- [x] Run `npx vitest run src/gateway/heartbeat.test.ts` — 21/21 pass
- [x] Run `npx vitest run` — 412/412 pass, no regressions (pre-existing gateway CLI test failure unrelated)
- [x] Quality assurance review

- [x] **2.8 Gateway CLI** (`src/cli/gateway.ts`)
  - `openclippy gateway start` / `stop` / `status`

### Task 2.8 — Gateway CLI Implementation Plan (COMPLETE)
- [x] Read existing files: program.ts, cli.test.ts, server.ts, config.ts, types.gateway.ts, paths.ts
- [x] Write RED tests in `src/cli/gateway.test.ts` (26 tests)
  - [x] PID_FILE_PATH is in state dir
  - [x] writePidFile writes PID
  - [x] readPidFile returns PID when file exists
  - [x] readPidFile returns null when no file
  - [x] readPidFile returns null for invalid content
  - [x] removePidFile removes when exists
  - [x] removePidFile does nothing when missing
  - [x] isProcessAlive returns true for alive process
  - [x] isProcessAlive returns false for dead PID
  - [x] gateway start logs listening address
  - [x] gateway start writes PID file
  - [x] gateway start uses port/host from config
  - [x] gateway start refuses if already running
  - [x] gateway start cleans stale PID and starts
  - [x] gateway start handles start failure
  - [x] gateway stop sends SIGTERM
  - [x] gateway stop removes PID file
  - [x] gateway stop logs confirmation
  - [x] gateway stop reports not running (no PID)
  - [x] gateway stop cleans stale PID
  - [x] gateway status: not running (no PID file)
  - [x] gateway status: stale PID cleanup
  - [x] gateway status: shows running with PID
  - [x] gateway status: shows port from config
  - [x] gateway command registered in CLI
  - [x] gateway has start/stop/status subcommands
- [x] Run tests — confirmed RED (module not found)
- [x] Write GREEN implementation in `src/cli/gateway.ts`
  - [x] gatewayStartCommand()
  - [x] gatewayStopCommand()
  - [x] gatewayStatusCommand()
  - [x] PID file helpers (writePidFile, readPidFile, removePidFile, isProcessAlive)
  - [x] Signal handlers (SIGINT/SIGTERM)
- [x] Register gateway subcommand in program.ts
- [x] Run `npx vitest run src/cli/gateway.test.ts` — 26/26 pass
- [x] Run `npx vitest run` — 438/438 pass, no regressions
- [x] Quality assurance review

### Phase 3: TUI + Memory + Planner + OneNote + SharePoint
**Goal:** Rich interactive experience and full M365 coverage.

- [x] **3.1 TUI** (`src/tui/`)
  - [x] tui.ts — Readline-based REPL with slash commands (/help, /reset, /status, /services, /model, /quit)
  - [x] tui.test.ts — 14 tests for parseSlashCommand, formatResponse, SLASH_COMMANDS
  - [x] cli/chat.ts — Thin wrapper calling startTui()
  - [x] cli/chat.test.ts — 1 test verifying delegation
  - [x] cli/program.ts — Added `chat` command

- [x] **3.2 Memory system** (`src/memory/`)
  - [x] store.ts — SQLite-backed MemoryStore (WAL, sessions + messages tables, search, stats)
  - [x] store.test.ts — 19 tests with real SQLite in temp dirs
  - [x] search.ts — buildMemoryContext() + formatMemoryContext()
  - [x] search.test.ts — 9 tests with mock MemoryStore

- [x] **3.3 Planner service** (`src/services/planner/`)
  - [x] types.ts — PlannerPlan, PlannerTask, PlannerBucket, PlannerAssignment
  - [x] tools.ts — planner_plans (GET /me/planner/plans), planner_tasks (GET /planner/plans/{planId}/tasks), planner_read (GET /planner/tasks/{taskId}), planner_create (POST /planner/plans/{planId}/tasks), planner_update (PATCH /planner/tasks/{taskId} with If-Match etag), planner_buckets (GET /planner/plans/{planId}/buckets)
  - [x] module.ts — ServiceModule with scopes Tasks.Read / Tasks.ReadWrite
  - [x] tools.test.ts — TDD tests for each tool with mocked Graph responses

- [x] **3.4 OneNote service** (`src/services/onenote/`)
  - [x] types.ts — OnenoteNotebook, OnenoteSection, OnenotePage
  - [x] tools.ts — onenote_notebooks (GET /me/onenote/notebooks), onenote_sections (GET /me/onenote/notebooks/{id}/sections), onenote_pages (GET /me/onenote/sections/{id}/pages), onenote_read (GET /me/onenote/pages/{id}/content), onenote_create (POST /me/onenote/sections/{id}/pages with HTML)
  - [x] module.ts — ServiceModule with scopes Notes.Read / Notes.ReadWrite
  - [x] tools.test.ts — TDD tests for each tool with mocked Graph responses

- [x] **3.5 SharePoint service** (`src/services/sharepoint/`)
  - [x] types.ts — SharePointSite, SharePointList, SharePointListItem, SharePointDriveItem
  - [x] tools.ts — sharepoint_sites (GET /sites?search=), sharepoint_site (GET /sites/{id}), sharepoint_lists (GET /sites/{id}/lists), sharepoint_list_items (GET /sites/{id}/lists/{id}/items), sharepoint_files (GET /sites/{id}/drive/root/children), sharepoint_search (GET /sites/{id}/drive/root/search)
  - [x] module.ts — ServiceModule with scopes Sites.Read.All / Sites.ReadWrite.All
  - [x] tools.test.ts — TDD tests for each tool with mocked Graph responses

### Phase 4: Polish + Plugin System + Deployment
**Goal:** Production-ready, extensible, deployable.

- [ ] **4.1 Plugin system** (`src/plugins/`)
  - Plugin API (registerService, registerTool)
  - Plugin discovery + loading
  - Example plugin

- [ ] **4.2 Configuration wizard**
  - First-run setup flow
  - Azure AD app registration guide
  - Service selection + consent

- [x] **4.3 Error recovery**
  - [x] rate-limit.ts — graphRequestWithRetry with 429/503/504 handling, exponential backoff + jitter (11 tests)
  - [x] health.ts — probeServiceHealth/probeAllServices for Graph endpoint health checks (5 tests)
  - [x] graceful-degrade.ts — withGracefulDegradation wrapper for helpful fallback messages (7 tests)

- [x] **4.4 Deployment**
  - [x] package.json — npm publish fields (files, keywords, repository, homepage, bugs)
  - [x] Dockerfile — node:22-slim, non-root user, config volume
  - [x] .dockerignore, .npmignore

- [x] **4.5 Documentation**
  - README with quickstart
  - Azure AD setup guide
  - Service reference
  - Tool reference

---

## Key Files to Port from OpenClaw

These files contain patterns to adapt (not copy verbatim) for OpenClippy:

| OpenClaw File | OpenClippy Equivalent | What to Adapt |
|---|---|---|
| `src/agents/tools/common.ts` | `src/agents/tool-registry.ts` | Tool utility functions (readStringParam, jsonResult, ToolInputError) |
| `src/config/types.secrets.ts` | `src/secrets/types.ts` | SecretInput/SecretRef types |
| `src/secrets/resolve.ts` | `src/secrets/resolve.ts` | Secret resolution logic |
| `src/channels/plugins/types.plugin.ts` | `src/services/types.ts` | ServiceModule interface (simplified from ChannelPlugin) |
| `src/channels/registry.ts` | `src/services/registry.ts` | Service registry pattern |
| `src/agents/tool-catalog.ts` | `src/agents/tool-profiles.ts` | Tool profile system |
| `src/infra/retry.ts` | `src/graph/rate-limit.ts` | Retry with exponential backoff |
| `extensions/msteams/src/graph.ts` | `src/graph/client.ts` | Graph API fetch pattern |
| `src/gateway/server.impl.ts` | `src/gateway/server.ts` | Gateway server pattern |
| `src/agents/system-prompt.ts` | `src/agents/prompt-builder.ts` | System prompt construction |

---

## Verification Plan

### Unit Tests (vitest)
- Auth: MSAL client mock, token cache read/write, scope manager
- Graph: Request building, pagination, batch, error handling, rate limits
- Services: Each tool tested with mocked Graph responses
- Agent: Prompt building, tool dispatch, session management
- Config: Loading, validation, defaults, secret resolution

### Integration Tests
- Full flow: login → ask agent → agent calls Graph → returns answer
- Mock Graph API server (express or msw) for reliable testing
- Gateway: WebSocket client connects, sends message, receives response

### Manual Verification
- Run `openclippy login` with real Azure AD app
- Run `openclippy ask "what are my unread emails?"` and verify results
- Run `openclippy ask "schedule a meeting with X tomorrow at 3pm"` and verify calendar event created
- Run TUI and have a multi-turn conversation
- Verify Teams bot responds in Teams (Phase 2)

### Test Coverage Target
- 70% line coverage minimum (matching OpenClaw)
- 100% coverage on auth and Graph client (security-critical)

---

## Active Task: Fix Failing WebSocket Tests (Round 2)

### Problem
7 of 16 gateway tests in `src/gateway/server.test.ts` fail with `waitForMessage timed out after 5000ms`.

### Root Cause (diagnosed)
**Race condition** in the `connectAndInit` helper and standalone WS tests.

The pattern `const ws = await connectWs(port); const msg = await waitForMessage(ws);` is broken because:
1. `connectWs` resolves when the `open` event fires
2. The server sends the `connected` message immediately in its `connection` handler
3. The message arrives and is delivered BETWEEN step 1 completing and step 2 registering its listener
4. `waitForMessage` registers `ws.once("message", ...)` AFTER the message has already been delivered
5. The message is lost, causing a timeout

### Fix
Rewrite `connectAndInit` to register the message listener BEFORE the connection opens,
using concurrent promise setup. Also fix the standalone "sends connected message" test.

### Steps
- [x] Read all source files
- [x] Run tests to identify failures
- [x] Diagnose root cause (race condition in sequential await pattern)
- [x] Verify fix with debug8.test.ts
- [x] Apply fix to server.test.ts
- [x] Remove debug test files
- [x] Run full test suite to verify all 16 pass (3 consecutive runs: 16/16 each)
- [x] Verify tests complete quickly (all under 5s; total suite ~130ms)
