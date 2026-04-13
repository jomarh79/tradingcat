import { Resend } from 'resend';
import { NextResponse } from 'next/server';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ticker, currentPrice, targetPrice, type } = body;

    if (!ticker || currentPrice == null || targetPrice == null || !resend) {
      return NextResponse.json({ error: "Faltan datos o Resend no configurado" }, { status: 400 });
    }

    const safePrice = Number(currentPrice).toFixed(2);
    const safeTarget = Number(targetPrice).toFixed(2);

    // Colores dinámicos: Verde para entradas, Rojo para Stop, Amarillo para TP
    const isEntry = type.includes("ENTRADA");
    const isStop = type.includes("STOP") || type.includes("VENTA");
    const accentColor = isEntry ? "#22c55e" : isStop ? "#f43f5e" : "#eab308";

    const { error } = await resend.emails.send({
      from: 'Trading Cat <onboarding@resend.dev>',
      to: 'ciberdgor@gmail.com',
      subject: `${type}: ${ticker}`,
      html: `
        <div style="font-family: sans-serif; background: #000; color: #fff; padding: 30px; border-radius: 15px; border: 1px solid #222;">
          <h1 style="color: ${accentColor}; margin-bottom: 10px; font-size: 24px;">${type}</h1>
          <p style="color: #888; font-size: 16px;">Movimiento detectado en <strong>${ticker}</strong></p>
          
          <div style="background: #111; padding: 25px; border-radius: 10px; margin-top: 20px; border: 1px solid #333;">
            <p style="font-size: 1.2rem; margin: 10px 0;">💰 Precio Actual: <strong style="color: #fff;">$${safePrice}</strong></p>
            <p style="font-size: 1.2rem; margin: 10px 0;">🎯 Objetivo: <strong style="color: #fff;">$${safeTarget}</strong></p>
          </div>
          
          <p style="font-size: 0.8rem; color: #444; margin-top: 25px; border-top: 1px solid #222; padding-top: 15px;">
            Trading Cat System • Notificación Automática
          </p>
        </div>
      `
    });

    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ success: true });

  } catch (error) {
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
