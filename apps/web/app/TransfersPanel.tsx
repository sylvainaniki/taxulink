"use client";
import { useEffect, useState, type FormEvent } from "react";
import { field } from "./Fields";
type Row = Record<string, any>;
export default function TransfersPanel({
  api,
  courses,
  drivers,
  vehicles,
  manage,
  reload,
}: {
  api: (path: string, body?: Row) => Promise<any>;
  courses: Row[];
  drivers: Row[];
  vehicles: Row[];
  manage: boolean;
  reload: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    api("/transfers")
      .then((r) => {
        if (active) setRequests(r);
      })
      .catch(() => {
        if (active) setError("Impossible de charger les demandes.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<any>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await reload();
      setRequests(await api("/transfers"));
      setNotice("Opération enregistrée.");
    } catch (err) {
      const code = (err as Error).message;
      setError(
        (
          {
            PLAN_STALE:
              "La course a changé. Rechargez la page et réexaminez la demande.",
            COURSE_FROZEN:
              "La mission a commencé : la réattribution est bloquée.",
            RESOURCE_CONFLICT:
              "Le remplaçant a déjà une mission sur ce créneau.",
            TRANSFER_NO_CHANGE: "Choisissez un autre chauffeur ou véhicule.",
            ROUTE_UNAVAILABLE:
              "Il manque un trajet validé pour cette affectation.",
            RESOURCE_UNAVAILABLE: "Le remplaçant est indisponible.",
          } as Row
        )[code] ||
          "Opération refusée : vérifiez les horaires, ressources et droits.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(
    e: FormEvent<HTMLFormElement>,
    action: (d: Row) => Promise<any>,
  ) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    void run(() => action(d));
  }
  return (
    <section className="panel padded">
      <h2>Relais et réattributions</h2>
      <p>
        Une demande ne déplace pas la mission. Un régulateur doit approuver le
        remplaçant après contrôle des contraintes.
      </p>
      <form
        onSubmit={(e) =>
          submit(e, (d) => {
            const c = courses.find((c) => c.id === d.course);
            if (!c) throw new Error("PLAN_STALE");
            return api(`/courses/${c.id}/transfer-request`, {
              version: c.version,
              reason: d.reason,
            });
          })
        }
      >
        <div className="form-grid">
          {field(
            "Mission à réattribuer",
            <select name="course" required>
              <option value="">Choisir</option>
              {courses
                .filter((c) => ["assigned", "confirmed"].includes(c.status))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.reference}
                  </option>
                ))}
            </select>,
          )}
          {field(
            "Motif du relais",
            <select name="reason">
              <option value="breakdown">Panne</option>
              <option value="delay">Retard</option>
              <option value="illness">Indisponibilité</option>
              <option value="other">Autre</option>
            </select>,
          )}
        </div>
        <button disabled={busy}>Demander un relais</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {requests.map((r) => (
        <article className="plan-card" key={r.id}>
          <h3>{r.reference}</h3>
          <p>
            {
              (
                {
                  pending: "En attente",
                  approved: "Approuvée",
                  rejected: "Refusée",
                } as Row
              )[r.status]
            }{" "}
            ·{" "}
            {
              (
                {
                  breakdown: "Panne",
                  delay: "Retard",
                  illness: "Indisponibilité",
                  other: "Autre",
                } as Row
              )[r.reason]
            }
          </p>
          {manage && r.status === "pending" && (
            <form
              onSubmit={(e) =>
                submit(e, (d) =>
                  api(`/transfers/${r.id}/decision`, {
                    decision: "approve",
                    driver_id: d.driver,
                    vehicle_id: d.vehicle,
                  }),
                )
              }
            >
              <div className="form-grid">
                {field(
                  "Chauffeur remplaçant",
                  <select name="driver" required>
                    <option value="">Choisir</option>
                    {drivers
                      .filter((d) => d.active)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>,
                )}
                {field(
                  "Véhicule remplaçant",
                  <select name="vehicle" required>
                    <option value="">Choisir</option>
                    {vehicles
                      .filter((v) => v.active)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                  </select>,
                )}
              </div>
              <button disabled={busy}>Valider la réattribution</button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    api(`/transfers/${r.id}/decision`, { decision: "reject" }),
                  )
                }
              >
                Refuser la demande
              </button>
            </form>
          )}
        </article>
      ))}
      {!requests.length && <p>Aucune demande de relais.</p>}
    </section>
  );
}
