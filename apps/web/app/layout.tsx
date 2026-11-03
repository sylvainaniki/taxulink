import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "TAXI LINK · Régulation",
  description: "Votre journée, coordonnée.",
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
