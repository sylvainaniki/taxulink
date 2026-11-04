import { writeFileSync } from "node:fs";
import { z } from "zod";
import * as models from "./index";
import * as extended from "./extended";
import * as account from "./account";
import * as pilot from "./pilot";
import { searchInput } from "../../apps/api/src/geocoding";
const schemas: Record<string, any> = {};
for (const name of [
  "loginInput",
  "registerInput",
  "joinInput",
  "vehicleInput",
  "driverInput",
  "courseInput",
  "assignmentInput",
  "invitationInput",
  "acceptInput",
  "groupInput",
  "statusInput",
] as const) {
  const json = z.toJSONSchema(models[name]);
  delete json.$schema;
  schemas[name] = json;
}
for (const [name, schema] of Object.entries({
  ...extended,
  ...account,
  ...pilot,
})) {
  const json = z.toJSONSchema(schema);
  delete json.$schema;
  schemas[name] = json;
}
schemas.addressSearchInput = z.toJSONSchema(searchInput);
const paths: Record<string, any> = {};
function add(
  path: string,
  method: string,
  summary: string,
  body?: string,
  publicRoute = false,
) {
  const parameters: any[] = [];
  if (
    !publicRoute &&
    !path.startsWith("/auth/") &&
    path !== "/invitations/accept"
  )
    parameters.push({
      name: "X-Tenant-Id",
      in: "header",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  if (path.includes("{id}"))
    parameters.push({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  if (path === "/courses" && method === "get")
    parameters.push({
      name: "date",
      in: "query",
      schema: { type: "string", format: "date" },
      description: "Journée locale Europe/Paris. Liste limitée à 500 missions.",
    });
  if (method === "post" && !publicRoute) {
    parameters.push({
      name: "X-CSRF-Token",
      in: "header",
      required: true,
      schema: { type: "string" },
    });
    if (!path.startsWith("/auth") && path !== "/invitations/accept")
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 8, maxLength: 100 },
      });
  }
  const status =
    method === "get" ||
    path === "/auth/login" ||
    path === "/auth/mobile-login" ||
    path === "/auth/change-password" ||
    path === "/auth/logout" ||
    path === "/invitations/accept"
      ? "200"
      : "201";
  const op: any = {
    summary,
    security: publicRoute ? [] : [{ sessionCookie: [] }, { mobileBearer: [] }],
    parameters,
    responses: {
      [status]: {
        description: "Résultat confirmé par le serveur",
        content: { "application/json": { schema: {} } },
      },
      "400": {
        description: "Entrée ou référence invalide",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      "401": { description: "Session absente ou expirée" },
      "403": { description: "Accès, CSRF ou origine refusés" },
      "404": { description: "Ressource absente ou invisible" },
      "409": {
        description: "Version périmée, conflit ou clé idempotente réutilisée",
      },
      "422": {
        description:
          "Course impossible : SHIFT_CONFLICT, BREAK_CONFLICT, TIME_WINDOW_CONFLICT, RESOURCE_CONFLICT, TRANSFER_CONFLICT, VEHICLE_INCOMPATIBLE ou ROUTE_UNAVAILABLE",
      },
      "429": { description: "Limite de tentatives de connexion atteinte" },
    },
  };
  if (body)
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/" + body },
        },
      },
    };
  else if (method === "post")
    op.requestBody = {
      required: true,
      content: {
        "application/json": { schema: { type: "object", maxProperties: 0 } },
      },
    };
  (paths[path] ||= {})[method] = op;
}
add("/health", "get", "État de la démonstration", undefined, true);
add(
  "/auth/register",
  "post",
  "Créer une entreprise de démonstration",
  "registerInput",
  true,
);
add(
  "/auth/login",
  "post",
  "Ouvrir une session de huit heures",
  "loginInput",
  true,
);
add("/auth/me", "get", "Compte, memberships actifs et jeton CSRF");
add(
  "/auth/password/request",
  "post",
  "Demander un lien de récupération, réponse uniforme",
  "accountEmailInput",
  true,
);
add(
  "/auth/password/reset",
  "post",
  "Changer le mot de passe par lien et MFA, révoquer les sessions",
  "resetPasswordInput",
  true,
);
add(
  "/auth/email/request",
  "post",
  "Renvoyer la vérification de l’adresse email",
);
add(
  "/auth/email/verify",
  "post",
  "Vérifier l’adresse par lien à usage unique",
  "accountTokenInput",
  true,
);
for (const path of [
  "/auth/password/request",
  "/auth/password/reset",
  "/auth/email/request",
  "/auth/email/verify",
]) {
  paths[path].post.responses["200"] = paths[path].post.responses["201"];
  delete paths[path].post.responses["201"];
  paths[path].post.responses["503"] = {
    description: "Envoi d’email non configuré",
  };
}
add("/auth/logout", "post", "Révoquer la session courante");
add("/locations", "get", "Catalogue des lieux fictifs");
add("/drivers", "get", "Chauffeurs autorisés");
add("/drivers", "post", "Créer un chauffeur et un service", "driverInput");
add("/vehicles", "get", "Véhicules de l’entreprise");
add("/vehicles", "post", "Créer un véhicule", "vehicleInput");
add("/courses", "get", "Planning selon entreprise, rôle et date");
add("/courses", "post", "Créer une course", "courseInput");
add("/courses/{id}", "get", "Lire une mission autorisée");
add(
  "/courses/{id}/assign",
  "post",
  "Attribuer après validation de faisabilité",
  "assignmentInput",
);
add(
  "/courses/{id}/status",
  "post",
  "Changer le statut avec contrôle de version",
  "statusInput",
);
add("/groups", "get", "Groupes accessibles");
add("/groups", "post", "Créer un groupe privé", "groupInput");
add("/invitations", "get", "Lister les invitations sans code");
add(
  "/invitations",
  "post",
  "Créer un code temporaire montré une seule fois",
  "invitationInput",
);
add("/invitations/{id}/revoke", "post", "Révoquer une invitation");
add(
  "/invitations/accept",
  "post",
  "Accepter une invitation liée à son email",
  "acceptInput",
);
add("/audit", "get", "Cent derniers événements de sécurité de l’entreprise");
add(
  "/auth/mobile-login",
  "post",
  "Ouvrir une session mobile bearer",
  "loginInput",
  true,
);
add(
  "/auth/change-password",
  "post",
  "Changer le mot de passe et révoquer toutes les sessions",
  "passwordInput",
);
for (const [path, summary] of [
  ["company", "Entreprise active"],
  ["members", "Membres et droits administrateur"],
  ["people", "Collaborateurs actifs de son entreprise"],
  ["contacts", "Clients et établissements de son entreprise"],
  ["shifts", "Services des chauffeurs"],
  ["offers", "Offres minimales des groupes autorisés"],
  ["network-invitations", "Invitations de réseau reçues"],
  ["notifications", "Notifications personnelles"],
  ["alerts", "Alertes opérationnelles"],
  ["analytics", "Indicateurs de l’entreprise"],
  ["recurrences", "Séries de courses"],
  ["pending-returns", "Retours dont l’horaire reste inconnu"],
  ["plans", "Propositions de planning"],
  ["conversations", "Conversations autorisées"],
])
  add("/" + path, "get", summary);
