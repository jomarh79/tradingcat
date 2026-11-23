// Respuestas falsas de las listas de índices (Wikipedia e iShares) para las pruebas de la corrida: GKOS pertenece a todos salvo que se diga otra cosa.
const relleno = (n: number): string[] => Array.from({ length: n }, (_, i) => `Q${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + i % 26)}`);
export function respuestaIndicesPrueba(url: string, miembros: string[] = ['GKOS']): { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> } | undefined {
  const wiki = url.includes('wikipedia.org'); const ish = url.includes('ishares.com');
  if (!wiki && !ish) return undefined;
  const n = url.includes('S%26P_500') ? 450 : url.includes('NASDAQ-100') ? 100 : url.includes('Dow_Jones') ? 30 : 125;
  const t = [...relleno(n), ...miembros];
  const cuerpo = wiki
    ? `<table><tr><th>${url.includes('NASDAQ') ? 'Ticker' : 'Symbol'}</th></tr>${t.map(x => `<tr><td>${x}</td></tr>`).join('')}</table>`
    : `Ticker,Name\n${t.map(x => `"${x}","N"`).join('\n')}\n`;
  return { ok: true, status: 200, json: async () => ({ parse: { text: cuerpo } }), text: async () => cuerpo };
}
