import { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { navigationUrl } from "../../packages/contracts/navigation";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
type Row = Record<string, any>;
const base = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api/v1"
).replace(/\/$/, "");
const sessionKey = "taxilink-session";
const labels: Row = {
  unassigned: "À attribuer",
  assigned: "Attribuée",
  draft: "Brouillon",
  confirmed: "Confirmée",
  failed: "Échec",
  no_show: "Non présent",
  approaching: "En approche",
  onboard: "À bord",
  completed: "Terminée",
  cancelled: "Annulée",
  published: "Disponible",
  reserved: "Réservation à confirmer",
  accepted: "Transfert confirmé",
  withdrawn: "Retirée",
  expired: "Expirée",
  rejected: "Refusée",
};
const time = (s: string) =>
  new Date(s).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  });
const storeOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
async function saveSession(s: Row) {
  let persisted = s;
  let text = JSON.stringify(persisted);
  if (encodeURIComponent(text).replace(/%[A-F0-9]{2}/gi, "x").length > 1800) {
    persisted = {
      ...s,
      memberships: s.memberships.filter((m: Row) => m.tenant_id === s.tenant),
    };
    text = JSON.stringify(persisted);
  }
  await SecureStore.setItemAsync(sessionKey, text, storeOptions);
}

export default function App() {
  const [session, setSession] = useState<Row | null>(null),
    [email, setEmail] = useState("driver@atlas.example"),
    [password, setPassword] = useState(""),
    [mfaCode, setMfaCode] = useState(""),
    [recoveryCode, setRecoveryCode] = useState(""),
    [tab, setTab] = useState("Missions"),
    [date, setDate] = useState("2026-11-04"),
    [missions, setMissions] = useState<Row[]>([]),
    [offers, setOffers] = useState<Row[]>([]),
    [groups, setGroups] = useState<Row[]>([]),
    [group, setGroup] = useState(""),
    [conversation, setConversation] = useState(""),
    [messages, setMessages] = useState<Row[]>([]),
    [text, setText] = useState(""),
    [drivers, setDrivers] = useState<Row[]>([]),
    [vehicles, setVehicles] = useState<Row[]>([]),
    [driver, setDriver] = useState(""),
    [vehicle, setVehicle] = useState(""),
    [locations, setLocations] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [lastSync, setLastSync] = useState(""),
    [loading, setLoading] = useState(true);
  const active = useRef<Row | null>(null);
  const activeDate = useRef(date);
  activeDate.current = date;
  const activeChannel = useRef("");
  activeChannel.current = conversation || group;
  const activate = (s: Row | null) => {
    active.current = s;
    setSession(s);
  };
  const current = (s: Row) =>
    active.current?.token === s.token && active.current?.tenant === s.tenant;
  const cacheKey = (s: Row) =>
    "taxilink-missions-" + s.user_id + "-" + s.tenant;
  async function enablePush() {
    const s = active.current;
    if (!s) return;
    const settings = await api("/notification-settings", undefined, s);
    if (!settings.push_available)
      throw new Error(
        "Les notifications push ne sont pas configurées sur cette installation.",
      );
    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
      Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId)
      throw new Error(
        "Le projet mobile doit être configuré avant d’activer les notifications.",
      );
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync("default", {
        name: "Événements TAXILINK",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== "granted")
      throw new Error("Permission de notification refusée.");
    const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!current(s)) return;
    const result = await api(
      "/devices",
      {
        token: expoToken.data,
        platform: Platform.OS === "ios" ? "ios" : "android",
      },
      s,
    );
    const next = { ...s, push_device_id: result.id };
    await saveSession(next);
    if (current(s)) activate(next);
    Alert.alert(
      "Notifications activées",
      "Les notifications affichent uniquement un avis générique. Les détails restent dans votre espace.",
    );
  }
  useEffect(() => {
    const listener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const s = active.current;
        if (!s) return;
        const tenant = response.notification.request.content.data?.tenant_id;
        if (tenant === s.tenant) {
          setTab("Missions");
          refresh(s).catch(() => {});
        } else
          Alert.alert(
            "Événement TAXILINK",
            "Un événement concerne une autre entreprise. Sélectionnez-la dans Compte pour consulter vos accès.",
          );
      },
    );
    return () => listener.remove();
  }, []);
  async function clearLocal(s = session) {
    if (s && active.current && s.token !== active.current.token) return;
    if (s) await SecureStore.deleteItemAsync(cacheKey(s));
    await SecureStore.deleteItemAsync(sessionKey);
    activate(null);
    setMissions([]);
    setOffers([]);
    setMessages([]);
    setGroups([]);
    setGroup("");
    setConversation("");
    setPassword("");
    setMfaCode("");
    setRecoveryCode("");
    setOffline(false);
  }
  async function api(path: string, body?: Row, s = session) {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          ...(s
            ? {
                Authorization: "Bearer " + s.token,
                "X-CSRF-Token": s.csrf,
                "X-Tenant-Id": s.tenant,
              }
            : {}),
          ...(body ? { "Idempotency-Key": Crypto.randomUUID() } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      setOffline(true);
      throw new Error("Connexion indisponible");
    }
    const result = await response.json();
    if (response.status === 401 && result.code === "SESSION_REQUIRED") {
      await clearLocal(s);
      throw new Error("Session expirée. Reconnectez-vous.");
    }
    if (!response.ok)
      throw new Error(
        (
          {
            OFFER_UNAVAILABLE: "Offre déjà prise, expirée ou retirée.",
            ACCESS_DENIED: "Accès refusé.",
            RESOURCE_CONFLICT: "Ce créneau est déjà occupé.",
            PLAN_STALE: "Les données ont changé. Actualisez.",
            SHIFT_CONFLICT: "Hors de votre service.",
            TRANSFER_CONFLICT: "Temps de liaison insuffisant.",
            BREAK_CONFLICT: "Conflit avec une pause.",
            MFA_REQUIRED:
              "Saisissez un code de double authentification ou un code de récupération.",
            MFA_INVALID: "Code invalide ou déjà utilisé.",
            INVALID_CREDENTIALS: "Identifiants incorrects.",
          } as Row
        )[result.code] || result.code,
      );
    setOffline(false);
    return result;
  }
  async function cache(s: Row, rows: Row[]) {
    const minimal: Row[] = [];
    for (const r of rows.slice(0, 3)) {
      const m = {
        id: r.id,
        reference: r.reference,
        pickup_at: r.pickup_at,
        origin: r.origin,
        destination: r.destination,
        status: r.status,
        version: r.version,
      };
      if (JSON.stringify([...minimal, m]).length > 550) break;
      minimal.push(m);
    }
    await SecureStore.setItemAsync(
      cacheKey(s),
      JSON.stringify({ rows: minimal, at: new Date().toISOString(), date }),
      storeOptions,
    );
  }
  async function refresh(s = session) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const requestedDate = date;
    const requestedChannel = conversation || group;
    const me = await api("/auth/me", undefined, s);
    if (!current(s)) return;
    if (!me.memberships.some((m: Row) => m.tenant_id === s.tenant)) {
      await clearLocal(s);
      throw new Error("Votre accès à cette entreprise a été retiré.");
    }
    const currentMembership = me.memberships.find(
      (m: Row) => m.tenant_id === s.tenant,
    );
    if (!["admin", "dispatcher", "driver"].includes(currentMembership.role)) {
      await clearLocal(s);
      throw new Error("Votre rôle ne permet plus l’accès aux missions.");
    }
    const priorMembership = s.memberships.find(
      (m: Row) => m.tenant_id === s.tenant,
    );
    if (priorMembership?.role !== currentMembership.role) {
      setMissions([]);
      setOffers([]);
      setMessages([]);
      const changed = { ...s, memberships: me.memberships };
      await saveSession(changed);
      activate(changed);
      return refresh(changed);
    }
    const [jobs, network, ds, vs, gs, ls] = await Promise.all([
      api("/courses?date=" + date, undefined, s),
      api("/offers", undefined, s),
      api("/drivers", undefined, s),
      api("/vehicles", undefined, s),
      api("/groups", undefined, s),
      api("/locations", undefined, s),
    ]);
    if (!current(s) || activeDate.current !== requestedDate) return;
    setMissions(jobs);
    setOffers(network);
    setDrivers(ds);
    setVehicles(vs);
    setGroups(gs);
    setLocations(ls);
    setDriver((d) => (ds.some((x: Row) => x.id === d) ? d : ds[0]?.id || ""));
    setVehicle((v) => (vs.some((x: Row) => x.id === v) ? v : vs[0]?.id || ""));
    setLastSync(new Date().toISOString());
    await cache(s, jobs);
    if (requestedChannel) {
      const route = conversation
        ? `/conversations/${conversation}/messages`
        : `/groups/${group}/messages`;
      const result = await api(route, undefined, s);
      if (current(s) && activeChannel.current === requestedChannel)
        setMessages(result);
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync(sessionKey);
      if (stored) {
        const s = JSON.parse(stored);
        if (s.expires_at > Date.now()) {
          activate(s);
          try {
            await refresh(s);
          } catch (e) {
            if ((e as Error).message === "Connexion indisponible") {
              const cached = await SecureStore.getItemAsync(cacheKey(s));
              if (cached) {
                const parsed = JSON.parse(cached);
                setMissions(parsed.rows);
                setDate(parsed.date);
                setLastSync(parsed.at);
              }
              setOffline(true);
            } else setError((e as Error).message);
          }
        } else await clearLocal(s);
      }
    })()
      .catch(() => setError("Impossible de restaurer la session."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    let current = true;
    refresh().catch((e) => {
      if (current) setError((e as Error).message);
    });
    const timer = setInterval(() => refresh().catch(() => {}), 15000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh().catch(() => {});
    });
    return () => {
      current = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [session?.tenant, group, date, conversation]);
  const name = (id: string) => locations.find((l) => l.id === id)?.label || id;
  const button = (
    title: string,
    onPress: () => void,
    secondary = false,
    disabled = busy || offline,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
    >
      <Text style={secondary ? styles.secondaryText : styles.buttonText}>
        {title}
      </Text>
    </Pressable>
  );
  if (loading)
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator accessibilityLabel="Chargement de la session" />
      </SafeAreaView>
    );
  if (!session)
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.login}>
          <Text style={styles.brand}>TAXI LINK ↗</Text>
          <Text style={styles.title}>Votre journée.{`\n`}En mouvement.</Text>
          <Text style={styles.note}>Démonstration · Données fictives</Text>
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Text style={styles.label}>Adresse email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            accessibilityLabel="Adresse email"
          />
          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            accessibilityLabel="Mot de passe"
          />
          <Text style={styles.label}>Double authentification (si activée)</Text>
          <TextInput
            accessibilityLabel="Code de double authentification"
            style={styles.input}
            keyboardType="number-pad"
            value={mfaCode}
            onChangeText={setMfaCode}
            maxLength={6}
            autoComplete="one-time-code"
          />
          <TextInput
            accessibilityLabel="Code de récupération"
            style={styles.input}
            placeholder="Ou un code de récupération"
            value={recoveryCode}
            onChangeText={setRecoveryCode}
            maxLength={17}
            autoCapitalize="characters"
          />
          {button(
            "Connexion",
            () =>
              run(async () => {
                const auth = await api(
                  "/auth/mobile-login",
                  {
                    email,
                    password,
                    ...(mfaCode ? { mfa_code: mfaCode } : {}),
                    ...(recoveryCode ? { recovery_code: recoveryCode } : {}),
                  },
                  null,
                );
                const initial = {
                  token: auth.token,
                  csrf: auth.csrf,
                  tenant: "",
                  user_id: "",
                  memberships: [],
                  expires_at: Date.now() + 8 * 3600000,
                };
                const me = await api("/auth/me", undefined, initial);
                if (!me.memberships.length)
                  throw new Error("Aucune entreprise active.");
                const s = {
                  ...initial,
                  tenant: me.memberships[0].tenant_id,
                  user_id: me.id,
                  memberships: me.memberships,
                };
                await saveSession(s);
                activate(s);
                setPassword("");
                setMfaCode("");
                setRecoveryCode("");
                await refresh(s);
              }),
            false,
            busy || !email || !password,
          )}
          <Text style={styles.note}>
            Serveur configuré : {base}. L’adresse du serveur se définit dans
            EXPO_PUBLIC_API_URL avant de lancer l’application.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>TAXI LINK ↗</Text>
        <Text style={styles.note}>DÉMONSTRATION</Text>
      </View>
      {offline && (
        <Text accessibilityRole="alert" style={styles.warning}>
          Hors connexion · Cache chiffré limité à 3 missions. Actions
          désactivées. Dernière synchronisation :{" "}
          {lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "inconnue"}.
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{tab}</Text>
        <Text style={styles.note}>
          {
            session.memberships.find((m: Row) => m.tenant_id === session.tenant)
              ?.name
          }
        </Text>
        {tab === "Missions" && (
          <>
            <Text style={styles.label}>Journée (AAAA-MM-JJ)</Text>
            <TextInput
              accessibilityLabel="Date des missions"
              style={styles.input}
              value={date}
              onChangeText={setDate}
              maxLength={10}
            />
            {missions.map((m) => (
              <View key={m.id} style={styles.card}>
                <Text style={styles.clock}>{time(m.pickup_at)}</Text>
                <Text style={styles.heading}>{m.reference}</Text>
                <Text style={styles.route}>
                  {name(m.origin)} → {name(m.destination)}
                </Text>
                <Text style={styles.badge}>{labels[m.status]}</Text>
                {!offline &&
                  button(
                    "Échanger sur cette mission",
                    () =>
                      run(async () => {
                        const chat = await api("/conversations", {
                          kind: "course",
                          course_id: m.id,
                        });
                        setConversation(chat.id);
                        setGroup("");
                        setTab("Messages");
                      }),
                    true,
                  )}
                {!offline &&
                  button(
                    "Ouvrir la navigation",
                    () => {
                      const origin = locations.find((p) => p.id === m.origin),
                        destination = locations.find(
                          (p) => p.id === m.destination,
                        );
                      const url =
                        origin && destination
                          ? navigationUrl(
                              origin as any,
                              destination as any,
                              Platform.OS === "ios" ? "apple" : "google",
                            )
                          : null;
                      if (url)
                        Linking.openURL(url).catch(() =>
                          Alert.alert("Navigation indisponible"),
                        );
                      else
                        Alert.alert(
                          "Navigation indisponible",
                          "Les coordonnées de ce trajet ne sont pas encore validées.",
                        );
                    },
                    true,
                  )}
                {!offline &&
                  ["assigned", "confirmed"].includes(m.status) &&
                  button(
                    "Demander une réattribution",
                    () =>
                      run(async () => {
                        await api(`/courses/${m.id}/transfer-request`, {
                          version: m.version,
                          reason: "other",
                        });
                        Alert.alert(
                          "Demande transmise",
                          "Votre affectation est conservée jusqu’à la décision de la régulation.",
                        );
                      }),
                    true,
                    busy,
                  )}
                {!offline &&
                  ["assigned", "confirmed", "approaching", "onboard"].includes(
                    m.status,
                  ) && (
                    <>
                      {button(
                        (
                          {
                            assigned: "En approche",
                            confirmed: "En approche",
                            approaching: "Passager à bord",
                            onboard: "Terminer",
                          } as Row
                        )[m.status],
                        () =>
                          run(async () => {
                            await api(`/courses/${m.id}/status`, {
                              status: (
                                {
                                  assigned: "approaching",
                                  confirmed: "approaching",
                                  approaching: "onboard",
                                  onboard: "completed",
                                } as Row
                              )[m.status],
                              version: m.version,
                            });
                            await refresh();
                          }),
                      )}
                      {button(
                        "Signaler +15 min de retard",
                        () =>
                          run(async () => {
                            await api(`/courses/${m.id}/delay`, {
                              minutes: 15,
                            });
                            Alert.alert(
                              "Retard signalé",
                              "La régulation est informée. Aucune mission n’a été déplacée automatiquement.",
                            );
                          }),
                        true,
                      )}
                    </>
                  )}
              </View>
            ))}
            {!missions.length && (
              <Text style={styles.note}>
                Aucune mission attribuée à cette date.
              </Text>
            )}
          </>
        )}
        {tab === "Bourse" && (
          <>
            <Text style={styles.note}>
              Les réservations restent soumises à confirmation du propriétaire.
            </Text>
            <Text style={styles.label}>Chauffeur sélectionné</Text>
            <View style={styles.choiceRow}>
              {drivers.map((d) =>
                button(
                  (driver === d.id ? "✓ " : "") + d.name,
                  () => setDriver(d.id),
                  true,
                  busy || offline,
                ),
              )}
            </View>
            <Text style={styles.label}>Véhicule sélectionné</Text>
            <View style={styles.choiceRow}>
              {vehicles.map((v) =>
                button(
                  (vehicle === v.id ? "✓ " : "") + v.label,
                  () => setVehicle(v.id),
                  true,
                  busy || offline,
                ),
              )}
            </View>
            {offers.map((o) => (
              <View key={o.id} style={styles.card}>
                <Text style={styles.heading}>
                  {o.origin_label} → {o.destination_label}
                </Text>
                <Text>
                  {time(o.pickup_at)} · {o.passengers} passager(s)
                </Text>
                <Text style={styles.badge}>{labels[o.status]}</Text>
                {!o.own &&
                  o.status === "published" &&
                  button(
                    "Réserver cette offre",
                    () =>
                      run(async () => {
                        await api(`/offers/${o.id}/claim`, {
                          driver_id: driver,
                          vehicle_id: vehicle,
                        });
                        await refresh();
                        Alert.alert(
                          "Réservée",
                          "Attendez la confirmation de l’entreprise propriétaire.",
                        );
                      }),
                    false,
                    busy || offline || !driver || !vehicle,
                  )}
                {o.own &&
                  o.status === "reserved" &&
                  session.memberships.some(
                    (m: Row) =>
                      m.tenant_id === session.tenant &&
                      ["admin", "dispatcher"].includes(m.role),
                  ) &&
                  button("Confirmer le transfert", () =>
                    run(async () => {
                      await api(`/offers/${o.id}/decision`, {
                        decision: "approve",
                      });
                      await refresh();
                    }),
                  )}
              </View>
            ))}
          </>
        )}
        {tab === "Messages" && (
          <>
            <Text style={styles.note}>
              Aucun document ni détail médical dans les échanges de groupe.
            </Text>
            {groups.map((g) =>
              button(
                (group === g.id ? "✓ " : "") + g.name,
                () => {
                  setConversation("");
                  setGroup(g.id);
                },
                true,
                busy || offline,
              ),
            )}
            {(group || conversation) && (
              <>
                {messages.map((m) => (
                  <View key={m.id} style={styles.card}>
                    <Text style={styles.label}>
                      {m.company} · {time(m.created_at)}
                    </Text>
                    <Text>{m.body}</Text>
                  </View>
                ))}
                <TextInput
                  accessibilityLabel="Message au groupe"
                  style={[styles.input, styles.multiline]}
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={2000}
                  placeholder="Message opérationnel"
                />
                {button(
                  "Envoyer",
                  () =>
                    run(async () => {
                      await api(
                        conversation
                          ? `/conversations/${conversation}/messages`
                          : `/groups/${group}/messages`,
                        { body: text },
                      );
                      setText("");
                      await refresh();
                    }),
                  false,
                  busy || offline || !text.trim(),
                )}
              </>
            )}
          </>
        )}
        {tab === "Compte" && (
          <>
            <Text style={styles.heading}>Entreprise active</Text>
            {session.memberships.map((m: Row) =>
              button(
                (session.tenant === m.tenant_id ? "✓ " : "") + m.name,
                () =>
                  run(async () => {
                    if (session.push_device_id)
                      await api(
                        `/devices/${session.push_device_id}/remove`,
                        {},
                      );
                    await SecureStore.deleteItemAsync(cacheKey(session));
                    setMissions([]);
                    setOffers([]);
                    setMessages([]);
                    setGroup("");
                    setConversation("");
                    const next = {
                      ...session,
                      tenant: m.tenant_id,
                      push_device_id: undefined,
                    };
                    await saveSession(next);
                    activate(next);
                    await refresh(next);
                  }),
                true,
                busy || offline,
              ),
            )}
            <Text style={styles.note}>
              Session stockée dans le stockage sécurisé du téléphone. Aucun mot
              de passe enregistré. Le cache de missions est limité, chiffré par
              le système et effacé à la déconnexion.
            </Text>
            {button("Actualiser", () => run(() => refresh()), true, busy)}
            {button(
              session.push_device_id
                ? "Renouveler les notifications"
                : "Activer les notifications",
              () => run(enablePush),
              true,
              busy || offline,
            )}
            {session.push_device_id &&
              button(
                "Désactiver les notifications",
                () =>
                  run(async () => {
                    await api(`/devices/${session.push_device_id}/remove`, {});
                    const next = { ...session, push_device_id: undefined };
                    await saveSession(next);
                    activate(next);
                  }),
                true,
                busy || offline,
              )}
            {button(
              "Déconnexion",
              () =>
                run(async () => {
                  try {
                    if (!offline) await api("/auth/logout", {});
                  } finally {
                    await clearLocal();
                  }
                }),
              true,
              busy,
            )}
          </>
        )}
      </ScrollView>
      <View style={styles.tabs}>
        {["Missions", "Bourse", "Messages", "Compte"].map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => {
              setTab(t);
              setError("");
            }}
          >
            <Text style={tab === t ? styles.tabTextActive : styles.tabText}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f5f7f8",
    paddingTop: Platform.OS === "android" ? 30 : 0,
  },
  header: {
    padding: 20,
    backgroundColor: "#fff",
    borderBottomColor: "#dce7e8",
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { fontSize: 21, fontWeight: "800", color: "#153440" },
  login: { padding: 28, paddingTop: 70, gap: 14 },
  title: {
    fontSize: 29,
    fontWeight: "700",
    color: "#153440",
    marginBottom: 10,
  },
  body: { padding: 20, paddingBottom: 40, gap: 10 },
  note: { fontSize: 12, color: "#5d737d", lineHeight: 19 },
  label: { fontSize: 12, fontWeight: "600", color: "#496470", marginTop: 12 },
  input: {
    backgroundColor: "#fff",
    borderColor: "#bdcfd2",
    borderWidth: 1,
    borderRadius: 9,
    minHeight: 48,
    padding: 13,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#087f79",
    borderRadius: 9,
    padding: 14,
    marginTop: 8,
    minHeight: 48,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  secondary: { backgroundColor: "#e4f1ed" },
  secondaryText: { color: "#146e62", fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.45 },
  card: {
    padding: 20,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderColor: "#e0e9eb",
    borderWidth: 1,
    gap: 10,
    marginTop: 10,
  },
  clock: { fontSize: 25, fontWeight: "700", color: "#153440" },
  heading: { fontSize: 17, fontWeight: "600", color: "#153440" },
  route: { fontSize: 15, color: "#486773", lineHeight: 23 },
  badge: { fontSize: 12, color: "#087f79", fontWeight: "600" },
  tabs: {
    backgroundColor: "#fff",
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#dce7e8",
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  tabActive: { backgroundColor: "#e4f1ed" },
  tabText: { fontSize: 12, color: "#647b85" },
  tabTextActive: { fontSize: 12, color: "#087f79", fontWeight: "700" },
  error: {
    backgroundColor: "#fcece7",
    color: "#8e3a2e",
    padding: 14,
    fontSize: 13,
  },
  warning: {
    backgroundColor: "#fff0cd",
    color: "#76581c",
    padding: 14,
    fontSize: 12,
    lineHeight: 18,
  },
  choiceRow: { gap: 4 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
});