add("/auth/policy", "get", "Politique d’accès du pilote", undefined, true);
add(
  "/auth/join",
  "post",
  "Créer son compte depuis une invitation",
  "joinInput",
  true,
);
const writes = [
  ["/members/{id}/update", "memberInput"],
  ["/contacts", "contactInput"],
  ["/contacts/{id}/update", "contactUpdateInput"],
  ["/shifts", "shiftInput"],
  ["/drivers/{id}/update", "driverInput"],
  ["/vehicles/{id}/update", "vehicleUpdateInput"],
  ["/courses/{id}/update", "courseUpdateInput"],
  ["/courses/{id}/unassign", "versionInput"],
  ["/courses/{id}/return", "returnInput"],
  ["/courses/{id}/delay", "delayInput"],
  ["/offers", "offerInput"],
  ["/offers/{id}/claim", "claimInput"],
  ["/offers/{id}/decision", "decisionInput"],
  ["/groups/{id}/invite", "companyTargetInput"],
  ["/groups/{id}/invite-code", "networkCodeInput"],
  ["/groups/{id}/remove-member", "companyTargetInput"],
  ["/groups/{id}/messages", "messageInput"],
  ["/conversations", "conversationInput"],
  ["/conversations/{id}/messages", "messageInput"],
  ["/recurrences", "recurrenceInput"],
  ["/plans/propose", "planInput"],
  ["/imports/preview", "importInput"],
  ["/imports/courses", "importInput"],
];
writes.push(
  ["/addresses/search", "addressSearchInput"],
  ["/locations", "locationInput"],
  ["/routing/refresh", "routingInput"],
  ["/absences", "absenceInput"],
  ["/courses/{id}/transfer-request", "transferInput"],
  ["/transfers/{id}/decision", "transferDecisionInput"],
);
for (const path of [
  "/routing/status",
  "/routing/cache",
  "/absences",
  "/transfers",
  "/settings",
  "/notification-settings",
])
  add(path, "get", path);
