/** Microsoft Graph Mail API types */

export type GraphEmailAddress = {
  address: string;
  name?: string;
};

export type GraphRecipient = {
  emailAddress: GraphEmailAddress;
};

export type GraphItemBody = {
  contentType: "text" | "html";
  content: string;
};

export type GraphMessageFlag = {
  flagStatus: "notFlagged" | "flagged" | "complete";
};

export type GraphMessage = {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: GraphItemBody;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  receivedDateTime: string;
  sentDateTime?: string;
  hasAttachments: boolean;
  importance: "low" | "normal" | "high";
  isRead: boolean;
  isDraft: boolean;
  conversationId?: string;
  parentFolderId?: string;
  flag?: GraphMessageFlag;
  webLink?: string;
};

export type GraphMailFolder = {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
};

/** Payload for sendMail endpoint */
export type SendMailPayload = {
  message: {
    subject: string;
    body: GraphItemBody;
    toRecipients: GraphRecipient[];
    ccRecipients?: GraphRecipient[];
    bccRecipients?: GraphRecipient[];
    importance?: "low" | "normal" | "high";
  };
  saveToSentItems?: boolean;
};

/** Payload for reply endpoint */
export type ReplyPayload = {
  comment: string;
};

/** Payload for forward endpoint */
export type ForwardPayload = {
  comment?: string;
  toRecipients: GraphRecipient[];
};

/** Payload for move endpoint */
export type MovePayload = {
  destinationId: string;
};
