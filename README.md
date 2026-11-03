# TAXI LINK

Premier socle exécutable de coordination taxi, en français : Next.js, API NestJS, TypeScript et PostgreSQL. **Démonstration sur données entièrement fictives.** Aucun hébergement public ni usage réel autorisé par cette version.

## Démarrer en local

Node.js 24 recommandé (minimum 22.18). Aucune clé de service payant nécessaire.

```bash
npm ci
cp .env.example .env
```

Renseigner dans `.env` `DEMO_MODE=true` et un `DEMO_PASSWORD` personnel d’au moins 16 caractères. Ne pas committer `.env`.

```bash
node --env-file=.env --import tsx apps/api/src/seed.ts
node --env-file=.env --import tsx apps/api/src/main.ts
```

Dans un deuxième terminal :

```bash
npm run dev:web
```

Ouvrir http://localhost:3000. API : http://localhost:4000/api/v1/health.

Les scripts `npm run dev`, `npm run db:seed` et `npm run db:migrate` attendent les variables déjà exportées. Les commandes `node --env-file=.env` ci-dessus chargent le fichier explicitement.

### Comptes fictifs

Deux entreprises : **Atlas Démo** et **Horizon Démo**, chacune avec deux chauffeurs, deux véhicules et quatre courses. Planning initial : **4 novembre 2026**, heure de Paris. Tous les comptes emploient le mot de passe choisi pour le seed :

| Rôle            | Atlas                    | Horizon                    |
| --------------- | ------------------------ | -------------------------- |
| Administrateur  | admin@atlas.example      | admin@horizon.example      |
| Régulateur      | dispatcher@atlas.example | dispatcher@horizon.example |
| Chauffeur       | driver@atlas.example     | driver@horizon.example     |
| Lecture limitée | viewer@atlas.example     | viewer@horizon.example     |

Un chauffeur ne voit que ses missions attribuées. Le compte de lecture limitée ne reçoit pas encore de droits métier : son planning est vide. Le seed est sans effet si Atlas existe déjà ; il ne réinitialise pas les mots de passe. `DEMO_DATE=AAAA-MM-JJ` change la date lors du **premier** seed uniquement.

### Base de données

Sans `DATABASE_URL`, la démo utilise PGlite (moteur PostgreSQL WASM) dans `.data/demo`, persistante après redémarrage. Une seule instance API peut ouvrir ce répertoire. Ce mode ne convient pas à un service partagé en production.

Avec `DATABASE_URL`, toutes les données passent par PostgreSQL via `pg`. Les utilisateurs partagent alors la même base et les validations sont transactionnelles. Un administrateur de base doit appliquer la migration initiale qui crée le rôle restreint `taxilink_app`. Le serveur actuel utilise encore une connexion privilégiée pour l’identité puis `SET LOCAL ROLE` pour les opérations métier : séparation des comptes de migration/identité/runtime à finaliser avant pilote (ADR-002).

### Docker Compose (configuration fournie)

```bash
docker compose up --build
```

Nécessite Docker Compose et `.env` renseigné, notamment `DB_PASSWORD` (mot de passe compatible URL, sans caractères `@`, `/` ou `:`). Web 3000, API 4000, PostgreSQL 5432 : ports exposés uniquement sur `127.0.0.1`. Configuration non exécutée dans l’environnement de réalisation ; voir `docs/validation.md`.

## Fonctions présentes

- Inscription d’une entreprise de démonstration ; connexion, session huit heures, déconnexion.
- Entreprises, memberships, rôles et contrôle serveur ; isolation RLS des tables métier.
- Invitations de collaborateurs : code à usage unique, destinataire contrôlé, 48 h, révocation. Transmission manuelle ; aucun email envoyé. Vérification réelle de l’email et MFA à ajouter avant pilote.
- Création de groupes privés ; visibilité des groupes du jeu de données selon adhésion. L’invitation d’entreprises au groupe reste à développer.
- Création de chauffeurs avec service et pauses via API, véhicules et courses.
- Planning journalier, recherche, filtres, attribution, statuts de mission et annulation confirmée.
- Vérification des disponibilités, capacités, pauses, rendez-vous, trajets de liaison chauffeur **et véhicule** ; refus si itinéraire manquant ou périmé.
- Versionnement, clés d’idempotence et sérialisation transactionnelle des mutations par entreprise.
- Audit append-only pour le rôle métier. Actualisation de l’interface toutes les 15 secondes.
- Interface responsive régulation et chauffeur. Messages de chargement, erreur, vide et connexion perdue.

La matrice de trajets contient seulement des durées **synthétiques**, explicitement étiquetées. Aucun calcul routier réel n’est simulé à partir d’une vitesse moyenne. Les adresses du prototype se limitent aux lieux fictifs fournis.

## Vérifier

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

La suite teste l’API NestJS/Express sans ouvrir de port et une véritable base PostgreSQL embarquée : RLS, isolation, RBAC, CSRF, invitations, transitions, idempotence, conflits et concurrence. La CI exécute aussi les mêmes tests sur PostgreSQL 16 avec `TEST_DATABASE_URL` (base vierge obligatoire). Aucun test PostgreSQL réseau réussi n’est revendiqué sans exécution CI correspondante.

## Périmètre restant

Cette PR constitue une première tranche des lots 0–1, pas une V1 complète. Restent : administration complète des memberships et ressources, multi-services quotidiens, invitations d’entreprises aux groupes, bourse/acceptation d’offres, chat, notifications, répartition automatique, fournisseur routier, application Expo native, mode hors ligne chiffré, récurrences, annuaire, MFA/OIDC, vérification email, sauvegardes/restauration, tests E2E et audit avant pilote.

Le test de 50 requêtes porte sur **l’affectation manuelle d’une course**, pas sur une offre réseau : ce second cas appartient au lot 2.

Les documents médicaux, l’OCR, la lecture de puce et les services CPAM ne sont pas implémentés. Le démarrage refuse `REAL_SENSITIVE_DOCUMENTS_ENABLED=true` et refuse le mode hors démonstration. Aucune conformité HDS/RGPD ni aptitude à la production n’est revendiquée.

Pour le parcours navigateur : `npx playwright install chromium`, puis lancer l’API et le web et exécuter `npm run test:e2e` avec `.env` renseigné. Ce contrôle est fourni mais n’a pas pu être exécuté localement faute de navigateur installé.

Les documents de cadrage transmis ont été étudiés sans les reproduire dans ce dépôt public. Les fichiers OpenAPI et SQL cités dans ces documents n’étaient pas joints comme fichiers indépendants : le contrat et la migration de ce dépôt sont nouveaux. Voir `docs/adr/001-foundation.md`, `docs/backlog.md`, `docs/validation.md` et `packages/contracts/openapi.json`.
