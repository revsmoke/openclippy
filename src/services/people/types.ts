/** Microsoft Graph People and Contacts API types */

/** Email address on a Person resource */
export type PersonEmailAddress = {
  address: string;
  rank?: number;
};

/** Person type classification */
export type PersonType = {
  class: "Person" | "Group" | "Unknown";
  subclass?: string;
};

/** Scored email address (used on Person) */
export type ScoredEmailAddress = {
  address: string;
  relevanceScore?: number;
};

/** Person returned by the People API (/me/people) */
export type Person = {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  scoredEmailAddresses?: ScoredEmailAddress[];
  phones?: Phone[];
  personType?: PersonType;
  jobTitle?: string;
  department?: string;
  companyName?: string;
  officeLocation?: string;
  userPrincipalName?: string;
};

/** Phone number on a Contact */
export type Phone = {
  type?: string;
  number: string;
};

/** Email address on a Contact */
export type ContactEmailAddress = {
  address: string;
  name?: string;
};

/** Physical address on a Contact */
export type PhysicalAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryOrRegion?: string;
};

/** Outlook Contact from /me/contacts */
export type Contact = {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: ContactEmailAddress[];
  homePhones?: string[];
  businessPhones?: string[];
  mobilePhone?: string;
  jobTitle?: string;
  companyName?: string;
  department?: string;
  officeLocation?: string;
  homeAddress?: PhysicalAddress;
  businessAddress?: PhysicalAddress;
  personalNotes?: string;
  birthday?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
};
