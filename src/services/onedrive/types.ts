/** Microsoft Graph Drive Item — represents a file or folder in OneDrive */
export type DriveItem = {
  id: string;
  name: string;
  size: number;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  createdBy?: IdentitySet;
  lastModifiedBy?: IdentitySet;
  parentReference?: ItemReference;
  file?: DriveItemFile;
  folder?: DriveItemFolder;
  /** Present when the item is shared */
  shared?: Shared;
  /** Download URL (short-lived, from @microsoft.graph.downloadUrl) */
  "@microsoft.graph.downloadUrl"?: string;
};

/** File-specific metadata on a DriveItem */
export type DriveItemFile = {
  mimeType: string;
  hashes?: FileHashes;
};

/** Folder-specific metadata on a DriveItem */
export type DriveItemFolder = {
  childCount: number;
};

/** File hash info */
export type FileHashes = {
  quickXorHash?: string;
  sha1Hash?: string;
  sha256Hash?: string;
};

/** Reference to the parent item */
export type ItemReference = {
  driveId?: string;
  driveType?: string;
  id?: string;
  name?: string;
  path?: string;
};

/** Identity set (user/application/device) */
export type IdentitySet = {
  user?: Identity;
  application?: Identity;
  device?: Identity;
};

/** Single identity */
export type Identity = {
  id?: string;
  displayName?: string;
};

/** Sharing info */
export type Shared = {
  owner?: IdentitySet;
  scope?: string;
  sharedBy?: IdentitySet;
  sharedDateTime?: string;
};

/** Permission resource (returned from createLink) */
export type Permission = {
  id: string;
  link?: SharingLink;
  roles: string[];
  shareId?: string;
  grantedToV2?: IdentitySet;
};

/** Sharing link details */
export type SharingLink = {
  type: "view" | "edit" | "embed";
  scope: "anonymous" | "organization" | "users";
  webUrl: string;
  preventsDownload?: boolean;
};

/** Upload session for large files (not used in this module but defined for completeness) */
export type UploadSession = {
  uploadUrl: string;
  expirationDateTime: string;
  nextExpectedRanges?: string[];
};
