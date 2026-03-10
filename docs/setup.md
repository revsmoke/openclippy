# Azure AD App Registration Guide

This guide walks you through registering an Azure AD application so OpenClippy can access Microsoft 365 services on your behalf.

## Prerequisites

- A Microsoft 365 account (work/school or personal)
- Access to the [Azure Portal](https://portal.azure.com)

## Step 1: Register the Application

1. Go to **Azure Portal** > **Azure Active Directory** > **App registrations**
2. Click **"New registration"**
3. Fill in the form:
   - **Name:** `OpenClippy` (or your preferred name)
   - **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts"
   - **Redirect URI:** Select **"Mobile and desktop applications"** and enter:
     ```
     https://login.microsoftonline.com/common/oauth2/nativeclient
     ```
4. Click **"Register"**

## Step 2: Note Your Credentials

After registration, copy these values from the **Overview** page:

| Field | Description |
|-------|-------------|
| **Application (client) ID** | Your app's unique identifier. You will set this in OpenClippy's config. |
| **Directory (tenant) ID** | Your organization's tenant ID. Use `common` for multi-tenant support (default). |

## Step 3: Configure API Permissions

1. Go to **"API permissions"** > **"Add a permission"** > **"Microsoft Graph"** > **"Delegated permissions"**
2. Add permissions based on which services you want to use:

### Required (minimum)

| Permission | Purpose |
|------------|---------|
| `User.Read` | Read your basic profile |
| `offline_access` | Keep tokens refreshed without re-login |

### Mail (Outlook)

| Permission | Purpose |
|------------|---------|
| `Mail.Read` | List, read, and search emails |
| `Mail.ReadWrite` | Create drafts, flag, move emails |
| `Mail.Send` | Send, reply, and forward emails |

### Calendar

| Permission | Purpose |
|------------|---------|
| `Calendars.Read` | View events and check free/busy |
| `Calendars.ReadWrite` | Create, update, delete, accept/decline events |

### To Do

| Permission | Purpose |
|------------|---------|
| `Tasks.Read` | List task lists and tasks |
| `Tasks.ReadWrite` | Create, update, complete, and delete tasks |

### Teams Chat

| Permission | Purpose |
|------------|---------|
| `Chat.Read` | List and read chat messages |
| `ChatMessage.Send` | Send chat messages |
| `Channel.ReadBasic.All` | List team channels |
| `ChannelMessage.Read.All` | Read channel messages |
| `ChannelMessage.Send` | Post to channels |

### OneDrive

| Permission | Purpose |
|------------|---------|
| `Files.Read` | List, read, and search files |
| `Files.ReadWrite` | Upload, create folders, delete, and share files |

### People & Contacts

| Permission | Purpose |
|------------|---------|
| `People.Read` | Search for relevant people |
| `Contacts.Read` | List and read Outlook contacts |

### Presence

| Permission | Purpose |
|------------|---------|
| `Presence.Read` | Read Teams availability status |
| `Presence.ReadWrite` | Set and clear presence overrides |

### Planner

| Permission | Purpose |
|------------|---------|
| `Tasks.Read` | List plans, tasks, and buckets |
| `Tasks.ReadWrite` | Create and update Planner tasks |
| `Group.Read.All` | Access group-based plans |

### OneNote

| Permission | Purpose |
|------------|---------|
| `Notes.Read` | List notebooks, sections, and read pages |
| `Notes.ReadWrite` | Create new pages |

### SharePoint

| Permission | Purpose |
|------------|---------|
| `Sites.Read.All` | Search sites, list content, browse files |
| `Sites.ReadWrite.All` | Modify SharePoint content |

## Step 4: Enable Public Client Flows

1. Go to **"Authentication"**
2. Under **"Advanced settings"**, set **"Allow public client flows"** to **Yes**
3. Click **Save**

This enables the device code flow that OpenClippy uses for login.

## Step 5: Admin Consent (if required)

Some permissions (especially those ending in `.All`) may require admin consent in your organization. If you see permissions marked as "Requires admin consent," contact your tenant administrator.

For personal Microsoft accounts, admin consent is not required.

## Next Steps

Configure OpenClippy with your credentials:

```yaml
# ~/.openclippy/config.yaml
azure:
  clientId: "your-application-client-id"
  tenantId: "common"   # or your specific tenant ID
```

Then authenticate:

```bash
openclippy login
```

This opens a device code flow -- follow the on-screen instructions to sign in with your Microsoft account.
