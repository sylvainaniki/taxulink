# Pilote commun sans documents — préparation Scalingo

## État

Configuration et démarrage préparés dans le dépôt ; aucune ressource Scalingo créée, aucun abonnement engagé, aucune donnée réelle migrée. La démonstration Render/Neon reste distincte et fictive. Le passage en exploitation réelle exige une revue du périmètre HDS, du contrat, des comptes, de la sauvegarde et de la recette ; les contrôles de configuration ne constituent pas une certification.

## Coût de référence

Sur 30 jours, région standard : deux conteneurs M de 512 Mo à 14,40 € HT chacun + PostgreSQL Business 512 Mo / 10 Go à 20 € HT = 48,80 € HT, soit 58,56 € TTC à 20 %. Le fournisseur impose deux conteneurs web minimum pour HDS et une base Business/Enterprise. Enveloppe indicative 70–90 € TTC avec marge, hors maintenance/audit. Vérifier les prix à la commande et mesurer la mémoire avant de garantir ce dimensionnement. Passer les deux conteneurs à 1 Go ajoute 28,80 € HT/mois et nécessite une nouvelle validation du budget.

## Déploiement préparé

- Créer une application avec l’option HDS dès l’origine, dans une région prévue au contrat. L’utilisateur accepte lui-même les conditions et renseigne son moyen de paiement et le contact HDS.
- Sélectionner le dépôt `sylvainaniki/taxulink`, branche `codex/foundation-planning`, à la racine du monorepo. Le buildpack Node lance `scalingo-postbuild`; `Procfile` démarre le superviseur web/API sur le port fourni par la plateforme.
- Node.js doit être une version supportée par le fournisseur et satisfaisant `engines` ; la version déployée doit passer la CI. `tsx` est une dépendance de production car l’API démarre depuis TypeScript.
- Provisionner une base PostgreSQL Business HDS séparée de Neon. Avant migration, valider les privilèges disponibles et la capacité de créer les rôles restreints. Vérifier aussi que le propriétaire des fonctions `SECURITY DEFINER` peut exécuter les opérations interentreprises prévues malgré la RLS forcée ; une migration qui termine sans erreur ne suffit pas. Les utilisateurs fournis par défaut par Scalingo disposent de privilèges larges : ne jamais les utiliser comme identités du serveur web. Si les migrations/grants nécessaires ne sont pas disponibles, arrêter et faire valider la configuration par le support, sans supprimer la RLS ni élargir les droits.
- Exécuter `scripts/provision.ts` dans un contexte administratif ponctuel, avec `MIGRATION_DATABASE_URL`, `API_DB_PASSWORD` et `AUTH_DB_PASSWORD`, sans `DEMO_PASSWORD`. Les migrations créent le schéma ; aucun jeu de démonstration n’est importé.
- Renseigner les variables de `docs/scalingo.env.example` dans le coffre de la plateforme. Générer deux clés distinctes de 32 octets en hexadécimal. Configurer un SMTP TLS avec domaine expéditeur vérifié. N’envoyer par email que les liens de compte et alertes génériques, sans informations patients.
- Retirer la connexion propriétaire injectée `SCALINGO_POSTGRESQL_URL` de l’environnement applicatif après provisionnement si la plateforme le permet ; à défaut ne pas mettre en exploitation avant résolution de cette exposition. Le superviseur la retire aussi des processus web/API. Ne conserver aucun identifiant de migration/bootstrap dans les variables permanentes de l’application.
- Créer l’administrateur de chaque entreprise avec `scripts/bootstrap-company.ts` dans un contexte administratif ponctuel : `MIGRATION_DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_COMPANY`. Ces valeurs sont saisies dans un contexte secret, jamais dans le dépôt ni dans une commande affichée. Chaque société reçoit son propre tenant ; plafond global de dix personnes. Le compte démarre sans validation d’email, ni activation MFA ; ces étapes restent à réaliser par son propriétaire.
- Le superviseur retire tous les identifiants de migration et bootstrap des processus web/API. L’inscription publique et toutes les routes documentaires restent fermées. Aucun BT, photo ni lien documentaire ne doit être transféré dans les messages.

## Avant ouverture aux utilisateurs réels

Exécuter `npm run doctor` avec les variables applicatives du pilote (ou `npm run doctor -- --json` pour un résultat structuré). Corriger tous les contrôles en échec avant le démarrage. Ce contrôle reste hors ligne : il ne prouve ni la disponibilité des services, ni leurs permissions réelles, ni la conformité du déploiement.

Vérifier : validation d’email et récupération ; MFA des administrateurs ; rôles et séparation entre deux sociétés ; sauvegarde automatique et restauration dans une base isolée ; absence d’identifiants privilégiés dans le runtime ; journaux sans données sensibles ; quotas routage ; tests simultanés ; mémoire des deux instances ; procédure de révocation et d’incident. Le serveur ne doit pas être présenté comme prêt avant ces validations.

Les sauvegardes quotidiennes/PITR du fournisseur sont à contrôler dans le compte. Le CLI `scripts/backup.ts` existe pour des exports chiffrés ; un fichier écrit dans un conteneur éphémère n’est pas une sauvegarde durable. Toute copie supplémentaire doit utiliser une destination adaptée et couverte par les conditions requises.

## Références fournisseur

- https://scalingo.com/pricing
- https://doc.scalingo.com/platform/hds
- https://doc.scalingo.com/platform/app/lifecycle-management
- https://doc.scalingo.com/languages/nodejs/start
- https://doc.scalingo.com/databases/postgresql/shared-resources/guides/managing-users
