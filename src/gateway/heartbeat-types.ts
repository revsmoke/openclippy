/**
 * Types for the HeartbeatRunner — periodic agent triggers.
 *
 * Morning briefings, meeting prep, and other time-based actions
 * that fire while the gateway daemon is running.
 */

/** Configuration for a single morning briefing trigger. */
export type MorningBriefingConfig = {
  enabled: boolean;
  /** Time in 24-hour "HH:MM" format, e.g. "08:00". */
  time: string;
  /** IANA timezone string. Defaults to system timezone. */
  timezone?: string;
};

/** Configuration for meeting-prep triggers. */
export type MeetingPrepConfig = {
  enabled: boolean;
  /** Minutes before a meeting to trigger prep. Default: 5. */
  leadMinutes: number;
  /** How often to poll for upcoming events (minutes). Default: 1. */
  checkIntervalMinutes: number;
};

/** Top-level heartbeat configuration. */
export type HeartbeatConfig = {
  enabled: boolean;
  morningBriefing: MorningBriefingConfig;
  meetingPrep: MeetingPrepConfig;
};

/** A calendar event with the fields the heartbeat needs. */
export type HeartbeatCalendarEvent = {
  id: string;
  subject: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  attendees?: string[];
};

/**
 * Callback to run the agent with a prompt and return its text response.
 * Matches the same shape used by Gateway's `runAsk`.
 */
export type RunAgentFn = (prompt: string) => Promise<string>;

/**
 * Callback to broadcast a message to all connected WebSocket clients
 * (or store it for the next connection).
 */
export type BroadcastFn = (message: string) => void;

/**
 * Callback to fetch upcoming calendar events within the next N minutes.
 */
export type FetchUpcomingEventsFn = (
  withinMinutes: number,
) => Promise<HeartbeatCalendarEvent[]>;

/** Dependencies injected into the HeartbeatRunner. */
export type HeartbeatDeps = {
  runAgent: RunAgentFn;
  broadcast: BroadcastFn;
  fetchUpcomingEvents: FetchUpcomingEventsFn;
};
