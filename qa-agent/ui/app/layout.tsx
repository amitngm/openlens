import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Agent | Test Automation Dashboard",
  description: "Kubernetes-deployable QA automation system for UI and API testing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="grid-pattern min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
