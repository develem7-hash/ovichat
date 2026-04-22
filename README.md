# EchoLink

A professional, real-time communication app optimized for low-bandwidth connections (as low as 256 Kbps) and collaborative remote support.

## Features

- **User Auth** — Register/login with JWT sessions
- **Contacts** — Add, remove, block, favorite, group contacts
- **Connection Requests** — Search, discover, send/accept requests
- **Real-time Messaging** — Text, file, image, voice messages
- **Message Deletion** — Delete messages for everyone in real-time
- **Reactions & Replies** — Emoji reactions, threaded replies
- **Audio/Video Calls** — WebRTC P2P with low-bandwidth optimization
- **Persistent Call Popups** — Never miss a call with persistent incoming notifications
- **Screen Sharing** — High-reliability screen sharing during calls
- **Remote Support** — Permission-based remote assistance intended to cover the full computer, not just the app window
- **Group Chats** — Multi-user group conversations
- **Dark/Light Theme** — Toggle with persistence
- **Responsive** — Full experience on desktop and mobile

## Quick Start

### Local Development

```bash
npm install
npm start
# Visit http://localhost:3000
```

### Desktop Companion Scaffold

```bash
cd desktop-companion
npm install
npm start
```

### Docker

```bash
docker build -t echolink .
docker run -p 3000:3000 -v echolink-data:/app/db -v echolink-uploads:/app/uploads echolink
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | `echolink-secret-key-2024` | JWT signing secret (change in production!) |
| `DATABASE_URL` | _(required)_ | PostgreSQL connection string |
| `PGSSLMODE` | `require` | PostgreSQL SSL mode |
| `CLIENT_ORIGIN` | `*` | Allowed frontend origin(s), comma-separated |

## Folder Structure

```
echolink/
├── server.js          # Node.js + Socket.io + PostgreSQL backend
├── package.json
├── Dockerfile
├── public/
│   ├── index.html     # Single-page app
│   ├── css/
│   │   └── styles.css # Full styling
│   └── js/
│       └── app.js     # All frontend logic
└── uploads/           # User uploaded files
```

## Low-Bandwidth Testing Guide

### Simulate 2G Network (Chrome DevTools)

1. Open DevTools → Network tab
2. Select "Slow 3G" or create custom throttle:
   - Download: 250 Kbps
   - Upload: 100 Kbps
   - Latency: 200ms

### Expected Performance

| Feature | Bandwidth |
|---------|-----------|
| Page load | < 500 KB total |
| Idle (presence only) | < 2 KB/s |
| Text messaging | < 1 KB/message |
| Audio call | 16–32 Kbps |
| Video call (240p) | 100–200 Kbps |
| Screen share (low fps) | 150–300 Kbps |

### WebRTC Optimization Settings

The app automatically:
- Uses Opus codec at 16–32 Kbps for audio
- Caps video at 320x240 @ 15fps
- Limits screen share to 15fps, 1280px wide
- Displays network quality indicator (latency-based)

## Collaborative Support Tools

During a call, users can request **Remote Support Access**. The intended experience is not limited to EchoLink alone and should extend across the user's computer. Once granted:
- **Live Cursor**: The supporter's cursor is visible on the user's screen.
- **Remote Control**: Supporters can click and type across the full computer experience, not only inside the shared EchoLink application.
- **Permission Control**: Access must be explicitly granted, visibly indicated during the session, and can be revoked at any time by the person receiving help.

### Current Web Build Limitation
The current browser-based implementation still limits remote control to the EchoLink session because standard web APIs do not allow trusted full OS-level device access. Delivering the intended whole-computer remote support experience would require a desktop application or native companion bridge for screen capture, permissions, and device-wide input control.

See [Desktop Remote Support Architecture](C:/Users/Texon/Documents/development/ovichat/nexus-chat/docs/desktop-remote-support-architecture.md) for the proposed desktop-companion design and rollout plan.

## API Endpoints

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/users/search?q=
GET    /api/users/suggested
PUT    /api/users/profile

GET    /api/contacts/list
POST   /api/contacts/request
POST   /api/contacts/accept/:id
POST   /api/contacts/reject/:id
POST   /api/contacts/block/:userId
DELETE /api/contacts/:contactId
GET    /api/contacts/requests/pending
PUT    /api/contacts/:contactId

GET    /api/messages/:userId
GET    /api/messages/unread/counts
POST   /api/upload

POST   /api/groups/create
GET    /api/groups
GET    /api/groups/:id/messages
GET    /api/groups/:id/members
POST   /api/groups/:id/members/add

GET    /api/devices
POST   /api/devices/register
GET    /api/users/:userId/support-availability
GET    /api/support-sessions
GET    /api/support-sessions/:id
POST   /api/support-sessions
POST   /api/support-sessions/:id/approve
POST   /api/support-sessions/:id/deny
POST   /api/support-sessions/:id/revoke
POST   /api/support-sessions/:id/heartbeat

GET    /api/health
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Find users / contacts |
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Esc` | End call / close modal |
| `M` | Mute/unmute microphone (in call) |
| `S` | Toggle screen share (in call) |

## Security Notes

- Change `JWT_SECRET` environment variable in production
- HTTPS is highly recommended for WebRTC and production security
- File uploads are stored locally — consider cloud storage for scale
- PostgreSQL is required for persistent hosted deployments
