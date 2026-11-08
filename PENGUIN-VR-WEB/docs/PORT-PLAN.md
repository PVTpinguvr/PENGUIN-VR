# Unity-to-Web port plan

1. Replace Unity XR rig and arm swing with WebXR input/hand tracking; validate on Quest 3S.
2. Port player identity, owner authorization and moderation to secure server-side APIs. Never decide owner status in client JavaScript.
3. Port multiplayer pose replication using WebSocket/WebRTC and authoritative server validation.
4. Port proximity voice using a browser-compatible WebRTC voice service; add permission, mute, push-to-talk and spatial attenuation.
5. Implement server-authoritative game modes, maps, cosmetics, inventory and social features.
6. Add tests, reconnect handling, abuse limits, account persistence and production deployment.

The old Unity C# scripts are retained only in the original uploaded archive. They cannot be executed by the browser and must be rewritten in JavaScript/TypeScript or moved into server services.
