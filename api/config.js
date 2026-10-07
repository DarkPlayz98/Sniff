// GET /api/config -> public Firebase web config from Vercel env vars.
// (Firebase web config is public by design; security comes from Firestore rules.)
export default function handler(req, res) {
  const cfg = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    appId: process.env.FIREBASE_APP_ID,
  };
  res.setHeader("Cache-Control", "public, max-age=300");
  if (!cfg.apiKey || !cfg.projectId) return res.status(200).json({ firebase: null });
  return res.status(200).json({ firebase: cfg });
}
