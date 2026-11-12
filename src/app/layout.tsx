import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "AquaTrack ERP — Water Distribution Management System",
  description:
    "Enterprise-grade platform for water distribution, 20L reusable jar custody, fleet logistics, and accounting.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0284c7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased text-foreground selection:bg-primary/20 selection:text-primary">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
