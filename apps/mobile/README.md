# TAXI LINK — client chauffeur Expo

Client TypeScript/React Native : connexion avec MFA/recovery, missions personnelles, statuts, retards, bourse privée, confirmation pour les responsables et conversations de groupe/mission.

1. Depuis la racine : `npm ci`, configuration/seed et démarrage API selon le README principal.
2. Copier `.env.example` vers `.env` **dans apps/mobile**, puis renseigner `EXPO_PUBLIC_API_URL` avec l’adresse joignable depuis le téléphone, par exemple l’adresse LAN de la machine pendant le développement fictif. `localhost` sur un téléphone désigne ce téléphone.
3. `npm run dev:mobile` depuis la racine, puis ouvrir le projet avec Expo Go compatible SDK 58 ou une application de développement.
4. Pour vérifier le bundle : `npm run build:mobile`.

La session opaque est conservée dans SecureStore, sans mot de passe. Le cache chiffré par le système conserve au maximum trois résumés de missions, sans noms/téléphones de passagers ni messages. Il est supprimé au changement d’entreprise et à la déconnexion. Les mutations sont bloquées hors ligne et les accès réévalués lors de la synchronisation. Le client ne géolocalise pas le chauffeur et n’accède pas à ses photos.

`eas.json` décrit un build Android APK de test interne. Pour créer un binaire signé : configurer son compte EAS, l’URL HTTPS de son serveur et ses identifiants de signature, puis lancer le build depuis ce répertoire. Le bundle exporté ne constitue pas un APK ni une preuve de fonctionnement sur appareil ; Android/iOS et l’effacement du cache doivent être recettés sur de vrais téléphones avant diffusion.

Aucune publication store ou installation sur le téléphone de l’utilisateur n’a été réalisée. Données fictives uniquement ; aucun document médical réel.
