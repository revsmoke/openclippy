import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureRulesFile,
  loadRules,
  saveRules,
  evaluableRules,
  ExternalEditError,
  RulesValidationError,
} from "./rules-file.js";
import type { RulesFile } from "./rule-types.js";

const VALID_YAML = `
version: 1
rules:
  - id: vendor-invoices
    name: Vendor invoices
    state: active
    priority: 20
    match: Emails from vendors containing an invoice or payment request.
    action: { type: move, folder: "Vendors/Invoices" }
    revision: 3
  - id: urgent
    name: Urgent
    state: trusted
    priority: 10
    match: Urgent requests.
    action: { type: flag }
  - id: old-rule
    name: Old
    state: retired
    priority: 5
    match: Retired rule.
    action: { type: none }
  - id: pending-rule
    name: Pending
    state: proposed
    priority: 1
    match: Not yet approved.
    action: { type: flag }
`;

describe("rules-file", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "triage-rules-"));
    path = join(dir, "rules.yaml");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("seeds a starter file only when missing", async () => {
    expect(await ensureRulesFile(path)).toBe(true);
    const loaded = await loadRules(path);
    expect(loaded.file.version).toBe(1);
    expect(loaded.file.rules.length).toBeGreaterThan(0);
    expect(loaded.file.rules[0].id).toBe("urgent-requests");

    // Second call must not overwrite
    expect(await ensureRulesFile(path)).toBe(false);
  });

  it("loads and validates a rules file, applying defaults", async () => {
    await writeFile(path, VALID_YAML, "utf-8");
    const loaded = await loadRules(path);
    expect(loaded.file.rules).toHaveLength(4);
    const vendor = loaded.file.rules[0];
    expect(vendor.id).toBe("vendor-invoices");
    expect(vendor.revision).toBe(3);
    expect(vendor.examples).toEqual([]); // defaulted
    const urgent = loaded.file.rules[1];
    expect(urgent.revision).toBe(1); // defaulted
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid YAML syntax", async () => {
    await writeFile(path, "version: 1\nrules: [unclosed", "utf-8");
    await expect(loadRules(path)).rejects.toThrow(RulesValidationError);
  });

  it("rejects schema violations with field detail", async () => {
    await writeFile(
      path,
      "version: 1\nrules:\n  - id: BadSlug!\n    name: x\n    match: y\n    action: { type: flag }\n",
      "utf-8",
    );
    await expect(loadRules(path)).rejects.toThrow(/id/);
  });

  it("rejects an unknown action type", async () => {
    await writeFile(
      path,
      "version: 1\nrules:\n  - id: a\n    name: x\n    match: y\n    action: { type: explode }\n",
      "utf-8",
    );
    await expect(loadRules(path)).rejects.toThrow(RulesValidationError);
  });

  it("saves atomically and reloads cleanly", async () => {
    await writeFile(path, VALID_YAML, "utf-8");
    const loaded = await loadRules(path);
    const updated: RulesFile = structuredClone(loaded.file);
    updated.rules[0].match = "Updated criteria.";
    updated.rules[0].revision = 4;

    const fresh = await saveRules(loaded, updated);
    expect(fresh.sha256).not.toBe(loaded.sha256);

    const reloaded = await loadRules(path);
    expect(reloaded.file.rules[0].match).toBe("Updated criteria.");
    expect(reloaded.file.rules[0].revision).toBe(4);
  });

  it("aborts save when the file changed on disk (external edit)", async () => {
    await writeFile(path, VALID_YAML, "utf-8");
    const loaded = await loadRules(path);

    // Simulate the user editing the file while we held it in memory
    await writeFile(path, VALID_YAML + "\n# user comment\n", "utf-8");

    const updated = structuredClone(loaded.file);
    updated.rules[0].match = "Clobbering edit.";
    await expect(saveRules(loaded, updated)).rejects.toThrow(ExternalEditError);

    // The user's edit survived
    const raw = await readFile(path, "utf-8");
    expect(raw).toContain("# user comment");
  });

  it("refuses to persist an invalid rules object, leaving the file untouched", async () => {
    await writeFile(path, VALID_YAML, "utf-8");
    const loaded = await loadRules(path);
    const before = await readFile(path, "utf-8");

    const broken = structuredClone(loaded.file);
    (broken.rules[0] as { match: string }).match = ""; // violates min(1)
    await expect(saveRules(loaded, broken)).rejects.toThrow(RulesValidationError);

    expect(await readFile(path, "utf-8")).toBe(before);
  });

  it("writes a .bak copy when asked", async () => {
    await writeFile(path, VALID_YAML, "utf-8");
    const loaded = await loadRules(path);
    const updated = structuredClone(loaded.file);
    updated.rules[0].revision = 99;

    await saveRules(loaded, updated, { backup: true });
    const bak = await readFile(`${path}.bak`, "utf-8");
    expect(bak).toBe(VALID_YAML);
  });

  it("evaluableRules returns active+trusted in priority order", async () => {
    await writeFile(path, VALID_YAML, "utf-8");
    const loaded = await loadRules(path);
    const rules = evaluableRules(loaded.file);
    expect(rules.map((r) => r.id)).toEqual(["urgent", "vendor-invoices"]);
  });

  it("caps match length", async () => {
    const long = "x".repeat(401);
    await writeFile(
      path,
      `version: 1\nrules:\n  - id: a\n    name: x\n    match: "${long}"\n    action: { type: flag }\n`,
      "utf-8",
    );
    await expect(loadRules(path)).rejects.toThrow(RulesValidationError);
  });
});
