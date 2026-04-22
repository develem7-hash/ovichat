# EchoLink Desktop Remote Support Architecture

## Goal

Extend EchoLink from browser-scoped remote assistance to a whole-computer remote support product while preserving explicit consent, visible session status, and revocation by the person receiving help.

## Non-Goals

- Silent or hidden access
- Persistent unattended control in the first release
- Bypassing OS permission prompts
- Replacing the existing browser app as the main collaboration surface

## Product Shape

EchoLink should become a two-part system:

1. The existing web app remains the collaboration and session-management surface.
2. A new signed desktop companion handles machine-level capabilities that browsers cannot provide.

The browser app continues to manage:

- account authentication
- contacts and chat
- support session requests
- session status UI
- audit log presentation

The desktop companion is responsible for:

- local device enrollment
- OS permission prompts
- screen capture
- local consent dialogs
- visible in-session trust indicators
- session revocation

## Proposed Components

### 1. Web Client

The current `public/index.html` and `public/js/app.js` remain the main operator interface.

Add desktop-aware features to the web UI:

- `Start Desktop Support` action
- device status indicator for the supported user
- session code / approval state
- audit timeline
- reconnect approval state

### 2. EchoLink Backend

The existing Node/Socket.io backend remains the control plane.

Add backend responsibilities:

- desktop device registration
- short-lived support session tokens
- support session records
- role and policy checks
- event logging
- reconnect authorization

Suggested new entities:

- `devices`
- `support_sessions`
- `support_session_events`
- `device_permissions`

### 3. Desktop Companion

Build a native companion app for Windows first.

Recommended stack:

- `Electron` or `Tauri` for shell/UI
- native helper service for screen capture and input brokering
- local secure storage for device identity

The companion should expose a narrow local IPC boundary between:

- trusted local UI
- privileged native helper

The privileged helper should be the only process allowed to interact with OS-level capture and control APIs.

### 4. Native Helper

The native helper exists to keep high-risk capabilities out of the general UI layer.

Responsibilities:

- enumerate displays
- capture desktop frames
- report local permission state
- stop all support activity immediately on revoke

Design rule:

The helper should never accept broad arbitrary commands. It should only accept a fixed set of support-session actions from the signed companion app.

## Trust Model

Every support session must satisfy all of the following:

1. The supported user starts or explicitly approves the session on their machine.
2. The supported user sees who is connected.
3. The supported user sees an always-visible active-session banner.
4. The supported user can stop access immediately.
5. The supporter sees whether access is pending, active, paused, or revoked.
6. The backend stores a durable event log.

## Consent Flow

### First-Time Device Setup

1. User installs the desktop companion.
2. User signs in with EchoLink.
3. Companion registers the device with the backend.
4. Companion asks for required OS permissions.
5. Backend marks the device as available for desktop support.

### Per-Session Approval

1. Supporter starts a support request from EchoLink web.
2. Backend creates a pending support session.
3. Desktop companion on the supported machine shows a native approval dialog.
4. Dialog shows:
   - supporter's display name
   - support start time
   - requested capabilities
   - clear revoke instructions
5. Supported user approves or denies locally.
6. On approval, backend issues short-lived session credentials.
7. Both sides enter the active support state.

### Active Session State

While support is active, the supported user should always see:

- top-most session banner
- supporter's identity
- elapsed time
- `Pause` or `Stop` action

Optional later additions:

- `Allow keyboard only`
- `Allow view only`
- `Allow file transfer`

## Session Lifecycle

Suggested state machine:

- `requested`
- `waiting_for_local_approval`
- `approved`
- `connecting`
- `active`
- `paused`
- `revoked`
- `ended`
- `expired`

Important rules:

- sessions expire automatically if approval is not completed
- reconnects after network loss require fresh approval in early releases
- ending the call should also end the desktop support session unless explicitly separated later

## Transport Design

Use separate channels for:

- control plane signaling via backend
- media/data path between companions when possible

Recommended pattern:

- backend issues ephemeral session tokens
- companions establish a peer session
- relays are used only when direct connectivity fails

Keep these streams logically separate:

- desktop video stream
- input/control channel
- session-state channel

## Security Controls

Required controls for v1:

- short-lived session tokens
- signed desktop builds
- device registration and device identity
- explicit per-session approval
- visible session banner
- one-click revoke
- session timeout on inactivity
- backend audit log

Strongly recommended:

- approval on reconnect
- action-rate limiting
- role-based support permissions
- organization policy settings
- session recording metadata

Do not ship v1 with:

- background hidden start
- unattended access
- permanent always-on input control

## Suggested Backend Additions

### REST Endpoints

- `POST /api/devices/register`
- `GET /api/devices`
- `POST /api/support-sessions`
- `POST /api/support-sessions/:id/approve`
- `POST /api/support-sessions/:id/deny`
- `POST /api/support-sessions/:id/revoke`
- `POST /api/support-sessions/:id/heartbeat`
- `GET /api/support-sessions/:id`

### Socket Events

- `desktop-device-online`
- `desktop-support-requested`
- `desktop-support-pending-local-approval`
- `desktop-support-approved`
- `desktop-support-denied`
- `desktop-support-started`
- `desktop-support-paused`
- `desktop-support-revoked`
- `desktop-support-ended`

## Database Sketch

### devices

- `id`
- `user_id`
- `device_name`
- `platform`
- `registered_at`
- `last_seen_at`
- `is_online`
- `capabilities_json`

### support_sessions

- `id`
- `requester_user_id`
- `target_user_id`
- `target_device_id`
- `status`
- `requested_at`
- `approved_at`
- `started_at`
- `ended_at`
- `ended_by_user_id`

### support_session_events

- `id`
- `support_session_id`
- `event_type`
- `actor_user_id`
- `created_at`
- `metadata_json`

## UI Changes In This Repo

Short-term changes we can make before the desktop app exists:

- add a `Desktop Support` entry point beside current remote support
- show `Desktop Companion Required` when the target user has no companion online
- show `Waiting for local approval on <device name>`
- show session history in chat info or call panel

## Rollout Plan

### Phase 1

- keep browser-only support as-is
- add desktop support architecture hooks on the backend
- add device registration UI

### Phase 2

- ship Windows companion MVP
- local approval only
- view + explicit active-session state

### Phase 3

- add richer session controls
- improve reconnect and audit tooling
- add organization policies

## Recommended Immediate Next Steps

1. Add backend models and APIs for `devices` and `support_sessions`.
2. Add web UI states for desktop support availability and pending approval.
3. Scaffold a `desktop-companion/` folder for the Windows app.
4. Keep the current browser remote support labeled clearly as `EchoLink Session Only`.
