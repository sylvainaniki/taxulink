# État de livraison — 4 novembre 2026

Adresse de démonstration : https://taxilink-demo.onrender.com

## Vérifications effectuées

- 73 tests locaux, TypeScript, formatage et compilation web réussis pour l’incrément d’exploitation. CI du commit 51a226c verte : https://github.com/sylvainaniki/taxulink/actions/runs/41797892249 (PGlite, PostgreSQL, Docker, navigateur, mobile).
- Connexion Atlas, création et affectation d’une mission, rechargement avec conservation des données.
- Recherche et enregistrement de lieux publics : Place du Capitole et Hôpital Purpan, Toulouse.
- Calcul routier IGN dans les deux sens, source explicitement affichée : 22 min / 5,1 km dans un sens et 21 min / 5,8 km dans l’autre lors de l’essai, marge de 25 % incluse. Ces valeurs ne sont pas des garanties pour une course future.
- Création de DEMO-IGN-TRAJET à 16 h, affectation à Camille 2 / véhicule démo 2 après configuration de leurs départs sur le lieu confirmé.
- Demande puis refus d’un relais ; calcul d’une proposition avec fenêtres horaires sans application automatique.
- Affichage vérifié à 390 px lors de la livraison initiale ; installation sur appareil physique à recetter.

## Périmètre documentaire corrigé

Les seules pièces prévues sont les bons de transport (BT) et, au besoin, une photo de la mutuelle. Aucun dossier clinique, carte Vitale, attestation de droits, catégorie libre ou autre justificatif. BT : PDF/JPEG/PNG ; mutuelle : JPEG/PNG uniquement. Le module préparatoire refuse les autres catégories. La route de dépôt reste désactivée sur Render/Neon Free : cette réduction ne valide pas le traitement des données réelles.

## Accès du pilote

Inscription publique fermée par défaut, création de compte par invitation nominative (48 h, révocable, usage unique). Plafond global de 10 personnes actives, y compris administrateurs et comptes de démonstration. Les inscriptions simultanées sont sérialisées ; un refus de capacité ne consomme ni invitation ni compte. Aucun compte patient prévu.

## Portes restantes avant données patients réelles

| Élément | État |
| --- | --- |
| Hébergement et conditions de traitement adaptés aux données de santé prévues | Non validés ; aucun statut HDS revendiqué pour Render/Neon Free |
| Comptes nominatifs et MFA des utilisateurs du pilote | Fonctions présentes, utilisateurs réels à enrôler ; comptes partagés réservés à la démo |
| Sauvegardes d’exploitation externalisées et restauration opérationnelle | CLI chiffrée et tests de restauration présents ; service planifié externe non configuré |
| SMTP / délivrabilité / récupération vers boîtes réelles | Non configurés |
| Push sur téléphone physique | Code présent, configuration et recette nécessaires |
| Routage des tournées complètes et contraintes terrain | Parcours de deux points publics testé ; qualification terrain restante |
| Revue de sécurité indépendante et procédures d’incident | Non réalisées |
| APK signé / distribution native | Non livré ; PWA web installable disponible |
| BT et photos de mutuelle réels | Dépôt désactivé ; stockage et conditions d’exploitation à valider |

Les offres gratuites peuvent interrompre le service après inactivité ou quota. Ce document ne déclare pas une version d’exploitation médicale finale. La saisie manuelle des données ne remplace pas les validations et contrats nécessaires. Aucun changement de variable ne doit être présenté comme une certification ou une recette.
