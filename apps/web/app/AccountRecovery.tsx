"use client";
import { useState, type FormEvent } from "react";
import { field } from "./Fields";
export default function AccountRecovery(p: {
  kind: "request" | "reset" | "verify";
  token?: string;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const path =
        p.kind === "request"
          ? "/auth/password/request"
          : p.kind === "reset"
            ? "/auth/password/reset"
            : "/auth/email/verify";
      const body =
        p.kind === "request"
          ? { email: d.email }
          : p.kind === "verify"
            ? { token: p.token }
            : {
                token: p.token,
                password: d.password,
                ...(d.mfa ? { mfa_code: d.mfa } : {}),
                ...(d.recovery ? { recovery_code: d.recovery } : {}),
              };
      const r = await fetch("/api/v1" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.code);
      setDone(true);
    } catch (e) {
      const code = (e as Error).message;
      setError(
        (
          {
            ACCOUNT_LINK_INVALID:
              "Lien expiré, remplacé ou déjà utilisé. Demandez un nouveau lien.",
            MAIL_UNAVAILABLE:
              "L’envoi d’email n’est pas configuré sur cette installation.",
            MFA_REQUIRED:
              "Votre compte est protégé par MFA. Saisissez un code ou un code de récupération.",
            MFA_INVALID: "Code MFA invalide ou déjà utilisé.",
            RATE_LIMITED: "Trop de demandes. Réessayez dans une minute.",
            VALIDATION_ERROR: "Vérifiez les champs saisis.",
          } as Record<string, string>
        )[code] || "La demande n’a pas abouti. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-recovery panel padded">
      <p className="eyebrow">TAXILINK · ACCÈS AU COMPTE</p>
      <h1>
        {p.kind === "request"
          ? "Mot de passe oublié"
          : p.kind === "reset"
            ? "Nouveau mot de passe"
            : "Vérifier mon email"}
      </h1>
      {done ? (
        <p role="status">
          {p.kind === "request"
            ? "Si un compte correspond à cette adresse, un lien sera envoyé. Vérifiez votre boîte de réception et les courriers indésirables."
            : p.kind === "reset"
              ? "Mot de passe modifié. Vos anciennes sessions sont fermées ; reconnectez-vous."
              : "Adresse email vérifiée. Vous pouvez revenir à votre espace."}
        </p>
      ) : (
        <form onSubmit={submit}>
          {p.kind === "request" &&
            field(
              "Adresse email",
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
              />,
            )}
          {p.kind === "verify" && (
            <p>Confirmez que cette adresse email vous appartient.</p>
          )}
          {p.kind === "reset" && (
            <>
              {field(
                "Nouveau mot de passe",
                <input
                  name="password"
                  type="password"
                  minLength={16}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />,
              )}
              <p>
                16 caractères minimum. Si la MFA est activée, renseignez
                également un des codes ci-dessous.
              </p>
              {field(
                "Code de l’application d’authentification",
                <input
                  name="mfa"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                />,
              )}
              {field(
                "Ou un code de récupération",
                <input name="recovery" maxLength={64} autoComplete="off" />,
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy
              ? "Traitement…"
              : p.kind === "request"
                ? "Envoyer le lien"
                : p.kind === "reset"
                  ? "Enregistrer le mot de passe"
                  : "Confirmer mon adresse"}
          </button>
        </form>
      )}
      <button className="quiet" disabled={busy} onClick={p.close}>
        Retour à la connexion
      </button>
    </main>
  );
}
