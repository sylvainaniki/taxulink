# Décisions d’architecture — version 0.2

## 001 — Monolithe modulaire et clients

NestJS, Next.js, Expo/React Native et TypeScript partagé. SQL paramétré via `pg`, migrations versionnées, PostgreSQL 16 réseau ou PGlite pour démonstration locale. Pas d’ORM masquant le contexte RLS. Les entrées sont validées par Zod ; les réponses de courses et d’offres ont des contrats stricts testés. Les nouveaux modules métier résident dans `apps/api/src/modules`.

## 002 — Identités distinctes et RLS

En réseau, deux pools utilisent des identifiants LOGIN sans superuser/BYPASSRLS/CREATEROLE : métier et identité. Les migrations/provisionnements restent au propriétaire. L’API métier n’a aucun SELECT sur utilisateurs/sessions ; la fonction `authenticate_request` vérifie le hash de session et l’appartenance active, verrouille les lignes d’autorisation puis retourne un contexte minimal. Chaque transaction métier fixe `app.tenant_id` et `app.user_id`, sous le rôle sans BYPASSRLS. Les FK composites empêchent les liens de ressources entre entreprises.

L’identité peut lire les hashes de mots de passe et gérer les sessions, sans lire les courses, contacts, offres ou conversations. Le runtime réseau refuse les identifiants de propriétaire. En mode WASM local, le même moteur est utilisé avec des rôles transactionnels séparés ; ce mode n’accepte pas plusieurs processus.

Les fonctions SECURITY DEFINER ont un search_path fixé, aucune permission PUBLIC et des contrôles explicites. Le runtime ne peut créer d’objets dans public. Aucune route n’accepte de SQL ou un identifiant d’acteur fourni par le client. Audit : insertion et lecture autorisées selon contexte, modification/suppression refusées aux rôles runtime.

## 003 — Concurrence et partage

Un verrou global transactionnel précède les autres mutations ; il élimine les deadlocks d’ordre entre deux entreprises et rend les réservations atomiques. Il est volontairement conservateur et devra être remplacé/mesuré avant une charge élevée. Les clés d’idempotence sont liées à l’acteur et à l’entreprise. Les invitations montrent le code brut une seule fois ; le cache de replay ne l’enregistre pas.

Une offre est unique pour une course et vise un ou plusieurs groupes. Sa projection ne contient ni référence passager, ni identifiant de course/contact, ni nom, téléphone, note ou document. Une réservation bloque les ressources dix minutes au maximum. Le propriétaire confirme ensuite ; l’exécutant reçoit une projection de mission dédiée dans son entreprise. Le fichier de contacts et les documents ne sont pas partagés. Les états de cette mission sont répercutés dans la course propriétaire avec audit. Une révocation coupe les lectures de groupe, tandis qu’une mission confirmée reste autorisée par son attribution explicite.

## 004 — Planification

Services, pauses, capacité, accessibilité, rendez-vous et marge, temps d’embarquement/dépose, collisions chauffeur/véhicule et trajets de liaison sont contrôlés. Les engagements précédents/suivants et les réservations sont pris en compte. Les changements de véhicule/chauffeur dans un service sont refusés si le passage de relais n’est pas modélisé. Une déclaration de dépôt/service est une donnée d’entrée à valider sur le terrain.

L’heuristique trie les rendez-vous puis privilégie la charge planifiée la plus faible et la continuité de véhicule. Elle produit un snapshot versionné sans mutation durable, laisse des raisons aux missions non attribuées et exige une confirmation. L’application vérifie le snapshot puis toutes les contraintes dans une transaction. Budget 30 s, lot maximal 500 ; aucun optimum global n’est garanti. Le cache de trajets est synthétique et étiqueté ; une durée absente/périmée n’est jamais inventée.

Un retard crée une alerte et informe le propriétaire d’une mission partagée ; il ne déplace pas automatiquement une course commencée. Les heures sont en UTC en base, Europe/Paris à l’écran. Les récurrences refusent les heures locales ambiguës/inexistantes au changement d’heure et génèrent des occurrences idempotentes.

## 005 — Authentification et secrets

Sessions opaques 256 bits, hash en base, cookies HttpOnly/SameSite Strict sur web, bearer conservé dans SecureStore sur mobile, CSRF et Origin contrôlés, mots de passe scrypt, limitation des tentatives. TOTP RFC 6238, graines chiffrées AES-256-GCM avec clé distincte de la base, compteurs anti-rejeu, codes de récupération hashés à usage unique. L’activation demande le mot de passe et une preuve TOTP, ferme les autres sessions ; désactivation/changement de mot de passe ferment toutes les sessions.

`setup` crée une configuration privée sans écraser l’existant. Les secrets, clés de signature, sauvegardes et documents source ne sont pas commités. La production requiert HTTPS, une gestion de secrets et une limitation distribuée ; l’email vérifié et la récupération par canal délivré restent à intégrer.

## 006 — Sauvegarde et périmètre

Archives chiffrées scrypt/AES-256-GCM, snapshot sous verrou, vérification d’authenticité avant lecture, restauration transactionnelle dans une base vide de la même version, permissions restaurées et sessions non restaurées. La clé MFA et la phrase de sauvegarde restent hors archive. Le test de restauration fait partie de la suite.

Aucun stockage de pièce médicale, OCR, lecture de puce ou CPAM. Le runtime refuse le mode hors démonstration et l’activation du flag documentaire. Hébergement, contrats, conservation, HDS/NIR et AIPD si applicable restent à établir avant de vraies données. Cette version ne revendique aucune conformité réglementaire ni aptitude à une exploitation médicale réelle.
