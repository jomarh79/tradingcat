import { createClient } from "@supabase/supabase-js";

/**
 * Autorización compartida para rutas API de uso personal (SOLO servidor).
 * Acepta la cabecera  Authorization: Bearer <access_token de la sesión de Supabase>
 * y, si OWNER_EMAIL está definido, exige que la sesión sea de esa cuenta.
 * Fail-closed: sin variables de entorno o con token inválido devuelve false.
 */
export async function isOwnerRequest(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return false;
  try {
    const { data, error } = await createClient(url, anon).auth.getUser(token);
    if (error || !data.user) return false;
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    return !owner || data.user.email?.toLowerCase() === owner;
  } catch {
    return false;
  }
}