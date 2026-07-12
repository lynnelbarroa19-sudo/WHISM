"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase, UserRole } from "@/lib/supabase";  // remove getRouteForRole

export interface AuthUser {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  initials: string;
  email: string;
  isFirstLogin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (u: AuthUser) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null, login: () => {}, logout: () => {}, isLoading: true,
});

function makeInitials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setUser(null);
          setIsLoading(false);
          return;
        }

        const { data: profile, error } = await supabase
          .from("users")
          .select("*")
          .eq("email", session.user.email)
          .single();

        if (error || !profile) {
          await supabase.auth.signOut();
          setUser(null);
          setIsLoading(false);
          return;
        }

        if (profile.is_first_login) {
          await supabase.auth.signOut();
          setUser(null);
          setIsLoading(false);
          return;
        }

        const authUser: AuthUser = {
          id:           profile.user_id,
          name:         `${profile.first_name} ${profile.last_name}`,
          firstName:    profile.first_name,
          lastName:     profile.last_name,
          role:         profile.role.toLowerCase() as UserRole,
          initials:     makeInitials(profile.first_name, profile.last_name),
          email:        profile.email,
          isFirstLogin: false,
        };

        setUser(authUser);
      } catch (err) {
        console.error("Session restore error:", err);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          setUser(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  function login(u: AuthUser) {
    setUser(u);
    localStorage.setItem("smartrhu_user", JSON.stringify(u));
  }

  // ← No useRouter here, logout just clears state
  async function logout() {
    setUser(null);
    localStorage.removeItem("smartrhu_user");
    await supabase.auth.signOut();
    // Redirect is handled by the component calling logout
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }