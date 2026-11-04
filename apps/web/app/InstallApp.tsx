"use client";
import { useEffect, useState } from "react";
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState("");
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);
  async function install() {
    if (!prompt) {
      setHelp((v) => !v);
      return;
    }
    try {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
    } catch {
      setHelp(true);
    }
  }
  async function share() {
    const url = new URL("/", window.location.origin).href;
    try {
      if (navigator.share)
        await navigator.share({
          title: "TAXILINK",
          text: "Ouvrir TAXILINK",
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setMessage(
          "Lien copié. Chaque personne se connecte avec son propre compte.",
        );
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setMessage("Copiez l’adresse du site pour le partager.");
    }
  }
  return (
    <aside className="install-app" aria-label="Installation et partage">
      <div className="install-actions">
        {!installed && (
          <button
            className="outline"
            type="button"
            onClick={() => void install()}
          >
            Installer TAXILINK
          </button>
        )}
        <button className="quiet" type="button" onClick={() => void share()}>
          Partager le lien
        </button>
      </div>
      {help && (
        <div className="install-help">
          <strong>Installer sur votre appareil</strong>
          <p>
            Sur iPhone ou iPad : ouvrez le site dans Safari, puis Partager → Sur
            l’écran d’accueil. Sur Android : utilisez le menu du navigateur →
            Installer l’application ou Ajouter à l’écran d’accueil. Sur
            ordinateur : utilisez l’icône d’installation dans la barre d’adresse
            si votre navigateur la propose.
          </p>
          <p>
            Une connexion reste nécessaire pour consulter et modifier les
            missions. Le partage du lien ne donne aucun accès à votre
            entreprise.
          </p>
          <button
            className="quiet"
            type="button"
            onClick={() => setHelp(false)}
          >
            Fermer l’aide
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </aside>
  );
}
