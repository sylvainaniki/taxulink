# Périmètre livré et portes suivantes

## Démonstration collaborative

Identités, MFA, vérification d’email/récupération de mot de passe et file SMTP chiffrée, entreprises isolées, memberships/invitations et révocation, groupes multi-entreprises sur invitation, flotte/ressources/services, contacts fictifs liés aux courses, planning manuel et heuristique équilibrée, propositions versionnées/confirmation, bourse multi-groupes avec réservation atomique puis validation propriétaire, projections de missions, conversations groupe/direct/mission, notifications in-app, retards et alertes, séries/retours, import/export/statistiques, sauvegarde/restauration et client Expo sont implémentés dans cette version.

Les tests et la CI sont les critères de livraison de cet incrément. Une fonctionnalité présente dans le code ne signifie pas qu’un service externe ou une exploitation réelle est activé.

## Avant pilote réel

1. Fournisseur de routage réel, géocodage/adresses privées et DTO de secteurs adaptés, quotas/contrats et tests terrain.
2. Qualification du SMTP externe (délivrabilité, domaine, SPF/DKIM/DMARC), recette de la récupération sur les boîtes réelles ; notifications push/email métier avec prestataires configurés ; gestion distribuée des tentatives et des événements.
3. Hébergement, HTTPS/secrets, charge distribuée, sauvegarde d’exploitation, monitoring et procédures d’incident ; revue de sécurité indépendante.
4. Validation sur vrais appareils, construction/signature et distribution des binaires Android/iOS.
5. Qualification juridique des traitements et documents de santé, contrats/HDS/NIR/conservation/AIPD si applicable. Développer/activer ensuite le module de pièces privées avec quarantaine/antivirus et grants, pas avant cette porte.

## Extensions V2 hors démonstration

Solveur avancé/pooling, autonomie EV, portail patients/établissements, abonnements et facturation, intégrations d’un éditeur CPAM certifié uniquement sur API contractuelle. Aucun de ces services ne doit être simulé comme opérationnel.

## Incrément du 4 novembre 2026

- Adresses privées avec coordonnées confirmées, matrice OSRM configurable et cache avec expiration ; les secteurs publics des offres ne révèlent pas les coordonnées privées. Sans prestataire configuré, aucune disponibilité de routage réel n’est annoncée.
- Congés, maladie et entretien des véhicules : blocage des affectations incompatibles, avertissement explicite pour les engagements existants, annulation d’indisponibilité depuis Administration.
- Demandes de transfert après panne/retard, décision du régulateur, réattribution atomique et conservation de l’historique. Une mission commencée reste figée.
- Proposition par recherche dans les fenêtres horaires, priorités et replanification, sans déplacer les missions commencées ; application versionnée et atomique.
- File de notifications email/Expo, reprises temporisées et reçus Expo, appareils liés à une session et révocables. Configuration externe et recette sur téléphone restent nécessaires. Les préférences email et appareils sont accessibles depuis Notifications.
- Préparation documentaire fictive : chiffrement, schéma privé, nettoyage des images/PDF et interface antivirus. **Les routes documentaires restent désactivées**, y compris pour les administrateurs ; ce code ne constitue pas une activation du module.

## Installation web et partage

L’interface comporte une commande d’installation et le partage du lien canonique sans jeton. Le manifeste et les icônes permettent une installation PWA sur les navigateurs compatibles, avec une aide Safari iOS. Le service worker conserve uniquement la page hors connexion et les icônes publiques : aucune page authentifiée ni réponse API n’est mise en cache. Cette installation web ne constitue pas un APK natif, ne permet pas de modifier des missions hors ligne et requiert une origine HTTPS hors localhost.

La distribution native Expo exige toujours une configuration de signature et un compte de build. Aucun binaire signé n’est livré par la compilation JavaScript Android.

## Recherche et saisie de lieux

Dans Contacts, recherche explicite d’adresses françaises et de lieux publics via IGN Géoplateforme (BAN / BD TOPO), avec sélection puis confirmation des coordonnées et d’un secteur public. La saisie manuelle reste disponible. Seul le champ de recherche dédié est envoyé au fournisseur ; aucune fiche patient n’est envoyée automatiquement. L’enregistrement d’un lieu ne garantit pas un itinéraire exploitable et n’active pas de fournisseur de routage.

Cette évolution ne constitue pas une validation pour des données médicales réelles : le pilote doit encore disposer de comptes nominatifs, d’un routage qualifié, d’une sauvegarde d’exploitation testée, d’une revue de sécurité et de conditions d’hébergement/traitement adaptées aux données prévues.

## Parcours d’exploitation du planning

Dans Contacts, le calcul de trajets IGN relie de deux à quatre points confirmés par lot. Seules les coordonnées sont envoyées, sans identité ; les durées statiques sont majorées de 25 %, stockées six heures et identifiées par leur fournisseur. Une erreur ne produit aucune durée de remplacement. Le fournisseur est limité à une matrice simultanée par processus et espace les requêtes. Les déploiements multi-instances exigent une limite distribuée avant montée en charge.

La position de départ du véhicule peut être configurée dans Équipe & flotte, avec contrôle de propriété du lieu. Optimisation permet une recherche bornée avec fenêtres horaires et replanification des missions non commencées hors délai de gel. Notifications permet de demander puis d’approuver/refuser un relais, sans modifier l’affectation avant validation serveur.

Le routage ne donne pas une garantie de circulation ni du trafic en temps réel. Le service public peut limiter les requêtes ou ne pas fournir d’itinéraire ; une recette géographique réelle reste nécessaire. Le passage aux données médicales réelles n’est toujours pas validé par ces fonctions.
