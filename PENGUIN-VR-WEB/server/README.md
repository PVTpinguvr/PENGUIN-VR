# PENGUIN VR realtime server

Node 20+ WebSocket server for public map/mode rooms, live player transforms, persistent map leaderboards, owner moderation, chat messages, and WebRTC signaling relay.

## Run locally
```sh
npm install
npm start
```
Health check: `/health`.

## Hosting
Deploy this folder as a Node web service. Set `DATA_DIR` to a persistent mounted disk path. The first player ID is saved as the permanent owner in `penguin-vr-state.json`; do not deploy multiple instances without shared transactional storage. Set the browser game's `window.PENGUIN_SERVER_URL` to the service's `wss://...` address before loading the game.

## Important
The server is a starter implementation. It does not yet provide production-grade authentication, anti-cheat, rate limiting, moderation audit logs, TURN relay, or durable multi-instance coordination. Use HTTPS/WSS and a persistent disk. WebRTC voice still requires client-side peer connections, microphone permission, and a TURN service for reliable connectivity.
