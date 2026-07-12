"use client";
import { useEffect } from "react";

type Props = {
  message: string;
  type: "success" | "error";
  onDone: () => void;
};

export default function Toast({ message, type, onDone }: Props) {
  useEffect(() => {
    const id = setTimeout(onDone, 3000);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: type === "success" ? "#1a5e35" : "#d63031",
      color: "#fff", borderRadius: 10, padding: "12px 20px",
      fontSize: 13, fontWeight: 700, boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      display: "flex", alignItems: "center", gap: 8, maxWidth: 320,
    }}>
      <span style={{ fontSize: 16 }}>{type === "success" ? "✓" : "✕"}</span>
      {message}
    </div>
  );
}