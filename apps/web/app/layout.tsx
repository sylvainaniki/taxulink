import type { Metadata } from "next";
import "./style.css";
import InstallApp from "./InstallApp";
export const metadata: Metadata = {
  title: "TAXI LINK · Régulation",
  description: "Votre journée, coordonnée.",
  referrer: "no-referrer",
  appleWebApp: { capable: true, title: "TAXILINK", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.png" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <InstallApp />
      </body>
    </html>
  );
}
