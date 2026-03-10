/** Microsoft Graph OneNote API types */

/** Links to open a notebook in OneNote clients */
export type OnenoteNotebookLinks = {
  oneNoteClientUrl?: { href: string };
  oneNoteWebUrl?: { href: string };
};

/** OneNote notebook resource */
export type OnenoteNotebook = {
  id: string;
  displayName: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  isDefault?: boolean;
  isShared?: boolean;
  links?: OnenoteNotebookLinks;
};

/** OneNote section within a notebook */
export type OnenoteSection = {
  id: string;
  displayName: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  isDefault?: boolean;
  pagesUrl?: string;
};

/** OneNote page within a section */
export type OnenotePage = {
  id: string;
  title: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  contentUrl?: string;
  level?: number;
  order?: number;
  self?: string;
};
