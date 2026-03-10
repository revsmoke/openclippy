# Tool Reference

Complete reference for all 61 tools across OpenClippy's 10 service modules. Tools are what the AI agent calls to interact with Microsoft 365 on your behalf.

## Tool Profiles

Tools are filtered by the configured tool profile, which controls what actions the agent can take:

| Profile | Description | Blocked Operations |
|---------|-------------|-------------------|
| `read-only` | List, read, search only | send, delete, create, update, move, flag, draft, reply, forward, accept, decline, complete |
| `standard` | Everything except destructive operations | delete |
| `full` | All operations | (none) |
| `admin` | All operations including org-wide | (none) |

Set the profile in `~/.openclippy/config.yaml`:

```yaml
agent:
  toolProfile: "standard"   # read-only | standard | full | admin
```

---

## Mail Tools

### mail_list

List recent emails from inbox. Optionally filter by folder and limit results.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `top` | number | No | Number of messages to return (default 10, max 50) |
| `folderId` | string | No | Mail folder ID (default: inbox). Use `mail_folders` to get IDs. |
| `filter` | string | No | OData filter expression (e.g. `isRead eq false`) |

### mail_read

Read a specific email message by ID. Returns full body content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to read |

### mail_search

Search emails using a keyword query. Searches subject, body, and sender.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query string |
| `top` | number | No | Max results to return (default 10, max 25) |

### mail_send

Send a new email. Provide recipients, subject, and body content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Comma-separated list of recipient email addresses |
| `subject` | string | Yes | Email subject |
| `body` | string | Yes | Email body (plain text or HTML) |
| `contentType` | string | No | Body content type: `text` or `html` (default: text) |
| `cc` | string | No | Comma-separated CC recipients |
| `importance` | string | No | `low`, `normal`, or `high` (default: normal) |

### mail_draft

Create a draft email. The draft is saved but not sent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | No | Comma-separated list of recipient email addresses |
| `subject` | string | Yes | Email subject |
| `body` | string | Yes | Email body content |
| `contentType` | string | No | Body content type: `text` or `html` (default: text) |

### mail_reply

Reply to an email message. Sends a reply to the sender of the specified message.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to reply to |
| `comment` | string | Yes | Reply message content |

### mail_forward

Forward an email message to specified recipients.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to forward |
| `to` | string | Yes | Comma-separated list of recipients to forward to |
| `comment` | string | No | Optional comment to include |

### mail_move

Move an email message to a different folder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to move |
| `destinationId` | string | Yes | Destination folder ID (or well-known names like `deleteditems`, `archive`) |

### mail_flag

Flag or unflag an email message for follow-up.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to flag/unflag |
| `flagged` | boolean | No | `true` to flag, `false` to remove flag (default: true) |

### mail_delete

Delete an email message. This permanently deletes the message.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to delete |

### mail_folders

List mail folders. Returns folder names, IDs, and unread counts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `top` | number | No | Max folders to return (default 25) |

---

## Calendar Tools

### calendar_list

List calendar events in a date range. Defaults to today if no range specified.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `startDateTime` | string | No | Start of range (ISO 8601). Defaults to start of today. |
| `endDateTime` | string | No | End of range (ISO 8601). Defaults to end of today. |
| `top` | number | No | Max events to return (default 25) |

### calendar_read

Get full details of a single calendar event by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | string | Yes | The event ID to retrieve |

### calendar_create

Create a new calendar event. Requires subject, start, and end times.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | Event subject/title |
| `startDateTime` | string | Yes | Start time in ISO 8601 format |
| `endDateTime` | string | Yes | End time in ISO 8601 format |
| `location` | string | No | Location name |
| `attendees` | string[] | No | List of attendee email addresses |
| `body` | string | No | Event body/description |
| `isAllDay` | boolean | No | Whether this is an all-day event |

### calendar_update

Update an existing calendar event. Only sends changed fields.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | string | Yes | Event ID to update |
| `subject` | string | No | New subject |
| `startDateTime` | string | No | New start time (ISO 8601) |
| `endDateTime` | string | No | New end time (ISO 8601) |
| `location` | string | No | New location name |
| `body` | string | No | New body content |
| `isAllDay` | boolean | No | Whether all-day |

### calendar_delete

Delete a calendar event by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | string | Yes | Event ID to delete |

### calendar_accept

