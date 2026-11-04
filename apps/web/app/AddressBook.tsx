"use client";
import { useRef, useState, type FormEvent } from "react";
import { field } from "./Fields";
type Row = Record<string, any>;
export default function AddressBook({
  api,
  reload,
  locations,
}: {
  api: (path: string, body?: Row) => Promise<any>;
  reload: () => Promise<void>;
  locations: Row[];
}) {
  const [results, setResults] = useState<Row[]>([]),
    [picked, setPicked] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const epoch = useRef(0);
  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    setResults([]);
    setNotice("");
    try {
      const r = await api("/addresses/search", {
        query: d.query,
        kind: d.kind,
      });
      if (current === epoch.current) {
        setResults(r);
        if (!r.length)
          setNotice(
            "Aucun résultat. Précisez la commune ou saisissez le lieu manuellement.",
          );
      }
    } catch (err) {
      if (current === epoch.current) setError((err as Error).message);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/locations", {
        label: d.label,
        address: d.address,
        sector: d.sector,
        latitude: Number(d.latitude),
        longitude: Number(d.longitude),
        confirmed: d.confirmed === "on",
      });
      await reload();
      setPicked(null);
      setNotice(
        "Lieu enregistré dans votre entreprise, disponible pour les courses.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const messages: Row = {
    GEOCODING_UNAVAILABLE:
      "La recherche IGN est indisponible. La saisie manuelle reste possible.",
    GEOCODING_RATE_LIMIT: "Trop de recherches. Patientez un instant.",
    VALIDATION_ERROR: "Vérifiez les champs et confirmez les coordonnées.",
    ACCESS_DENIED: "Votre rôle ne permet pas cette opération.",
  };
  return (
    <section className="panel padded">
      <h2>Lieux, adresses et établissements</h2>
      <p>
        Recherchez une adresse ou un établissement public, puis vérifiez et
        confirmez le point de prise en charge.
      </p>
      <form onSubmit={search}>
        <div className="form-grid">
          {field(
            "Recherche d’adresse ou de lieu",
            <input
              name="query"
              minLength={4}
              maxLength={180}
              required
              placeholder="Hôpital Purpan Toulouse ou une adresse"
              onChange={() => {
                epoch.current++;
                setBusy(false);
                setResults([]);
              }}
            />,
          )}
          {field(
            "Type de recherche",
            <select
              name="kind"
              onChange={() => {
                epoch.current++;
                setBusy(false);
                setResults([]);
              }}
            >
              <option value="address">Adresse française</option>
              <option value="poi">Établissement / lieu public</option>
            </select>,
          )}
        </div>
        <p className="hint">
          En cliquant sur Rechercher, le texte de ce champ est envoyé au service
          public IGN. Saisissez uniquement une adresse ou un établissement, sans
          nom de patient ni information médicale.
        </p>
        <button disabled={busy}>Rechercher</button>{" "}
        <button
          type="button"
          className="outline"
          disabled={busy}
          onClick={() => setPicked({})}
        >
          Saisir un lieu manuellement
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {messages[error] || "Impossible de terminer l’opération. Réessayez."}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <ul>
        {results.map((r, i) => (
          <li key={i}>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setPicked(r)}
            >
              {r.label} · {r.sector}
            </button>
          </li>
        ))}
      </ul>
      {picked && (
        <form key={JSON.stringify(picked)} onSubmit={save}>
          <div className="form-grid">
            {field(
              "Nom du lieu",
              <input
                name="label"
                required
                minLength={2}
                maxLength={80}
                defaultValue={picked.label || ""}
              />,
            )}
            {field(
              "Adresse complète",
              <input
                name="address"
                required
                minLength={2}
                maxLength={200}
                defaultValue={picked.address || ""}
              />,
            )}
            {field(
              "Secteur public / commune",
              <input
                name="sector"
                required
                minLength={2}
                maxLength={80}
                defaultValue={picked.sector || ""}
              />,
            )}
            {field(
              "Latitude",
              <input
                name="latitude"
                type="number"
                min={-90}
                max={90}
                step="any"
                required
                defaultValue={picked.latitude}
              />,
            )}
            {field(
              "Longitude",
              <input
                name="longitude"
                type="number"
                min={-180}
                max={180}
                step="any"
                required
                defaultValue={picked.longitude}
              />,
            )}
          </div>
          <p className="hint">
            Le secteur peut être visible dans vos offres réseau. Indiquez la
            commune, sans adresse précise ni identité. Une recherche
            d’établissement ne garantit pas l’entrée adaptée aux patients.
          </p>
          <label className="check">
            <input name="confirmed" type="checkbox" required />
            J’ai vérifié l’adresse et les coordonnées du point de prise en
            charge.
          </label>
          <button disabled={busy}>Enregistrer le lieu</button>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setPicked(null)}
          >
            Fermer
          </button>
        </form>
      )}
      <details>
        <summary>Lieux disponibles ({locations.length})</summary>
        {locations.map((l) => (
          <p key={l.id}>
            <strong>{l.label}</strong> · {l.address || l.label}{" "}
            {l.latitude === null || l.latitude === undefined
              ? "· Coordonnées non renseignées"
              : "· Coordonnées renseignées"}
          </p>
        ))}
      </details>
      <p className="hint">
        Source de recherche : IGN / BAN et BD TOPO. L’enregistrement d’un lieu
        ne calcule pas ses temps de trajet. Sans routage configuré, une
        affectation peut rester bloquée.
      </p>
    </section>
  );
}
