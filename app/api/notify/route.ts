import { Resend } from 'resend';
import { NextResponse } from 'next/server';
if (!process.env.RESEND_API_KEY) {
  throw new Error("Falta RESEND_API_KEY")
}
const resend = new Resend(process.env.RESEND_API_KEY);
export async function POST(request: Request) {
  try {
    const { ticker, currentPrice, targetPrice } = await request.json();
    // ✅ Validación
    if (!ticker || currentPrice == null || targetPrice == null) {
      return NextResponse.json(
        { error: "Datos inválidos" },
        { status: 400 }
      )
    }
    const safePrice = Number(currentPrice) || 0
    const safeTarget = Number(targetPrice) || 0
    const { data, error } = await resend.emails.send({
      from: 'Alertas Trading <onboarding@resend.dev>',
      to: 'ciberdgor@gmail.com',
      subject: `🚨 OPORTUNIDAD: ${ticker} en zona de compra`,
      html: `
        <div style="font-family: sans-serif; background: #000; color: #fff; padding: 30px; border-radius: 15px;">
          <h1 style="color: #22c55e;">¡Entrada Detectada!</h1>
          <p>El ticker <strong>${ticker}</strong> tocó tu precio objetivo.</p>
          <div style="background: #111; padding: 20px; border-radius: 10px;">
            <p>💰 Precio Actual: $${safePrice.toFixed(2)}</p>
            <p>🎯 Objetivo: $${safeTarget.toFixed(2)}</p>
          </div>
        </div>
      `
    });
    if (error) {
      console.error("RESEND ERROR:", error)
      return NextResponse.json({ error }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API ERROR:", error)
    return NextResponse.json({ error }, { status: 500 });
  }
}