Accept a meeting invitation. Sends response to organizer by default.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | string | Yes | Event ID to accept |
| `comment` | string | No | Optional comment to include with the response |
| `sendResponse` | boolean | No | Whether to send a response to the organizer (default: true) |

### calendar_decline

Decline a meeting invitation. Sends response to organizer by default.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | string | Yes | Event ID to decline |
| `comment` | string | No | Optional comment to include with the response |
| `sendResponse` | boolean | No | Whether to send a response to the organizer (default: true) |

### calendar_freebusy

Check free/busy availability for one or more people in a time range.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schedules` | string[] | Yes | Email addresses to check availability for |
| `startDateTime` | string | Yes | Start of the time range (ISO 8601) |
| `endDateTime` | string | Yes | End of the time range (ISO 8601) |
| `availabilityViewInterval` | number | No | Duration of each time slot in minutes (default 30) |

---

## To Do Tools

### todo_lists

List all Microsoft To Do task lists for the current user.

No parameters required.

### todo_tasks

List tasks in a Microsoft To Do list. Optionally filter by status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listId` | string | Yes | The task list ID |
| `status` | string | No | Filter by status: `notStarted`, `inProgress`, `completed`, `waitingOnOthers`, `deferred` |

### todo_create

Create a new task in a Microsoft To Do list.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listId` | string | Yes | The task list ID |
| `title` | string | Yes | Task title |
| `body` | string | No | Task body/notes |
| `dueDateTime` | string | No | Due date in YYYY-MM-DD format |
| `importance` | string | No | `low`, `normal`, or `high` |

### todo_update

Update properties of an existing Microsoft To Do task.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listId` | string | Yes | The task list ID |
| `taskId` | string | Yes | The task ID |
| `title` | string | No | New task title |
| `body` | string | No | New task body/notes |
| `importance` | string | No | `low`, `normal`, or `high` |
| `dueDateTime` | string | No | New due date in YYYY-MM-DD format |

### todo_complete

Mark a Microsoft To Do task as completed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listId` | string | Yes | The task list ID |
| `taskId` | string | Yes | The task ID |

### todo_delete

Delete a Microsoft To Do task.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listId` | string | Yes | The task list ID |
| `taskId` | string | Yes | The task ID |

---

## Teams Chat Tools

### teams_list_chats

List the current user's Teams chats (1:1, group, and meeting chats).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `top` | number | No | Maximum number of chats to return (default 20, max 50) |

### teams_read_chat

Read recent messages from a Teams chat.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chatId` | string | Yes | The chat ID |
| `top` | number | No | Number of messages to retrieve (default 20, max 50) |

### teams_send

Send a message to a Teams chat.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chatId` | string | Yes | The chat ID |
| `content` | string | Yes | Message text to send |

### teams_list_channels

List channels in a Teams team.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `teamId` | string | Yes | The team ID |

### teams_channel_messages

Read recent messages from a Teams channel.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `teamId` | string | Yes | The team ID |
| `channelId` | string | Yes | The channel ID |
| `top` | number | No | Number of messages to retrieve (default 20, max 50) |

### teams_send_channel

Send a message to a Teams channel.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `teamId` | string | Yes | The team ID |
| `channelId` | string | Yes | The channel ID |
| `content` | string | Yes | Message text to send |

---

## OneDrive Tools

### files_list

List files and folders in the user's OneDrive. Lists root by default.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folderPath` | string | No | Folder path relative to OneDrive root (e.g. `Documents/Reports`). Omit for root. |

### files_read

Get metadata for a file or folder by item ID. Optionally download text content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `itemId` | string | Yes | The DriveItem ID |
| `includeContent` | boolean | No | If true and file is text-based, download and return content (default: false) |

### files_search

Search for files and folders in OneDrive by name or content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query string |

### files_upload

Upload a small file (< 4 MB) to OneDrive.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Destination path including filename (e.g. `Documents/notes.txt`) |
| `content` | string | Yes | The file content as a text string |

### files_mkdir

Create a new folder in OneDrive.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name of the new folder |
| `parentPath` | string | No | Parent folder path relative to root. Omit to create in root. |

### files_delete

Delete a file or folder from OneDrive by item ID. Moves item to recycle bin.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `itemId` | string | Yes | The DriveItem ID to delete |

### files_share

