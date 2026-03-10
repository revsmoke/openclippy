/** Microsoft Graph To Do task list */
export type TodoTaskList = {
  id: string;
  displayName: string;
  isOwner: boolean;
  wellknownListName: "none" | "defaultList" | "flaggedEmails" | "unknownFutureValue";
};

/** Graph dateTimeTimeZone resource */
export type DateTimeTimeZone = {
  dateTime: string;
  timeZone: string;
};

/** Body content for a To Do task */
export type TaskBody = {
  content: string;
  contentType: "text" | "html";
};

/** Task status values */
export type TaskStatus =
  | "notStarted"
  | "inProgress"
  | "completed"
  | "waitingOnOthers"
  | "deferred";

/** Task importance values */
export type TaskImportance = "low" | "normal" | "high";

/** Microsoft Graph To Do task */
export type TodoTask = {
  id: string;
  title: string;
  body?: TaskBody;
  status: TaskStatus;
  importance: TaskImportance;
  dueDateTime?: DateTimeTimeZone;
  completedDateTime?: DateTimeTimeZone;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  categories?: string[];
};
