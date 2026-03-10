# Service Reference

OpenClippy connects to 10 Microsoft 365 services via the Microsoft Graph API. Each service is a pluggable module that exposes tools to the AI agent.

## Service Overview

| Service | ID | Label | Tools | Scopes (required) |
|---------|-----|-------|-------|--------------------|
| [Mail](#mail) | `mail` | Outlook Mail | 11 | Mail.Read |
| [Calendar](#calendar) | `calendar` | Outlook Calendar | 8 | Calendars.Read |
| [To Do](#to-do) | `todo` | To Do | 6 | Tasks.Read |
| [Teams Chat](#teams-chat) | `teams-chat` | Teams Chat | 6 | Chat.Read, ChatMessage.Send, Channel.ReadBasic.All, ChannelMessage.Read.All, ChannelMessage.Send |
| [OneDrive](#onedrive) | `onedrive` | OneDrive | 7 | Files.Read |
| [People](#people--contacts) | `people` | People & Contacts | 3 | People.Read, Contacts.Read |
| [Presence](#presence) | `presence` | Presence | 3 | Presence.Read |
| [Planner](#planner) | `planner` | Planner | 6 | Tasks.Read |
| [OneNote](#onenote) | `onenote` | OneNote | 5 | Notes.Read |
| [SharePoint](#sharepoint) | `sharepoint` | SharePoint | 6 | Sites.Read.All |

**Total: 61 tools across 10 services**

## Capabilities Matrix

| Service | Read | Write | Delete | Search | Subscribe |
|---------|------|-------|--------|--------|-----------|
| Mail | Yes | Yes | Yes | Yes | Yes |
| Calendar | Yes | Yes | Yes | No | Yes |
| To Do | Yes | Yes | Yes | No | No |
| Teams Chat | Yes | Yes | No | No | No |
| OneDrive | Yes | Yes | Yes | Yes | No |
| People | Yes | No | No | Yes | No |
| Presence | Yes | Yes | No | No | No |
| Planner | Yes | Yes | No | No | No |
| OneNote | Yes | Yes | No | No | No |
| SharePoint | Yes | No | No | Yes | No |

---

## Mail

**ID:** `mail`
**Label:** Outlook Mail
**Description:** Read, send, search, and manage Outlook emails

**Required Scopes:** `Mail.Read`
**Optional Scopes:** `Mail.ReadWrite`, `Mail.Send`

**Tools:** `mail_list`, `mail_read`, `mail_search`, `mail_send`, `mail_draft`, `mail_reply`, `mail_forward`, `mail_move`, `mail_flag`, `mail_delete`, `mail_folders`

Supports Graph change notification subscriptions on `/me/messages`.

---

## Calendar

**ID:** `calendar`
**Label:** Outlook Calendar
**Description:** View, create, update, and manage calendar events and check availability

**Required Scopes:** `Calendars.Read`
**Optional Scopes:** `Calendars.ReadWrite`

**Tools:** `calendar_list`, `calendar_read`, `calendar_create`, `calendar_update`, `calendar_delete`, `calendar_accept`, `calendar_decline`, `calendar_freebusy`

Supports Graph change notification subscriptions on `/me/events`.

---

## To Do

**ID:** `todo`
**Label:** To Do
**Description:** Microsoft To Do task management -- lists, tasks, create, update, complete, delete

**Required Scopes:** `Tasks.Read`
**Optional Scopes:** `Tasks.ReadWrite`

**Tools:** `todo_lists`, `todo_tasks`, `todo_create`, `todo_update`, `todo_complete`, `todo_delete`

---

## Teams Chat

**ID:** `teams-chat`
**Label:** Teams Chat
**Description:** Read and send messages in Microsoft Teams chats and channels

**Required Scopes:** `Chat.Read`, `ChatMessage.Send`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`

**Tools:** `teams_list_chats`, `teams_read_chat`, `teams_send`, `teams_list_channels`, `teams_channel_messages`, `teams_send_channel`

---

## OneDrive

**ID:** `onedrive`
**Label:** OneDrive
**Description:** OneDrive file management -- list, read, search, upload, create folders, delete, and share files

**Required Scopes:** `Files.Read`
**Optional Scopes:** `Files.ReadWrite`

**Tools:** `files_list`, `files_read`, `files_search`, `files_upload`, `files_mkdir`, `files_delete`, `files_share`

---

## People & Contacts

**ID:** `people`
**Label:** People & Contacts
**Description:** Search for people relevant to the user and manage Outlook personal contacts

**Required Scopes:** `People.Read`, `Contacts.Read`

**Tools:** `people_search`, `contacts_list`, `contacts_read`

---

## Presence

**ID:** `presence`
**Label:** Presence
**Description:** Microsoft Teams presence -- read availability, set preferred presence, clear overrides

**Required Scopes:** `Presence.Read`
**Optional Scopes:** `Presence.ReadWrite`

**Tools:** `presence_read`, `presence_set`, `presence_clear`

---

## Planner

**ID:** `planner`
**Label:** Planner
**Description:** Microsoft Planner task boards and plans

**Required Scopes:** `Tasks.Read`
**Optional Scopes:** `Tasks.ReadWrite`, `Group.Read.All`

**Tools:** `planner_plans`, `planner_tasks`, `planner_read`, `planner_create`, `planner_update`, `planner_buckets`

---

## OneNote

**ID:** `onenote`
**Label:** OneNote
**Description:** Microsoft OneNote notebooks, sections, and pages

**Required Scopes:** `Notes.Read`
**Optional Scopes:** `Notes.ReadWrite`

**Tools:** `onenote_notebooks`, `onenote_sections`, `onenote_pages`, `onenote_read`, `onenote_create`

---

## SharePoint

**ID:** `sharepoint`
**Label:** SharePoint
**Description:** SharePoint sites, lists, and document libraries

**Required Scopes:** `Sites.Read.All`
**Optional Scopes:** `Sites.ReadWrite.All`

**Tools:** `sharepoint_sites`, `sharepoint_site`, `sharepoint_lists`, `sharepoint_list_items`, `sharepoint_files`, `sharepoint_search`

---

## Enabling/Disabling Services

Services are configured in `~/.openclippy/config.yaml`:

```yaml
services:
  mail: { enabled: true }
  calendar: { enabled: true }
  todo: { enabled: true }
  teams-chat: { enabled: true }
  onedrive: { enabled: true }
  planner: { enabled: false }
  onenote: { enabled: false }
  sharepoint: { enabled: false }
  people: { enabled: true }
  presence: { enabled: true }
```

When a service is enabled, OpenClippy will request the required scopes during login and expose that service's tools to the agent.
