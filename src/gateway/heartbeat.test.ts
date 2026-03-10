/**
 * Tests for HeartbeatRunner — periodic agent triggers.
 *
 * Uses vi.useFakeTimers to control time and verify that morning
 * briefings and meeting-prep triggers fire at the correct moments.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { HeartbeatRunner } from "./heartbeat.js";
import type {
  HeartbeatConfig,
  HeartbeatDeps,
  HeartbeatCalendarEvent,
} from "./heartbeat-types.js";

// ── Helpers ─────────────────────────────────────────────────

function makeConfig(overrides?: Partial<HeartbeatConfig>): HeartbeatConfig {
  return {
    enabled: true,
    morningBriefing: {
      enabled: true,
      time: "08:00",
      ...(overrides?.morningBriefing ?? {}),
    },
    meetingPrep: {
      enabled: true,
      leadMinutes: 5,
      checkIntervalMinutes: 1,
      ...(overrides?.meetingPrep ?? {}),
    },
    ...overrides,
    // Re-apply nested overrides (spread order matters)
  };
}

function makeDeps(overrides?: Partial<HeartbeatDeps>): HeartbeatDeps {
  return {
    runAgent: vi.fn(async () => "agent response"),
    broadcast: vi.fn(),
    fetchUpcomingEvents: vi.fn(async () => []),
    ...overrides,
  };
}

/** Set fake-timer clock to a specific local time on a given date. */
function setClockTo(year: number, month: number, day: number, hour: number, minute: number): void {
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  vi.setSystemTime(d);
}

// ── Tests ───────────────────────────────────────────────────

