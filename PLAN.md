# Codebase Duplication & Redundancy Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all verified code duplication and redundancy across the OpenClippy codebase — shared utilities, credentials, service registration, service ID lists, test helpers, and dead code.

**Architecture:** Extract duplicated helpers into shared modules (`tool-utils.ts`, `builtin-modules.ts`, test-utils/), consolidate Azure credentials to a single source of truth, and remove dead barrel exports. All changes are pure refactoring — no behavior changes.

**Tech Stack:** TypeScript (strict ESM), vitest, pnpm, tsdown

---

## Context

Three parallel exploration agents analyzed the entire codebase and found **12 categories of duplication** across 30+ files. A Plan agent verified every finding against the actual source. This plan addresses all confirmed duplications in priority order.

Key risks: (1) onenote's `missingParam` uses a different message format — standardizing may break string-matching tests; (2) `vi.mock()` hoisting in vitest requires careful handling when extracting mock factories; (3) gateway credential change adds a new import dependency.

---

## Chunk 1: Shared Service Tool Utilities

**Goal:** Extract `missingParam`, `errorResult`, date formatters, `formatFileSize`, `requireString`, `requireArray`, and `getErrorMessage` into a single shared module.

### Task 1.1: Create tool-utils with RED tests

**Files:**
- Create: `src/services/tool-utils.test.ts`
- Create: `src/services/tool-utils.ts` (empty stub)

- [x] **Step 1: Write failing tests for `missingParam`**

```typescript
import { describe, it, expect } from "vitest";
import { missingParam } from "./tool-utils.js";

describe("missingParam", () => {
  it("returns ToolResult with isError true", () => {
    const result = missingParam("userId");
    expect(result).toEqual({
      content: "Missing required parameter: userId",
      isError: true,
    });
  });
});
```

- [x] **Step 2: Write failing tests for `errorResult`**

```typescript
describe("errorResult", () => {
  it("returns ToolResult with Error prefix", () => {
    const result = errorResult("something broke");
    expect(result).toEqual({
      content: "Error: something broke",
      isError: true,
    });
  });
});
```

- [x] **Step 3: Write failing tests for `getErrorMessage`**

```typescript
describe("getErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(getErrorMessage("string error")).toBe("string error");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
  });
});
```

- [x] **Step 4: Write failing tests for date formatters**

```typescript
describe("formatShortDate", () => {
  it("formats ISO string to short date", () => {
    expect(formatShortDate("2025-01-15T10:30:00Z")).toMatch(/Jan 15, 2025/);
  });
  it("returns 'unknown' for undefined", () => {
    expect(formatShortDate(undefined)).toBe("unknown");
  });
});

describe("formatDateTime", () => {
  it("formats ISO string with time", () => {
    const result = formatDateTime("2025-01-15T14:30:00Z");
    expect(result).toContain("2025");
    expect(result).toContain("Jan");
  });
  it("returns original string on invalid date", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateOnly", () => {
  it("extracts YYYY-MM-DD from ISO string", () => {
    expect(formatDateOnly("2025-01-15T10:30:00Z")).toBe("2025-01-15");
  });
  it("returns undefined for undefined input", () => {
    expect(formatDateOnly(undefined)).toBeUndefined();
  });
});
```

- [x] **Step 5: Write failing tests for `formatFileSize`**

```typescript
describe("formatFileSize", () => {
  it("formats bytes to human-readable", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });
  it("returns 'unknown' for undefined", () => {
    expect(formatFileSize(undefined)).toBe("unknown");
  });
});
```

- [x] **Step 6: Write failing tests for `requireString` and `requireArray`**

```typescript
describe("requireString", () => {
  it("returns trimmed string when present", () => {
    expect(requireString({ name: " hello " }, "name")).toBe("hello");
  });
  it("returns ToolResult error when missing", () => {
    const result = requireString({}, "name");
    expect(result).toHaveProperty("isError", true);
  });
});

describe("requireArray", () => {
  it("returns array when present", () => {
    expect(requireArray({ ids: [1, 2] }, "ids")).toEqual([1, 2]);
  });
  it("returns ToolResult error when missing", () => {
    const result = requireArray({}, "ids");
    expect(result).toHaveProperty("isError", true);
  });
});
```

