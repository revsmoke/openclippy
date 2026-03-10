/** Microsoft Graph Planner API types */

/** Assignment entry for a Planner task — keyed by userId */
export type PlannerAssignment = {
  [userId: string]: {
    orderHint: string;
    "@odata.type"?: string;
  };
};

/** Applied categories on a Planner task (category1–category25) */
export type PlannerAppliedCategories = {
  [key: string]: boolean;
};

/** Checklist item within task details */
export type PlannerChecklistItem = {
  title: string;
  isChecked: boolean;
  orderHint?: string;
};

/** External reference within task details */
export type PlannerExternalReference = {
  alias?: string;
  type?: string;
  previewPriority?: string;
};

/** Container info for a Planner plan */
export type PlannerPlanContainer = {
  containerId: string;
  type: "group" | "roster" | "unknownFutureValue";
  url?: string;
};

/** Microsoft Planner Plan */
export type PlannerPlan = {
  id: string;
  title: string;
  owner?: string;
  createdDateTime?: string;
  container?: PlannerPlanContainer;
  createdBy?: {
    user?: {
      displayName?: string;
      id?: string;
    };
  };
};

/** Microsoft Planner Task */
export type PlannerTask = {
  id: string;
  planId: string;
  bucketId?: string;
  title: string;
  percentComplete: number;
  priority: number;
  startDateTime?: string;
  dueDateTime?: string;
  completedDateTime?: string;
  assignments?: PlannerAssignment;
  orderHint?: string;
  createdDateTime?: string;
  appliedCategories?: PlannerAppliedCategories;
  conversationThreadId?: string;
  /** ETag for optimistic concurrency (from @odata.etag) */
  "@odata.etag"?: string;
};

/** Microsoft Planner Bucket */
export type PlannerBucket = {
  id: string;
  name: string;
  planId: string;
  orderHint?: string;
};

/** Expanded task details (returned with ?$expand=details) */
export type PlannerTaskDetails = {
  id: string;
  description?: string;
  checklist?: {
    [key: string]: PlannerChecklistItem;
  };
  references?: {
    [key: string]: PlannerExternalReference;
  };
  "@odata.etag"?: string;
};

/** A task with its details expanded inline */
export type PlannerTaskWithDetails = PlannerTask & {
  details?: PlannerTaskDetails;
};
