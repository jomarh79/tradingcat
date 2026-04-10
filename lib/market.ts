// Finnhub: usado para activos en portafolio (trades abiertos y cerrados)
// TwelveData: usado para watchlist (activos en seguimiento pre-compra)
// Ambas APIs tienen límite de llamadas, por eso se mantienen separadas.

export const fetchQuote = async (symbol: string) => {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${process.env.NEXT_PUBLIC_FINNHUB_KEY}`
  )
  const data = await res.json()
  return {
    price: data.c,
    change: data.d,
    percent: data.dp,
  }
}