# TAXI LINK — démonstration collaborative 0.2

Application web Next.js, client chauffeur Expo Android/iOS, API NestJS et PostgreSQL. Cette version permet de démontrer la coordination de deux entreprises sur des **données entièrement fictives**. Elle ne doit pas recevoir de vrais dossiers médicaux et ne constitue pas une version d’exploitation certifiée.

## Démarrage local

Node.js 24 recommandé, minimum 22.18.

```bash
npm ci
npm run setup
node --env-file=.env --import tsx apps/api/src/seed.ts
node --env-file=.env --import tsx apps/api/src/main.ts
```

Dans un deuxième terminal :

```bash
npm run dev:web
```

Ouvrir http://localhost:3000. Le script `setup` crée `.env` avec des secrets locaux uniques et les permissions `0600`. Il refuse de remplacer une configuration existante. Lire son `DEMO_PASSWORD` localement ; ne pas publier ce fichier. Le code public ne contient aucun mot de passe d’utilisation réelle.

Deux entreprises fictives, **Atlas Démo** et **Horizon Démo**, sont préparées avec chacune deux chauffeurs, deux véhicules et quatre courses. Date initiale du planning : **4 novembre 2026**, heure de Paris. Le seed est idempotent et ne réinitialise pas les comptes existants.

| Rôle            | Atlas                    | Horizon                    |
| --------------- | ------------------------ | -------------------------- |
| Administrateur  | admin@atlas.example      | admin@horizon.example      |
| Régulateur      | dispatcher@atlas.example | dispatcher@horizon.example |
| Chauffeur       | driver@atlas.example     | driver@horizon.example     |
| Lecture limitée | viewer@atlas.example     | viewer@horizon.example     |

Les comptes utilisent le `DEMO_PASSWORD` choisi lors du premier seed. Un chauffeur voit ses missions uniquement. Le rôle de lecture limitée n’a pas encore de droits de lecture de données passagers. `DEMO_DATE=AAAA-MM-JJ` modifie uniquement la date du premier seed.

## Fonctions disponibles

- Connexion, entreprises, invitations temporaires, rôles, révocation des accès et changement de mot de passe.
- Vérification d’email et récupération de mot de passe par liens temporaires, avec maintien de la MFA, révocation des sessions et file SMTP chiffrée avec reprise sur échec.
- Double authentification TOTP : activation vérifiée, secrets chiffrés, protection contre la réutilisation d’un code, codes de récupération à usage unique, révocation des autres sessions.
- Chauffeurs, association à un compte utilisateur, véhicules, services sur plusieurs journées, pauses et contrôles des engagements avant modification.
- Fiches de clients/patients **fictifs**, établissements et partenaires, liées aux courses sans diagnostic.
- Courses, modifications versionnées, affectation/désaffectation, statuts, annulation, signalement de retard, séries récurrentes et retours à heure connue ou à confirmer.
- Planning journalier, filtres et propositions de répartition équilibrées en durée de travail. Aucune proposition n’est appliquée sans confirmation ; une proposition périmée est refusée.
- Groupes privés : invitation par code entreprise, acceptation, liste et retrait des membres.
- Bourse : publication dans plusieurs groupes, DTO minimal sans identité, réservation concurrente unique, blocage des ressources, confirmation/rejet par le propriétaire, retrait et expiration. Le partenaire reçoit ensuite une projection opérationnelle de sa mission, sans le fichier de contacts du propriétaire.
- Messagerie de groupe, directe et liée à une mission ; participants et permissions contrôlés à chaque lecture/écriture.
- Notifications in-app, alertes opérationnelles, statistiques, import CSV avec aperçu/dédoublonnage et export protégé contre les formules.
- Sauvegardes chiffrées, restauration dans une base vide avec conservation des ACL et invalidation des anciennes sessions.

La matrice routière et les adresses sont **synthétiques**. Un itinéraire absent/périmé bloque l’affectation. Les contrôles portent sur les horaires, marges, capacités, pauses, collisions et liaisons. Un changement de binôme chauffeur/véhicule au cours du même service est refusé si sa remise n’est pas modélisée.

