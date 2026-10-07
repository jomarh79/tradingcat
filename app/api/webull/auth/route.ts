import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { checkWebullToken, generateAndStoreWebullToken } from "@/lib/webull-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ruta de administración del token de Webull. Solo para ti:
 *   - Con sesión:  Authorization: Bearer <access_token de Supabase>  (y OWNER_EMAIL si está definido)
 *   - Sin sesión (curl/Postman): cabecera  x-admin-secret: <MANUAL_SECRET>
 *
 * GET : consulta el estado del token guardado (status NO_TOKEN si todavía no existe).
 * POST: crea un token nuevo en Webull y lo guarda. Normalmente queda PENDING:
 *       aprueba la notificación 2FA en la app de Webull y luego haz GET para confirmar NORMAL.
 */

const GET_MIN_GAP_MS = 10_000;
const POST_MIN_GAP_MS = 60_000; // cada POST le manda una notificación 2FA a tu teléfono
let lastGet = 0;
let lastPost = 0;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function isAuthorized(request: Request): Promise<boolean> {
  // 1) Secreto de administración (fail-closed: si no está configurado, esta vía no existe)
  const adminSecret = process.env.MANUAL_SECRET;
  const sent = request.headers.get("x-admin-secret") || "";
  if (adminSecret && sent && safeEqual(sent, adminSecret)) return true;

  // 2) Sesión de Supabase
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

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 });
  }

  const now = Date.now();
  if (now - lastGet < GET_MIN_GAP_MS) {
    return NextResponse.json(
      { success: false, error: "Demasiado pronto, espera unos segundos" },
      { status: 429 }
    );
  }
  lastGet = now;

  try {
    const { data, error } = await supabaseAdmin
      .from("webull_auth")
      .select("access_token, status, expires_at, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      throw new Error(`Error leyendo autenticación Webull: ${error.message}`);
    }

    if (!data?.access_token) {
      return NextResponse.json({
        success: false,
        status: "NO_TOKEN",
        message: "Todavía no existe un token Webull. Haz POST a este endpoint para crear uno.",
      });
    }

    const result = await checkWebullToken(data.access_token);
    const updatedAt = new Date().toISOString();

    await supabaseAdmin
      .from("webull_auth")
      .update({ status: result.status, expires_at: result.expires, updated_at: updatedAt })
      .eq("id", 1);

    return NextResponse.json({
      success: true,
      status: result.status,
      expires: result.expires,
      requires2FA: result.status === "PENDING",
      updated_at: updatedAt,
    });
  } catch (error) {
    console.error("Webull status error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 });
  }

  const now = Date.now();
  if (now - lastPost < POST_MIN_GAP_MS) {
    return NextResponse.json(
      { success: false, error: "Ya se pidió un token hace menos de 1 minuto; aprueba la notificación 2FA en Webull" },
      { status: 429 }
    );
  }
  lastPost = now;

  try {
    const tokenData = await generateAndStoreWebullToken();

    return NextResponse.json({
      success: true,
      status: tokenData.status,
      expires: tokenData.expires,
      requires2FA: tokenData.status === "PENDING",
      message:
        tokenData.status === "PENDING"
          ? "Token creado. Aprueba la notificación en la app de Webull y luego haz GET a este endpoint para confirmar."
          : "Token creado y activo.",
    });
  } catch (error) {
    console.error("Webull token create error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}