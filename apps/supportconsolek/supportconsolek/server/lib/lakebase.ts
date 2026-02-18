import pg from "pg";
import { WorkspaceClient } from "@databricks/sdk-experimental";

const CACHE_BUFFER_MS = 2 * 60 * 1000;

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface CredentialResponse {
  token: string;
  expire_time: string;
}

function isCredentialResponse(value: unknown): value is CredentialResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.token === "string" && typeof obj.expire_time === "string";
}

async function fetchOAuthToken(
  workspaceClient: WorkspaceClient,
  endpoint: string,
): Promise<TokenCache> {
  const response: unknown = await workspaceClient.apiClient.request({
    path: "/api/2.0/postgres/credentials",
    method: "POST",
    headers: new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    raw: false,
    payload: { endpoint },
  });

  if (!isCredentialResponse(response)) {
    throw new Error(
      `Invalid credential response from Databricks API: ${JSON.stringify(response)}`,
    );
  }

  return {
    token: response.token,
    expiresAt: new Date(response.expire_time).getTime(),
  };
}

function createPasswordCallback(
  workspaceClient: WorkspaceClient,
  endpoint: string,
): () => Promise<string> {
  let cached: TokenCache | null = null;
  let refreshPromise: Promise<string> | null = null;

  return async (): Promise<string> => {
    const now = Date.now();
    if (cached && now < cached.expiresAt - CACHE_BUFFER_MS) {
      return cached.token;
    }

    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const result = await fetchOAuthToken(workspaceClient, endpoint);
          cached = result;
          return result.token;
        } finally {
          refreshPromise = null;
        }
      })();
    }

    return refreshPromise;
  };
}

async function resolveUsername(workspaceClient: WorkspaceClient): Promise<string> {
  const envUser = process.env.PGUSER;
  if (envUser) return envUser;
  const me = await workspaceClient.currentUser.me();
  if (!me.userName) {
    throw new Error("Could not determine Lakebase username. Set PGUSER.");
  }
  return me.userName;
}

export async function createLakebasePool(): Promise<pg.Pool> {
  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE ?? "databricks_postgres";
  const endpoint = process.env.LAKEBASE_ENDPOINT;
  const sslMode = process.env.PGSSLMODE ?? "require";
  const port = process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432;

  if (!host) throw new Error("PGHOST is required");
  if (!endpoint) throw new Error("LAKEBASE_ENDPOINT is required");

  const workspaceClient = new WorkspaceClient({
    host: process.env.DATABRICKS_HOST,
    ...(process.env.DATABRICKS_CONFIG_PROFILE && {
      profile: process.env.DATABRICKS_CONFIG_PROFILE,
    }),
  });
  const user = await resolveUsername(workspaceClient);

  const pool = new pg.Pool({
    host,
    port,
    database,
    user,
    password: createPasswordCallback(workspaceClient, endpoint),
    ssl: sslMode === "require" ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("[lakebase] Pool error:", error.message);
  });

  return pool;
}
