# Phase 4.1 — Plugin System

## Context

OpenClippy has 10 built-in M365 service modules, each implementing the `ServiceModule` interface. Currently, all services are hardcoded imports in `ask.ts` and `tui.ts`. The `ServiceId` type is a fixed union. The `ScopeManager` has a hardcoded scope map. This means adding a new service requires modifying core files — no third-party extensibility.

Phase 4.1 adds a plugin system that lets external `ServiceModule` implementations be loaded dynamically from `~/.openclippy/plugins/`, configured via YAML, and registered at runtime — zero changes to core files required.

**Key constraint:** The existing `ServiceModule` interface is already well-designed for plugins. We avoid changing it. The work is in the *loading*, *registration*, and *configuration* layers, not the plugin contract itself.

**No new npm dependencies.** Plugin loading uses Node.js `import()`, config uses existing YAML system, validation uses runtime checks.

---

## Architecture

### Plugin Structure

```
~/.openclippy/plugins/
  my-plugin/
    manifest.json          # Plugin metadata
    index.js               # ESM module exporting ServiceModule
```

### manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Custom service for Jira integration",
  "serviceId": "jira",
  "entry": "index.js",
  "scopes": {
    "required": [],
    "optional": []
  }
}
```

### Config Integration

```yaml
plugins:
  jira:
    enabled: true
    path: "~/.openclippy/plugins/my-plugin"  # optional, auto-discovered if omitted
    customSetting: "https://jira.example.com"
```

### Loading Flow

```
startup → scan ~/.openclippy/plugins/ → validate manifests → import() entry
        → validate ServiceModule shape → register in ServiceRegistry
        → merge scopes into ScopeManager → merge config into services
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/plugins/types.ts` | PluginManifest type, PluginLoadResult type |
| `src/plugins/manifest.ts` | Manifest validation (read + validate manifest.json) |
| `src/plugins/loader.ts` | Dynamic import + ServiceModule shape validation |
| `src/plugins/scanner.ts` | Directory scanner (find plugins in plugins dir) |
| `src/plugins/registry.ts` | PluginRegistry — orchestrates scan → load → register |
| `src/plugins/errors.ts` | Plugin-specific error types |
| `src/plugins/manifest.test.ts` | Tests for manifest validation |
| `src/plugins/loader.test.ts` | Tests for dynamic loading + shape validation |
| `src/plugins/scanner.test.ts` | Tests for directory scanning |
| `src/plugins/registry.test.ts` | Tests for full plugin lifecycle |

## Files to Modify

| File | Change |
|------|--------|
| `src/config/types.services.ts` | Change `ServiceId` from union to `string` (with branded type) |
| `src/config/types.base.ts` | Add `plugins?: PluginsConfig` section |
| `src/config/defaults.ts` | Add `plugins: {}` default |
| `src/auth/scope-manager.ts` | Accept dynamic scope registration from plugins |
| `src/services/registry.ts` | Accept `string` IDs (was `ServiceId` union) |
| `src/cli/ask.ts` | Add plugin loading after builtin registration |
| `src/tui/tui.ts` | Add plugin loading after builtin registration |
| `src/cli/wizard.ts` | Show discovered plugins in service selection step |

---

## Phase A: Plugin Types & Manifest Validation (TDD)

### A.1 — Plugin Types (`src/plugins/types.ts`)

```typescript
export type PluginManifest = {
  name: string;                    // Human-readable name
  version: string;                 // Semver
  description: string;             // What this plugin does
  serviceId: string;               // Unique service ID (e.g., "jira")
  entry: string;                   // Relative path to ESM entry (e.g., "index.js")
  scopes?: {
    required?: string[];           // Graph scopes needed
    optional?: string[];           // Nice-to-have scopes
  };
};

export type PluginLoadResult = {
  manifest: PluginManifest;
  path: string;                    // Absolute path to plugin directory
  module: ServiceModule;           // The loaded ServiceModule
};

export type PluginError = {
  pluginPath: string;
  error: string;
};
```

### A.2 — Manifest Validation Tests (write first)

Tests for `src/plugins/manifest.test.ts`:
- [ ] Valid manifest passes validation
- [ ] Missing `name` field → error
- [ ] Missing `serviceId` field → error
- [ ] Missing `entry` field → error
- [ ] Empty `serviceId` → error
- [ ] Non-string `version` → error
- [ ] Optional `scopes` section validates correctly
- [ ] Extra fields are ignored (forward compatibility)

### A.3 — Manifest Validation Implementation

`src/plugins/manifest.ts`:
- `validateManifest(data: unknown): { valid: true; manifest: PluginManifest } | { valid: false; error: string }`
- `readManifest(pluginDir: string): Promise<PluginManifest>` — reads + validates manifest.json

---

## Phase B: ServiceId Relaxation (TDD)

### B.1 — Widen ServiceId to Accept Plugin IDs

**Current:** `ServiceId` is a fixed union of 10 strings.
**Target:** `ServiceId` becomes `string`, with a `BuiltinServiceId` union for the 10 known services.

```typescript
// src/config/types.services.ts
export type BuiltinServiceId =
  | "mail" | "calendar" | "todo" | "teams-chat"
  | "onedrive" | "planner" | "onenote" | "sharepoint"
  | "people" | "presence";

