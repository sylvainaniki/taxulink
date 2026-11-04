"use client";
import { useEffect, useState, type FormEvent } from "react";
type Row = Record<string, any>;
export default function RoutingPanel({
  api,
  locations,
}: {
  api: (path: string, body?: Row) => Promise<any>;
  locations: Row[];
}) {
  const [status, setStatus] = useState<Row | null>(null),
    [routes, setRoutes] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function load() {
    const [s, r] = await Promise.all([
      api("/routing/status"),
      api("/routing/cache"),
    ]);
    setStatus(s);
    setRoutes(r);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api("/routing/status"), api("/routing/cache")])
      .then(([s, r]) => {
        if (active) {
          setStatus(s);
          setRoutes(r);
        }
      })
      .catch(() => {
        if (active) setError("Impossible de charger l’état des trajets.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function calculate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      ids = d.getAll("locations").map(String);
    if (ids.length < 2 || ids.length > (status?.max_points || 4)) {
      setError(`Choisissez de 2 à ${status?.max_points || 4} lieux.`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/routing/refresh", { location_ids: ids });
      await load();
      setNotice(
        `${result.stored} trajets enregistrés, ${result.unavailable} indisponibles. Durées valables ${result.expires_in_hours} heures.`,
      );
    } catch (err) {
      const key = (err as Error).message;
      setError(
        (
          {
            ROUTING_BUSY:
              "Un calcul est déjà en cours. Patientez avant de réessayer.",
            ROUTING_QUOTA_REACHED: "Quota journalier de calcul atteint.",
            COORDINATES_UNCONFIRMED:
              "Confirmez les coordonnées de tous les lieux.",
            ROUTING_BATCH_INVALID: "Réduisez le nombre de lieux sélectionnés.",
          } as Row
        )[key] ||
          "Le calcul des trajets a échoué. Aucune durée fictive n’a été ajoutée.",
      );
    } finally {
      setBusy(false);
    }
  }
  const eligible = locations.filter(
    (l) => l.validated_at && l.latitude !== null && l.longitude !== null,
  );
  return (
    <section className="panel padded">
      <h2>Temps de trajet routiers</h2>
      <p>
        {status?.available
          ? `Fournisseur : ${status.provider}. ${status.usage}/${status.quota} calculs aujourd’hui.`
          : "Le fournisseur de trajets n’est pas disponible sur cette installation."}
      </p>
      <p className="hint">
        Les calculs IGN utilisent le réseau routier réel, sans trafic en direct,
        avec une marge de 25 %. Vérifiez les durées pour votre tournée. Les
        trajets fictifs de démonstration restent identifiés dans la liste.
      </p>
      <form onSubmit={calculate}>
        <fieldset disabled={busy || !status?.available}>
          <legend>Lieux à relier (2 à {status?.max_points || 4})</legend>
          {eligible.map((l) => (
            <label className="check" key={l.id}>
              <input name="locations" type="checkbox" value={l.id} />
              {l.label}
            </label>
          ))}
        </fieldset>
        {!eligible.length && (
          <p>Enregistrez d’abord des lieux avec des coordonnées confirmées.</p>
        )}
        <label className="check">
          <input type="checkbox" required disabled={busy} />
          J’autorise l’envoi des coordonnées sélectionnées au fournisseur de
          calcul. Aucun nom de patient n’est envoyé.
        </label>
        <button disabled={busy || !status?.available || eligible.length < 2}>
          {busy ? "Calcul des trajets…" : "Calculer et enregistrer les durées"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Consulter les trajets enregistrés ({routes.length})</summary>
        {routes.map((r, i) => (
          <p key={i}>
            {locations.find((l) => l.id === r.origin)?.label ||
              "Lieu de mission"}{" "}
            →{" "}
            {locations.find((l) => l.id === r.destination)?.label ||
              "Lieu de mission"}{" "}
            : <strong>{r.minutes} min</strong>
            {r.distance_m != null
              ? ` · ${(r.distance_m / 1000).toFixed(1)} km`
              : ""}{" "}
            · {r.provider} ·{" "}
            {new Date(r.expires_at) > new Date() ? "Valide" : "À recalculer"}
          </p>
        ))}
      </details>
    </section>
  );
}
