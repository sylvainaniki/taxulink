import { writeFileSync } from "node:fs";
import { z } from "zod";
import * as models from "./index";
const schemas: Record<string, any> = {};
for (const name of [
  "loginInput",
  "registerInput",
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
    path === "/auth/logout" ||
    path === "/invitations/accept"
      ? "200"
      : "201";
  const op: any = {
    summary,
    security: publicRoute ? [] : [{ sessionCookie: [] }],
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
        version: "0.1.0",
        description:
          "Contrat des routes livrées. Inputs stricts générés depuis Zod. Les DTO de sortie détaillés restent à typer avant génération de clients. Données fictives seulement ; documents et production désactivés.",
      },
      servers: [{ url: "http://localhost:4000/api/v1" }],
      paths,
      components: {
        securitySchemes: {
          sessionCookie: { type: "apiKey", in: "cookie", name: "tl_session" },
        },
        schemas,
      },
    },
    null,
    2,
  ) + "\n",
);
