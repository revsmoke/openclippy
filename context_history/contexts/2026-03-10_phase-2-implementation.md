## Phase 2 Implementation — 2026-03-10 13:30

### Phase
implementation

### Summary
Completed Phase 2 of OpenClippy: gateway server (HTTP + WebSocket), Graph change notification subscriptions, heartbeat runner (morning briefings + meeting prep), gateway CLI (start/stop/status), and three new service modules (OneDrive, People, Presence). Fixed a critical WebSocket test race condition and wired all new modules into the agent tool registry. 438 tests across 22 suites, zero failures. Committed as `05793f0`.

### Files Created/Modified
| File | Purpose |
|------|---------|
| `src/gateway/server.ts` | Gateway orchestrator — HTTP + WS + token renewal |
| `src/gateway/server-http.ts` | HTTP handler: /health, /api/ask, /webhooks/graph, 404 |
| `src/gateway/server-ws.ts` | WebSocket handler: sessions, ping/pong, ask routing |
| `src/gateway/types.ts` | Gateway type definitions (ClientMessage, ServerMessage, etc.) |
| `src/gateway/server.test.ts` | Gateway tests (16 tests, fixed race condition) |
| `src/gateway/subscriptions.ts` | Graph change notification lifecycle manager |
| `src/gateway/subscriptions.test.ts` | Subscription tests (34 tests) |
| `src/gateway/heartbeat.ts` | HeartbeatRunner — morning briefing + meeting prep |
| `src/gateway/heartbeat-types.ts` | HeartbeatConfig and related types |
| `src/gateway/heartbeat.test.ts` | Heartbeat tests (21 tests) |
| `src/cli/gateway.ts` | Gateway CLI: start/stop/status with PID file management |
| `src/cli/gateway.test.ts` | Gateway CLI tests (26 tests) |
| `src/cli/program.ts` | Modified — registered gateway subcommand |
| `src/services/onedrive/` | OneDrive module: 7 tools, types, module, 33 tests |
| `src/services/people/` | People module: 3 tools, types, module, 18 tests |
| `src/services/presence/` | Presence module: 3 tools, types, module, 22 tests |
| `src/graph/client.ts` | Fixed raw body passthrough for non-JSON Content-Types |
| `src/graph/client.test.ts` | Added 2 tests for raw body passthrough |
| `src/cli/ask.ts` | Wired OneDrive, People, Presence into tool registry |
| `vitest.config.ts` | Updated test configuration |
| `PLAN.md` | Checked off completed Phase 2 tasks |

### Key Decisions
- **WebSocket race condition fix**: Server sends "connected" immediately on connection. Tests must register message listener BEFORE connection opens to avoid missing it. Pattern: `const msgPromise = waitForMessage(ws)` → await open → `await msgPromise`.
- **Per-test gateway isolation**: Each WS test creates its own gateway (try/finally) while HTTP tests share one (beforeAll/afterAll). Prevents cross-test interference.
- **Raw body passthrough in Graph client**: Non-JSON Content-Types (like text/plain for file uploads) now pass body as-is instead of double-JSON-stringifying.
- **Teams Bot (Task 2.3) deferred**: Requires botbuilder SDK dependency and Azure Bot registration. Not blocking other Phase 2 work.
- **Subscription auto-renew**: Uses configurable buffer (default 5 min) before expiry. Timers stored per-subscription for cleanup.
- **Heartbeat dedup**: Meeting prep uses `_preppedEventIds` Set to avoid firing twice for the same calendar event.

### Technical Details
- Gateway uses `ws` package with `noServer: true` mode — handles HTTP upgrade manually on `/ws` path only
- SubscriptionManager interfaces with Graph API's /subscriptions endpoint for create/renew/delete lifecycle
- HeartbeatRunner polls every 60s for morning briefing time match, configurable interval for meeting prep
- Gateway CLI uses PID file at `~/.openclippy/gateway.pid` for daemon management
- OneDrive tools handle both folder navigation and file CRUD (upload limited to 4MB PUT endpoint)
- People module uses /me/people (relevance-ranked) and /me/contacts (personal contacts)
- Presence module supports read, set (with ISO 8601 duration), and clear operations

### Testing/Verification
- Full test suite: `pnpm test` → 438 tests, 22 suites, 0 failures
- Build: `pnpm build` → 27 output files, no TypeScript errors
- Individual module verification via `npx vitest run <file>`

### State
completed

### Next Steps
- **Task 2.3: Teams Bot channel** — deferred, requires botbuilder SDK + Azure Bot registration
- **Phase 3**: TUI, Memory system, Planner/OneNote/SharePoint services
- Consider adding the test-ws.mjs debug file to .gitignore

### Related Files
- PLAN.md (master plan with Phase 2 checkboxes)
- contexts/2026-03-10_task-1.13-integration-tests.md (Phase 1 integration tests)

### Git
- Phase 1 commit: `c913052` (266 tests, 13 steps)
- Phase 2 commit: `05793f0` (438 tests, 30 files, +5755 lines)
