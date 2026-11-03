# Validation 0.2 — 3 novembre 2026

Le dépôt était vide au premier incrément. Les documents de cadrage ont été consultés sans être publiés.

## Contrôles locaux

- TypeScript API/contrats/tests, web et Expo.
- Formatage Prettier ; compilation Next.js de production.
- Export Android Expo/Hermes : bundle généré, sans construction ni signature d’APK.
- Tests d’intégration NestJS/Express avec PostgreSQL embarqué : isolation/RLS/RBAC, concurrence, bourse, validation propriétaire, visibilité minimale, révocations, chat, planification/équilibrage, récurrences/DST, retours, import/export, sauvegarde/restauration, sessions bearer, mots de passe et MFA.
- 50 claims simultanés sur une offre, y compris depuis deux groupes : exactement une réservation ; aucune mission finale avant confirmation.
- Benchmark synthétique 100 courses/20 chauffeurs éligibles : 100 propositions, zéro non attribuée, environ 1,8 s lors de la mesure locale sur PGlite. Cette mesure ne représente pas une matrice routière réelle ni une charge distribuée.
- Archive restaurée dans un autre moteur avec permissions intactes et aucune session restaurée ; clé erronée et base non vide refusées.

Le nombre et les résultats exacts de la dernière exécution figurent dans la PR et la CI associée. Aucun contrôle d’une version antérieure ne vaut validation du dernier commit.

## Contrôles CI

Le workflow exécute les mêmes tests sur PostgreSQL 16 et sur de véritables connexions LOGIN métier/identité restreintes, puis les compilations web et Android, le benchmark, l’audit de dépendances et les parcours Playwright desktop/390 px : création/attribution/clôture, rôles, deux entreprises indépendantes, bourse/réservation/confirmation, messagerie et application d’une proposition de planning.

Les captures restent des artefacts internes de test ; aucune validation visuelle sur téléphone physique n’est revendiquée. Le Chromium local ne peut pas être installé correctement dans l’environnement de réalisation ; la validation navigateur se fait sur le runner CI.

## Limites à conserver

- Pas de test Android/iOS sur appareil, d’APK signé, de publication store ou de déploiement utilisateur.
- Compose fourni mais non exécuté intégralement localement ; les rôles PostgreSQL sont vérifiés séparément par la CI.
- Pas de pentest, de charge multi-répliques, de routage réel, de livraison d’email/push externe ou de recette métier clinique.
- L’audit npm doit être lu avec ses détails : l’ajout d’Expo peut exposer des avis de sévérité modérée dans ses outils CLI transitifs. Aucun résultat « zéro vulnérabilité » n’est revendiqué si l’audit en liste. Le seuil CI bloque les niveaux élevé et critique.
- Les uploads médicaux et toute mise en exploitation réelle restent bloqués.
