import type { Metadata } from "next";
import "./globals.css";
import "@/app/styles/DarkMode.css"; 
import { AuthProvider } from "@/context/AuthContext";


export const metadata: Metadata = {
  title: "SMARTRHU — RHU Lopez, Quezon",
  description: "Smart Rural Health Unit — Inventory and Patient Management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Google Fonts */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Poppins:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

