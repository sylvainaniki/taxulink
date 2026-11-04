"use client";
import {
  useEffect,
  useState,
  useRef,
  cloneElement,
  type FormEvent,
  type ReactElement,
} from "react";
import WorkspacePanels from "./WorkspacePanels";
import AccountRecovery from "./AccountRecovery";
import { field } from "./Fields";
import { requestId } from "../../../packages/contracts/id";
import { parisDateTime } from "../../../packages/contracts/dates";
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
  MFA_REQUIRED:
    "Saisissez le code de votre application d’authentification ou un code de récupération.",
  MFA_INVALID:
    "Code invalide ou déjà utilisé. Attendez le prochain code ou utilisez un code de récupération.",
  MFA_UNAVAILABLE:
    "La double authentification est indisponible sur cette installation.",
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
  REGISTRATION_DISABLED: "L’accès est réservé aux personnes invitées.",
  PILOT_USER_LIMIT:
    "La limite de 10 utilisateurs actifs du pilote est atteinte. Contactez l’administrateur.",
  ACCOUNT_EXISTS:
    "Ce compte existe déjà. Connectez-vous puis acceptez votre invitation dans Accès.",
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
const parisIso = parisDateTime;
export default function Page() {
  const [accountAction, setAccountAction] = useState<{
    kind: "request" | "reset" | "verify";
    token?: string;
    opened?: number;
  } | null>(null);
  const accountLinkEpoch = useRef(0);
  const [me, setMe] = useState<Row | null>(null),
    [tenant, setTenant] = useState(""),
    [csrf, setCsrf] = useState(""),
    [tab, setTab] = useState("Planning"),
    [date, setDate] = useState("2026-11-04");
  const [accessPolicy, setAccessPolicy] = useState<Row>({
    public_registration_enabled: false,
  });
  const demoMode = accessPolicy.demo_mode !== false;
  const [courses, setCourses] = useState<Row[]>([]),
    [customers, setCustomers] = useState<Row[]>([]),
    [drivers, setDrivers] = useState<Row[]>([]),
    [vehicles, setVehicles] = useState<Row[]>([]),
    [locations, setLocations] = useState<Row[]>([]),
    [groups, setGroups] = useState<Row[]>([]),
    [invites, setInvites] = useState<Row[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [mfaLogin, setMfaLogin] = useState(false),
    [modal, setModal] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [inviteToken, setInviteToken] = useState(""),
    [offline, setOffline] = useState(false),
    [updated, setUpdated] = useState("");
  const identityEpoch = useRef(0);
  const membership = me?.memberships?.find((m: Row) => m.tenant_id === tenant);
  const manage = ["admin", "dispatcher"].includes(membership?.role),
    admin = membership?.role === "admin";
  async function api(
    path: string,
    body?: Row,
    active = tenant,
    csrfValue = csrf,
  ) {
    const requestEpoch = identityEpoch.current;
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
                "Idempotency-Key": requestId(),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("NETWORK");
    }
    const value = await response.json();
    if (!response.ok) {
      if (["MFA_REQUIRED", "MFA_INVALID"].includes(value.code))
        setMfaLogin(true);
      if (
        response.status === 401 &&
        value.code === "SESSION_REQUIRED" &&
        me &&
        requestEpoch === identityEpoch.current
      ) {
        identityEpoch.current++;
        setMe(null);
        setTenant("");
        setCourses([]);
        setCustomers([]);
        setDrivers([]);
        setVehicles([]);
        setGroups([]);
        setInvites([]);
      }
      throw new Error(value.code || "NETWORK");
    }
    return value;
  }
  async function loadIdentity() {
    const generation = identityEpoch.current;
    const m = await api("/auth/me");
    if (generation !== identityEpoch.current) return m;
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
    const consumeAccountLink = () => {
      const match = window.location.hash.match(
        /^#(reset|verify)=([a-f0-9]{64})$/,
      );
      if (match) {
        setAccountAction({
          kind: match[1] as "reset" | "verify",
          token: match[2],
          opened: ++accountLinkEpoch.current,
        });
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      }
    };
    consumeAccountLink();
    window.addEventListener("hashchange", consumeAccountLink);
    void api("/auth/policy")
      .then((policy) => {
        setAccessPolicy(policy);
        if (policy.demo_mode === false)
          setDate(
            new Intl.DateTimeFormat("sv-SE", {
              timeZone: "Europe/Paris",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
          );
      })
      .catch(() => {});
    loadIdentity()
      .catch(() => {})
      .finally(() => setLoading(false));
    const off = () => setOffline(true),
      on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("hashchange", consumeAccountLink);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  async function refresh() {
    if (!tenant) return;
    const generation = identityEpoch.current;
    const identity = await api("/auth/me");
    if (generation !== identityEpoch.current) return;
    const current = identity.memberships.find(
      (m: Row) => m.tenant_id === tenant,
    );
    if (!current) {
      setCourses([]);
      setCustomers([]);
      setDrivers([]);
      setVehicles([]);
      setGroups([]);
      setInvites([]);
      setMe(identity);
      setTenant(identity.memberships[0]?.tenant_id || "");
      throw new Error("ACCESS_DENIED");
    }
    if (current.role !== membership?.role) {
      identityEpoch.current++;
      setCourses([]);
      setCustomers([]);
      setDrivers([]);
      setVehicles([]);
      setGroups([]);
      setInvites([]);
      setInviteToken("");
      setMe(identity);
      return;
    }
    setMe(identity);
    const allowed = ["admin", "dispatcher"].includes(current.role);
    const [c, d, v, l, g, i, contacts] = await Promise.all([
      api("/courses?date=" + date),
      api("/drivers"),
      allowed || current.role === "driver"
        ? api("/vehicles")
        : Promise.resolve([]),
      api("/locations"),
      api("/groups"),
      current.role === "admin" ? api("/invitations") : Promise.resolve([]),
      allowed ? api("/contacts") : Promise.resolve([]),
    ]);
    if (generation !== identityEpoch.current) return;
    return { c, d, v, l, g, i, contacts };
  }
  function acceptRefresh(x: any) {
    if (!x) return;
    setCourses(x.c);
    setCustomers((x.contacts || []).filter((c: Row) => c.kind === "customer"));
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
    setCustomers([]);
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
      identityEpoch.current++;
      setMfaLogin(false);
      setCustomers([]);
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
        identityEpoch.current++;
        if (modal === "register")
          await api("/auth/register", {
            email: d.email,
            password: d.password,
            company: d.company,
          });
        else if (modal === "join")
          await api("/auth/join", {
            email: d.email,
            password: d.password,
            token: d.token,
          });
        else
          await api("/auth/login", {
            email: d.email,
            password: d.password,
            ...(d.mfa ? { mfa_code: d.mfa } : {}),
            ...(d.recovery ? { recovery_code: d.recovery } : {}),
          });
        await loadIdentity();
        setModal("");
        return;
      }
      if (modal === "course" || modal === "edit") {
        const course = {
          reference: d.reference,
          ...(d.customer ? { customer_id: d.customer } : {}),
          origin: d.origin,
          destination: d.destination,
          pickup_at: parisIso(date, String(d.pickup)),
          appointment_at: parisIso(date, String(d.appointment)),
          arrival_buffer: Number(d.buffer),
          passengers: Number(d.passengers),
          accessible: d.accessible === "on",
        };
        if (modal === "edit" && selected)
          await api(`/courses/${selected.id}/update`, {
            course,
            version: selected.version,
          });
        else await api("/courses", course);
      }
      if (modal === "delay" && selected)
        await api(`/courses/${selected.id}/delay`, {
          minutes: Number(d.minutes),
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
  const locationSelect = (name: string, initial?: string) => (
    <select name={name} defaultValue={initial} required>
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
  if (accountAction)
    return (
      <AccountRecovery
        key={
          accountAction.kind +
          (accountAction.token || "") +
          accountAction.opened
        }
        {...accountAction}
        close={() => window.location.assign("/")}
      />
    );
  if (me?.email_verification_required && !me.email_verified)
    return (
      <main className="account-recovery panel padded">
        <h1>Vérifiez votre adresse email</h1>
        <p>
          Un email de confirmation est nécessaire pour accéder à votre espace.
        </p>
        {error && (
          <p role="alert" className="error">
            {errors[error] || error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              await api("/auth/email/request", {});
              setNotice(
                "Si nécessaire, un lien de confirmation sera envoyé à votre adresse.",
              );
            })
          }
        >
          Renvoyer le lien de confirmation
        </button>
        <button
          className="quiet"
          onClick={() =>
            act(async () => {
              await api("/auth/logout", {});
              window.location.assign("/");
            })
          }
        >
          Déconnexion
        </button>
      </main>
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
          <small>
            {demoMode
              ? "Version de démonstration · Données fictives uniquement"
              : "Pilote privé · Accès sur invitation"}
          </small>
        </section>
        <section className="login-form">
          <p className="eyebrow">VOTRE ESPACE DE TRAVAIL</p>
          <h2>
            {modal === "register"
              ? "Créer mon entreprise"
              : modal === "join"
                ? "Rejoindre sur invitation"
                : "Connexion"}
          </h2>
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
              {modal === "join" &&
                field(
                  "Code d’invitation",
                  <input
                    name="token"
                    required
                    minLength={64}
                    maxLength={64}
                    autoComplete="off"
                  />,
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
                    modal === "register" || modal === "join"
                      ? "new-password"
                      : "current-password"
                  }
                  required
                  minLength={modal === "register" || modal === "join" ? 16 : 1}
                />,
              )}
              {mfaLogin && modal !== "register" && modal !== "join" && (
                <>
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
                    <input name="recovery" maxLength={17} autoComplete="off" />,
                  )}
                </>
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
                    : modal === "join"
                      ? "Créer mon compte et rejoindre"
                      : "Ouvrir mon espace →"}
              </button>
              <button
                className="quiet"
                type="button"
                onClick={() => setAccountAction({ kind: "request" })}
              >
                Mot de passe oublié
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setModal(modal === "join" ? "" : "join");
                  setError("");
                }}
              >
                {modal === "join"
                  ? "Retour à la connexion"
                  : "J’ai une invitation"}
              </button>
              {accessPolicy.public_registration_enabled && (
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
              )}
            </form>
          )}
          {demoMode && (
            <aside className="demo-note">
              Comptes de démo : <strong>admin@atlas.example</strong> ou{" "}
              <strong>driver@atlas.example</strong>. Mot de passe défini au
              démarrage dans DEMO_PASSWORD.
              <br />
              Planning initial : 4 novembre 2026.
            </aside>
          )}
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
            identityEpoch.current++;
            setCourses([]);
            setCustomers([]);
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
          {[
            "Planning",
            "Courses",
            "Bourse",
            "Optimisation",
            "Messages",
            "Réseaux",
            "Équipe & flotte",
            "Contacts",
            "Récurrences & retours",
            "Statistiques",
            "Notifications",
            "Accès",
            "Administration",
            "Compte",
          ]
            .filter((t) =>
              t === "Administration"
                ? admin
                : t === "Accès"
                  ? admin
                  : [
                        "Équipe & flotte",
                        "Contacts",
                        "Récurrences & retours",
                        "Statistiques",
                        "Optimisation",
                      ].includes(t)
                    ? manage
                    : ["Bourse", "Messages", "Réseaux"].includes(t)
                      ? ["admin", "dispatcher", "driver"].includes(
                          membership?.role,
                        )
                      : true,
            )
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
                <span>{["◫", "↗", "⌘", "◇", "◉"][i % 5]}</span>
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
          <span className="demo-badge">
            {demoMode ? "DÉMONSTRATION" : "PILOTE PRIVÉ"}
          </span>
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
          {!["Planning", "Courses"].includes(tab) && (
            <label className="date-switch">
              Date active{" "}
              <input
                aria-label="Date active"
                type="date"
                value={date}
                disabled={busy}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </label>
          )}
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
            {manage &&
              [
                "Planning",
                "Courses",
                "Équipe & flotte",
                "Réseaux",
                "Accès",
              ].includes(tab) && (
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
                          {c.passenger_name && (
                            <p className="passenger">
                              {c.passenger_name}
                              {c.passenger_phone && (
                                <>
                                  {" "}
                                  ·{" "}
                                  <a
                                    href={
                                      "tel:" +
                                      c.passenger_phone.replace(/[^+0-9]/g, "")
                                    }
                                  >
                                    {c.passenger_phone}
                                  </a>
                                </>
                              )}
                            </p>
                          )}
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
                          {manage &&
                            c.status === "unassigned" &&
                            !c.source_course_id && (
                              <button
                                className="quiet"
                                disabled={busy || offline}
                                onClick={() => {
                                  setSelected(c);
                                  setModal("edit");
                                }}
                              >
                                Modifier
                              </button>
                            )}
                          {manage &&
                            c.status === "assigned" &&
                            c.driver_id &&
                            !c.source_course_id && (
                              <button
                                className="quiet"
                                disabled={busy || offline}
                                onClick={() =>
                                  act(async () => {
                                    await api(`/courses/${c.id}/unassign`, {
                                      version: c.version,
                                    });
                                    acceptRefresh(await refresh());
                                  })
                                }
                              >
                                Désattribuer
                              </button>
                            )}
                          {Boolean(c.driver_id) &&
                            ["assigned", "approaching", "onboard"].includes(
                              c.status,
                            ) && (
                              <button
                                className="quiet"
                                disabled={busy || offline}
                                onClick={() => {
                                  setSelected(c);
                                  setModal("delay");
                                }}
                              >
                                Signaler un retard
                              </button>
                            )}

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
                          {Boolean(c.driver_id) &&
                            ["assigned", "approaching", "onboard"].includes(
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
                                    setNotice(
                                      "Statut confirmé par le serveur.",
                                    );
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
          {[
            "Équipe & flotte",
            "Bourse",
            "Messages",
            "Réseaux",
            "Optimisation",
            "Contacts",
            "Récurrences & retours",
            "Statistiques",
            "Notifications",
            "Administration",
            "Compte",
          ].includes(tab) && (
            <WorkspacePanels
              demo={demoMode}
              tab={tab}
              tenant={tenant}
              date={date}
              role={membership?.role || "viewer"}
              courses={courses}
              drivers={drivers}
              vehicles={vehicles}
              locations={locations}
              groups={groups}
              api={api}
              reload={async () => acceptRefresh(await refresh())}
              onBusy={setBusy}
              onSessionClosed={() => {
                identityEpoch.current++;
                setCustomers([]);
                setMe(null);
                setTenant("");
                setCsrf("");
                setCourses([]);
                setDrivers([]);
                setVehicles([]);
                setGroups([]);
                setInvites([]);
              }}
            />
          )}
          <footer>
            {" "}
            T A X I L I N K <span>·</span>{" "}
            {demoMode
              ? "Données fictives uniquement"
              : "Espace professionnel privé"}{" "}
            <span>·</span> Documents gérés hors de TAXILINK
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
                    edit: "Modifier la course",
                    delay: "Signaler un retard",
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
                {(modal === "course" || modal === "edit") && (
                  <>
                    {field(
                      demoMode ? "Référence fictive" : "Référence de la course",
                      <input
                        autoFocus
                        name="reference"
                        placeholder="DEMO-005"
                        defaultValue={
                          modal === "edit" ? selected?.reference : undefined
                        }
                        required
                        maxLength={60}
                      />,
                    )}
                    {field(
                      demoMode ? "Client / patient fictif" : "Client / patient",
                      <select
                        name="customer"
                        defaultValue={
                          modal === "edit" ? selected?.customer_id || "" : ""
                        }
                      >
                        <option value="">Sans fiche associée</option>
                        {customers.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field(
                      "Départ",
                      locationSelect(
                        "origin",
                        modal === "edit" ? selected?.origin : undefined,
                      ),
                    )}
                    {field(
                      "Destination",
                      locationSelect(
                        "destination",
                        modal === "edit" ? selected?.destination : undefined,
                      ),
                    )}
                    <div className="form-grid">
                      {field(
                        "Prise en charge (Paris)",
                        <input
                          name="pickup"
                          type="time"
                          defaultValue={
                            modal === "edit" && selected
                              ? time(selected.pickup_at)
                              : "09:00"
                          }
                          required
                        />,
                      )}
                      {field(
                        "Rendez-vous (Paris)",
                        <input
                          name="appointment"
                          type="time"
                          defaultValue={
                            modal === "edit" && selected
                              ? time(selected.appointment_at)
                              : "10:00"
                          }
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
                          defaultValue={
                            modal === "edit" ? selected?.arrival_buffer : 15
                          }
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
                          defaultValue={
                            modal === "edit" ? selected?.passengers : 1
                          }
                          required
                        />,
                      )}
                    </div>
                    <label className="check">
                      <input
                        name="accessible"
                        type="checkbox"
                        defaultChecked={
                          modal === "edit" ? selected?.accessible : false
                        }
                      />
                      Véhicule adapté PMR requis
                    </label>
                    <p className="hint">
                      Date : {date}. Vérifiez les coordonnées et les durées de
                      trajet dans Contacts avant l’affectation.
                    </p>
                  </>
                )}
                {modal === "delay" &&
                  field(
                    "Retard estimé (minutes)",
                    <input
                      name="minutes"
                      type="number"
                      min={1}
                      max={240}
                      defaultValue={15}
                      required
                    />,
                  )}
                {modal === "driver" && (
                  <>
                    {field(
                      demoMode ? "Nom fictif" : "Nom",
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
