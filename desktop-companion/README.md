# EchoLink Desktop Companion

This is the first native scaffold for the EchoLink desktop-support flow.

## Current Scope

The companion currently provides:

- a native desktop window
- device registration against the EchoLink backend
- online/offline presence updates
- polling for desktop support sessions
- local approve, deny, and revoke controls

It does not yet provide:

- desktop screen capture
- system-wide mouse or keyboard control
- native helper service
- peer-to-peer media transport

## Run

```bash
cd desktop-companion
npm install
npm start
```

## Setup

1. Start the EchoLink backend from the repo root.
2. Sign in to EchoLink in the web app.
3. Paste your EchoLink JWT token into the companion.
4. Register the device.
5. Use the companion to approve or deny desktop support requests.

## Notes

- Default backend URL is `http://localhost:3000`
- Device identity is stored locally in browser storage inside the Electron shell
- Session data is fetched from the backend control plane added in this repo