- [x] **Step 7: Run tests to verify they all fail**

Run: `pnpm test src/services/tool-utils.test.ts`
Expected: ALL FAIL (module doesn't exist yet)

- [x] **Step 8: Commit RED tests**

```bash
git add src/services/tool-utils.test.ts
git commit -m "test(red): add tests for shared tool-utils module"
```

### Task 1.2: Implement tool-utils (GREEN)

**Files:**
- Create: `src/services/tool-utils.ts`

- [x] **Step 1: Implement all functions in `src/services/tool-utils.ts`**

Implement `missingParam`, `errorResult`, `getErrorMessage`, `formatShortDate`, `formatDateTime`, `formatDateOnly`, `formatFileSize`, `requireString`, `requireArray` — all typed against `ToolResult` from `./types.js`.

- [x] **Step 2: Run tests to verify they pass**

Run: `pnpm test src/services/tool-utils.test.ts`
Expected: ALL PASS

- [x] **Step 3: Commit GREEN implementation**

```bash
git add src/services/tool-utils.ts src/services/tool-utils.test.ts
git commit -m "feat: add shared tool-utils module (missingParam, errorResult, formatters)"
```

### Task 1.3: Replace local helpers in service tool files

**Files to modify** (remove local functions, import from `./tool-utils.js`):
- `src/services/todo/tools.ts` — remove `missingParam` (L23-25)
- `src/services/onedrive/tools.ts` — remove `missingParam` (L42-44), `formatDate` (L24-28), `formatSize` (L17-22)
- `src/services/planner/tools.ts` — remove `missingParam` (L16-18), `formatDate` (L39-42)
- `src/services/presence/tools.ts` — remove `missingParam` (L42-44)
- `src/services/people/tools.ts` — remove `missingParam` (L11-13)
- `src/services/onenote/tools.ts` — remove `missingParam` (L10-12, **note: different message format — will standardize**)
- `src/services/mail/tools.ts` — remove `errorResult` (L93-95), `formatDate` (L28-37)
- `src/services/teams-chat/tools.ts` — remove `errorResult` (L41-43)
- `src/services/sharepoint/tools.ts` — remove `formatDate` (L22-26), `formatFileSize` (L15-20)
- `src/services/calendar/tools.ts` — remove `requireString` (L128-138), `requireArray` (L140-149)

Do each file one at a time. After each file:

- [x] **Step 1: Replace helpers in `todo/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 2: Replace helpers in `onedrive/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 3: Replace helpers in `planner/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 4: Replace helpers in `presence/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 5: Replace helpers in `people/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 6: Replace helpers in `onenote/tools.ts` (update test assertions for new message format), run `pnpm test` — verify green**
- [x] **Step 7: Replace helpers in `mail/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 8: Replace helpers in `teams-chat/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 9: Replace helpers in `sharepoint/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 10: Replace helpers in `calendar/tools.ts`, run `pnpm test` — verify green**
- [x] **Step 11: Commit all service tool replacements**

```bash
git commit -m "refactor: replace local helpers with shared tool-utils across all services"
```

### Task 1.4: Replace `getErrorMessage` pattern across non-service files

**Files to modify** — replace `err instanceof Error ? err.message : String(err)` with `getErrorMessage(err)`:
- `src/gateway/server-http.ts`, `src/gateway/server-ws.ts`
- `src/services/registry.ts`
- `src/cli/services.ts`, `src/cli/gateway.ts`, `src/cli/config.ts`, `src/cli/ask.ts`, `src/cli/status.ts`, `src/cli/login.ts`
- `src/tui/tui.ts`
- `src/plugins/registry.ts`
- `src/agents/runtime.ts`
- Service module files (`calendar/module.ts`, `mail/module.ts`, etc.)

- [x] **Step 1: Replace pattern in all files listed above**
- [x] **Step 2: Run `pnpm test` — verify green**
- [x] **Step 3: Run `pnpm build` — verify clean**
- [x] **Step 4: Commit**

```bash
git commit -m "refactor: use getErrorMessage() utility across codebase"
```

---

## Chunk 2: Azure Credential Consolidation

**Goal:** Single source of truth for default Azure AD client/tenant IDs.

### Task 2.1: Consolidate credential fallbacks

**Files:**
- Modify: `src/auth/credentials.ts` — import `DEFAULT_CONFIG` from `../config/defaults.js`, use as fallback
- Modify: `src/gateway/server.ts` — import `resolveAzureCredentials()`, use in `renewToken()`

- [x] **Step 1: Update `credentials.ts` to use `DEFAULT_CONFIG` for fallback values**
- [x] **Step 2: Run `pnpm test` — verify green**
- [x] **Step 3: Update `gateway/server.ts` `renewToken()` to use `resolveAzureCredentials()`**
- [x] **Step 4: Run `pnpm test` — verify green**
- [x] **Step 5: Run `pnpm build` — verify clean**
- [x] **Step 6: Commit**

```bash
git commit -m "refactor: consolidate Azure credentials to single source of truth"
```

---

## Chunk 3: Service Registration DRY

**Goal:** Extract the duplicated 10-module import + `registry.register()` block into a shared helper.

### Task 3.1: Create builtin-modules with RED tests

**Files:**
- Create: `src/services/builtin-modules.test.ts`
- Create: `src/services/builtin-modules.ts`

- [x] **Step 1: Write failing tests** — `builtinModules` has 10 entries with unique IDs, `registerBuiltinModules()` registers all
- [x] **Step 2: Run tests to verify they fail**
- [x] **Step 3: Implement `builtin-modules.ts`** — import all 10 modules, export array + helper function
- [x] **Step 4: Run tests to verify they pass**
- [x] **Step 5: Commit**

```bash
git commit -m "feat: add builtin-modules helper for service registration"
```

### Task 3.2: Replace registration in ask.ts and tui.ts

**Files:**
- Modify: `src/cli/ask.ts` — remove 10 module imports + 10 register calls, use `registerBuiltinModules()`
- Modify: `src/tui/tui.ts` — same replacement

- [x] **Step 1: Update `ask.ts`**
- [x] **Step 2: Run `pnpm test` — verify green**
- [x] **Step 3: Update `tui.ts`**
- [x] **Step 4: Run `pnpm test` — verify green**
- [x] **Step 5: Commit**

```bash
git commit -m "refactor: use registerBuiltinModules() in ask and tui"
```

---

## Chunk 4: Service ID List Consolidation

**Goal:** Derive `BuiltinServiceId` type and `ALL_SERVICES` array from a single `as const` tuple.

### Task 4.1: Define canonical ID list

**Files:**
- Modify: `src/services/builtin-modules.ts` — add `BUILTIN_SERVICE_IDS` as const tuple
- Modify: `src/config/types.services.ts` — derive `BuiltinServiceId` from the tuple type
- Modify: `src/cli/services.ts` — remove local `ALL_SERVICES`, import `BUILTIN_SERVICE_IDS`

- [x] **Step 1: Add `BUILTIN_SERVICE_IDS` tuple to `builtin-modules.ts`**

```typescript
export const BUILTIN_SERVICE_IDS = [
  "mail", "calendar", "todo", "teams-chat", "onedrive",
  "planner", "onenote", "sharepoint", "people", "presence",
] as const;
```

- [x] **Step 2: Update `types.services.ts` to derive the type from the tuple**
- [x] **Step 3: Update `cli/services.ts` to import `BUILTIN_SERVICE_IDS`**
- [x] **Step 4: Add a test that `BUILTIN_SERVICE_IDS` matches `builtinModules` IDs**
- [x] **Step 5: Run `pnpm test` — verify green**
- [x] **Step 6: Run `pnpm build` — verify clean (check for circular import issues)**
- [x] **Step 7: Commit**

```bash
git commit -m "refactor: single source of truth for builtin service ID list"
```

**Note:** Watch for circular imports — `builtin-modules.ts` imports service modules which import from `types.services.ts`. If `types.services.ts` imports back from `builtin-modules.ts`, that's circular. If this happens, keep the const tuple in `types.services.ts` instead and have `builtin-modules.ts` import it.

---

## Chunk 5: Shared Test Helpers

**Goal:** Extract duplicated mock setup, context fixtures, and temp directory management into reusable test utilities.

### Task 5.1: Create graph mock factory

**Files:**
- Create: `src/test-utils/graph-mock.ts`
- Create: `src/test-utils/graph-mock.test.ts`

- [x] **Step 1: Write tests for `graphClientMockFactory()` and `createToolContext()`**
- [x] **Step 2: Implement the factories**

```typescript
export function graphClientMockFactory() {
  return {
    graphRequest: vi.fn(),
    graphPaginate: vi.fn(),
    GraphApiError: class GraphApiError extends Error { /* full mock */ },
  };
}

export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return { token: "test-token", timezone: "America/New_York", ...overrides };
}
```

- [x] **Step 3: Run tests — verify green**
- [x] **Step 4: Commit**

### Task 5.2: Create temp directory helper

**Files:**
- Create: `src/test-utils/temp-dir.ts`
- Create: `src/test-utils/temp-dir.test.ts`

- [x] **Step 1: Write tests for temp dir helper**
- [x] **Step 2: Implement with automatic cleanup via afterEach/afterAll**
- [x] **Step 3: Run tests — verify green**
- [x] **Step 4: Commit**

### Task 5.3: Roll out graph mock to service test files

**Files to modify** (pilot one first, then batch):
- `src/services/todo/tools.test.ts` (pilot)
- `src/services/onedrive/tools.test.ts`
- `src/services/planner/tools.test.ts`
- `src/services/mail/tools.test.ts`
- `src/services/calendar/tools.test.ts`
- `src/services/people/tools.test.ts`
- `src/services/presence/tools.test.ts`
- `src/services/onenote/tools.test.ts`
- `src/services/sharepoint/tools.test.ts`
- `src/services/teams-chat/tools.test.ts`
- `src/gateway/subscriptions.test.ts`

- [x] **Step 1: Update `todo/tools.test.ts` as pilot — verify green**
- [x] **Step 2: Roll out to remaining 10 test files**
- [x] **Step 3: Run `pnpm test` — verify all green**
- [x] **Step 4: Commit**

```bash
git commit -m "refactor: use shared graph mock factory across all service tests"
```

### Task 5.4: Roll out temp dir helper to test files

**Files to modify:**
- `src/cli/wizard.test.ts`
- `src/plugins/scanner.test.ts`, `registry.test.ts`, `loader.test.ts`
- `src/memory/store.test.ts`
- `src/config/config.test.ts`
- `src/secrets/resolve.test.ts`

- [x] **Step 1: Update all files to use shared temp dir helper**
- [x] **Step 2: Run `pnpm test` — verify green**
- [x] **Step 3: Commit**

```bash
git commit -m "refactor: use shared temp dir helper across test files"
```

---

## Chunk 6: Cleanup

**Goal:** Remove dead barrel exports and any remaining dead code.

### Task 6.1: Remove unused barrel files

**Files:**
- Delete: `src/config/types.ts` (zero imports confirmed by grep)
- Delete: `src/plugins/index.ts` (zero imports confirmed by grep)

- [x] **Step 1: Verify zero imports with grep**
- [x] **Step 2: Delete both files**
- [x] **Step 3: Run `pnpm test` — verify green**
- [x] **Step 4: Run `pnpm build` — verify clean**
- [x] **Step 5: Commit**

```bash
git commit -m "chore: remove unused barrel export files"
```

### Task 6.2: Final verification

- [x] **Step 1: Run `pnpm test` — all tests pass**
- [x] **Step 2: Run `pnpm build` — clean**
- [x] **Step 3: Grep audit — no remaining local `missingParam`/`errorResult` definitions**
- [x] **Step 4: Grep audit — no remaining `instanceof Error ? err.message` pattern**
- [x] **Step 5: Grep audit — `bfe7dd6e` (Azure client ID) appears only in `config/defaults.ts`**

---

## Verification

After all chunks are complete:

1. `pnpm test` — all tests pass (712+ baseline, plus new utility tests)
2. `pnpm build` — clean build, no TypeScript errors
3. Grep audit confirms single-source-of-truth for each extracted utility
