// Demo mode is a browser flag set by the one-click /demo sign-in.
// It hides costly controls and opts questions into the shared daily limit.
const KEY = "demo_mode";

export const DEMO_DAILY_LIMIT = 20;

export const isDemoMode = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};
export const setDemoMode = (on: boolean) => {
  try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* ignore */ }
};
export const demoHeaders = (): Record<string, string> => (isDemoMode() ? { "x-demo-mode": "1" } : {});
