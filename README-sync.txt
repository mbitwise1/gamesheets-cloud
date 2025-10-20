Cloud Sync (Firebase) — quick setup

1) In Firebase console, enable:
   - Authentication: Email link and/or Google
   - Firestore: Create database (production)
   - Storage: Create bucket (default rules are fine for testing)
2) Your config is embedded in firebase-sync.js. No extra hosting needed.
3) In your app, a floating “Sync” button appears. Use Email link or Google to sign in.
4) Once signed in, every autosave is mirrored to cloud storage. List your files via the Sync modal.
