import { NextResponse } from "next/server";
import { checkWebullToken, generateAndStoreWebullToken } from "@/lib/webull-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * GET: consulta el estado actual del token guardado en Supabase.
 * Si no existe token todavía, regresa status "NO_TOKEN" — en ese
 * caso hay que hacer POST a este mismo endpoint para crear uno.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("webull_auth")
      .select(
        "access_token, status, expires_at, updated_at"
      )
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Error leyendo autenticación Webull: ${error.message}`
      );
    }

    if (!data?.access_token) {
      return NextResponse.json({
        success: false,
        status: "NO_TOKEN",
        message:
          "Todavía no existe un token Webull. Haz POST a este endpoint para crear uno.",
      });
    }

    const result = await checkWebullToken(
      data.access_token
    );

    await supabaseAdmin
      .from("webull_auth")
      .update({
        status: result.status,
        expires_at: result.expires,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    return NextResponse.json({
      success: true,
      status: result.status,
      expires: result.expires,
      requires2FA: result.status === "PENDING",
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Webull status error:",
      error
    );
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido",
      },
      {
        status: 500,
      }
    );
  }
}

/**
 * POST: crea un token nuevo en Webull y lo guarda en Supabase.
 * El status inicial normalmente será "PENDING" (requiere aprobar
 * la notificación de 2FA en la app de Webull). Después de aprobar,
 * llama GET en este mismo endpoint para confirmar que pasó a "NORMAL".
 */
export async function POST() {
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
    console.error(
      "Webull token create error:",
      error
    );
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido",
      },
      {
        status: 500,
      }
    );
  }
}