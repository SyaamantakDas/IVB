# IVB on Google Play

The Android app is a Trusted Web Activity: it opens https://syaamantakdas.github.io/IVB/ full screen in the phone's Chrome, so it is always the current site and works offline once opened. `twa-manifest.json` describes it (package `io.github.syaamantakdas.ivb`); [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) turns that into an Android project, and the **Build the Android app** workflow builds it. Nothing generated is kept in the repository.

## One-time setup

1. **Make an upload key** on your own computer (it never needs to leave it except as a repository secret):

   ```sh
   keytool -genkeypair -v -keystore ivb-upload.keystore -alias ivb -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 ivb-upload.keystore > ivb-upload.keystore.base64   # macOS: base64 -i ivb-upload.keystore
   ```

   Keep the keystore and its passwords somewhere safe. Google keeps the key that signs the app for users (Play App Signing), so a lost upload key can be reset from Play Console.

2. **Add three repository secrets** (Settings > Secrets and variables > Actions): `ANDROID_KEYSTORE_BASE64` (the contents of the `.base64` file), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`.

3. **Publish the Digital Asset Links file at the root of the domain.** Android checks `https://syaamantakdas.github.io/.well-known/assetlinks.json` before it opens the site full screen; without it the app shows a browser address bar. A project site cannot serve that path, so create a repository named `syaamantakdas.github.io` with two files:
   - `.well-known/assetlinks.json`: the `assetlinks.json` from a build (step 4), with Play's app signing key added (step 6);
   - `.nojekyll`, an empty file, so that GitHub Pages serves the `.well-known` folder.

   A custom domain for IVB would do instead: the file then goes in this repository at `.well-known/assetlinks.json`.

## Each release

4. **Build.** Actions > Build the Android app > Run workflow, with a version name (`1.0.0`) and a version code one higher than the last upload. The run's artifact holds `app-release-bundle.aab` (for Play), `app-release-signed.apk` (to install on a phone) and `assetlinks.json`.

5. **Upload** the `.aab` in Play Console: create the app (default language English, United Kingdom or United States; free), then Testing > Internal testing > Create release. The listing text, images and the answers for App content are in [store/listing.md](store/listing.md).

6. **Add Play's signing key to the asset links.** Play Console > Test and release > App integrity > App signing shows the SHA-256 fingerprint of the app signing key. Add it to `fingerprints` in `twa-manifest.json`:

   ```json
   "fingerprints": [{ "name": "Play app signing", "value": "AA:BB:…" }]
   ```

   The next build's `assetlinks.json` then lists both keys; copy it to the domain root (step 3).

7. **Check** on a phone: install the app from the internal test link. It should open full screen with no address bar. If a bar shows, the asset links do not match: compare the fingerprints, and open the `assetlinks.json` address in a browser to make sure it is served.

## Notes

- Google Play needs a developer account in your name (a one-time fee, and identity checks) and, for a new personal account, a closed test with testers before the app can go to production. *Check* Play Console's current requirements when you start.
- The app runs on Android 7.0 and later (API level 24, the least its browser helper library supports) and targets Android 16 (API level 36), the level Bubblewrap 1.27 uses.
- To change the app's name, colours or shortcuts, edit `twa-manifest.json` and build again; the website's own changes reach the app without a new release.