describe("HeartbeatRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Config defaults ──────────────────────────────────────

  describe("config defaults", () => {
    it("uses default config when none provided", () => {
      const deps = makeDeps();
      const runner = new HeartbeatRunner(undefined, deps);
      const config = runner.config;

      expect(config.enabled).toBe(true);
      expect(config.morningBriefing.enabled).toBe(true);
      expect(config.morningBriefing.time).toBe("08:00");
      expect(config.meetingPrep.enabled).toBe(true);
      expect(config.meetingPrep.leadMinutes).toBe(5);
      expect(config.meetingPrep.checkIntervalMinutes).toBe(1);
    });

    it("merges partial config with defaults", () => {
      const deps = makeDeps();
      const runner = new HeartbeatRunner(
        { enabled: true, morningBriefing: { enabled: false, time: "09:30" }, meetingPrep: { enabled: true, leadMinutes: 10, checkIntervalMinutes: 2 } },
        deps,
      );
      expect(runner.config.morningBriefing.enabled).toBe(false);
      expect(runner.config.morningBriefing.time).toBe("09:30");
      expect(runner.config.meetingPrep.leadMinutes).toBe(10);
      expect(runner.config.meetingPrep.checkIntervalMinutes).toBe(2);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────

  describe("start/stop lifecycle", () => {
    it("starts and stops cleanly", () => {
      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);

      runner.start();
      expect(runner.isRunning).toBe(true);

      runner.stop();
      expect(runner.isRunning).toBe(false);
    });

    it("double-start is idempotent", () => {
      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);

      runner.start();
      runner.start(); // should not throw
      expect(runner.isRunning).toBe(true);

      runner.stop();
    });

    it("double-stop is safe", () => {
      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);

      runner.start();
      runner.stop();
      runner.stop(); // should not throw
      expect(runner.isRunning).toBe(false);
    });

    it("does not start timers when top-level enabled is false", () => {
      const deps = makeDeps();
      const runner = new HeartbeatRunner(
        { ...makeConfig(), enabled: false },
        deps,
      );

      runner.start();
      // Even though start() was called, since enabled=false the runner
      // should not actually schedule anything (isRunning may be false)
      expect(runner.isRunning).toBe(false);
    });
  });

  // ── Morning briefing ─────────────────────────────────────

  describe("morning briefing", () => {
    it("triggers at the configured time", async () => {
      // Set clock to 7:59 AM
      setClockTo(2026, 3, 10, 7, 59);

      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      // Advance 1 minute to 8:00 AM
      await vi.advanceTimersByTimeAsync(60_000);

      expect(deps.runAgent).toHaveBeenCalled();
      const prompt = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(prompt).toContain("morning briefing");

      runner.stop();
    });

    it("broadcasts result to clients", async () => {
      setClockTo(2026, 3, 10, 7, 59);

      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(deps.broadcast).toHaveBeenCalledWith(
        expect.stringContaining("agent response"),
      );

      runner.stop();
    });

    it("does not trigger when morningBriefing is disabled", async () => {
      setClockTo(2026, 3, 10, 7, 59);

      const deps = makeDeps();
      const runner = new HeartbeatRunner(
        makeConfig({ morningBriefing: { enabled: false, time: "08:00" } }),
        deps,
      );
      runner.start();

      // Advance past 8:00 AM
      await vi.advanceTimersByTimeAsync(120_000);

      // runAgent should NOT have been called for morning briefing.
      // (fetchUpcomingEvents may be called for meeting prep.)
      const calls = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls;
      const hasBriefingCall = calls.some(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("morning briefing"),
      );
      expect(hasBriefingCall).toBe(false);

      runner.stop();
    });

    it("uses the correct prompt text", async () => {
      setClockTo(2026, 3, 10, 7, 59);

      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      const prompt = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(prompt).toContain("unread email");
      expect(prompt).toContain("calendar");
      expect(prompt).toContain("overdue tasks");

      runner.stop();
    });

    it("triggers at a custom time", async () => {
      // Set to 8:59 AM, trigger at 9:00
      setClockTo(2026, 3, 10, 8, 59);

      const deps = makeDeps();
      const runner = new HeartbeatRunner(
        makeConfig({ morningBriefing: { enabled: true, time: "09:00" } }),
        deps,
      );
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      const calls = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls;
      const hasBriefingCall = calls.some(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("morning briefing"),
      );
      expect(hasBriefingCall).toBe(true);

      runner.stop();
    });
  });

  // ── Meeting prep ─────────────────────────────────────────

  describe("meeting prep", () => {
    it("triggers before an upcoming event", async () => {
      // Current time: 9:55 AM
      setClockTo(2026, 3, 10, 9, 55);

      const meeting: HeartbeatCalendarEvent = {
        id: "evt-1",
        subject: "Sprint Planning",
        start: new Date(2026, 2, 10, 10, 0).toISOString(),
        end: new Date(2026, 2, 10, 11, 0).toISOString(),
        attendees: ["alice@example.com", "bob@example.com"],
      };

      const deps = makeDeps({
        fetchUpcomingEvents: vi.fn(async () => [meeting]),
      });

      const runner = new HeartbeatRunner(
        makeConfig({ meetingPrep: { enabled: true, leadMinutes: 5, checkIntervalMinutes: 1 } }),
        deps,
      );
      runner.start();

      // Advance 1 minute for the first check interval tick
      await vi.advanceTimersByTimeAsync(60_000);

      // runAgent should have been called with a meeting prep prompt
      const calls = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls;
      const hasPrepCall = calls.some(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("Sprint Planning"),
      );
      expect(hasPrepCall).toBe(true);

      runner.stop();
    });

    it("includes meeting title in the prompt", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const meeting: HeartbeatCalendarEvent = {
        id: "evt-2",
        subject: "Design Review",
        start: new Date(2026, 2, 10, 10, 0).toISOString(),
        end: new Date(2026, 2, 10, 10, 30).toISOString(),
      };

      const deps = makeDeps({
        fetchUpcomingEvents: vi.fn(async () => [meeting]),
      });

      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      const calls = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls;
      const prepCall = calls.find(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("Design Review"),
      );
      expect(prepCall).toBeDefined();
      expect((prepCall![0] as string)).toContain("Prepare me for my upcoming meeting");

      runner.stop();
    });

    it("does not trigger when meetingPrep is disabled", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const meeting: HeartbeatCalendarEvent = {
        id: "evt-3",
        subject: "All Hands",
        start: new Date(2026, 2, 10, 10, 0).toISOString(),
        end: new Date(2026, 2, 10, 11, 0).toISOString(),
      };

      const deps = makeDeps({
        fetchUpcomingEvents: vi.fn(async () => [meeting]),
      });

      const runner = new HeartbeatRunner(
        makeConfig({ meetingPrep: { enabled: false, leadMinutes: 5, checkIntervalMinutes: 1 } }),
        deps,
      );
      runner.start();

      await vi.advanceTimersByTimeAsync(120_000);

      // fetchUpcomingEvents should NOT be called when meeting prep is disabled
      expect(deps.fetchUpcomingEvents).not.toHaveBeenCalled();

      runner.stop();
    });

    it("does not fire twice for the same event", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const meeting: HeartbeatCalendarEvent = {
        id: "evt-dup",
        subject: "Standup",
        start: new Date(2026, 2, 10, 10, 0).toISOString(),
        end: new Date(2026, 2, 10, 10, 15).toISOString(),
      };

      const deps = makeDeps({
        fetchUpcomingEvents: vi.fn(async () => [meeting]),
      });

      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      // Advance through multiple check intervals
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      // Should only prep this event once
      const calls = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls;
      const prepCalls = calls.filter(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("Standup"),
      );
      expect(prepCalls.length).toBe(1);

      runner.stop();
    });

    it("respects configurable check interval", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const deps = makeDeps({
        fetchUpcomingEvents: vi.fn(async () => []),
      });

      const runner = new HeartbeatRunner(
        makeConfig({ meetingPrep: { enabled: true, leadMinutes: 5, checkIntervalMinutes: 3 } }),
        deps,
      );
      runner.start();

      // Advance 2 minutes — should not have checked yet (interval is 3 min)
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(deps.fetchUpcomingEvents).not.toHaveBeenCalled();

      // Advance to 3 minutes total
      await vi.advanceTimersByTimeAsync(60_000);
      expect(deps.fetchUpcomingEvents).toHaveBeenCalledTimes(1);

      runner.stop();
    });

    it("broadcasts meeting prep result to clients", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const meeting: HeartbeatCalendarEvent = {
        id: "evt-bc",
        subject: "Team Sync",
        start: new Date(2026, 2, 10, 10, 0).toISOString(),
        end: new Date(2026, 2, 10, 10, 30).toISOString(),
      };

      const deps = makeDeps({
        runAgent: vi.fn(async () => "Here is your meeting prep for Team Sync..."),
        fetchUpcomingEvents: vi.fn(async () => [meeting]),
      });

      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(deps.broadcast).toHaveBeenCalledWith(
        expect.stringContaining("meeting prep for Team Sync"),
      );

      runner.stop();
    });
  });

  // ── Error handling ───────────────────────────────────────

  describe("error handling", () => {
    it("does not crash when runAgent throws during morning briefing", async () => {
      setClockTo(2026, 3, 10, 7, 59);

      const deps = makeDeps({
        runAgent: vi.fn(async () => {
          throw new Error("LLM unavailable");
        }),
      });

      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      // This should NOT throw
      await vi.advanceTimersByTimeAsync(60_000);

      expect(runner.isRunning).toBe(true);
      runner.stop();
    });

    it("does not crash when runAgent throws during meeting prep", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const meeting: HeartbeatCalendarEvent = {
        id: "evt-err",
        subject: "Failing Prep",
        start: new Date(2026, 2, 10, 10, 0).toISOString(),
        end: new Date(2026, 2, 10, 11, 0).toISOString(),
      };

      const deps = makeDeps({
        runAgent: vi.fn(async () => {
          throw new Error("Network down");
        }),
        fetchUpcomingEvents: vi.fn(async () => [meeting]),
      });

      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(runner.isRunning).toBe(true);
      runner.stop();
    });

    it("does not crash when fetchUpcomingEvents throws", async () => {
      setClockTo(2026, 3, 10, 9, 55);

      const deps = makeDeps({
        fetchUpcomingEvents: vi.fn(async () => {
          throw new Error("Calendar API down");
        }),
      });

      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(runner.isRunning).toBe(true);
      runner.stop();
    });
  });

  // ── Stop cleans up timers ────────────────────────────────

  describe("stop cleans up timers", () => {
    it("no more triggers fire after stop()", async () => {
      setClockTo(2026, 3, 10, 7, 50);

      const deps = makeDeps();
      const runner = new HeartbeatRunner(makeConfig(), deps);
      runner.start();
      runner.stop();

      // Advance well past the briefing time
      await vi.advanceTimersByTimeAsync(30 * 60_000);

      // Nothing should have fired
      expect(deps.runAgent).not.toHaveBeenCalled();
    });
  });
});