La répartition est une heuristique déterministe et équilibrée, pas un solveur garantissant l’optimum global. Lot maximal : 500 courses et budget de calcul de 30 secondes avec explications pour les missions restantes. Les listes de courses/contacts sont bornées à 500, exports à 10 000 et imports à 100 lignes.

## PostgreSQL et Docker

Sans `DATABASE_URL`, la démo utilise PostgreSQL WASM/PGlite dans `.data/demo` ; une seule instance API peut ouvrir ce répertoire. Avec PostgreSQL réseau, les comptes sont séparés :

| Compte                            | Usage                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Propriétaire de migration         | Migrations, seed, provisionnement et sauvegarde administrative  |
| taxilink_api → taxilink_app       | Métier sous RLS, sans lecture des mots de passe ni des sessions |
| taxilink_auth → taxilink_identity | Identité/sessions, sans lecture des courses ni contacts         |

Le runtime réseau refuse les comptes superutilisateur/propriétaire trop privilégiés. Les contextes sont locaux à chaque transaction ; les passerelles inter-entreprises sont des fonctions autorisées explicitement. Le verrou global du prototype sérialise les mutations et les transferts entre entreprises. Il faut mesurer/redessiner ce verrou pour une montée en charge importante.

```bash
docker compose up --build
```

La configuration générée par `npm run setup` fournit les secrets nécessaires. Un conteneur de migration provisionne les rôles puis quitte ; le conteneur API ne reçoit pas le mot de passe propriétaire. Les ports sont exposés sur `127.0.0.1` uniquement. La CI vérifie le démarrage complet de Compose, les contrôles de santé et une connexion à travers le proxy web, ainsi que PostgreSQL 16 et les deux identités réseau restreintes.

Pour un PostgreSQL géré sans Compose, configurer `MIGRATION_DATABASE_URL`, exécuter `node --env-file=.env --import tsx scripts/provision.ts`, puis renseigner `DATABASE_URL` pour `taxilink_api` et `AUTH_DATABASE_URL` pour `taxilink_auth`. L’API n’applique pas de migrations avec ses identifiants runtime.

## Vérification d’email et récupération de compte

Compose démarre une boîte **Mailpit locale**, accessible sur http://localhost:8025. Les messages y restent : aucun email n’est envoyé à une vraie boîte. Depuis « Compte », demander une vérification d’adresse ; depuis la connexion, choisir « Mot de passe oublié ». Ouvrir le lien reçu dans Mailpit puis confirmer l’action dans l’application.

Les liens expirent après 30 minutes, sont à usage unique et remplacés au renouvellement. Une demande par adresse et par minute au maximum crée un envoi, avec une réponse identique pour les comptes absents ou existants. Le jeton est hashé en base ; le contenu de la file est chiffré avec `MAIL_ENCRYPTION_KEY`, distincte de la clé MFA. Les liens utilisent le fragment de l’URL et sont retirés de la barre d’adresse dès ouverture. Aucune action n’est exécutée par une simple lecture de lien.

Une récupération exige aussi un code MFA ou un code de récupération si le compte est protégé. Elle révoque toutes les sessions ; elle ne désactive pas la MFA. Les événements de confirmation et de récupération sont audités. La file retente au maximum cinq fois, avec délai croissant, avant l’expiration. Un arrêt après acceptation SMTP peut entraîner un doublon de livraison ; le lien reste utilisable une seule fois. Les liens et la file ne sont pas restaurés depuis les sauvegardes.

Pour un serveur SMTP externe, configurer `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_ENCRYPTION_KEY` (64 caractères hexadécimaux) et `WEB_ORIGIN` HTTPS. TLS et validation des certificats restent obligatoires. L’exception `SMTP_ALLOW_INSECURE=true` est réservée à Mailpit/localhost en démonstration. Aucun fournisseur externe n’est préconfiguré. Les installations existantes doivent ajouter une clé mail unique à leur `.env` avant de relancer Compose ; `setup` ne remplace pas une configuration existante.

