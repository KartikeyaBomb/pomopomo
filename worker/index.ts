import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const migrationEnv=env as unknown as { MIGRATION_DESTINATION?: string; DB?: D1Database };
    if(migrationEnv.MIGRATION_DESTINATION && new URL(request.url).pathname!=='/api/migration') {
      const row=await migrationEnv.DB?.prepare("SELECT value FROM hosting_migration WHERE key='frozen'").first<{value:string}>().catch(()=>null);
      if(row?.value==='1') { const destination=new URL(migrationEnv.MIGRATION_DESTINATION);const source=new URL(request.url);destination.pathname=source.pathname;destination.search=source.search;return Response.redirect(destination.toString(),307); }
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
