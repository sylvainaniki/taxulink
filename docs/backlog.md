# Périmètre livré et portes suivantes

## Démonstration collaborative

Identités, MFA, entreprises isolées, memberships/invitations et révocation, groupes multi-entreprises sur invitation, flotte/ressources/services, contacts fictifs liés aux courses, planning manuel et heuristique équilibrée, propositions versionnées/confirmation, bourse multi-groupes avec réservation atomique puis validation propriétaire, projections de missions, conversations groupe/direct/mission, notifications in-app, retards et alertes, séries/retours, import/export/statistiques, sauvegarde/restauration et client Expo sont implémentés dans cette version.

Les tests et la CI sont les critères de livraison de cet incrément. Une fonctionnalité présente dans le code ne signifie pas qu’un service externe ou une exploitation réelle est activé.

## Avant pilote réel

1. Fournisseur de routage réel, géocodage/adresses privées et DTO de secteurs adaptés, quotas/contrats et tests terrain.
2. Vérification d’email et récupération du compte par canal délivré ; notifications push/email avec prestataires configurés ; gestion distribuée des tentatives et des événements.
3. Hébergement, HTTPS/secrets, charge distribuée, sauvegarde d’exploitation, monitoring et procédures d’incident ; revue de sécurité indépendante.
4. Validation sur vrais appareils, construction/signature et distribution des binaires Android/iOS.
5. Qualification juridique des traitements et documents de santé, contrats/HDS/NIR/conservation/AIPD si applicable. Développer/activer ensuite le module de pièces privées avec quarantaine/antivirus et grants, pas avant cette porte.

## Extensions V2 hors démonstration

Solveur avancé/pooling, autonomie EV, portail patients/établissements, abonnements et facturation, intégrations d’un éditeur CPAM certifié uniquement sur API contractuelle. Aucun de ces services ne doit être simulé comme opérationnel.
