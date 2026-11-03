# Reprise et critères des prochains incréments

## Socle livré dans cette PR

US-001 : inscription prototype et entreprise isolée. US-002 : invitations de collaborateurs, expiration/révocation/acceptation (vérification email et changement de mot de passe restent ouverts). US-003 : RLS et RBAC sur les routes livrées ; séparation des comptes PostgreSQL avant pilote. US-004 : création/lecture de groupes uniquement. US-005 : création ressources et un service par chauffeur. US-006/007/008/009 : courses, liste journalière, affectation manuelle et visibilité chauffeur. US-021 : web responsive. US-022 : monorepo web/API, SQL, fixtures, CI et documentation ; Expo/E2E et validation Docker restent ouverts.

## Suite ordonnée

1. **Compléter lots 0–1** : séparation des rôles PostgreSQL, comptes vérifiés/OIDC/MFA, mot de passe oublié, administration memberships et révocation, rattachement chauffeur utilisateur, édition ressources, services multi-jours et pauses web, membres de groupe sur invitation, E2E desktop/mobile, CI PostgreSQL verte, test Compose et restauration. DoD : aucun défaut d’isolement, tests des refus et révocations, parcours utilisateurs démontrés, restauration vérifiée.
2. **Lot 2** : offres DTO stricts sans identité, réservation puis validation propriétaire par défaut, acceptation atomique/idempotente, expiration/retrait et grant minimal après acceptation, conversations ACL, outbox et notifications in-app. DoD : 50 claims sur une offre → 1 gagnant, aucun accès cross-group, aucune mission confirmée avant confirmation serveur.
3. **Lot 3** : matrice routière réelle sous contrat, heuristique explicable, propositions versionnées puis confirmation, contraintes R-001 à R-015, tests de charge et cas impossibles. DoD : aucune durée inventée, aucune réaffectation des courses commencées, refus des snapshots périmés.
4. **Lot 4+** : clients/établissements minimisés, récurrences, retours inconnus, retards et replanification, Expo et synchronisation. Pièces réelles uniquement après gate technique/juridique formalisé et développement du module privé.

Aucun devis ferme ou délai total déduit d’une session de code. L’estimation de cadrage reste celle du dossier source ; cette tranche ne représente pas l’ensemble de ses lots. Pas de nouveaux services payants avant choix explicite.
