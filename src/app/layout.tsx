import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { AuthProvider } from "../context/AuthContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MedQ",
  description: "MedQ v0.1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-white text-gray-900`}
      >
        <AuthProvider>
          <nav className="p-4 border-b flex gap-4">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/soloQ">SoloQ</Link>
            <Link href="/resultados">Resultados</Link>
            <Link href="/ranking">Ranking</Link>
            <Link href="/login" className="ml-auto">Login</Link>
          </nav>
          <main className="p-6 max-w-3xl mx-auto">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
