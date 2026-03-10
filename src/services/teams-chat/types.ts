/** Microsoft Graph Teams types for chat, channels, and messages */

export type TeamsMember = {
  id: string;
  displayName: string;
  email?: string;
  roles?: string[];
};

export type TeamsChat = {
  id: string;
  topic: string | null;
  chatType: "oneOnOne" | "group" | "meeting";
  createdDateTime: string;
  lastUpdatedDateTime?: string;
  members?: TeamsMember[];
};

export type TeamsChatMessageBody = {
  content: string;
  contentType: "text" | "html";
};

export type TeamsChatMessageFrom = {
  user?: {
    id: string;
    displayName: string;
  };
  application?: {
    id: string;
    displayName: string;
  };
};

export type TeamsChatMessage = {
  id: string;
  body: TeamsChatMessageBody;
  from: TeamsChatMessageFrom | null;
  createdDateTime: string;
  messageType: "message" | "chatEvent" | "systemEventMessage" | "unknownFutureValue";
  importance?: "normal" | "high" | "urgent";
  subject?: string | null;
};

export type TeamsChannel = {
  id: string;
  displayName: string;
  description: string | null;
  membershipType: "standard" | "private" | "unknownFutureValue" | "shared";
};

export type TeamsTeam = {
  id: string;
  displayName: string;
  description: string | null;
};
