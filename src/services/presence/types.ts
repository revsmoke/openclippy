/** Microsoft Graph presence availability values */
export type PresenceAvailability =
  | "Available"
  | "AvailableIdle"
  | "Away"
  | "BeRightBack"
  | "Busy"
  | "BusyIdle"
  | "DoNotDisturb"
  | "Offline"
  | "PresenceUnknown";

/** Microsoft Graph presence activity values */
export type PresenceActivity =
  | "Available"
  | "Away"
  | "BeRightBack"
  | "Busy"
  | "DoNotDisturb"
  | "InACall"
  | "InAConferenceCall"
  | "Inactive"
  | "InAMeeting"
  | "Offline"
  | "OffWork"
  | "OutOfOffice"
  | "PresenceUnknown"
  | "Presenting"
  | "UrgentInterruptionsOnly";

/** Microsoft Graph Presence resource */
export type Presence = {
  id: string;
  availability: PresenceAvailability;
  activity: PresenceActivity;
  statusMessage?: {
    message?: {
      content: string;
      contentType: string;
    };
    expiryDateTime?: {
      dateTime: string;
      timeZone: string;
    };
  };
};

/** Request body for setUserPreferredPresence */
export type SetUserPreferredPresenceBody = {
  availability: string;
  activity: string;
  expirationDuration: string;
};