for (const path of ["/absences/{id}/cancel", "/devices/{id}/remove"])
  add(path, "post", path);
for (const [path, body] of writes) add(path, "post", path, body);
for (const path of [
  "/network-invitations/{id}/accept",
  "/notifications/{id}/read",
  "/alerts/{id}/resolve",
  "/recurrences/{id}/generate",
  "/recurrences/{id}/stop",
  "/plans/{id}/apply",
])
  add(path, "post", path);
for (const path of [
  "/groups/{id}/members",
  "/groups/{id}/messages",
  "/conversations/{id}/messages",
  "/exports/courses",
])
  add(path, "get", path);
paths["/offers"].get.responses["200"].content["application/json"].schema = {
  type: "array",
  items: { $ref: "#/components/schemas/offerOutput" },
};
paths["/courses"].get.responses["200"].content["application/json"].schema = {
  type: "array",
  items: { $ref: "#/components/schemas/courseOutput" },
};
paths["/courses/{id}"].get.responses["200"].content["application/json"].schema =
  { $ref: "#/components/schemas/courseOutput" };
for (const [path, properties] of [
  ["/auth/mfa/enroll", { password: { type: "string", maxLength: 128 } }],
  ["/auth/mfa/confirm", { code: { type: "string", pattern: "^[0-9]{6}$" } }],
  [
    "/auth/mfa/disable",
    {
      password: { type: "string", maxLength: 128 },
      code: { type: "string", pattern: "^[0-9]{6}$" },
      recovery_code: { type: "string" },
    },
  ],
] as const) {
  add(path, "post", path);
  paths[path].post.requestBody = {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", properties, additionalProperties: false },
      },
    },
  };
  paths[path].post.responses["200"] = paths[path].post.responses["201"];
  delete paths[path].post.responses["201"];
}
schemas.Error = {
  type: "object",
  required: ["code"],
  properties: {
    code: { type: "string" },
    fields: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};
writeFileSync(
  "packages/contracts/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "TAXI LINK — prototype fondation",
        version: "0.2.0",
        description:
          "Contrat des routes livrées. Entrées générées depuis Zod. DTO des courses et des offres explicitement typés, avec projection réseau minimale. Données fictives seulement ; documents et production désactivés.",
      },
      servers: [{ url: "http://localhost:4000/api/v1" }],
      paths,
      components: {
        securitySchemes: {
          mobileBearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "opaque",
          },
          sessionCookie: { type: "apiKey", in: "cookie", name: "tl_session" },
        },
        schemas,
      },
    },
    null,
    2,
  ) + "\n",
);