export type ServiceId = string;  // Accepts builtins + plugin IDs
```

### B.2 — Update ServiceRegistry to use `string`

The `Map<ServiceId, ServiceModule>` already works since `ServiceId` becomes `string`. Verify:
- [ ] Existing tests pass with widened type
- [ ] Registry accepts arbitrary string IDs
- [ ] Config `ServicesConfig` type now accepts `Record<string, ServiceConfig>`

### B.3 — Update ScopeManager for Dynamic Scopes

Add method to `ScopeManager`:
```typescript
registerPluginScopes(serviceId: string, scopes: { required: string[]; optional: string[] }): void
```

Tests:
- [ ] `registerPluginScopes` adds scopes to the scope map
- [ ] `computeRequiredScopes` includes plugin scopes when plugin service is enabled
- [ ] Duplicate scope registration replaces previous entry
- [ ] Plugin scopes don't interfere with builtin scopes

---

## Phase C: Plugin Scanner (TDD)

### C.1 — Scanner Tests (write first)

Tests for `src/plugins/scanner.test.ts`:
- [ ] Returns empty array when plugins dir doesn't exist
- [ ] Returns empty array when plugins dir is empty
- [ ] Discovers directories with manifest.json
- [ ] Skips directories without manifest.json
- [ ] Skips files (non-directories)
- [ ] Returns absolute paths
- [ ] Handles config-specified plugin paths (explicit path override)

### C.2 — Scanner Implementation

`src/plugins/scanner.ts`:
```typescript
export async function scanPluginDirs(options?: {
  pluginsDir?: string;           // Default: ~/.openclippy/plugins/
  configPaths?: Record<string, string>;  // Explicit paths from config
}): Promise<string[]>            // Returns absolute paths to plugin directories
```

---

## Phase D: Plugin Loader (TDD)

### D.1 — Loader Tests (write first)

Tests for `src/plugins/loader.test.ts`:
- [ ] Loads valid ESM module exporting ServiceModule
- [ ] Rejects module with missing `id` property
- [ ] Rejects module with missing `tools` function
- [ ] Rejects module with missing `meta` property
- [ ] Rejects module with missing `capabilities` property
- [ ] Validates `id` matches manifest `serviceId`
- [ ] Returns PluginLoadResult on success
- [ ] Wraps import() errors in PluginError

### D.2 — Loader Implementation

`src/plugins/loader.ts`:
```typescript
export async function loadPlugin(pluginDir: string): Promise<PluginLoadResult>

// Validates the exported object has ServiceModule shape
export function validateServiceModule(obj: unknown): obj is ServiceModule
```

**Shape validation** (runtime, not TypeScript — we can't trust external code):
- `id` is string
- `meta` has `label`, `description`, `requiredScopes` (array)
- `capabilities` has `read`, `write`, `delete`, `search`, `subscribe` (all boolean)
- `tools` is function returning array
- `status?.probe` is function if present
- `subscriptions?.resources` is array if present
- `promptHints` is function if present

---

## Phase E: Plugin Registry (TDD)

### E.1 — Registry Tests (write first)

Tests for `src/plugins/registry.test.ts`:
- [ ] `loadAll` discovers and loads plugins from directory
- [ ] `loadAll` skips invalid manifests with warning
- [ ] `loadAll` skips failed loads with warning
- [ ] `loadAll` rejects duplicate serviceId (builtin collision)
- [ ] `loadAll` rejects duplicate serviceId (plugin-plugin collision)
- [ ] Loaded plugins register into ServiceRegistry
- [ ] Loaded plugins register scopes into ScopeManager
- [ ] Plugin config merges into ServicesConfig
- [ ] `getLoadErrors` returns all errors encountered
- [ ] Empty plugins directory → no errors, no plugins loaded

### E.2 — Registry Implementation

`src/plugins/registry.ts`:
```typescript
export class PluginRegistry {
  constructor(private serviceRegistry: ServiceRegistry, private scopeManager: ScopeManager);

  async loadAll(options?: {
    pluginsDir?: string;
    pluginConfig?: PluginsConfig;
  }): Promise<{
    loaded: PluginLoadResult[];
    errors: PluginError[];
  }>;

  getLoadedPlugins(): PluginLoadResult[];
  getLoadErrors(): PluginError[];
}
```

---

## Phase F: CLI Integration

### F.1 — Add Plugin Loading to ask.ts

After builtin service registration, before tool collection:

```typescript
// Load plugins
const pluginRegistry = new PluginRegistry(registry, scopeManager);
const pluginResults = await pluginRegistry.loadAll({
  pluginConfig: config.plugins,
});
if (pluginResults.errors.length > 0) {
  for (const err of pluginResults.errors) {
    console.warn(`⚠️  Plugin load failed: ${err.pluginPath}: ${err.error}`);
  }
}
```

### F.2 — Add Plugin Loading to tui.ts

Same pattern as ask.ts.

### F.3 — Config Types Update

Add to `types.base.ts`:
```typescript
export type PluginConfig = {
  enabled?: boolean;
  path?: string;        // Override plugin directory
  [key: string]: unknown;  // Plugin-specific settings
};

export type PluginsConfig = Record<string, PluginConfig>;
```

### F.4 — Wizard Update (optional, defer if needed)

If plugins are installed, the wizard's service selection step can show them alongside builtins.

---

## Phase G: Integration Tests

- [ ] End-to-end: Create mock plugin on disk → load → register → verify tools appear
- [ ] Plugin tools are filtered by tool profiles
- [ ] Plugin tools execute correctly via agent runtime
- [ ] Plugin health probes run alongside builtin probes
- [ ] Bad plugin doesn't crash startup (graceful skip)

---

## Phase H: Documentation & Polish

- [x] Update README.md with plugin authoring section
- [x] Create `docs/plugin-authoring.md` with guide
- [x] Add example plugin skeleton to `examples/example-plugin/`
- [ ] Run full test suite
- [ ] Run build
- [ ] Manual smoke test with example plugin

---

## TDD Implementation Order

### Phase A: Types & Manifest (tests first)
1. Write `src/plugins/manifest.test.ts` — expect red
2. Create `src/plugins/types.ts` + `src/plugins/manifest.ts` — go green

### Phase B: ServiceId Relaxation
1. Change `ServiceId` type, add `BuiltinServiceId`
2. Update `ScopeManager` with `registerPluginScopes()`
3. Write scope manager tests — go green
4. Verify all 632 existing tests still pass

### Phase C: Scanner (tests first)
1. Write `src/plugins/scanner.test.ts` — expect red
2. Implement `src/plugins/scanner.ts` — go green

### Phase D: Loader (tests first)
1. Write `src/plugins/loader.test.ts` — expect red
2. Implement `src/plugins/loader.ts` — go green

### Phase E: Registry (tests first)
1. Write `src/plugins/registry.test.ts` — expect red
2. Implement `src/plugins/registry.ts` — go green

### Phase F: CLI Integration
1. Add config types
2. Wire plugin loading into `ask.ts` and `tui.ts`
3. Verify all tests pass

### Phase G: Integration Tests
1. Write integration tests
2. Verify end-to-end flow

### Phase H: Docs & Polish
1. Update README, create authoring guide
2. Create example plugin
3. Final test suite + build

---

## Verification

1. **Unit tests:** `pnpm test` — all 632 existing + ~60 new tests pass
2. **Build:** `pnpm build` succeeds
3. **No regressions:** All builtin services work identically
4. **Plugin loading:** Create example plugin → loads → tools available
5. **Error handling:** Invalid plugin → logged warning, doesn't crash
6. **Scope integration:** Plugin scopes included in auth flow
7. **Tool profile compatibility:** Plugin tools filtered by profile correctly

---

## Key Design Decisions

| Decision | Reasoning | Alternatives |
|----------|-----------|-------------|
| `ServiceId` → `string` (not branded) | Simplest change, plugins need arbitrary IDs | Keep union + module augmentation (complex), branded string type (extra boilerplate) |
| Manifest.json per plugin | Standard, human-readable, versionable | Package.json field (assumes npm), inline config only (no metadata) |
| Shape validation at load time | Can't trust external code with TypeScript types | Trust exports (unsafe), require TypeScript source (limits users) |
| Graceful skip on plugin error | One bad plugin shouldn't kill the app | Fail fast (harsh), retry (complex) |
| Scopes in manifest + ScopeManager | Plugin scopes need to participate in auth flow | Separate scope config (confusing), ignore scopes (broken auth) |
| No npm dependency for plugins | Keeps core lightweight, ESM `import()` is enough | Use a plugin framework (overkill for our needs) |