Create a sharing link for a file or folder in OneDrive.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `itemId` | string | Yes | The DriveItem ID to share |
| `type` | string | Yes | Link type: `view` (read-only) or `edit` (read-write) |
| `scope` | string | No | `anonymous` (anyone) or `organization` (same tenant). Default: `organization`. |

---

## People & Contacts Tools

### people_search

Search for people relevant to the current user (colleagues, frequent contacts).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (name, email, etc.) |
| `top` | number | No | Maximum results (default 25) |

### contacts_list

List the current user's Outlook personal contacts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `top` | number | No | Maximum contacts to return (default 50) |
| `orderBy` | string | No | Sort field (e.g. `displayName`, `givenName`). Default: `displayName`. |

### contacts_read

Get full details of a specific Outlook contact by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `contactId` | string | Yes | The contact ID |

---

## Presence Tools

### presence_read

Get the current user's presence (availability and activity) in Microsoft Teams.

No parameters required.

### presence_set

Set the current user's preferred presence in Microsoft Teams.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `availability` | string | Yes | `Available`, `Busy`, `DoNotDisturb`, `BeRightBack`, `Away`, `Offline` |
| `activity` | string | Yes | Should match availability or be a specific activity (e.g. `InAMeeting`) |
| `expirationDuration` | string | Yes | ISO 8601 duration (e.g. `PT1H` for 1 hour, `PT30M` for 30 minutes) |

### presence_clear

Clear the current user's preferred presence override, restoring automatic detection.

No parameters required.

---

## Planner Tools

### planner_plans

List the user's Microsoft Planner plans.

No parameters required.

### planner_tasks

List tasks in a Microsoft Planner plan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | The Planner plan ID |

### planner_read

Read full details of a specific Planner task, including description, checklist, references, and etag.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | The Planner task ID |

### planner_create

Create a new task in a Microsoft Planner plan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | The Planner plan ID |
| `title` | string | Yes | Task title |
| `bucketId` | string | No | Bucket ID to place the task in |
| `dueDateTime` | string | No | Due date in ISO 8601 format |
| `priority` | number | No | 0=Urgent, 1=Important, 5=Medium, 9=Low |
| `assignments` | object | No | Assignments object: `{ "userId": { "orderHint": "" } }` |

### planner_update

Update a Planner task. Requires etag for optimistic concurrency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | The Planner task ID |
| `etag` | string | Yes | The task etag (get from `planner_read`) |
| `title` | string | No | New task title |
| `percentComplete` | number | No | 0=Not started, 50=In progress, 100=Complete |
| `dueDateTime` | string | No | New due date in ISO 8601 format |
| `priority` | number | No | 0=Urgent, 1=Important, 5=Medium, 9=Low |
| `bucketId` | string | No | Move task to a different bucket |

### planner_buckets

List buckets (columns) in a Microsoft Planner plan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | The Planner plan ID |

---

## OneNote Tools

### onenote_notebooks

List the user's OneNote notebooks.

No parameters required.

### onenote_sections

List sections within a specific OneNote notebook.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notebookId` | string | Yes | The notebook ID |

### onenote_pages

List pages within a specific OneNote section.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sectionId` | string | Yes | The section ID |

### onenote_read

Get the HTML content of a specific OneNote page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pageId` | string | Yes | The page ID |

### onenote_create

Create a new page in a OneNote section with HTML content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sectionId` | string | Yes | The section ID to create the page in |
| `htmlContent` | string | Yes | HTML content for the page body |
| `title` | string | No | Optional page title |

---

## SharePoint Tools

### sharepoint_sites

Search for SharePoint sites by name or keyword.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query to find sites |

### sharepoint_site

Get detailed information about a specific SharePoint site by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteId` | string | Yes | The SharePoint site ID |

### sharepoint_lists

List the lists and libraries in a SharePoint site. Hidden system lists are filtered out.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteId` | string | Yes | The SharePoint site ID |

### sharepoint_list_items

Get items from a SharePoint list, including all field values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteId` | string | Yes | The SharePoint site ID |
| `listId` | string | Yes | The list ID |
| `top` | number | No | Maximum number of items to return |

### sharepoint_files

List files and folders in a SharePoint site's default document library.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteId` | string | Yes | The SharePoint site ID |

### sharepoint_search

Search for files within a SharePoint site's document library by keyword.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteId` | string | Yes | The SharePoint site ID |
| `query` | string | Yes | Search query to find files |
