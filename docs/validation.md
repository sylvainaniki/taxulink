# Validation de l’incrément initial — 3 novembre 2026

## Vérifications réalisées

- Dossier Word de consultation extrait ; même contenu dans les deux versions Word jointes. Dépôt GitHub vide au démarrage.
- Migration SQL appliquée, puis rejouée sans effet ; fixtures fictives écrites et API démarrée sur le répertoire persistant PGlite.
- `npm run typecheck` : vérification du backend, contrats, tests et interface.
- `npm test` : 25 cas API/règles métier. Une requête traverse NestJS/Express avec injection HTTP en mémoire et PostgreSQL embarqué avec RLS. Aucun mock de la base ni des permissions.
- Course : 50 affectations concurrentes donnent une seule réponse de succès et 49 refus de version/concurrence. Ceci ne constitue pas le test du futur claim d’offre réseau.
- Conflits chauffeur/véhicule, routage expiré, délais entre missions, pauses, services, capacité, transitions/versionnement, clé d’idempotence, invitations, révocation, permissions et RLS couverts.
- `npm run lint` : formatage Prettier.
- `npm run build` : compilation Next.js de production.
- Smoke HTTP réel : route santé testée sur un port éphémère, réponse 200 avec documents désactivés.
- `npm audit --omit=dev --audit-level=high` : aucune vulnérabilité de dépendance de production signalée après mises à jour.

Les résultats exacts de la dernière exécution sont indiqués dans la pull request. La CI répète les contrôles et ajoute les tests PostgreSQL 16, un contrôle des dépendances et le parcours navigateur.

## Vérifications non acquises localement

- Le navigateur Chromium n’est pas installé dans l’environnement. `npx playwright install chromium` reçoit une archive non exploitable ; aucune capture ou validation visuelle desktop/mobile n’est présentée comme réussie. Le parcours `tests/e2e.mjs` est fourni et doit passer en CI ou sur une machine équipée : connexion, création, affectation, transitions, responsive sans débordement, déconnexion, compte chauffeur.
- Docker et le serveur PostgreSQL natif ne sont pas disponibles localement. Compose, migration PostgreSQL réseau et concurrence entre plusieurs processus restent à exécuter hors PGlite ; le workflow CI est prévu pour PostgreSQL 16.
- Pas de test de charge, de restauration, de pentest, d’Expo sur appareil, d’offline, d’identité MFA ni de production.

## Limites connues

Le runtime est volontairement bloqué en démonstration. Le compte propriétaire de base n’est pas encore séparé du compte d’identité ; voir ADR-002. Les trajets sont synthétiques. Un service unique par chauffeur est exposé. Les sorties OpenAPI ne sont pas encore suffisamment typées pour générer un SDK. La bourse, les fichiers et les fonctions P1/P2 restent absents.

Les scripts de test navigateur nécessitent une base de démonstration vierge au premier passage ; ils ajoutent une mission `DEMO-E2E`. Ne pas les exécuter sur un environnement d’exploitation.
