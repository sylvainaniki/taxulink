"use client";
import {
  useEffect,
  useRef,
  useState,
  cloneElement,
  type ReactElement,
  type FormEvent,
} from "react";
import { parseCsv, encodeCsv } from "../../../packages/contracts/csv";
import { parisDateTime } from "../../../packages/contracts/dates";
import { field } from "./Fields";
import AddressBook from "./AddressBook";
import RoutingPanel from "./RoutingPanel";
import TransfersPanel from "./TransfersPanel";
type Row = Record<string, any>;
type Props = {
  tab: string;
  tenant: string;
  date: string;
  role: string;
  courses: Row[];
  drivers: Row[];
  vehicles: Row[];
  groups: Row[];
  locations: Row[];
  api: (path: string, body?: Row) => Promise<any>;
  reload: () => Promise<void>;
  onBusy: (v: boolean) => void;
  onSessionClosed: () => void;
};
const messages: Row = {
  MFA_INVALID: "Code invalide ou déjà utilisé.",
  MFA_REQUIRED: "Un code de double authentification est requis.",
  INVALID_CREDENTIALS: "Mot de passe incorrect.",
  ACCESS_DENIED: "Accès non autorisé pour ce rôle.",
  NOT_FOUND: "Élément introuvable ou non autorisé.",
  PLAN_STALE: "Les données ont changé : recalculez la proposition.",
  OFFER_UNAVAILABLE: "Cette offre est déjà réservée, retirée ou expirée.",
  COURSE_OFFERED: "Retirez cette offre avant de modifier la course.",
  RESOURCE_COMMITTED:
    "Cette ressource a des engagements. Réattribuez-les avant de la modifier.",
  RESOURCE_CONFLICT: "Créneau déjà occupé pour ce chauffeur ou ce véhicule.",
  VEHICLE_HANDOVER_REQUIRED:
    "Un changement de véhicule ou de chauffeur exige une remise du véhicule qui n’est pas planifiée. Conservez le même binôme sur ce service.",
  CALCULATION_BUDGET: "Budget de calcul atteint. Réduisez le lot de missions.",
  SHIFT_CONFLICT: "En dehors du service du chauffeur.",
  BREAK_CONFLICT: "Le trajet empiète sur une pause.",
  TRANSFER_CONFLICT: "Temps de liaison insuffisant entre les missions.",
  VALIDATION_ERROR: "Vérifiez les valeurs et les horaires du formulaire.",
  LOCAL_TIME_INVALID:
    "Heure locale ambiguë ou inexistante lors du changement d’heure.",
  INVALID_LOCAL_TIME: "Cette heure locale n’existe pas.",
  AMBIGUOUS_LOCAL_TIME: "Cette heure locale est ambiguë.",
  CONFLICT: "Une opération identique existe déjà.",
  NETWORK: "Connexion au serveur impossible.",
  ROUTE_UNAVAILABLE:
    "Trajet absent ou périmé : calculez les durées dans Contacts.",
  RESOURCE_UNAVAILABLE:
    "Le chauffeur ou le véhicule est indisponible sur ce créneau.",
  CSV_HEADERS_INVALID: "Colonnes CSV incorrectes. Utilisez le modèle proposé.",
  SHIFT_OVERLAP: "Ce chauffeur a déjà un service sur cette période.",
  COURSE_FROZEN:
    "Cette mission est engagée et ne peut pas être modifiée ainsi.",
  INVITATION_INVALID: "Invitation expirée ou déjà traitée.",
  LAST_ADMIN: "Conservez au moins un administrateur actif.",
  SELF_CHANGE_FORBIDDEN: "Vous ne pouvez pas modifier vos propres droits.",
};
const when = (s: string) =>
  new Date(s).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function WorkspacePanels(p: Props) {
  const [data, setData] = useState<Row>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedGroup, setSelectedGroup] = useState(""),
    [conversation, setConversation] = useState(""),
    [chatMode, setChatMode] = useState("group"),
    [selectedOffer, setSelectedOffer] = useState(""),
    [selectedDriver, setSelectedDriver] = useState(""),
    [selectedVehicle, setSelectedVehicle] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [preview, setPreview] = useState<Row | null>(null),
    [mfaSetup, setMfaSetup] = useState<Row | null>(null),
    [recovery, setRecovery] = useState<string[]>([]),
    [loaded, setLoaded] = useState(false);
  const epoch = useRef(0);
  const manage = ["admin", "dispatcher"].includes(p.role),
    admin = p.role === "admin";
  async function load(generation = epoch.current) {
    const paths: Record<string, string[]> = {
      Bourse: ["/offers"],
      Messages: [
        "/conversations",
        "/people",
        ...(chatMode === "group" && selectedGroup
          ? [`/groups/${selectedGroup}/messages`]
          : conversation
            ? [`/conversations/${conversation}/messages`]
            : []),
      ],
      Réseaux: admin ? ["/network-invitations", "/company"] : ["/company"],
      Contacts: ["/contacts"],
      "Équipe & flotte": ["/people"],
      "Récurrences & retours": [
        "/recurrences",
        "/pending-returns",
        "/contacts",
      ],
      Statistiques: ["/analytics"],
      Notifications: [
        "/notifications",
        "/notification-settings",
        ...(manage ? ["/alerts"] : []),
      ],
      Administration: admin
        ? ["/members", "/company", "/shifts", "/absences"]
        : ["/company"],
      Compte: ["/company", "/auth/me"],
      Optimisation: ["/plans"],
    };
    const results = await Promise.all(
      (paths[p.tab] || []).map(async (path) => [path, await p.api(path)]),
    );
    if (generation === epoch.current) {
      setData((previous) => ({ ...previous, ...Object.fromEntries(results) }));
      setLoaded(true);
    }
  }
  useEffect(() => {
    const generation = ++epoch.current;
    setData({});
    setError("");
    setNotice("");
    setSelectedOffer("");
    setLoaded(false);
    load(generation).catch((e) => {
      if (generation === epoch.current) {
        setError(e.message);
        setLoaded(true);
      }
    });
    const interval = setInterval(
      () => load(generation).catch(() => {}),
      p.tab === "Messages" ? 1500 : 8000,
    );
    return () => {
      epoch.current++;
      clearInterval(interval);
    };
  }, [p.tenant, p.tab, p.date, selectedGroup, conversation, chatMode]);
  useEffect(() => {
    setSelectedGroup("");
    setConversation("");
    setRows([]);
    setPreview(null);
  }, [p.tenant]);
  async function run(
    action: () => Promise<any>,
    success = "Action confirmée par le serveur.",
  ) {
    if (busy || !navigator.onLine) return;
    const generation = epoch.current;
    setBusy(true);
    p.onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (generation === epoch.current) {
        await p.reload();
        await load(generation);
        setNotice(success);
      }
    } catch (e) {
      if (generation === epoch.current) setError((e as Error).message);
    } finally {
      setBusy(false);
      p.onBusy(false);
    }
  }
  const submit =
    (callback: (values: Row) => Promise<any>, success?: string) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const values: Row = Object.fromEntries(formData);
      if (formData.has("groups")) values.groups = formData.getAll("groups");
      void run(() => callback(values), success);
    };
  const post = (path: string, body: Row = {}) => p.api(path, body);
  const location = (name: string) => (
    <select name={name} required>
      {p.locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
  const groupSelect = (
    <select
      value={selectedGroup}
      onChange={(e) => setSelectedGroup(e.target.value)}
    >
      <option value="">Choisir un groupe</option>
      {p.groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
  const offers: Row[] = data["/offers"] || [];
  return (
    <section className="workspace-panels">
      {error && (
        <div className="error" role="alert">
          {messages[error] || error}
        </div>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {!loaded && <p role="status">Chargement…</p>}
      {p.tab === "Bourse" && (
        <>
          {manage && (
            <details className="panel expandable">
              <summary>＋ Proposer une course au réseau</summary>
              <form
                onSubmit={submit(
                  (d) =>
                    post("/offers", {
                      course_id: d.course,
                      group_ids: d.groups || [],
                      expires_at: new Date(
                        Date.now() + Number(d.duration) * 3600000,
                      ).toISOString(),
                    }),
                  "Offre publiée sans référence nominative.",
                )}
              >
                <div className="form-grid">
                  {field(
                    "Course à proposer",
                    <select name="course" required>
                      <option value="">Choisir une course</option>
                      {p.courses
                        .filter(
                          (c) =>
                            c.status === "unassigned" && !c.source_course_id,
                        )
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.reference} · {when(c.pickup_at)}
                          </option>
                        ))}
                    </select>,
                  )}
                  <fieldset>
                    <legend>Groupes destinataires</legend>
                    {p.groups.map((g, i) => (
                      <label className="check" key={g.id}>
                        <input
                          type="checkbox"
                          name="groups"
                          value={g.id}
                          defaultChecked={i === 0}
                        />
                        {g.name}
                      </label>
                    ))}
                  </fieldset>
                  {field(
                    "Validité de l’offre",
                    <select name="duration">
                      <option value="1">1 heure</option>
                      <option value="4">4 heures</option>
                      <option value="24">24 heures</option>
                    </select>,
                  )}
                </div>
                <p className="hint">
                  Le groupe voit les lieux, horaires et besoins du véhicule.
                  Aucune référence passager ni pièce n’est publiée. Une
                  réservation nécessite ensuite votre confirmation.
                </p>
                <button disabled={busy}>Publier l’offre</button>
              </form>
            </details>
          )}
          <div className="panel">
            <div className="panel-head">
              <h2>Offres de vos groupes privés</h2>
              <span>Confirmation propriétaire obligatoire</span>
            </div>
            {offers.length ? (
              offers.map((o) => (
                <article key={o.id} className="offer-card">
                  <div>
                    <span
                      className={
                        "status " +
                        (o.status === "published" ? "assigned" : "unassigned")
                      }
                    >
                      {
                        (
                          {
                            published: "Disponible",
                            reserved: "Réservée · validation en attente",
                            accepted: "Transfert confirmé",
                            withdrawn: "Retirée",
                            expired: "Expirée",
                            rejected: "Refusée",
                          } as Row
                        )[o.status]
                      }
                    </span>
                    <h3>
                      {o.origin_label} → {o.destination_label}
                    </h3>
                    <p>
                      {when(o.pickup_at)} · {o.passengers} passager(s)
                      {o.accessible ? " · PMR" : ""}
                    </p>
                    <small>
                      {o.own
                        ? "Votre offre"
                        : o.claimed_by_me
                          ? "Réservée par votre entreprise"
                          : "Offre partenaire"}{" "}
                      · Échéance {when(o.expires_at)}
                    </small>
                  </div>
                  <div className="row-actions">
                    {!o.own && o.status === "published" && (
                      <button
                        disabled={busy}
                        onClick={() => setSelectedOffer(o.id)}
                      >
                        Réserver
                      </button>
                    )}
                    {o.own && manage && o.status === "reserved" && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                post(`/offers/${o.id}/decision`, {
                                  decision: "approve",
                                }),
                              "Transfert confirmé. Le partenaire reçoit uniquement sa mission.",
                            )
                          }
                        >
                          Confirmer le transfert
                        </button>
                        <button
                          className="outline"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              post(`/offers/${o.id}/decision`, {
                                decision: "reject",
                              }),
                            )
                          }
                        >
                          Refuser
                        </button>
                      </>
                    )}
                    {o.own &&
                      manage &&
                      ["published", "reserved"].includes(o.status) && (
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              post(`/offers/${o.id}/decision`, {
                                decision: "withdraw",
                              }),
                            )
                          }
                        >
                          Retirer l’offre
                        </button>
                      )}
                  </div>
                  {selectedOffer === o.id && o.status === "published" && (
                    <form
                      className="inline-form"
                      onSubmit={submit(
                        (d) =>
                          post(`/offers/${o.id}/claim`, {
                            driver_id: d.driver,
                            vehicle_id: d.vehicle,
                          }),
                        "Réservation enregistrée. La mission reste sous réserve de confirmation du propriétaire.",
                      )}
                    >
                      <div className="form-grid">
                        {field(
                          "Chauffeur pour cette offre",
                          <select name="driver" required>
                            {p.drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>,
                        )}
                        {field(
                          "Véhicule pour cette offre",
                          <select name="vehicle" required>
                            {p.vehicles.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.label}
                              </option>
                            ))}
                          </select>,
                        )}
                      </div>
                      <p className="hint">
                        Vos ressources sont réservées pendant 10 minutes au
                        maximum. Aucune mission définitive avant confirmation.
                      </p>
                      <button disabled={busy}>Confirmer la réservation</button>
                      <button
                        className="quiet"
                        type="button"
                        onClick={() => setSelectedOffer("")}
                      >
                        Fermer
                      </button>
                    </form>
                  )}
                </article>
              ))
            ) : (
              <p className="empty">
                Aucune offre visible dans vos groupes pour le moment.
              </p>
            )}
          </div>
        </>
      )}
      {p.tab === "Messages" && (
        <div className="panel padded">
          <h2>Messagerie</h2>
          <div className="filters">
            {[
              ["group", "Groupe"],
              ["direct", "Direct"],
              ["course", "Mission"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                className={chatMode === mode ? "selected" : "quiet"}
                onClick={() => {
                  setChatMode(mode);
                  setConversation("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">
            Échanges opérationnels uniquement. Ne publiez ni carte Vitale, ni
            prescription, ni détail médical.
          </p>
          {chatMode === "group" ? (
            field("Conversation du groupe", groupSelect)
          ) : (
            <>
              <form
                className="inline-form"
                onSubmit={submit(async (d) => {
                  const result = await post(
                    "/conversations",
                    chatMode === "course"
                      ? { kind: "course", course_id: d.target }
                      : { kind: "direct", user_id: d.target },
                  );
                  setConversation(result.id);
                })}
              >
                {field(
                  chatMode === "course"
                    ? "Mission concernée"
                    : "Destinataire direct",
                  <select name="target" required>
                    <option value="">Choisir</option>
                    {(chatMode === "course"
                      ? p.courses
                      : data["/people"] || []
                    ).map((r: Row) => (
                      <option key={r.id || r.user_id} value={r.id || r.user_id}>
                        {r.reference || r.email}
                      </option>
                    ))}
                  </select>,
                )}
                <button disabled={busy}>Ouvrir la conversation</button>
              </form>
              {field(
                "Conversations existantes",
                <select
                  value={conversation}
                  onChange={(e) => setConversation(e.target.value)}
                >
                  <option value="">Choisir une conversation</option>
                  {(data["/conversations"] || [])
                    .filter((c: Row) => c.kind === chatMode)
                    .map((c: Row) => (
                      <option key={c.id} value={c.id}>
                        {c.label} · {when(c.created_at)}
                      </option>
                    ))}
                </select>,
              )}
            </>
          )}
          {(chatMode === "group" ? selectedGroup : conversation) && (
            <>
              <div
                className="chat-log"
                role="log"
                aria-label="Messages de la conversation"
              >
                {(
                  data[
                    chatMode === "group"
                      ? `/groups/${selectedGroup}/messages`
                      : `/conversations/${conversation}/messages`
                  ] || []
                ).map((m: Row) => (
                  <article
                    className={m.own ? "message own" : "message"}
                    key={m.id}
                  >
                    <small>
                      {m.company} · {when(m.created_at)}
                    </small>
                    <p>{m.body}</p>
                  </article>
                ))}
              </div>
              <form
                onSubmit={submit((d) =>
                  post(
                    chatMode === "group"
                      ? `/groups/${selectedGroup}/messages`
                      : `/conversations/${conversation}/messages`,
                    { body: d.message },
                  ),
                )}
              >
                {field(
                  "Votre message",
                  <textarea
                    name="message"
                    required
                    maxLength={2000}
                    rows={3}
                  />,
                )}
                <button disabled={busy}>Envoyer le message</button>
              </form>
            </>
          )}
        </div>
      )}
      {p.tab === "Réseaux" && (
        <div className="panel padded">
          <h2>Groupes et entreprises partenaires</h2>
          <p>
            Votre code entreprise :{" "}
            <strong>{data["/company"]?.network_code || "…"}</strong>
          </p>
          <p className="hint">
            Transmettez ce code à un administrateur partenaire pour recevoir une
            invitation. Les fichiers clients de chaque entreprise restent
            séparés.
          </p>
          <div className="cards">
            {p.groups.map((g) => (
              <article key={g.id}>
                <h3>{g.name}</h3>
                <p>
                  {g.owner_tenant_id === p.tenant
                    ? "Votre entreprise administre ce groupe"
                    : "Entreprise membre"}
                </p>
                {g.owner_tenant_id === p.tenant && admin && (
                  <form
                    onSubmit={submit((d) =>
                      post(`/groups/${g.id}/invite-code`, { code: d.code }),
                    )}
                  >
                    {field(
                      "Code entreprise à inviter " + g.name,
                      <input
                        name="code"
                        required
                        minLength={12}
                        maxLength={12}
                        placeholder="12 caractères"
                      />,
                    )}
                    <button disabled={busy}>Inviter l’entreprise</button>
                  </form>
                )}
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const members = await p.api(`/groups/${g.id}/members`);
                      setData((d) => ({ ...d, ["members-" + g.id]: members }));
                    })
                  }
                >
                  Voir les membres
                </button>
                {(data["members-" + g.id] || []).map((m: Row) => (
                  <div className="member-line" key={m.tenant_id}>
                    {m.name}
                    {admin &&
                      g.owner_tenant_id === p.tenant &&
                      m.tenant_id !== p.tenant && (
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              post(`/groups/${g.id}/remove-member`, {
                                tenant_id: m.tenant_id,
                              }),
                            )
                          }
                        >
                          Retirer
                        </button>
                      )}
                  </div>
                ))}
              </article>
            ))}
          </div>
          {admin && (
            <>
              <h3>Invitations reçues</h3>
              {(data["/network-invitations"] || []).map((i: Row) => (
                <div key={i.id} className="invite-row">
                  <strong>{i.name}</strong>
                  <span>
                    {i.status === "pending" ? "En attente" : i.status}
                  </span>
                  {i.status === "pending" &&
                    new Date(i.expires_at) > new Date() && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() => post(`/network-invitations/${i.id}/accept`))
                        }
                      >
                        Rejoindre ce groupe
                      </button>
                    )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {p.tab === "Équipe & flotte" && (
        <>
          <div className="panel padded">
            <h2>Modifier un chauffeur</h2>
            {field(
              "Chauffeur à modifier",
              <select
                value={selectedDriver}
                onChange={(e) => setSelectedDriver(e.target.value)}
              >
                <option value="">Choisir</option>
                {p.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>,
            )}
            {p.drivers
              .filter((d) => d.id === selectedDriver)
              .map((d) => (
                <form
                  key={d.id}
                  onSubmit={submit((v) =>
                    post(`/drivers/${d.id}/update`, {
                      name: v.name,
                      ...(v.user ? { user_id: v.user } : {}),
                      shift_start: parisDateTime(v.day, v.start),
                      shift_end: parisDateTime(v.day, v.end),
                      start_location: v.origin,
                      end_location: v.destination,
                      breaks: [
                        ...(v.pause_start && v.pause_end
                          ? [
                              {
                                start: parisDateTime(v.day, v.pause_start),
                                end: parisDateTime(v.day, v.pause_end),
                              },
                            ]
                          : []),
                        ...d.breaks.slice(1),
                      ],
                    }),
                  )}
                >
                  <div className="form-grid">
                    {field(
                      "Nom du chauffeur",
                      <input name="name" defaultValue={d.name} required />,
                    )}
                    {field(
                      "Accès utilisateur associé",
                      <select name="user" defaultValue={d.user_id || ""}>
                        <option value="">Aucun compte associé</option>
                        {(data["/people"] || []).map((u: Row) => (
                          <option key={u.user_id} value={u.user_id}>
                            {u.email}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field(
                      "Jour du service initial",
                      <input
                        name="day"
                        type="date"
                        defaultValue={new Intl.DateTimeFormat("sv-SE", {
                          timeZone: "Europe/Paris",
                        }).format(new Date(d.shift_start))}
                        required
                      />,
                    )}
                    {field(
                      "Début du service initial",
                      <input
                        name="start"
                        type="time"
                        defaultValue={new Date(
                          d.shift_start,
                        ).toLocaleTimeString("fr-FR", {
                          timeZone: "Europe/Paris",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        required
                      />,
                    )}
                    {field(
                      "Fin du service initial",
                      <input
                        name="end"
                        type="time"
                        defaultValue={new Date(d.shift_end).toLocaleTimeString(
                          "fr-FR",
                          {
                            timeZone: "Europe/Paris",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                        required
                      />,
                    )}
                    {field(
                      "Origine du service",
                      <select name="origin" defaultValue={d.start_location}>
                        {p.locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field(
                      "Dépôt de retour",
                      <select name="destination" defaultValue={d.end_location}>
                        {p.locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field(
                      "Début de la pause principale",
                      <input
                        name="pause_start"
                        type="time"
                        defaultValue={
                          d.breaks[0]
                            ? new Date(d.breaks[0].start).toLocaleTimeString(
                                "fr-FR",
                                {
                                  timeZone: "Europe/Paris",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )
                            : ""
                        }
                      />,
                    )}
                    {field(
                      "Fin de la pause principale",
                      <input
                        name="pause_end"
                        type="time"
                        defaultValue={
                          d.breaks[0]
                            ? new Date(d.breaks[0].end).toLocaleTimeString(
                                "fr-FR",
                                {
                                  timeZone: "Europe/Paris",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )
                            : ""
                        }
                      />,
                    )}
                  </div>
                  <p className="hint">
                    Toute modification est refusée si des missions ou
                    réservations sont engagées. Les autres pauses sont
                    conservées.
                  </p>
                  <button disabled={busy}>Enregistrer le chauffeur</button>
                </form>
              ))}
          </div>
          <div className="panel padded">
            <h2>Modifier un véhicule</h2>
            {field(
              "Véhicule à modifier",
              <select
                value={selectedVehicle}
                onChange={(e) => setSelectedVehicle(e.target.value)}
              >
                <option value="">Choisir</option>
                {p.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>,
            )}
            {p.vehicles
              .filter((v) => v.id === selectedVehicle)
              .map((v) => (
                <form
                  key={v.id}
                  onSubmit={submit((d) =>
                    post(`/vehicles/${v.id}/update`, {
                      label: d.label,
                      seats: Number(d.seats),
                      accessible: d.accessible === "on",
                      active: d.active === "on",
                      start_location: d.start_location,
                    }),
                  )}
                >
                  {field(
                    "Nom ou immatriculation fictive",
                    <input
                      name="label"
                      defaultValue={v.label}
                      required
                      maxLength={60}
                    />,
                  )}
                  {field(
                    "Nombre de places passagers",
                    <input
                      name="seats"
                      type="number"
                      min={1}
                      max={8}
                      defaultValue={v.seats}
                      required
                    />,
                  )}
                  <label className="check">
                    <input
                      name="accessible"
                      type="checkbox"
                      defaultChecked={v.accessible}
                    />
                    Équipement PMR
                  </label>
                  <label className="check">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={v.active}
                    />
                    Véhicule disponible
                  </label>
                  <p className="hint">
                    Les changements sont bloqués si le véhicule a des missions
                    ou réservations engagées.
                  </p>
                  {field(
                    "Position de départ du véhicule",
                    <select
                      name="start_location"
                      defaultValue={v.start_location}
                    >
                      {p.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>,
                  )}
                  <button disabled={busy}>Enregistrer le véhicule</button>
                </form>
              ))}
          </div>
        </>
      )}
      {p.tab === "Contacts" && (
        <div className="panel padded">
          <AddressBook
            key={p.tenant}
            api={p.api}
            reload={p.reload}
            locations={p.locations}
          />
          <RoutingPanel
            key={p.tenant + "-routing"}
            api={p.api}
            locations={p.locations}
          />
          <h2>Clients, établissements et partenaires</h2>
          <details>
            <summary>＋ Ajouter une fiche fictive</summary>
            <form onSubmit={submit((d) => post("/contacts", d))}>
              {field(
                "Nom de la fiche",
                <input name="name" required minLength={2} maxLength={100} />,
              )}
              {field(
                "Catégorie de fiche",
                <select name="kind">
                  <option value="customer">Client / patient fictif</option>
                  <option value="facility">Établissement</option>
                  <option value="partner">Partenaire</option>
                </select>,
              )}
              {field(
                "Téléphone",
                <input name="phone" type="tel" maxLength={30} />,
              )}
              {field("Adresse", <input name="address" maxLength={200} />)}
              <button disabled={busy}>Créer la fiche</button>
            </form>
          </details>
          <div className="cards">
            {(data["/contacts"] || []).map((r: Row) => (
              <article key={r.id}>
                <h3>{r.name}</h3>
                <p>
                  {
                    (
                      {
                        customer: "Client",
                        facility: "Établissement",
                        partner: "Partenaire",
                      } as Row
                    )[r.kind]
                  }
                </p>
                <p>{r.address}</p>
                {r.phone && (
                  <a href={"tel:" + r.phone.replace(/[^+\d]/g, "")}>
                    {r.phone}
                  </a>
                )}
              </article>
            ))}
          </div>
          <p className="hint">
            Les fiches de cette version ne contiennent aucun diagnostic ni
            justificatif médical.
          </p>
        </div>
      )}
      {p.tab === "Optimisation" && (
        <div className="panel padded">
          <h2>Proposer un planning réalisable</h2>
          <p>
            Journée du {p.date}. Les courses déjà engagées restent en place. Les
            courses impossibles sont laissées sans chauffeur avec leurs motifs.
          </p>
          <p className="hint">
            Le calcul utilise les trajets enregistrés et refuse les trajets
            absents ou périmés. Il propose des affectations, sans les appliquer.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              run(
                () => post("/plans/propose", { date: p.date }),
                "Proposition calculée. Examinez les résultats avant de confirmer.",
              )
            }
          >
            Calculer une proposition
          </button>
          <form
            onSubmit={submit(
              (d) =>
                post("/plans/propose", {
                  date: p.date,
                  strategy: "search",
                  replan: d.replan === "on",
                  max_seconds: 5,
                }),
              "Recherche terminée. Examinez la proposition avant de l’appliquer.",
            )}
          >
            <h3>Recherche avec fenêtres horaires</h3>
            <label className="check">
              <input name="replan" type="checkbox" />
              Réorganiser aussi les missions non commencées, hors délai de gel.
            </label>
            <button disabled={busy}>Chercher une meilleure répartition</button>
          </form>
          {(data["/plans"] || []).map((plan: Row) => (
            <article key={plan.id} className="plan-card">
              <h3>Proposition du {when(plan.created_at)}</h3>
              <p>
                {plan.proposal.assigned.length} course(s) attribuable(s) ·{" "}
                {plan.proposal.unassigned.length} non attribuable(s)
              </p>
              {plan.proposal.assigned.map((a: Row) => (
                <p key={a.course_id}>
                  {p.courses.find((c) => c.id === a.course_id)?.reference ||
                    "Mission"}{" "}
                  →{" "}
                  {p.drivers.find((d) => d.id === a.driver_id)?.name ||
                    "Chauffeur"}
                </p>
              ))}
              {plan.proposal.unassigned.map((a: Row) => (
                <p className="hint" key={a.course_id}>
                  {p.courses.find((c) => c.id === a.course_id)?.reference ||
                    "Mission"}{" "}
                  : {a.reasons.map((r: string) => messages[r] || r).join(" · ")}
                </p>
              ))}
              {plan.status === "proposed" &&
              new Date(plan.expires_at) > new Date() ? (
                <button
                  disabled={busy || !plan.proposal.assigned.length}
                  onClick={() =>
                    run(
                      () => post(`/plans/${plan.id}/apply`),
                      "Planning confirmé et enregistré.",
                    )
                  }
                >
                  Appliquer cette proposition
                </button>
              ) : (
                <span className="status">
                  {plan.status === "applied" ? "Appliquée" : "Expirée"}
                </span>
              )}
            </article>
          ))}
        </div>
      )}
      {p.tab === "Récurrences & retours" && (
        <>
          <div className="panel padded">
            <h2>Courses récurrentes</h2>
            <details>
              <summary>＋ Créer une série</summary>
              <form
                onSubmit={submit((d) =>
                  post("/recurrences", {
                    template: {
                      reference: d.reference,
                      origin: d.origin,
                      destination: d.destination,
                      pickup_time: d.pickup,
                      appointment_time: d.appointment,
                      arrival_buffer: 15,
                      passengers: Number(d.passengers),
                      accessible: false,
                    },
                    start_date: d.start,
                    end_date: d.end,
                    weekdays: String(d.weekdays).split(",").map(Number),
                    exceptions: String(d.exceptions)
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    interval_weeks: Number(d.interval),
                  }),
                )}
              >
                <div className="form-grid">
                  {field(
                    "Référence de la série",
                    <input name="reference" required maxLength={50} />,
                  )}
                  {field(
                    "Passagers par trajet",
                    <input
                      name="passengers"
                      type="number"
                      min={1}
                      max={8}
                      defaultValue={1}
                      required
                    />,
                  )}
                  {field("Lieu de départ", location("origin"))}
                  {field("Lieu d’arrivée", location("destination"))}
                  {field(
                    "Début de la série",
                    <input
                      name="start"
                      type="date"
                      defaultValue={p.date}
                      required
                    />,
                  )}
                  {field(
                    "Fin de la série (93 jours maximum)",
                    <input
                      name="end"
                      type="date"
                      defaultValue={p.date}
                      required
                    />,
                  )}
                  {field(
                    "Heure de prise en charge",
                    <input
                      name="pickup"
                      type="time"
                      defaultValue="09:00"
                      required
                    />,
                  )}
                  {field(
                    "Heure de rendez-vous",
                    <input
                      name="appointment"
                      type="time"
                      defaultValue="10:00"
                      required
                    />,
                  )}
                  {field(
                    "Jours : lundi 1 à dimanche 7",
                    <input
                      name="weekdays"
                      defaultValue="1,4"
                      required
                      pattern="[1-7](,[1-7])*"
                    />,
                  )}
                  {field(
                    "Une fois toutes les semaines",
                    <select name="interval">
                      <option value="1">Chaque semaine</option>
                      <option value="2">Toutes les 2 semaines</option>
                      <option value="3">Toutes les 3 semaines</option>
                      <option value="4">Toutes les 4 semaines</option>
                    </select>,
                  )}
                </div>
                {field(
                  "Dates exclues séparées par des virgules",
                  <input
                    name="exceptions"
                    placeholder="2026-12-25,2027-01-01"
                  />,
                )}
                <button disabled={busy}>Enregistrer la série</button>
              </form>
            </details>
            {(data["/recurrences"] || []).map((r: Row) => (
              <article className="plan-card" key={r.id}>
                <h3>{r.template.reference}</h3>
                <p>
                  Jours {r.weekdays.join(", ")} ·{" "}
                  {String(r.start_date).slice(0, 10)} au{" "}
                  {String(r.end_date).slice(0, 10)}
                </p>
                {r.active ? (
                  <div className="row-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const result = await post(
                            `/recurrences/${r.id}/generate`,
                          );
                          setNotice(
                            `${result.generated} occurrence(s) créée(s).`,
                          );
                        }, "Génération terminée, sans doublon.")
                      }
                    >
                      Générer les occurrences
                    </button>
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => post(`/recurrences/${r.id}/stop`),
                          "Série arrêtée. Les courses existantes sont conservées.",
                        )
                      }
                    >
                      Arrêter la série
                    </button>
                  </div>
                ) : (
                  <span className="status">Arrêtée</span>
                )}
              </article>
            ))}
          </div>
          <div className="panel padded">
            <h2>Retours à organiser</h2>
            <p>
              Un horaire inconnu est signalé sans bloquer arbitrairement le
              planning.
            </p>
            <form
              onSubmit={submit((d) => {
                const course = [
                  ...(data["/pending-returns"] || []),
                  ...p.courses,
                ].find((c: Row) => c.id === d.course);
                return post(
                  `/courses/${d.course}/return`,
                  d.mode === "unknown"
                    ? { version: course.version }
                    : {
                        version: course.version,
                        pickup_at: parisDateTime(d.day, d.pickup),
                        appointment_at: parisDateTime(d.day, d.appointment),
                      },
                );
              })}
            >
              {field(
                "Course aller concernée",
                <select name="course" required>
                  {[
                    ...new Map(
                      [
                        ...p.courses.filter(
                          (c) =>
                            !c.source_course_id &&
                            !c.return_of &&
                            c.status !== "cancelled",
                        ),
                        ...(data["/pending-returns"] || []),
                      ].map((c: Row) => [c.id, c]),
                    ).values(),
                  ].map((c: Row) => (
                    <option key={c.id} value={c.id}>
                      {c.reference}
                      {c.return_pending ? " · horaire à confirmer" : ""}
                    </option>
                  ))}
                </select>,
              )}
              {field(
                "Type de retour",
                <select name="mode">
                  <option value="unknown">Horaire à confirmer</option>
                  <option value="known">Horaire connu</option>
                </select>,
              )}
              <div className="form-grid">
                {field(
                  "Jour du retour",
                  <input
                    name="day"
                    type="date"
                    defaultValue={p.date}
                    required
                  />,
                )}
                {field(
                  "Prise en charge retour",
                  <input
                    name="pickup"
                    type="time"
                    defaultValue="15:00"
                    required
                  />,
                )}
                {field(
                  "Arrivée prévue retour",
                  <input
                    name="appointment"
                    type="time"
                    defaultValue="16:00"
                    required
                  />,
                )}
              </div>
              <button disabled={busy}>Enregistrer le retour</button>
            </form>
            {(data["/pending-returns"] || []).map((r: Row) => (
              <p key={r.id} className="status unassigned">
                {r.reference} · Heure à confirmer
              </p>
            ))}
          </div>
        </>
      )}
      {p.tab === "Statistiques" && (
        <>
          <div className="stats">
            {[
              ["total", "Courses enregistrées"],
              ["completed", "Terminées"],
              ["unassigned", "À attribuer"],
              ["received", "Reçues du réseau"],
            ].map(([key, label]) => (
              <article key={key}>
                <span>{label}</span>
                <strong>{data["/analytics"]?.[key] ?? 0}</strong>
                <small>Votre entreprise · toutes dates</small>
              </article>
            ))}
          </div>
          <div className="panel padded">
            <h2>Importer et exporter les courses</h2>
            <p className="hint">
              100 lignes maximum par import. Les horodatages doivent inclure un
              décalage UTC explicite. L’import est précédé d’une vérification,
              avec détection des doublons.
            </p>
            <div className="row-actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await p.api("/exports/courses");
                    download(
                      "taxilink-courses.csv",
                      encodeCsv([r.columns, ...r.rows]),
                    );
                  }, "Export préparé.")
                }
              >
                Exporter les courses
              </button>
              <button
                className="outline"
                onClick={() =>
                  download(
                    "taxilink-modele-import.csv",
                    encodeCsv([
                      [
                        "reference",
                        "origin",
                        "destination",
                        "pickup_at",
                        "appointment_at",
                        "arrival_buffer",
                        "passengers",
                        "accessible",
                      ],
                      [
                        "DEMO-IMPORT",
                        "loc-0",
                        "loc-1",
                        parisDateTime(p.date, "09:00"),
                        parisDateTime(p.date, "10:00"),
                        15,
                        1,
                        false,
                      ],
                    ]),
                  )
                }
              >
                Modèle d’import CSV
              </button>
            </div>
            {field(
              "Fichier CSV à vérifier",
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPreview(null);
                  run(async () => {
                    if (file.size > 262144) throw new Error("CSV_TOO_LARGE");
                    const parsed = parseCsv(await file.text());
                    setRows(parsed);
                    const result = await post("/imports/preview", {
                      rows: parsed,
                    });
                    setPreview(result);
                  }, "Prévisualisation prête. Confirmez pour importer.");
                }}
              />,
            )}
            {preview && (
              <div className="success">
                {preview.valid} ligne(s) valide(s) ·{" "}
                {preview.duplicate_indexes.length} doublon(s) ignoré(s)
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => post("/imports/courses", { rows }),
                      "Import enregistré. Les doublons ont été ignorés.",
                    )
                  }
                >
                  Confirmer l’import
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {p.tab === "Notifications" && (
        <>
          {(manage || p.role === "driver") && (
            <TransfersPanel
              key={p.tenant}
              api={p.api}
              reload={p.reload}
              courses={p.courses}
              drivers={p.drivers}
              vehicles={p.vehicles}
              manage={manage}
            />
          )}
          <div className="panel padded">
            <h2>Canaux de notification</h2>
            <p>
              Les messages externes ne contiennent aucune information passager.
            </p>
            <button
              className="outline"
              disabled={
                busy ||
                (!data["/notification-settings"]?.email_available &&
                  !data["/notification-settings"]?.email_enabled)
              }
              onClick={() =>
                run(() =>
                  post("/notification-settings", {
                    email_enabled:
                      !data["/notification-settings"]?.email_enabled,
                  }),
                )
              }
            >
              {data["/notification-settings"]?.email_enabled
                ? "Désactiver les emails"
                : "Activer les emails"}
            </button>
            {!data["/notification-settings"]?.email_available && (
              <p className="hint">
                L’envoi d’email est indisponible sur cette installation.
              </p>
            )}
            <h3>Appareils mobiles autorisés</h3>
            {(data["/notification-settings"]?.devices || []).map(
              (device: Row) => (
                <article className="invite-row" key={device.id}>
                  <span>
                    {device.platform} · expire le {when(device.expires_at)}
                  </span>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => post(`/devices/${device.id}/remove`),
                        "Appareil révoqué.",
                      )
                    }
                  >
                    Révoquer
                  </button>
                </article>
              ),
            )}
            <p className="hint">
              Activez les notifications mobiles depuis l’application sur votre
              téléphone.
            </p>
            <h2>Notifications personnelles</h2>
            {(data["/notifications"] || []).map((n: Row) => (
              <article className="invite-row" key={n.id}>
                <span>
                  {(
                    {
                      ["course.assigned"]: "Une mission vous est attribuée",
                      ["offer.reserved"]: "Une offre attend votre confirmation",
                      ["offer.accepted"]:
                        "Un transfert de mission est confirmé",
                      ["group.invited"]:
                        "Une entreprise vous invite dans un groupe",
                      ["course.cancelled"]: "Une mission a été annulée",
                    } as Row
                  )[n.kind] || n.kind}
                </span>
                <small>{when(n.created_at)}</small>
                {!n.read_at && (
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      run(() => post(`/notifications/${n.id}/read`))
                    }
                  >
                    Marquer comme lue
                  </button>
                )}
              </article>
            ))}
            {!data["/notifications"]?.length && (
              <p className="empty">Aucune notification pour le moment.</p>
            )}
          </div>
          {manage && (
            <div className="panel padded">
              <h2>Alertes opérationnelles</h2>
              {(data["/alerts"] || []).map((a: Row) => (
                <article className="invite-row" key={a.id}>
                  <strong>
                    {a.kind === "resource_unavailable"
                      ? "Ressource indisponible"
                      : `Retard signalé : +${a.minutes} min`}
                  </strong>
                  <small>
                    {p.courses.find((c) => c.id === a.course_id)?.reference ||
                      "Mission d’une autre date"}
                  </small>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => post(`/alerts/${a.id}/resolve`),
                        "Alerte marquée comme traitée.",
                      )
                    }
                  >
                    Marquer comme traitée
                  </button>
                </article>
              ))}
              <p className="hint">
                Un signalement ne déplace aucune mission. Vérifiez le planning
                et réattribuez si nécessaire.
              </p>
            </div>
          )}
        </>
      )}
      {p.tab === "Administration" && (
        <>
          <div className="panel padded">
            <h2>Indisponibilités</h2>
            <form
              onSubmit={submit(
                (d) =>
                  post("/absences", {
                    ...(d.resource.startsWith("driver:")
                      ? { driver_id: d.resource.slice(7) }
                      : { vehicle_id: d.resource.slice(8) }),
                    start_at: parisDateTime(d.start_day, d.start),
                    end_at: parisDateTime(d.end_day, d.end),
                    reason: d.reason,
                    acknowledge_conflicts: d.acknowledge === "on",
                  }),
                "Indisponibilité enregistrée. Consultez les alertes pour les missions concernées.",
              )}
            >
              <div className="form-grid">
                {field(
                  "Ressource",
                  <select name="resource" required>
                    {p.drivers.map((d) => (
                      <option key={d.id} value={"driver:" + d.id}>
                        {d.name}
                      </option>
                    ))}
                    {p.vehicles.map((v) => (
                      <option key={v.id} value={"vehicle:" + v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>,
                )}
                {field(
                  "Premier jour",
                  <input
                    name="start_day"
                    type="date"
                    defaultValue={p.date}
                    required
                  />,
                )}
                {field(
                  "Début",
                  <input
                    name="start"
                    type="time"
                    defaultValue="06:00"
                    required
                  />,
                )}
                {field(
                  "Dernier jour",
                  <input
                    name="end_day"
                    type="date"
                    defaultValue={p.date}
                    required
                  />,
                )}
                {field(
                  "Fin",
                  <input
                    name="end"
                    type="time"
                    defaultValue="19:00"
                    required
                  />,
                )}
                {field(
                  "Motif",
                  <select name="reason">
                    <option value="leave">Congé</option>
                    <option value="illness">Maladie</option>
                    <option value="maintenance">Entretien / panne</option>
                    <option value="other">Autre</option>
                  </select>,
                )}
              </div>
              <label className="check">
                <input type="checkbox" name="acknowledge" />
                Créer les alertes si des missions sont déjà attribuées. Leur
                réattribution reste nécessaire.
              </label>
              <button disabled={busy}>Enregistrer l’indisponibilité</button>
            </form>
            {(data["/absences"] || []).map((a: Row) => (
              <article className="invite-row" key={a.id}>
                <span>
                  {p.drivers.find((d) => d.id === a.driver_id)?.name ||
                    p.vehicles.find((v) => v.id === a.vehicle_id)?.label ||
                    "Ressource"}{" "}
                  · {when(a.start_at)} → {when(a.end_at)}
                </span>
                <button
                  className="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => post(`/absences/${a.id}/cancel`),
                      "Indisponibilité annulée.",
                    )
                  }
                >
                  Annuler l’indisponibilité
                </button>
              </article>
            ))}
            <h2>Membres et droits</h2>
            {(data["/members"] || []).map((m: Row) => (
              <form
                className="member-admin"
                key={m.user_id}
                onSubmit={submit((d) =>
                  post(`/members/${m.user_id}/update`, {
                    role: d.role,
                    active: d.active === "on",
                  }),
                )}
              >
                <strong>{m.email}</strong>
                <select
                  name="role"
                  defaultValue={m.role}
                  aria-label={"Rôle de " + m.email}
                >
                  <option value="admin">Administrateur</option>
                  <option value="dispatcher">Régulateur</option>
                  <option value="driver">Chauffeur</option>
                  <option value="viewer">Lecture limitée</option>
                </select>
                <label className="check">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={m.active}
                  />
                  Accès actif
                </label>
                <button className="outline" disabled={busy}>
                  Appliquer
                </button>
              </form>
            ))}
            <p className="hint">
              Votre propre rôle ne peut pas être changé depuis cette liste. Un
              administrateur actif doit être conservé.
            </p>
          </div>
          <div className="panel padded">
            <h2>Services des chauffeurs</h2>
            <form
              onSubmit={submit((d) => {
                const driver = p.drivers.find((r) => r.id === d.driver)!;
                return post("/shifts", {
                  driver_id: d.driver,
                  shift: {
                    name: driver.name,
                    start_location: d.origin,
                    end_location: d.destination,
                    shift_start: parisDateTime(d.day, d.start),
                    shift_end: parisDateTime(d.day, d.end),
                    breaks:
                      d.break_start && d.break_end
                        ? [
                            {
                              start: parisDateTime(d.day, d.break_start),
                              end: parisDateTime(d.day, d.break_end),
                            },
                          ]
                        : [],
                  },
                });
              })}
            >
              <div className="form-grid">
                {field(
                  "Chauffeur du service",
                  <select name="driver" required>
                    {p.drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>,
                )}
                {field(
                  "Date du service",
                  <input
                    name="day"
                    type="date"
                    defaultValue={p.date}
                    required
                  />,
                )}
                {field(
                  "Début de service",
                  <input
                    name="start"
                    type="time"
                    defaultValue="06:00"
                    required
                  />,
                )}
                {field(
                  "Fin de service",
                  <input
                    name="end"
                    type="time"
                    defaultValue="19:00"
                    required
                  />,
                )}
                {field("Dépôt de départ", location("origin"))}
                {field("Dépôt de fin", location("destination"))}
                {field(
                  "Début de pause (facultatif)",
                  <input name="break_start" type="time" />,
                )}
                {field(
                  "Fin de pause (facultatif)",
                  <input name="break_end" type="time" />,
                )}
              </div>
              <button disabled={busy}>Ajouter un service</button>
            </form>
            {(data["/shifts"] || []).map((s: Row) => (
              <p key={s.id}>
                {p.drivers.find((d) => d.id === s.driver_id)?.name} ·{" "}
                {when(s.shift_start)} – {when(s.shift_end)} · {s.breaks.length}{" "}
                pause(s)
              </p>
            ))}
          </div>
        </>
      )}
      {p.tab === "Compte" && (
        <div className="panel padded">
          <h2>Sécurité et entreprise</h2>
          <p>
            Entreprise : <strong>{data["/company"]?.name}</strong>
          </p>
          <p>
            Code réseau : <strong>{data["/company"]?.network_code}</strong>
          </p>
          <p className="hint">
            Fuseau : Europe/Paris. Les documents de santé restent désactivés.
            Pour utiliser de vraies données, l’identité, l’hébergement et les
            obligations documentaires doivent être validés.
          </p>
          <h3>Adresse email</h3>
          <p>
            {data["/auth/me"]?.email_verified
              ? "Adresse vérifiée."
              : "Adresse non vérifiée."}
          </p>
          {data["/auth/me"]?.email_available &&
            !data["/auth/me"]?.email_verified && (
              <button
                disabled={busy}
                onClick={() =>
                  run(
                    () => post("/auth/email/request", {}),
                    "Si nécessaire, un lien de confirmation sera envoyé à votre adresse.",
                  )
                }
              >
                Envoyer le lien de confirmation
              </button>
            )}
          {!data["/auth/me"]?.email_available && (
            <p className="hint">
              L’envoi d’email n’est pas configuré sur cette installation.
            </p>
          )}
          <h3>Double authentification</h3>
          <p>
            {data["/auth/me"]?.mfa_enabled
              ? "Activée : un code est demandé à chaque connexion."
              : "Non activée."}
          </p>
          {data["/auth/me"]?.mfa_available &&
            !data["/auth/me"]?.mfa_enabled &&
            !mfaSetup && (
              <form
                onSubmit={submit(async (d) => {
                  const r = await post("/auth/mfa/enroll", {
                    password: d.password,
                  });
                  setMfaSetup(r);
                  setRecovery([]);
                }, "Ajoutez la clé à votre application d’authentification, puis confirmez avec un code.")}
              >
                {field(
                  "Mot de passe pour activer la double authentification",
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />,
                )}
                <button disabled={busy}>Préparer l’activation</button>
              </form>
            )}
          {!data["/auth/me"]?.mfa_available && (
            <p className="hint">
              La double authentification doit être configurée sur cette
              installation avant de pouvoir être activée.
            </p>
          )}
          {mfaSetup && (
            <div className="success">
              <p>
                Dans votre application d’authentification, ajoutez un compte
                TAXI LINK avec cette clé. Elle expire après 10 minutes si
                l’activation n’est pas confirmée.
              </p>
              <code>{mfaSetup.secret}</code>
              <form
                onSubmit={submit(async (d) => {
                  const r = await post("/auth/mfa/confirm", { code: d.code });
                  setMfaSetup(null);
                  setRecovery(r.recovery_codes);
                }, "Double authentification activée. Vos autres sessions ont été fermées.")}
              >
                {field(
                  "Code de confirmation à six chiffres",
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                  />,
                )}
                <button disabled={busy}>
                  Activer et afficher les codes de récupération
                </button>
              </form>
            </div>
          )}
          {recovery.length > 0 && (
            <div className="success">
              <strong>Codes de récupération · affichés une seule fois</strong>
              <p>
                Conservez-les en lieu sûr, séparément de votre téléphone. Chaque
                code ne fonctionne qu’une fois.
              </p>
              {recovery.map((code) => (
                <p key={code}>
                  <code>{code}</code>
                </p>
              ))}
            </div>
          )}
          {data["/auth/me"]?.mfa_enabled && (
            <details>
              <summary>Désactiver la double authentification</summary>
              <form
                onSubmit={submit(async (d) => {
                  await post("/auth/mfa/disable", {
                    password: d.password,
                    ...(d.code ? { code: d.code } : {}),
                    ...(d.recovery ? { recovery_code: d.recovery } : {}),
                  });
                  p.onSessionClosed();
                })}
              >
                {field(
                  "Mot de passe pour désactiver",
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />,
                )}
                {field(
                  "Code de l’authentificateur",
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                  />,
                )}
                {field(
                  "Ou code de récupération pour désactiver",
                  <input name="recovery" maxLength={17} />,
                )}
                <button disabled={busy}>
                  Désactiver et fermer les sessions
                </button>
              </form>
            </details>
          )}
          <h3>Changer mon mot de passe</h3>
          <form
            onSubmit={submit(async (d) => {
              await post("/auth/change-password", {
                old_password: d.old,
                new_password: d.next,
              });
              p.onSessionClosed();
            }, "Mot de passe modifié. Toutes vos sessions ont été révoquées.")}
          >
            <div className="form-grid">
              {field(
                "Mot de passe actuel",
                <input
                  name="old"
                  type="password"
                  autoComplete="current-password"
                  required
                />,
              )}
              {field(
                "Nouveau mot de passe",
                <input
                  name="next"
                  type="password"
                  autoComplete="new-password"
                  minLength={16}
                  maxLength={128}
                  required
                />,
              )}
            </div>
            <button disabled={busy}>Changer et fermer les sessions</button>
          </form>
        </div>
      )}
    </section>
  );
}
