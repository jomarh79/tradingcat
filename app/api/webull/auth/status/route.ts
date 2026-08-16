import { NextResponse } from "next/server";
import { checkWebullToken } from "@/lib/webull-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

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
        message: "Todavía no existe un token Webull.",
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