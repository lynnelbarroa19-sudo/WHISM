import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const REMEMBER_KEY = "smartrhu_remember_me";

function isRemembered(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(REMEMBER_KEY) === "true";
}

// Dynamic storage adapter: writes to localStorage only if "Remember Me"
// was checked at login time; otherwise writes to sessionStorage, which
// clears itself when the browser/tab is closed.
const dynamicAuthStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    const store = isRemembered() ? window.localStorage : window.sessionStorage;
    return store.getItem(key);
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    const store = isRemembered() ? window.localStorage : window.sessionStorage;
    store.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function setRememberMe(remember: boolean): void {
  if (typeof window === "undefined") return;
  if (remember) {
    window.localStorage.setItem(REMEMBER_KEY, "true");
  } else {
    window.localStorage.removeItem(REMEMBER_KEY);
  }
}

export function clearRememberMe(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REMEMBER_KEY);
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: dynamicAuthStorage,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  db: {
    schema: "public",
  },
});

export type UserRole =
  | "pharmacist"
  | "warehouse"
  | "admin";

export interface DBUser {
  user_id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  role: UserRole;
  status: string;
  is_first_login: boolean;
}

export function getRouteForRole(role: string): string {
  const routes: Record<string, string> = {
    admin:      "/admin",
    pharmacist: "/pharmacist",
    medtech:    "/Laboratory",
    warehouse:  "/warehouse/dashboard",
   
  };
  return routes[role.toLowerCase()] ?? "/member-dashboard";
}