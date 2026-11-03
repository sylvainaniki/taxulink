# ADR-001 — Premier incrément exécutable

Statut : adopté pour prototype fictif, 3 novembre 2026.

Le dépôt reçu était vide. Le dossier fourni existe en deux documents Word de contenu identique et deux PDF de consultation, avec un prompt de démarrage. Les documents source restent hors du dépôt public. Les règles métier sont appliquées sans prétendre disposer des fichiers techniques indépendants mentionnés dans le sommaire.

Choix : monolithe modulaire NestJS + Next.js, TypeScript partagé, SQL paramétré explicite via `pg`. Les schémas Zod sont les contrats d’entrée. Les contrôles d’accès et le planning ne résident pas dans React. Le contrôleur HTTP du socle reste centralisé ; séparer en modules NestJS au lot 2 avant croissance.

Le premier incrément cible la vue web responsive, y compris pour chauffeur. Expo est explicitement reporté, sans dossier natif factice. Aucun abonnement tiers engagé. Les données réelles et toutes les pièces restent bloquées.

Les horaires portent un offset explicite, sont stockés en `timestamptz`, et sont affichés en Europe/Paris. La saisie web porte sur des services de jour ; les créneaux ambigus lors du changement d’heure ne font pas partie du parcours de démonstration. L’API accepte un offset explicite pour lever l’ambiguïté.

# ADR-002 — Isolation et accès base

Chaque requête vérifie session, membership actif et rôle, puis ouvre une transaction et fixe `app.tenant_id` avec `set_config(..., true)` et `SET LOCAL ROLE taxilink_app`. Les FK composites empêchent de rattacher des ressources d’entreprises différentes. Le rôle métier est sans BYPASSRLS, les tables métier sont sous RLS forcée. Audit : SELECT/INSERT autorisés, UPDATE/DELETE refusés.

Le pool `pg` garde la même connexion jusqu’au commit/rollback et libère ensuite. Le contexte est local à la transaction. La migration est versionnée et verrouillée. Pas d’ORM : SQL transparent au démarrage, responsabilité de maintenir types et migration. PGlite permet des tests RLS reproductibles sans Docker ; PostgreSQL réseau doit aussi être validé par la CI.

**Limite explicite :** le prototype emploie une connexion propriétaire pour l’authentification puis rétrograde son rôle pour le métier. Une injection arbitraire dans le service aurait trop de privilèges. Le pilote exige trois comptes séparés (migrations, identité à permissions étroites, runtime non propriétaire), des procédures d’identité contrôlées, un test sous chaque compte, et aucune possibilité de reset de rôle privilégié depuis le runtime métier. Ce socle est bloqué en démonstration et ne remplace pas cette étape.

# ADR-003 — Concurrence et planification

Une mutation métier verrouille la ligne entreprise (`FOR UPDATE`) avant lecture du planning. Toutes les écritures passent par cette séquence : protection simultanée des courses, chauffeurs et véhicules même avec plusieurs répliques API PostgreSQL. Un index unique interdit deux affectations d’une course ; version optimiste et clé d’idempotence contrôlent les retries. Le verrou est volontairement grossier, acceptable pour prototype ; mesurer avant verrous par ressource.

Le validateur utilise une matrice versionnée par fournisseur et validité. Les fixtures sont synthétiques ; route absente/périmée = refus. Contrôles : temps d’embarquement/dépose, marge RDV, services, capacité, PMR, pauses, collisions et déplacements depuis/après les engagements précédents/suivants du chauffeur et du véhicule. Les pauses et transferts sont évalués conservativement : certains plans faisables peuvent être refusés ; aucun override de ces contrôles n’est exposé.

Les heures d’affectation sont prévisionnelles. Les retards réels, ETA et indisponibilités à chaud ne sont pas gérés par cette tranche. Une transition « terminée » ne libère pas arbitrairement les créneaux du planning ; une annulation les libère. Pas de solveur ni de partage inter-entreprises de missions.

# ADR-004 — Identité, documents et exploitation

Sessions opaques 256 bits, hash SHA-256 en base, expiration huit heures, cookies HttpOnly/SameSite Strict, CSRF par session, Origin contrôlé et JSON obligatoire sur mutations. Mots de passe scrypt avec sel aléatoire, entrées bornées, limitation locale des tentatives. Les codes d’invitation sont hashés et montrés une fois. L’idempotence n’enregistre jamais leur valeur brute ; un retry retourne seulement l’ID et `token_returned=true`.

Limites : comptes de démo, email non vérifié, pas de MFA, rate limit mono-processus, HTTPS/cookies Secure à configurer avec l’hébergement retenu, purge sessions/idempotence à industrialiser. Ces limites bloquent le pilote réel. Pas de journalisation des corps, tokens ou erreurs SQL détaillées.

Pas de données médicales, stockage documentaire, NIR, lecture de puce ou CPAM. Le flag documentaire ne peut pas être activé dans cette version. Hébergement, rôles juridiques, DPA, HDS/NIR, AIPD si applicable et conservation demeurent des décisions avant tout traitement réel ; aucune conclusion juridique n’est codée.