`REQUIRE_VERIFIED_EMAIL=true` bloque les routes métier tant que l’adresse n’est pas vérifiée ; les routes de compte restent accessibles. Cette politique exige un SMTP configuré. Elle est désactivée par défaut dans la démo, y compris pour les comptes seedés dont l’adresse n’est pas déclarée vérifiée. Sans SMTP, les parcours de récupération indiquent clairement l’indisponibilité du service.

## Application chauffeur

Voir [apps/mobile/README.md](apps/mobile/README.md). Le client couvre missions, statuts, retards, bourse et conversations. La session et un cache limité à trois missions sont placés dans SecureStore ; les mutations sont bloquées hors ligne. Le cache ne contient pas les noms/téléphones passagers ni les messages.

```bash
npm run dev:mobile
npm run build:mobile
```

Le téléphone doit joindre le serveur via `EXPO_PUBLIC_API_URL`. L’export Android produit un bundle JavaScript/Hermes, **pas un APK signé**. La configuration EAS est fournie ; un compte de build, les identifiants de signature et une validation sur appareils restent nécessaires avant distribution. Aucun abonnement ni compte payant n’a été créé.

## Sauvegarder et restaurer

`BACKUP_PASSPHRASE` contient au moins 32 caractères. Conserver cette phrase et `MFA_ENCRYPTION_KEY` séparément des archives. Le format utilise scrypt et AES-256-GCM ; la restauration refuse une mauvaise clé, une version incompatible ou une base non vide. Limite : 50 MiB.

```bash
node --env-file=.env --import tsx scripts/backup.ts create .data/backups/demo.tlbackup
CONFIRM_EMPTY_RESTORE=true node --env-file=.env --import tsx scripts/backup.ts restore .data/backups/demo.tlbackup
```

Sur PGlite, arrêter l’API et utiliser un répertoire/base vide pour la restauration. Sur PostgreSQL, renseigner l’URL administrative dans `MIGRATION_DATABASE_URL` et restaurer vers une base vide de la même version applicative. Les sessions et caches d’idempotence ne sont pas restaurés. Les rôles de connexion sont reprovisionnés séparément.

## Vérifications

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:mobile
node --import tsx scripts/benchmark.ts
npm audit --omit=dev --audit-level=high
```

`TEST_DATABASE_URL` exécute les mêmes tests sur une base PostgreSQL 16 vierge. La suite teste aussi de véritables connexions aux identités restreintes. Le parcours Playwright vérifie deux sessions web indépendantes, la bourse/confirmation, le chat et la validation du planning. Lancer API/web, installer Chromium avec `npx playwright install chromium`, puis `npm run test:e2e`.

Voir [docs/validation.md](docs/validation.md), [docs/adr/001-foundation.md](docs/adr/001-foundation.md) et [packages/contracts/openapi.json](packages/contracts/openapi.json). Les documents source joints ne sont pas reproduits dans ce dépôt public.

## Avant une exploitation réelle

Restent la sélection et l’intégration d’un routage réel, la configuration et la qualification de la délivrabilité SMTP externe, les notifications push/email externes, la recette sur appareils, les tests de charge distribuée, les procédures d’exploitation et l’audit de sécurité. Le fournisseur d’hébergement et les prérequis RGPD/HDS/NIR doivent être validés pour les données visées. Les uploads de pièces médicales, OCR/puce et intégrations CPAM sont absents et ne peuvent pas être activés par un simple flag.

Le démarrage exige `DEMO_MODE=true` et refuse `REAL_SENSITIVE_DOCUMENTS_ENABLED=true`. Le pilote d’exploitation réel n’est donc pas déclaré terminé. Les fonctions V2 (paiements SaaS, portail établissements/patients, facturation B2, pooling, EV/solveur avancé) ne sont pas comprises dans cette démonstration.
