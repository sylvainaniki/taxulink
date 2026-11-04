# ADR 006 — Routage, exploitation et notifications de démonstration

Le routage utilise une interface injectable et une matrice OSRM configurable. Le fournisseur ne reçoit que les points nécessaires ; les projections de bourse restent limitées aux secteurs jusqu’à confirmation. Le cache expire et une marge configurable majore les durées statiques. Le trafic réel et le géocodage automatique ne sont pas fournis.

Les indisponibilités et transferts complètent les contraintes du planning ; les décisions modifient les affectations dans une transaction et refusent une version périmée. La recherche avancée reste bornée en temps.

Les notifications externes sont optionnelles. Le texte ne contient pas de passager ; les jetons Expo sont chiffrés, liés à une session et revérifiés au moment de l’envoi. Les échecs font l’objet de reprises limitées et les reçus sont vérifiés séparément. Une panne après envoi mais avant commit peut produire un doublon : cette file garantit une tentative renouvelable, pas une livraison exactement une fois.

Le module documentaire demeure inaccessible par HTTP. Les composants préparatoires et migrations ne valent ni activation ni validation pour des données réelles.
