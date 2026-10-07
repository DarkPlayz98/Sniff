// GET /api/config -> public Firebase web config.
// Firebase web config is public by design; security comes from Firestore rules.
// Env vars (FIREBASE_*) override these defaults if set.
const DEFAULTS = {
  apiKey: "AIzaSyCfwl8l-jh1iHqmivu-14qQtyiCL6cNYf8",
  authDomain: "sniff-c61c2.firebaseapp.com",
  projectId: "sniff-c61c2",
  storageBucket: "sniff-c61c2.firebasestorage.app",
  messagingSenderId: "243412756966",
  appId: "1:243412756966:web:9225d83546a6b778b60e27",
};

export default function handler(req, res) {
  const cfg = {
    apiKey: process.env.FIREBASE_API_KEY || DEFAULTS.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || DEFAULTS.authDomain,
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULTS.projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || DEFAULTS.storageBucket,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || DEFAULTS.messagingSenderId,
    appId: process.env.FIREBASE_APP_ID || DEFAULTS.appId,
  };
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({ firebase: cfg });
}
