import { supabase } from "@/lib/supabase";

/**
 * fetch para el NAVEGADOR que adjunta la sesión de Supabase como Bearer.
 * Se usa con las rutas /api/... que exigen sesión (ver lib/api-auth.ts).
 * Si no hay sesión lanza error en vez de llamar sin credenciales.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sesión expirada, vuelve a iniciar sesión");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}