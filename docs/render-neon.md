# Démonstration sur Render et Neon

Démonstration déployée le 4 novembre 2026 sur https://taxilink-demo.onrender.com. Les 14 migrations sont appliquées sur Neon à Francfort. Les parcours de connexion, création, affectation, rechargement, géocodage et calcul routier de deux lieux publics ont été vérifiés. Cela ne valide pas un hébergement pour des données médicales réelles.

Le Blueprint `render.yaml` sélectionne explicitement le plan gratuit et un service Docker unique. Next.js écoute sur le port public fourni par Render ; l’API écoute seulement sur la boucle locale. Les données utilisent exclusivement PostgreSQL distant : aucun PGlite ni stockage local éphémère n’est accepté par ce démarrage. Les cookies HTTPS sont obligatoires.

## Préparer Neon

Créer un projet gratuit dans une région européenne et une base dédiée vide. Conserver l’URL administrative dans un gestionnaire de secrets. Vérifier les permissions de création des rôles et d’exécution des migrations de ce projet, puis exécuter le provisionnement existant sur cette base : `scripts/provision.ts` applique les migrations, crée les identités restreintes et peut charger les fixtures fictives avec un mot de passe de démonstration unique. Les rôles PostgreSQL gérés Neon et leur compatibilité avec toutes les migrations doivent être vérifiés avant publication ; aucun contrôle RLS ne doit être désactivé pour résoudre une incompatibilité.

Produire ensuite deux URL de connexion TLS distinctes : `DATABASE_URL` utilise taxilink_api, `AUTH_DATABASE_URL` utilise taxilink_auth. La base, l’hôte et le paramètre sslmode=require sont conservés. L’URL administrative et les mots de passe de provisionnement ne sont jamais configurés dans le service Render.

## Créer le service Render

Importer le Blueprint depuis la branche codex/foundation-planning du dépôt GitHub. Vérifier le choix Free et l’absence de service payant. Renseigner les deux URL runtime, WEB_ORIGIN égal à l’origine HTTPS réelle du service, et une MFA_ENCRYPTION_KEY unique de 64 caractères hexadécimaux. Le port public est fourni par Render.

SMTP et push externes restent non configurés et les documents médicaux sont bloqués. Le géocodage et le calcul routier IGN sont disponibles avec confirmation dans l’interface. Une période d’inactivité peut arrêter le service gratuit ; les tâches d’envoi ne fonctionnent pas pendant cette période. Le premier accès peut être lent. Les enregistrements sont conservés dans Neon selon ses quotas gratuits, à surveiller séparément. Tester la consommation mémoire du service combiné sur les 512 Mo du plan gratuit avant de le considérer viable.

## Recette avant partage

Vérifier le contrôle de santé public, connexion/CSRF, rôles et isolation Atlas/Horizon, création et affectation d’une course, rechargement après redémarrage, cookies Secure/HttpOnly, manifeste et icônes PWA, installation sur téléphone et partage sans jeton. Confirmer que les documents restent bloqués et que le cache hors connexion ne contient aucune donnée métier. Ne pas déclarer la recette réussie sans l’avoir effectuée sur le site réellement publié.

La démo installable par navigateur n’est pas un APK signé et ne constitue pas une autorisation pour des données médicales réelles.
