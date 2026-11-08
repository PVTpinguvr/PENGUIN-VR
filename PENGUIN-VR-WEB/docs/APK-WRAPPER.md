# Build an Android APK wrapper without Unity

## Why TWA

PENGUIN VR uses WebXR. A normal Capacitor/WebView wrapper may not expose immersive WebXR reliably. Use a Trusted Web Activity (TWA) so Android opens the hosted PWA in Chrome full-screen. This requires an HTTPS website and a domain association file.

## Steps after deploying the website

1. Deploy the contents of this folder to a permanent HTTPS domain (GitHub Pages, Cloudflare Pages, or another static host).
2. Confirm the site opens in Chrome and in Meta Quest Browser. Test the **ENTER VR** button on the headset before wrapping it.
3. Install Node.js on a cloud build machine (or use GitHub Actions), then install Bubblewrap:
   ```bash
   npm install -g @bubblewrap/cli
   ```
4. Initialize the TWA from the hosted manifest:
   ```bash
   bubblewrap init --manifest https://YOUR-DOMAIN/manifest.webmanifest
   ```
   Choose the Android package ID you control, e.g. `com.yourstudio.penguinvr`. Do not use a package ID belonging to someone else.
5. Bubblewrap generates a signing key and an Android project. Keep the keystore and passwords private; back them up safely. Never commit them to a public repository.
6. Build the APK:
   ```bash
   bubblewrap build
   ```
7. Upload the generated `assetlinks.json` to `https://YOUR-DOMAIN/.well-known/assetlinks.json` exactly as Bubblewrap instructs. It must contain the SHA-256 fingerprint for the signing certificate used by the APK.
8. Rebuild/reinstall and confirm Android reports the domain as verified. Test on Quest 3S. If the browser launches outside the wrapper, the domain association or signing fingerprint is wrong.

## Notes

- A TWA is not a self-contained offline APK; the game is hosted online. The APK is the installable launcher.
- Android SDK/build-tools are needed by Bubblewrap, but they can run in GitHub Actions or another cloud runner; they do not need to be installed on the user's PC.
- Meta Quest support for installing and launching a TWA package must be verified on the actual headset and current firmware. If the headset refuses the APK, the hosted HTTPS PWA remains playable in Meta Quest Browser.
- Do not create a final signed APK until the permanent domain, package ID, app icon, and signing key are decided.
