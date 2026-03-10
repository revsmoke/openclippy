/**
 * HeartbeatRunner — Periodic agent triggers for the OpenClippy gateway.
 *
 * Manages time-based actions that fire while the daemon is running:
 *   - Morning briefing: daily digest of unread emails, calendar, overdue tasks
 *   - Meeting prep: advance preparation for upcoming calendar events
 *
 * Each trigger runs the agent with a specific prompt and broadcasts
 * the result to all connected WebSocket clients (or stores it for
 * the next connection).
 */

import type {
  HeartbeatConfig,
  HeartbeatDeps,
  HeartbeatCalendarEvent,
} from "./heartbeat-types.js";

// ── Defaults ──────────────────────────────────────────────

const DEFAULT_CONFIG: HeartbeatConfig = {
  enabled: true,
  morningBriefing: {
    enabled: true,
    time: "08:00",
  },
  meetingPrep: {
    enabled: true,
    leadMinutes: 5,
    checkIntervalMinutes: 1,
  },
};

// ── Prompts ───────────────────────────────────────────────

const MORNING_BRIEFING_PROMPT =
  "Give me a morning briefing: unread email count, today's calendar events, and overdue tasks.";

function meetingPrepPrompt(event: HeartbeatCalendarEvent): string {
  const parts = [
    `Prepare me for my upcoming meeting: ${event.subject}.`,
    "Show attendees, agenda, and relevant recent emails.",
  ];
  if (event.attendees && event.attendees.length > 0) {
    parts.push(`Attendees: ${event.attendees.join(", ")}.`);
  }
  return parts.join(" ");
}

// ── HeartbeatRunner ───────────────────────────────────────

export class HeartbeatRunner {
  private _config: HeartbeatConfig;
  private _deps: HeartbeatDeps;
  private _running = false;

  /** Timer that checks every minute whether the morning briefing should fire. */
  private _morningTimer: ReturnType<typeof setInterval> | null = null;

  /** Timer that polls for upcoming events on the configured interval. */
  private _meetingPrepTimer: ReturnType<typeof setInterval> | null = null;

  /** Track which events we've already prepped so we don't duplicate. */
  private _preppedEventIds = new Set<string>();

  /** Whether the morning briefing has already fired today. */
  private _briefingFiredDate: string | null = null;

  constructor(config: HeartbeatConfig | undefined, deps: HeartbeatDeps) {
    this._config = config ?? { ...DEFAULT_CONFIG };
    this._deps = deps;
  }

  /** Expose current config (read-only). */
  get config(): Readonly<HeartbeatConfig> {
    return this._config;
  }

  /** Whether the heartbeat runner is actively scheduling triggers. */
  get isRunning(): boolean {
    return this._running;
  }

  /** Start all enabled heartbeat triggers. */
  start(): void {
    if (this._running) return;
    if (!this._config.enabled) return;

    this._running = true;

    // ── Morning briefing timer ─────────────────────────────
    if (this._config.morningBriefing.enabled) {
      // Check every minute whether we've hit the briefing time.
      this._morningTimer = setInterval(() => {
        void this._checkMorningBriefing();
      }, 60_000);
    }

    // ── Meeting prep timer ─────────────────────────────────
    if (this._config.meetingPrep.enabled) {
      const intervalMs = this._config.meetingPrep.checkIntervalMinutes * 60_000;
      this._meetingPrepTimer = setInterval(() => {
        void this._checkMeetingPrep();
      }, intervalMs);
    }
  }

  /** Stop all heartbeat triggers and clean up timers. */
  stop(): void {
    if (!this._running) return;

    if (this._morningTimer) {
      clearInterval(this._morningTimer);
      this._morningTimer = null;
    }

    if (this._meetingPrepTimer) {
      clearInterval(this._meetingPrepTimer);
      this._meetingPrepTimer = null;
    }

    this._running = false;
  }

  // ── Private: Morning Briefing ────────────────────────────

  private async _checkMorningBriefing(): Promise<void> {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    // Only fire once per day
    if (this._briefingFiredDate === todayKey) return;

    const [targetHour, targetMinute] = this._config.morningBriefing.time
      .split(":")
      .map(Number);

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Fire if we're at or past the target time (within the same day)
    if (
      currentHour > targetHour ||
      (currentHour === targetHour && currentMinute >= targetMinute)
    ) {
      this._briefingFiredDate = todayKey;

      try {
        const result = await this._deps.runAgent(MORNING_BRIEFING_PROMPT);
        this._deps.broadcast(result);
      } catch {
        // Agent failure is non-fatal — log and continue.
        // In production this would use a proper logger.
      }
    }
  }

  // ── Private: Meeting Prep ────────────────────────────────

  private async _checkMeetingPrep(): Promise<void> {
    const { leadMinutes } = this._config.meetingPrep;

    let events: HeartbeatCalendarEvent[];
    try {
      events = await this._deps.fetchUpcomingEvents(leadMinutes);
    } catch {
      // Calendar API failure is non-fatal.
      return;
    }

    for (const event of events) {
      // Skip events we've already prepped
      if (this._preppedEventIds.has(event.id)) continue;

      // Mark as prepped before running (prevent re-entry on long agent calls)
      this._preppedEventIds.add(event.id);

      try {
        const prompt = meetingPrepPrompt(event);
        const result = await this._deps.runAgent(prompt);
        this._deps.broadcast(result);
      } catch {
        // Agent failure is non-fatal.
      }
    }
  }
}
