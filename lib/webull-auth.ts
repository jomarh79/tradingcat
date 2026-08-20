import { supabaseAdmin } from "./supabase-admin";
import {
  generateNonce,
  generateTimestamp,
  signWebullRequest,
} from "./webull-signature";

const APP_KEY = process.env.WEBULL_APP_KEY;
const APP_SECRET = process.env.WEBULL_KEY_APP_SECRET;

const WEBULL_BASE_URL =
  process.env.WEBULL_API_URL || "https://api.webull.com";

const TOKEN_CREATE_PATH = "/openapi/auth/token/create";
const TOKEN_CHECK_PATH = "/openapi/auth/token/check";

type WebullTokenStatus =
  | "PENDING"
  | "NORMAL"
  | "INVALID"
  | "EXPIRED";

interface WebullTokenResponse {
  token: string;
  expires: number;
  status: WebullTokenStatus;
}

interface WebullErrorResponse {
  error_code?: string;
  message?: string;
}

if (!APP_KEY) {
  throw new Error("WEBULL_APP_KEY no está configurado");
}

if (!APP_SECRET) {
  throw new Error("WEBULL_KEY_APP_SECRET no está configurado");
}

/**
 * Construye los headers necesarios para Webull.
 */
function createWebullHeaders(
  path: string,
  body = "",
  accessToken?: string
) {
  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = signWebullRequest({
    path,
    host: new URL(WEBULL_BASE_URL).host,
    appKey: APP_KEY!,
    appSecret: APP_SECRET!,
    timestamp,
    nonce,
    body,
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-app-key": APP_KEY!,
    "x-timestamp": timestamp,
    "x-signature-version": "1.0",
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": nonce,
    "x-version": "v2",
    "x-signature": signature,
  };

  if (accessToken) {
    headers["x-access-token"] = accessToken;
  }

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

/**
 * Llama a Create Token de Webull.
 */
export async function createWebullToken(): Promise<WebullTokenResponse> {
  const body = JSON.stringify({});

  const headers = createWebullHeaders(
    TOKEN_CREATE_PATH,
    body
  );

  // Create Token requiere JSON.
  headers["Content-Type"] = "application/json";

  const response = await fetch(
    `${WEBULL_BASE_URL}${TOKEN_CREATE_PATH}`,
    {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    }
  );

  const data =
    (await response.json()) as
      | WebullTokenResponse
      | WebullErrorResponse;

  if (!response.ok) {
    const error = data as WebullErrorResponse;

    throw new Error(
      `Webull Create Token ${response.status}: ${
        error.message || JSON.stringify(data)
      }`
    );
  }

  return data as WebullTokenResponse;
}

/**
 * Guarda el token en Supabase.
 */
async function saveWebullToken(
  tokenData: WebullTokenResponse
) {
  const { error } = await supabaseAdmin
    .from("webull_auth")
    .upsert(
      {
        id: 1,
        access_token: tokenData.token,
        status: tokenData.status,
        expires_at: tokenData.expires,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "id",
      }
    );

  if (error) {
    throw new Error(
      `Error guardando token Webull en Supabase: ${error.message}`
    );
  }
}

/**
 * Obtiene el token almacenado en Supabase.
 */
async function getStoredWebullToken() {
  const { data, error } = await supabaseAdmin
    .from("webull_auth")
    .select(
      "id, access_token, status, expires_at, updated_at"
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Error leyendo token Webull: ${error.message}`
    );
  }

  return data;
}

/**
 * Comprueba el estado de un token.
 */
export async function checkWebullToken(
  token: string
): Promise<WebullTokenResponse> {
  const body = JSON.stringify({
    token,
  });

  const headers = createWebullHeaders(
    TOKEN_CHECK_PATH,
    body
  );

  const response = await fetch(
    `${WEBULL_BASE_URL}${TOKEN_CHECK_PATH}`,
    {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    }
  );

  const data =
    (await response.json()) as
      | WebullTokenResponse
      | WebullErrorResponse;

  if (!response.ok) {
    const error = data as WebullErrorResponse;

    throw new Error(
      `Webull Check Token ${response.status}: ${
        error.message || JSON.stringify(data)
      }`
    );
  }

  return data as WebullTokenResponse;
}

/**
 * Actualiza solamente el estado del token.
 */
async function updateTokenStatus(
  status: WebullTokenStatus,
  expires?: number
) {
  const updateData: {
    status: WebullTokenStatus;
    expires_at?: number;
    updated_at: string;
  } = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (expires !== undefined) {
    updateData.expires_at = expires;
  }

  const { error } = await supabaseAdmin
    .from("webull_auth")
    .update(updateData)
    .eq("id", 1);

  if (error) {
    throw new Error(
      `Error actualizando estado Webull: ${error.message}`
    );
  }
}

/**
 * Genera un token nuevo.
 *
 * El resultado normalmente será PENDING cuando
 * 2FA está activado (requiere aprobar la notificación
 * en la app de Webull).
 */
export async function generateAndStoreWebullToken() {
  const tokenData = await createWebullToken();

  await saveWebullToken(tokenData);

  return tokenData;
}

/**
 * Obtiene un token válido.
 *
 * 1. Busca token en Supabase.
 * 2. Si existe, comprueba estado.
 * 3. Si NORMAL, lo devuelve.
 * 4. Si PENDING, lo devuelve indicando que falta aprobar 2FA.
 * 5. Si no existe o está INVALID/EXPIRED, crea uno nuevo.
 */
export async function getWebullAccessToken() {
  const stored = await getStoredWebullToken();

  if (stored?.access_token) {
    try {
      const checked = await checkWebullToken(
        stored.access_token
      );

      await updateTokenStatus(
        checked.status,
        checked.expires
      );

      if (checked.status === "NORMAL") {
        return {
          token: checked.token,
          status: checked.status,
          expires: checked.expires,
          requires2FA: false,
        };
      }

      if (checked.status === "PENDING") {
        return {
          token: checked.token,
          status: checked.status,
          expires: checked.expires,
          requires2FA: true,
        };
      }
    } catch (error) {
      console.error(
        "Error comprobando token existente de Webull:",
        error
      );
    }
  }

  const newToken =
    await generateAndStoreWebullToken();

  return {
    token: newToken.token,
    status: newToken.status,
    expires: newToken.expires,
    requires2FA:
      newToken.status === "PENDING",
  };
}