# PENGUIN VR build and deployment notes

## Game client
The game is in `PENGUIN-VR-WEB/`. It is designed to enter immersive WebXR and hide the flat-screen menus. Open it from a secure HTTPS origin in a WebXR-capable Quest browser, then use the in-headset Enter VR control.

## Vercel static hosting
The repository-level `vercel.json` publishes `PENGUIN-VR-WEB` as the static output directory. Import this GitHub repository into Vercel and deploy the main branch.

## Live multiplayer service
The WebSocket backend is in `PENGUIN-VR-WEB/server/`.
1. Deploy that folder as a Node 20+ service.
2. Attach persistent storage and set `DATA_DIR` to its mount path.
3. Confirm `https://YOUR-SERVER/health` returns JSON.
4. Edit `PENGUIN-VR-WEB/server-config.js` and set `window.PENGUIN_SERVER_URL` to `wss://YOUR-SERVER`.
5. Redeploy the client.

The server provides map/mode public rooms, penguin transform sync, persistent map leaderboard scores, first-player owner token, owner kick/mute/announcement actions, chat relay, and WebRTC signaling. The browser client sends positions and receives remote penguin avatars. Grip squeeze is used for push-to-talk when the browser grants microphone permission.

## Current limitations
- This is an active prototype, not a tested Quest release. It has not yet been verified on a physical Quest headset.
- Public multiplayer is disabled until the server is deployed and its WSS URL is configured.
- Voice chat uses STUN only. A TURN service is needed for reliable connections across restrictive networks; microphone permissions and spatial audio need headset testing.
- The owner token is stored in browser local storage. Add account authentication and recovery before a public production launch.
- Map art and map geometry are still prototype-level; the current map selector changes the environment palette rather than loading fully separate finished levels.
- Owner moderation actions have server support but still need a complete in-world moderation panel.
- Android APK packaging and Quest store signing have not been produced.
