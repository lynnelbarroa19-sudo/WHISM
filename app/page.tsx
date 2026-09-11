"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getRouteForRole } from "@/lib/supabase";

export default function RootPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    router.replace(getRouteForRole(user.role));
  }, [user, isLoading, router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0f7f2",
        fontFamily: "Nunito, sans-serif",
        color: "#4b6557",
        fontSize: 14,
      }}
    >
      Loading…
    </div>
  );
}