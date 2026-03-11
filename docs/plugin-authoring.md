# Plugin Authoring Guide

Extend OpenClippy with custom service integrations. Plugins are standalone ESM modules that implement the same `ServiceModule` interface used by the 10 built-in services. They are loaded dynamically at startup -- no changes to OpenClippy's core code required.

## Quick Start

Create a minimal plugin in three files:

```
~/.openclippy/plugins/my-plugin/
  manifest.json
  index.js
```

**manifest.json:**

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A minimal example plugin",
  "serviceId": "my-service",
  "entry": "index.js"
}
```

**index.js:**

```js
const myService = {
  id: "my-service",

  meta: {
    label: "My Service",
    description: "A custom service integration",
    requiredScopes: [],
  },

  capabilities: {
    read: true,
    write: false,
    delete: false,
    search: false,
    subscribe: false,
  },

  tools() {
    return [
      {
        name: "my_service_hello",
        description: "Returns a greeting",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name to greet" },
          },
          required: ["name"],
        },
        async execute(args) {
          return { content: `Hello, ${args.name}!` };
        },
      },
    ];
  },
};

export default myService;
```

Enable it in your `~/.openclippy/config.yaml`:

```yaml
plugins:
  my-service:
    enabled: true
```

Restart OpenClippy and the tool `my_service_hello` will be available to the agent.

---

## Manifest Reference

Every plugin directory must contain a `manifest.json` file. OpenClippy validates this file at load time -- plugins with invalid manifests are skipped with a warning.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable plugin name |
| `version` | string | Yes | Semver version string (e.g., `"1.0.0"`) |
| `description` | string | Yes | Short description of what the plugin does |
| `serviceId` | string | Yes | Unique identifier for this service. Must not collide with built-in service IDs or other plugins. |
| `entry` | string | Yes | Relative path to the ESM entry module (e.g., `"index.js"`) |
| `scopes` | object | No | Microsoft Graph API scopes needed by this plugin |
| `scopes.required` | string[] | No | Scopes the plugin requires to function |
| `scopes.optional` | string[] | No | Scopes that enhance functionality but are not strictly necessary |

**Reserved service IDs** (used by built-in services): `mail`, `calendar`, `todo`, `teams-chat`, `onedrive`, `planner`, `onenote`, `sharepoint`, `people`, `presence`.

### Example with Graph scopes

If your plugin calls the Microsoft Graph API, declare the scopes it needs:

```json
{
  "name": "custom-planner",
  "version": "1.0.0",
  "description": "Advanced Planner integration",
  "serviceId": "custom-planner",
  "entry": "index.js",
  "scopes": {
    "required": ["Tasks.ReadWrite"],
    "optional": ["Group.Read.All"]
  }
}
```

Declared scopes are merged into the MSAL authentication flow automatically. Users will be prompted to consent when they run `openclippy login` after installing a plugin with new scopes.

---

## ServiceModule Interface

Your plugin's entry file must `export default` an object matching the `ServiceModule` shape. OpenClippy validates this shape at runtime -- if it does not match, the plugin is rejected.

### Required Properties

#### `id: string`

Must exactly match the `serviceId` in your manifest.json. A mismatch will cause the plugin to be rejected at load time.

#### `meta: object`

Service metadata:

| Property | Type | Description |
|----------|------|-------------|
| `label` | string | Display name shown in status output |
| `description` | string | What the service does |
| `requiredScopes` | string[] | Graph scopes needed (should match manifest) |

#### `capabilities: object`

Capability flags. These affect how the agent understands what your service can do:

| Property | Type | Description |
|----------|------|-------------|
| `read` | boolean | Can read/list resources |
| `write` | boolean | Can create or update resources |
| `delete` | boolean | Can delete resources |
| `search` | boolean | Can search across resources |
| `subscribe` | boolean | Supports Graph change notifications |

#### `tools(): AgentTool[]`

Returns an array of tool definitions that the agent can invoke. See the [Tool Definition Guide](#tool-definition-guide) below for details.

### Optional Properties

#### `status.probe(params): Promise<ProbeResult>`

A health check function called during `openclippy status`. Receives `{ token: string }` and should return `{ ok: boolean, error?: string }`.

```js
status: {
  async probe({ token }) {
    try {
      // Check connectivity to your service
      const resp = await fetch("https://api.example.com/health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: resp.ok };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
},
```

#### `promptHints(): string[]`

Returns extra context strings injected into the agent's system prompt. Use this to give the LLM information about how your service works or special instructions for using your tools.

```js
promptHints() {
  return [
    "The weather service returns temperatures in Celsius by default.",
    "Use weather_forecast for multi-day predictions.",
  ];
},
```

#### `subscriptions: object`

For Graph change notification support. Most plugins will not need this.

```js
subscriptions: {
  resources: ["/me/messages"],
  changeTypes: ["created", "updated"],
  async handle(notification) {
    // Process incoming change notification
  },
},
```

---

## Tool Definition Guide

Each tool returned by `tools()` has this shape:

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Tool name. Prefix with your serviceId (e.g., `"weather_current"`) |
| `description` | string | What the tool does. The agent reads this to decide when to use it. |
| `inputSchema` | object | JSON Schema describing the tool's parameters |
| `execute` | function | `(args, context) => Promise<ToolResult>` |

### Tool naming conventions

Prefix all tool names with your service ID to avoid collisions:

```
weather_current       (good - prefixed with "weather")
weather_forecast      (good)
get_current_weather   (bad - no service prefix, could collide)
```

### Input schema

Use standard JSON Schema. The agent uses this to construct valid arguments:

```js
inputSchema: {
  type: "object",
  properties: {
    city: {
      type: "string",
      description: "City name (e.g., 'London', 'New York')",
    },
    units: {
      type: "string",
      enum: ["celsius", "fahrenheit"],
      description: "Temperature units",
    },
  },
  required: ["city"],
},
```

### The execute function

```js
async execute(args, context) {
  // args: the validated parameters from the agent
  // context: { token: string, userId?: string }
  //   - token: Microsoft Graph access token (if your plugin uses Graph)
  //   - userId: the authenticated user's ID

  // Return a ToolResult
  return {
    content: "The result as a string",  // Required
    isError: false,                      // Optional, defaults to false
  };
}
```

The `content` field is always a string. For structured data, serialize to JSON:

```js
async execute(args) {
  const data = { temperature: 22, condition: "Sunny" };
  return { content: JSON.stringify(data, null, 2) };
}
```

To report an error back to the agent:

```js
async execute(args) {
  if (!args.city) {
    return { content: "Error: city parameter is required", isError: true };
  }
  // ...
}
```

### Tool profile filtering

Plugin tools are subject to the same tool profile rules as built-in tools. Tools with names containing these suffixes are filtered out in lower profiles:

| Profile | Filtered suffixes |
|---------|------------------|
| **read-only** | `_send`, `_create`, `_update`, `_delete`, `_move`, `_reply`, `_forward`, `_flag`, `_upload`, `_share` |
| **standard** | `_send`, `_delete`, `_share`, `_upload` |
| **full** | None (all tools available) |
| **admin** | None (all tools available) |

Name your tools accordingly. If a tool only reads data, avoid naming it with write-action suffixes.

### Complete tool example

```js
{
  name: "jira_list_issues",
  description: "List Jira issues assigned to the current user, optionally filtered by project or status",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Jira project key (e.g., 'PROJ')",
      },
      status: {
        type: "string",
        enum: ["open", "in-progress", "done"],
        description: "Filter by issue status",
      },
      limit: {
        type: "number",
        description: "Maximum number of issues to return (default: 10)",
      },
    },
  },
  async execute(args) {
    const project = args.project || "all";
    const status = args.status || "open";
    const limit = args.limit || 10;

    // In a real plugin, you would call the Jira API here
    const issues = [
      { key: `${project}-101`, summary: "Fix login bug", status },
      { key: `${project}-102`, summary: "Update docs", status },
    ].slice(0, limit);

    return { content: JSON.stringify(issues, null, 2) };
  },
}
```

---

## Configuration

Plugins are configured in `~/.openclippy/config.yaml` under the `plugins` key:

```yaml
plugins:
  my-service:
    enabled: true
    path: "~/.openclippy/plugins/my-plugin"  # optional
    # Plugin-specific settings below:
    apiKey: "your-api-key"
    baseUrl: "https://api.example.com"
