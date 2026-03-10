/** SharePoint site from Microsoft Graph API */
export type SharePointSite = {
  id: string;
  displayName: string;
  name: string;
  webUrl: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  description?: string;
  root?: Record<string, unknown>;
  siteCollection?: { hostname: string };
};

/** SharePoint list from Microsoft Graph API */
export type SharePointList = {
  id: string;
  displayName: string;
  description?: string;
  webUrl: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  list?: { template: string; hidden: boolean };
};

/** SharePoint list item from Microsoft Graph API */
export type SharePointListItem = {
  id: string;
  fields: Record<string, unknown>;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl?: string;
};

/** SharePoint drive item (file or folder) from Microsoft Graph API */
export type SharePointDriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  createdDateTime: string;
  lastModifiedDateTime: string;
  parentReference?: { path: string };
};
