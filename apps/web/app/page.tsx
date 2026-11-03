"use client";
import {
  useEffect,
  useState,
  cloneElement,
  type FormEvent,
  type ReactElement,
} from "react";
type Row = Record<string, any>;
const status: Record<string, string> = {
  unassigned: "À attribuer",
  assigned: "Attribuée",
  approaching: "En approche",
  onboard: "À bord",
  completed: "Terminée",
  cancelled: "Annulée",
};
const errors: Record<string, string> = {
  INVALID_CREDENTIALS: "Identifiants incorrects.",
  ACCESS_DENIED: "Votre rôle ne permet pas cette action.",
  SESSION_REQUIRED: "Connectez-vous pour continuer.",
  RESOURCE_CONFLICT:
    "Ce chauffeur ou ce véhicule a déjà une mission sur ce créneau.",
  TRANSFER_CONFLICT:
    "Le trajet entre les missions ne tient pas dans le temps disponible.",
  SHIFT_CONFLICT: "Cette course dépasse les horaires de service.",
  BREAK_CONFLICT: "Cette mission ou son trajet empiète sur une pause.",
  VEHICLE_INCOMPATIBLE: "Capacité ou équipement du véhicule insuffisant.",
  TIME_WINDOW_CONFLICT:
    "Le rendez-vous et sa marge ne peuvent pas être respectés.",
  ROUTE_UNAVAILABLE: "Aucun trajet validé : affectation bloquée.",
  PLAN_STALE: "La course a changé. Actualisez avant de réessayer.",
  VALIDATION_ERROR: "Vérifiez les champs et les horaires saisis.",
  DOCUMENTS_DISABLED: "Le module documentaire est désactivé.",
  NETWORK: "Connexion au serveur impossible.",
  CSRF_DENIED: "Session expirée. Reconnectez-vous.",
  INVITATION_INVALID:
    "Invitation expirée, révoquée ou destinée à un autre compte.",
};
const time = (s: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(new Date(s));
const initialDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(
    new Date(),
  );
function parisIso(day: string, hour: string) {
  const local = new Date(`${day}T${hour}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).formatToParts(local);
  const offset =
    parts
      .find((p) => p.type === "timeZoneName")
      ?.value.match(/GMT([+-]\d+)/)?.[1] || "+0";
  return `${day}T${hour}:00${Number(offset) >= 0 ? "+" : "-"}${String(Math.abs(Number(offset))).padStart(2, "0")}:00`;
}
export default function Page() {
  const [me, setMe] = useState<Row | null>(null),
    [tenant, setTenant] = useState(""),
    [csrf, setCsrf] = useState(""),
    [tab, setTab] = useState("Planning"),
    [date, setDate] = useState("2026-11-04");
  const [courses, setCourses] = useState<Row[]>([]),
    [drivers, setDrivers] = useState<Row[]>([]),
    [vehicles, setVehicles] = useState<Row[]>([]),
    [locations, setLocations] = useState<Row[]>([]),
    [groups, setGroups] = useState<Row[]>([]),
    [invites, setInvites] = useState<Row[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [modal, setModal] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [inviteToken, setInviteToken] = useState(""),
    [offline, setOffline] = useState(false),
    [updated, setUpdated] = useState("");
  const membership = me?.memberships?.find((m: Row) => m.tenant_id === tenant);
  const manage = ["admin", "dispatcher"].includes(membership?.role),
    admin = membership?.role === "admin";
  async function api(
    path: string,
    body?: Row,
    active = tenant,
    csrfValue = csrf,
  ) {
    let response: Response;
    try {
      response = await fetch("/api/v1" + path, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(active ? { "X-Tenant-Id": active } : {}),
          ...(body
            ? {
                "X-CSRF-Token": csrfValue,
                "Idempotency-Key": crypto.randomUUID(),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("NETWORK");
    }
    const value = await response.json();
    if (!response.ok) throw new Error(value.code || "NETWORK");
    return value;
  }
  async function loadIdentity() {
    const m = await api("/auth/me");
    setMe(m);
    setCsrf(m.csrf);
    setTenant((t) =>
      m.memberships.some((x: Row) => x.tenant_id === t)
        ? t
        : m.memberships[0]?.tenant_id || "",
    );
    return m;
  }
  useEffect(() => {
    loadIdentity()
      .catch(() => {})
      .finally(() => setLoading(false));
    const off = () => setOffline(true),
      on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  async function refresh() {
    if (!tenant) return;
    const [c, d, v, l, g, i] = await Promise.all([
      api("/courses?date=" + date),
      api("/drivers"),
      manage ? api("/vehicles") : Promise.resolve([]),
      api("/locations"),
      api("/groups"),
      admin ? api("/invitations") : Promise.resolve([]),
    ]);
    return { c, d, v, l, g, i };
  }
  function acceptRefresh(x: any) {
    if (!x) return;
    setCourses(x.c);
    setDrivers(x.d);
    setVehicles(x.v);
    setLocations(x.l);
    setGroups(x.g);
    setInvites(x.i);
    setUpdated(new Date().toLocaleTimeString("fr-FR"));
  }
  useEffect(() => {
    if (!tenant) return;
    let current = true;
    setCourses([]);
    setDrivers([]);
    setVehicles([]);
    setGroups([]);
    setInvites([]);
    setModal("");
    setLoading(true);
    refresh()
      .then((x) => {
        if (current) {
          acceptRefresh(x);
          setError("");
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    const timer = setInterval(
      () =>
        refresh()
          .then((x) => {
            if (current) acceptRefresh(x);
          })
          .catch((e) => {
            if (current) setError(e.message);
          }),
      15000,
    );
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [tenant, date, membership?.role]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await act(async () => {
      await api("/auth/logout", {});
      setMe(null);
      setTenant("");
      setCsrf("");
      setCourses([]);
      setDrivers([]);
      setVehicles([]);
      setGroups([]);
      setInvites([]);
      setInviteToken("");
      setError("");
      setNotice("");
    });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    await act(async () => {
      if (!me) {
        if (modal === "register")
          await api("/auth/register", {
            email: d.email,
            password: d.password,
            company: d.company,
          });
        else await api("/auth/login", { email: d.email, password: d.password });
        await loadIdentity();
        setModal("");
        return;
      }
      if (modal === "course")
        await api("/courses", {
          reference: d.reference,
          origin: d.origin,
          destination: d.destination,
          pickup_at: parisIso(date, String(d.pickup)),
          appointment_at: parisIso(date, String(d.appointment)),
          arrival_buffer: Number(d.buffer),
          passengers: Number(d.passengers),
          accessible: d.accessible === "on",
        });
      if (modal === "driver")
        await api("/drivers", {
          name: d.name,
          start_location: d.location,
          end_location: d.location,
          shift_start: parisIso(date, String(d.start)),
          shift_end: parisIso(date, String(d.end)),
          breaks: [],
        });
      if (modal === "vehicle")
        await api("/vehicles", {
          label: d.label,
          seats: Number(d.seats),
          accessible: d.accessible === "on",
        });
      if (modal === "group") await api("/groups", { name: d.name });
      if (modal === "invite") {
        const r = await api("/invitations", { email: d.email, role: d.role });
        setInviteToken(r.token);
      }
      if (modal === "accept") {
        await api("/invitations/accept", { token: d.token });
        await loadIdentity();
      }
      if (modal === "assign" && selected)
        await api(`/courses/${selected.id}/assign`, {
          driver_id: d.driver,
          vehicle_id: d.vehicle,
          version: selected.version,
        });
      setModal("");
      setNotice("Enregistré et confirmé par le serveur.");
      acceptRefresh(await refresh());
    });
  }
  const loc = (id: string) => locations.find((l) => l.id === id)?.label || id;
  const field = (label: string, child: ReactElement<{ id?: string }>) => {
    const id =
      "field-" +
      label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {cloneElement(child, { id })}
      </div>
    );
  };
  const locationSelect = (name: string) => (
    <select name={name} required>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
  const visible = courses.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      `${c.reference} ${loc(c.origin)} ${loc(c.destination)} ${c.driver_name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  if (!me)
    return (
      <main className="login">
        <section className="login-art">
          <div className="brand">
            TAXI<span>LINK</span>
            <i>↗</i>
          </div>
          <p className="eyebrow">LE LIEN ENTRE VOS MISSIONS</p>
          <h1>
            Votre journée.
            <br />
            En mouvement.
          </h1>
          <p>
            Une régulation claire.
            <br />
            Une équipe qui avance ensemble.
          </p>
          <div className="art-route">
            <b>01</b>
            <span>Planifier</span>
            <b>02</b>
            <span>Coordonner</span>
            <b>03</b>
            <span>Accompagner</span>
          </div>
          <small>Version de démonstration · Données fictives uniquement</small>
        </section>
        <section className="login-form">
          <p className="eyebrow">VOTRE ESPACE DE TRAVAIL</p>
          <h2>{modal === "register" ? "Créer mon entreprise" : "Connexion"}</h2>
          <p>Retrouvez votre équipe et vos missions.</p>
          {loading ? (
            <p>Connexion en cours…</p>
          ) : (
            <form onSubmit={submit}>
              {modal === "register" &&
                field(
                  "Entreprise",
                  <input name="company" required minLength={2} />,
                )}
              {field(
                "Adresse email",
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  defaultValue="admin@atlas.example"
                  required
                />,
              )}
              {field(
                "Mot de passe",
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    modal === "register" ? "new-password" : "current-password"
                  }
                  required
                  minLength={modal === "register" ? 16 : 1}
                />,
              )}
              {error && (
                <p role="alert" className="error">
                  {errors[error] || error}
                </p>
              )}
              <button disabled={busy} type="submit">
                {busy
                  ? "Connexion…"
                  : modal === "register"
                    ? "Créer mon espace"
                    : "Ouvrir mon espace →"}
              </button>
              <button
                className="quiet"
                type="button"
                onClick={() => {
                  setModal(modal === "register" ? "" : "register");
                  setError("");
                }}
              >
                {modal === "register"
                  ? "J’ai déjà un compte"
                  : "Créer une entreprise de démonstration"}
              </button>
            </form>
          )}
          <aside className="demo-note">
            Comptes de démo : <strong>admin@atlas.example</strong> ou{" "}
            <strong>driver@atlas.example</strong>. Mot de passe défini au
            démarrage dans DEMO_PASSWORD.
            <br />
            Planning initial : 4 novembre 2026.
          </aside>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          TAXI<span>LINK</span>
          <i>↗</i>
        </div>
        <p className="workspace-label">ESPACE ENTREPRISE</p>
        <select
          aria-label="Entreprise active"
          disabled={busy || loading}
          value={tenant}
          onChange={(e) => {
            setError("");
            setNotice("");
            setInviteToken("");
            setTenant(e.target.value);
          }}
        >
          {me.memberships.map((m: Row) => (
            <option key={m.tenant_id} value={m.tenant_id}>
              {m.name}
            </option>
          ))}
        </select>
        <nav>
          {["Planning", "Courses", "Équipe & flotte", "Réseaux", "Accès"]
            .filter((t) => manage || !["Équipe & flotte", "Accès"].includes(t))
            .map((t, i) => (
              <button
                key={t}
                className={tab === t ? "nav active" : "nav"}
                onClick={() => {
                  setTab(t);
                  setSearch("");
                  setFilter("all");
                }}
              >
                <span>{["◫", "↗", "◉", "⌘", "◇"][i]}</span>
                {t}
                {t === "Planning" && (
                  <em>
                    {courses.filter((c) => c.status === "unassigned").length}
                  </em>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{me.email[0].toUpperCase()}</div>
          <div>
            <strong>{me.email.split("@")[0]}</strong>
            <small>
              {membership?.role === "admin"
                ? "Administrateur"
                : membership?.role === "dispatcher"
                  ? "Régulateur"
                  : membership?.role === "driver"
                    ? "Chauffeur"
                    : "Lecture limitée"}
            </small>
          </div>
          <button
            title="Déconnexion"
            aria-label="Déconnexion"
            className="exit"
            onClick={logout}
          >
            ↪
          </button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <span>
            <span className={offline ? "dot offline" : "dot"} />
            {offline ? "Hors connexion" : "Espace connecté"}{" "}
            <small>· Europe/Paris</small>
          </span>
          <span className="demo-badge">DÉMONSTRATION</span>
          <button
            className="mobile-exit quiet"
            title="Déconnexion"
            aria-label="Déconnexion"
            onClick={logout}
          >
            ↪ Quitter
          </button>
        </header>
        <main className="main">
          <div className="heading">
            <div>
              <p className="eyebrow">
                {new Intl.DateTimeFormat("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "Europe/Paris",
                }).format(new Date(date + "T12:00:00Z"))}
              </p>
              <h1>
                {tab === "Planning" ? "Une journée bien coordonnée." : tab}
              </h1>
              <p>
                {tab === "Planning"
                  ? "Gardez une longueur d’avance sur vos missions."
                  : "Votre espace de coordination, au même endroit."}
              </p>
            </div>
            {manage && (
              <button
                disabled={busy || offline}
                onClick={() =>
                  setModal(
                    tab === "Équipe & flotte"
                      ? "driver"
                      : tab === "Réseaux"
                        ? "group"
                        : tab === "Accès"
                          ? "invite"
                          : "course",
                  )
                }
              >
                ＋{" "}
                {tab === "Équipe & flotte"
                  ? "Ajouter un chauffeur"
                  : tab === "Réseaux"
                    ? "Créer un groupe"
                    : tab === "Accès"
                      ? "Inviter un membre"
                      : "Nouvelle course"}
              </button>
            )}
          </div>
          {offline && (
            <div role="alert" className="error">
              Connexion perdue. Données affichées à {updated}. Les actions sont
              indisponibles.
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {errors[error] || error}
              <button className="quiet" onClick={() => setError("")}>
                Fermer
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="success">
              {notice}
            </div>
          )}
          {inviteToken && (
            <div className="success">
              <strong>Invitation créée · valable 48 h</strong>
              <p>
                Transmettez ce code au destinataire. Il doit créer un compte,
                puis utiliser « Accepter une invitation ».
              </p>
              <code>{inviteToken}</code>
              <button
                className="quiet"
                onClick={() =>
                  navigator.clipboard
                    .writeText(inviteToken)
                    .then(() => setNotice("Code copié."))
                    .catch(() =>
                      setNotice("Sélectionnez le code pour le copier."),
                    )
                }
              >
                Copier
              </button>
            </div>
          )}
          {(tab === "Planning" || tab === "Courses") && (
            <>
              <div className="stats">
                <article>
                  <span>Missions du jour</span>
                  <strong>{courses.length.toString().padStart(2, "0")}</strong>
                  <small>Une vue claire sur votre activité</small>
                </article>
                <article>
                  <span>Attribuées</span>
                  <strong>
                    {courses
                      .filter((c) =>
                        ["assigned", "approaching", "onboard"].includes(
                          c.status,
                        ),
                      )
                      .length.toString()
                      .padStart(2, "0")}
                    <i>↗</i>
                  </strong>
                  <small>Votre équipe est en mouvement</small>
                </article>
                <article className="attention">
                  <span>À organiser</span>
                  <strong>
                    {courses
                      .filter((c) => c.status === "unassigned")
                      .length.toString()
                      .padStart(2, "0")}
                    <i>◷</i>
                  </strong>
                  <small>En attente d’un chauffeur</small>
                </article>
                <article>
                  <span>Terminées</span>
                  <strong>
                    {courses
                      .filter((c) => c.status === "completed")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                  <small>Des missions accomplies</small>
                </article>
              </div>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>
                      {tab === "Planning"
                        ? "Le fil de votre journée"
                        : "Toutes les courses"}
                    </h2>
                    <p>Horaires et rendez-vous affichés en heure de Paris</p>
                  </div>
                  <input
                    aria-label="Date du planning"
                    type="date"
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                  />
                </div>
                <div className="toolbar">
                  <div className="filters">
                    {[
                      ["all", "Toutes"],
                      ["unassigned", "À attribuer"],
                      ["assigned", "Attribuées"],
                      ["completed", "Terminées"],
                    ].map(([s, l]) => (
                      <button
                        key={s}
                        className={filter === s ? "selected" : "quiet"}
                        onClick={() => setFilter(s)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="Rechercher une course"
                    placeholder="Rechercher une mission…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {loading ? (
                  <p className="empty" role="status">
                    Chargement du planning…
                  </p>
                ) : !visible.length ? (
                  <div className="empty">
                    <span>↗</span>
                    <h3>Aucune mission à afficher</h3>
                    <p>Changez la date ou ajoutez une course pour commencer.</p>
                    <button
                      className="quiet"
                      onClick={() => setDate(initialDate())}
                    >
                      Voir aujourd’hui
                    </button>
                  </div>
                ) : (
                  <div className="course-list">
                    {visible.map((c) => (
                      <article className="course" key={c.id}>
                        <div className="course-time">
                          <strong>{time(c.pickup_at)}</strong>
                          <small>Départ</small>
                        </div>
                        <div className="course-route">
                          <span className="reference">{c.reference}</span>
                          <h3>
                            {loc(c.origin)} <span>→</span> {loc(c.destination)}
                          </h3>
                          <p>
                            RDV {time(c.appointment_at)} · Arrivée avant{" "}
                            {time(c.dropoff_deadline)} · {c.passengers} passager
                            {c.passengers > 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="course-driver">
                          <span className={"status " + c.status}>
                            {status[c.status]}
                          </span>
                          <small>
                            {c.driver_name || "Chauffeur à définir"}
                          </small>
                        </div>
                        <div className="course-actions">
                          {manage && c.status === "unassigned" && (
                            <button
                              className="outline"
                              disabled={busy || offline}
                              onClick={() => {
                                setSelected(c);
                                setModal("assign");
                              }}
                            >
                              Attribuer →
                            </button>
                          )}
                          {["assigned", "approaching", "onboard"].includes(
                            c.status,
                          ) && (
                            <button
                              className="outline"
                              disabled={busy || offline}
                              onClick={() =>
                                act(async () => {
                                  const next = (
                                    {
                                      assigned: "approaching",
                                      approaching: "onboard",
                                      onboard: "completed",
                                    } as Row
                                  )[c.status];
                                  await api(`/courses/${c.id}/status`, {
                                    status: next,
                                    version: c.version,
                                  });
                                  acceptRefresh(await refresh());
                                  setNotice("Statut confirmé par le serveur.");
                                })
                              }
                            >
                              {
                                (
                                  {
                                    assigned: "En approche",
                                    approaching: "À bord",
                                    onboard: "Terminer",
                                  } as Row
                                )[c.status]
                              }
                            </button>
                          )}
                          {manage &&
                            ["unassigned", "assigned", "approaching"].includes(
                              c.status,
                            ) && (
                              <button
                                className="quiet"
                                disabled={busy || offline}
                                onClick={() => {
                                  setSelected(c);
                                  setModal("cancel");
                                }}
                              >
                                Annuler
                              </button>
                            )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div className="panel-foot">
                  <span>Actualisation toutes les 15 secondes</span>
                  <button
                    className="quiet"
                    disabled={busy || offline}
                    onClick={() =>
                      act(async () => acceptRefresh(await refresh()))
                    }
                  >
                    ↻ Actualiser
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === "Équipe & flotte" && (
            <>
              <div className="panel">
                <div className="panel-head">
                  <h2>Chauffeurs</h2>
                  <span>{drivers.length} membres opérationnels</span>
                </div>
                <div className="cards">
                  {drivers.map((d) => (
                    <article key={d.id}>
                      <div className="avatar">{d.name[0]}</div>
                      <h3>{d.name}</h3>
                      <p>
                        {time(d.shift_start)} – {time(d.shift_end)}
                      </p>
                      <small>
                        {loc(d.start_location)} · {d.breaks.length} pause(s)
                      </small>
                    </article>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="panel-head">
                  <h2>Flotte</h2>
                  <button
                    className="outline"
                    onClick={() => setModal("vehicle")}
                  >
                    ＋ Ajouter un véhicule
                  </button>
                </div>
                <div className="cards">
                  {vehicles.map((v) => (
                    <article key={v.id}>
                      <span className="vehicle-icon">↗</span>
                      <h3>{v.label}</h3>
                      <p>
                        {v.seats} places ·{" "}
                        {v.accessible ? "Adapté PMR" : "Standard"}
                      </p>
                      <span className="status assigned">
                        {v.active ? "Disponible" : "Immobilisé"}
                      </span>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
          {tab === "Réseaux" && (
            <div className="panel">
              <div className="panel-head">
                <h2>Vos groupes privés</h2>
                <span className="status assigned">Accès contrôlé</span>
              </div>
              <div className="cards">
                {groups.map((g) => (
                  <article key={g.id}>
                    <span className="vehicle-icon">⌘</span>
                    <h3>{g.name}</h3>
                    <p>
                      {g.owner_tenant_id === tenant
                        ? "Groupe administré par votre entreprise"
                        : "Entreprise membre"}
                    </p>
                  </article>
                ))}
              </div>
              <p className="empty">
                La bourse de courses et la messagerie seront ajoutées au lot
                suivant.
              </p>
            </div>
          )}
          {tab === "Accès" && (
            <div className="panel">
              <div className="panel-head">
                <h2>Invitations</h2>
                <button className="outline" onClick={() => setModal("accept")}>
                  Accepter une invitation
                </button>
              </div>
              {invites.map((i) => (
                <div key={i.id} className="invite-row">
                  <strong>{i.email}</strong>
                  <span>{i.role}</span>
                  <span>
                    {i.revoked
                      ? "Révoquée"
                      : i.accepted
                        ? "Acceptée"
                        : new Date(i.expires_at) < new Date()
                          ? "Expirée"
                          : "En attente"}
                  </span>
                  {!i.revoked && !i.accepted && (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await api(`/invitations/${i.id}/revoke`, {});
                          acceptRefresh(await refresh());
                        })
                      }
                    >
                      Révoquer
                    </button>
                  )}
                </div>
              ))}
              {!invites.length && (
                <p className="empty">
                  Invitez votre premier collaborateur depuis le bouton en haut
                  de page.
                </p>
              )}
            </div>
          )}
          <footer>
            {" "}
            T A X I L I N K <span>·</span> Données fictives uniquement{" "}
            <span>·</span> Documents médicaux désactivés
          </footer>
        </main>
      </div>
      {modal && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="close quiet"
              aria-label="Fermer"
              onClick={() => setModal("")}
            >
              ×
            </button>
            <p className="eyebrow">VOTRE ESPACE DE COORDINATION</p>
            <h2 id="modal-title">
              {
                (
                  {
                    course: "Nouvelle course",
                    driver: "Ajouter un chauffeur",
                    vehicle: "Ajouter un véhicule",
                    assign: "Attribuer une mission",
                    group: "Créer un groupe",
                    invite: "Inviter un collaborateur",
                    accept: "Accepter une invitation",
                    cancel: "Annuler la mission ?",
                  } as Row
                )[modal]
              }
            </h2>
            {error && (
              <p role="alert" className="error">
                {errors[error] || error}
              </p>
            )}
            {modal === "cancel" ? (
              <>
                <p>{selected?.reference} sera marquée comme annulée.</p>
                <button
                  disabled={busy || offline}
                  onClick={() =>
                    act(async () => {
                      await api(`/courses/${selected?.id}/status`, {
                        status: "cancelled",
                        version: selected?.version,
                      });
                      setModal("");
                      acceptRefresh(await refresh());
                      setNotice("Annulation confirmée.");
                    })
                  }
                >
                  Confirmer l’annulation
                </button>
              </>
            ) : (
              <form onSubmit={submit}>
                {modal === "course" && (
                  <>
                    {field(
                      "Référence fictive",
                      <input
                        autoFocus
                        name="reference"
                        placeholder="DEMO-005"
                        required
                        maxLength={60}
                      />,
                    )}
                    {field("Départ", locationSelect("origin"))}
                    {field("Destination", locationSelect("destination"))}
                    <div className="form-grid">
                      {field(
                        "Prise en charge (Paris)",
                        <input
                          name="pickup"
                          type="time"
                          defaultValue="09:00"
                          required
                        />,
                      )}
                      {field(
                        "Rendez-vous (Paris)",
                        <input
                          name="appointment"
                          type="time"
                          defaultValue="10:00"
                          required
                        />,
                      )}
                      {field(
                        "Marge d’arrivée (min)",
                        <input
                          name="buffer"
                          type="number"
                          min={0}
                          max={120}
                          defaultValue={15}
                          required
                        />,
                      )}
                      {field(
                        "Passagers",
                        <input
                          name="passengers"
                          type="number"
                          min={1}
                          max={8}
                          defaultValue={1}
                          required
                        />,
                      )}
                    </div>
                    <label className="check">
                      <input name="accessible" type="checkbox" />
                      Véhicule adapté PMR requis
                    </label>
                    <p className="hint">
                      Date : {date}. Les adresses et temps de route sont fictifs
                      dans cette démonstration.
                    </p>
                  </>
                )}
                {modal === "driver" && (
                  <>
                    {field(
                      "Nom fictif",
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={80}
                      />,
                    )}
                    {field(
                      "Dépôt de début et de fin",
                      locationSelect("location"),
                    )}
                    <div className="form-grid">
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
                    </div>
                    <p className="hint">
                      Service du {date}. Les pauses peuvent être définies via
                      l’API.
                    </p>
                  </>
                )}
                {modal === "vehicle" && (
                  <>
                    {field(
                      "Libellé du véhicule",
                      <input name="label" required maxLength={60} />,
                    )}
                    {field(
                      "Places passagers",
                      <input
                        type="number"
                        name="seats"
                        min={1}
                        max={8}
                        defaultValue={4}
                        required
                      />,
                    )}
                    <label className="check">
                      <input type="checkbox" name="accessible" />
                      Équipement PMR réel
                    </label>
                  </>
                )}
                {modal === "assign" && (
                  <>
                    <p>
                      {selected?.reference} ·{" "}
                      {selected && time(selected.pickup_at)}
                    </p>
                    {field(
                      "Chauffeur",
                      <select name="driver" required>
                        <option value="">Choisir un chauffeur</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} · {time(d.shift_start)}–{time(d.shift_end)}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field(
                      "Véhicule",
                      <select name="vehicle" required>
                        <option value="">Choisir un véhicule</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label} · {v.seats} places
                            {v.accessible ? " · PMR" : ""}
                          </option>
                        ))}
                      </select>,
                    )}
                    <p className="hint">
                      La validation serveur contrôle les horaires, les pauses,
                      la capacité et les trajets de liaison.
                    </p>
                  </>
                )}
                {modal === "group" &&
                  field(
                    "Nom du groupe privé",
                    <input name="name" required minLength={2} maxLength={80} />,
                  )}
                {modal === "invite" && (
                  <>
                    {field(
                      "Email du collaborateur",
                      <input name="email" type="email" required />,
                    )}
                    {field(
                      "Rôle",
                      <select name="role">
                        <option value="driver">Chauffeur</option>
                        <option value="dispatcher">Régulateur</option>
                        <option value="viewer">Lecture limitée</option>
                      </select>,
                    )}
                    <p className="hint">
                      Un code valable 48 h sera créé. Aucun email ne sera envoyé
                      automatiquement.
                    </p>
                  </>
                )}
                {modal === "accept" &&
                  field(
                    "Code d’invitation",
                    <input
                      name="token"
                      required
                      minLength={64}
                      maxLength={64}
                    />,
                  )}
                <button type="submit" disabled={busy || offline}>
                  {busy ? "Validation en cours…" : "Confirmer →"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