```

### Configuration fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether the plugin is active (default: `true` if listed) |
| `path` | string | Explicit path to the plugin directory. If omitted, OpenClippy auto-discovers plugins from `~/.openclippy/plugins/`. |
| *custom keys* | any | Plugin-specific settings, passed through to the service module |

### Auto-discovery vs explicit paths

**Auto-discovery (default):** OpenClippy scans `~/.openclippy/plugins/` for subdirectories containing a `manifest.json`. No config entry is needed -- just drop your plugin folder there.

**Explicit path:** Use the `path` field to load a plugin from a custom location (useful during development):

```yaml
plugins:
  my-service:
    enabled: true
    path: "/Users/me/projects/my-plugin"
```

### Disabling a plugin

Set `enabled: false` to disable a discovered plugin without removing it:

```yaml
plugins:
  my-service:
    enabled: false
```

---

## Debugging & Troubleshooting

### Plugin failed to load

When a plugin fails to load, OpenClippy logs a warning and continues without it:

```
Warning: Plugin load failed: /Users/me/.openclippy/plugins/bad-plugin: Missing or invalid field "serviceId": expected a string
```

Common causes:

| Error | Fix |
|-------|-----|
| `Failed to read manifest.json` | Ensure `manifest.json` exists in the plugin directory |
| `Invalid JSON in manifest.json` | Check for syntax errors (trailing commas, missing quotes) |
| `Missing or invalid field "..."` | Add the required field to your manifest |
| `Failed to import plugin entry` | Check that `entry` in manifest points to a valid ESM file; check for syntax errors in your code |
| `does not export a valid ServiceModule shape` | Your default export is missing required properties (`id`, `meta`, `capabilities`, `tools`) |
| `Plugin id mismatch` | The `id` in your exported object must match `serviceId` in your manifest |
| `Service ID collision` | Another plugin or built-in service already uses that `serviceId` |

### Checking plugin status

Run `openclippy status` to see which plugins loaded successfully. If your plugin implements a `status.probe`, its health will be checked here too.

### Development workflow

During development, use an explicit path in your config so you can iterate without copying files:

```yaml
plugins:
  my-service:
    enabled: true
    path: "/path/to/your/dev/plugin"
```

1. Edit your plugin code
2. Restart OpenClippy (plugins are loaded at startup)
3. Test with `openclippy ask "use my_service_hello with name Test"`

### Common mistakes

**Not using ESM exports.** Your entry file must use ESM syntax (`export default`), not CommonJS (`module.exports`):

```js
// Correct (ESM)
export default myService;

// Wrong (CommonJS -- will fail)
module.exports = myService;
```

**Forgetting the `id` property.** The `id` field on your service object is required and must match the `serviceId` in your manifest:

```js
// manifest.json says: "serviceId": "weather"
// Your module must have: id: "weather"
const service = {
  id: "weather",  // Must match manifest
  // ...
};
```

**Tool names without service prefix.** While not enforced, unprefixed tool names can collide with built-in tools or other plugins:

```js
// Good: prefixed
{ name: "weather_current", ... }

// Risky: not prefixed
{ name: "get_temperature", ... }
```

**Returning non-string content from execute.** The `content` field in `ToolResult` must be a string. Serialize objects with `JSON.stringify()`.
