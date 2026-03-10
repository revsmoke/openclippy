/** Microsoft Graph Calendar API types */

export type GraphDateTimeTimeZone = {
  dateTime: string;
  timeZone: string;
};

export type GraphEmailAddress = {
  name?: string;
  address: string;
};

export type GraphAttendee = {
  emailAddress: GraphEmailAddress;
  type?: "required" | "optional" | "resource";
  status?: {
    response?: "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";
    time?: string;
  };
};

export type GraphLocation = {
  displayName?: string;
  locationType?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    countryOrRegion?: string;
    postalCode?: string;
  };
};

export type GraphItemBody = {
  contentType?: "text" | "html";
  content?: string;
};

export type GraphEvent = {
  id: string;
  subject?: string;
  body?: GraphItemBody;
  bodyPreview?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  location?: GraphLocation;
  locations?: GraphLocation[];
  attendees?: GraphAttendee[];
  organizer?: {
    emailAddress: GraphEmailAddress;
  };
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  importance?: "low" | "normal" | "high";
  sensitivity?: "normal" | "personal" | "private" | "confidential";
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  webLink?: string;
  onlineMeeting?: {
    joinUrl?: string;
  };
  onlineMeetingUrl?: string;
  recurrence?: unknown;
  responseStatus?: {
    response?: string;
    time?: string;
  };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
};

export type GraphScheduleItem = {
  status: string;
  subject?: string;
  location?: string;
  start: GraphDateTimeTimeZone;
  end: GraphDateTimeTimeZone;
  isPrivate?: boolean;
};

export type GraphScheduleInformation = {
  scheduleId: string;
  availabilityView: string;
  scheduleItems: GraphScheduleItem[];
  error?: {
    message: string;
    responseCode: string;
  };
};

export type GraphGetScheduleRequest = {
  schedules: string[];
  startTime: GraphDateTimeTimeZone;
  endTime: GraphDateTimeTimeZone;
  availabilityViewInterval?: number;
};

export type GraphGetScheduleResponse = {
  value: GraphScheduleInformation[];
};

export type GraphCalendar = {
  id: string;
  name: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: GraphEmailAddress;
};
