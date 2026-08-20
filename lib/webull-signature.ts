import crypto from "crypto";

/**
 * Genera un nonce único para cada petición.
 */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Timestamp UTC requerido por Webull.
 */
export function generateTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Encoding RFC3986 estricto.
 *
 * encodeURIComponent no codifica ! ' ( ) * por defecto,
 * pero Webull espera que también estén codificados.
 * Esta función se usa en TODOS los lugares donde se firma
 * una petición a Webull para evitar firmas inválidas por
 * inconsistencia de encoding entre archivos.
 */
export function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Genera la firma HMAC-SHA256 de Webull.
 *
 * IMPORTANTE:
 * - Debe generarse una firma nueva para cada petición.
 * - Todos los parámetros (query params + headers de firma + host)
 *   se ordenan alfabéticamente por nombre antes de concatenarse.
 * - Si hay body, se agrega su SHA256 en mayúsculas al final.
 * - El string completo se codifica con rfc3986Encode antes del HMAC.
 */
export function signWebullRequest({
  path,
  host,
  appKey,
  appSecret,
  timestamp,
  nonce,
  extraParams = {},
  body = "",
}: {
  path: string;
  host: string;
  appKey: string;
  appSecret: string;
  timestamp: string;
  nonce: string;
  extraParams?: Record<string, string>;
  body?: string;
}): string {
  const params: Record<string, string> = {
    ...extraParams,
    host,
    "x-app-key": appKey,
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": nonce,
    "x-signature-version": "1.0",
    "x-timestamp": timestamp,
  };

  // Orden alfabético por nombre del parámetro.
  const sortedKeys = Object.keys(params).sort();

  const queryString = sortedKeys
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  let signString = `${path}&${queryString}`;

  // Si existe body, agregamos SHA256 en mayúsculas.
  if (body) {
    const bodySha256 = crypto
      .createHash("sha256")
      .update(body, "utf8")
      .digest("hex")
      .toUpperCase();

    signString += `&${bodySha256}`;
  }

  // Webull aplica URL encoding RFC3986 al string completo.
  const encodedString = rfc3986Encode(signString);

  // App Secret + "&"
  const signingKey = `${appSecret}&`;

  // HMAC-SHA256 + Base64
  return crypto
    .createHmac("sha256", signingKey)
    .update(encodedString, "utf8")
    .digest("base64");
}