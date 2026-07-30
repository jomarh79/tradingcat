import React, { useState, useMemo } from 'react';
import { 
  ArrowUpRight, ArrowDownRight, Search, ExternalLink, 
  TrendingUp, Clock, PieChart, BarChart2, Layers 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart as RePie, Pie, Cell, Legend, CartesianGrid 
} from 'recharts';

// --- MOCK DATA ---
const PORTFOLIO_DATA = [
  { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Tecnología', invertido: 15000, valorActual: 18500, varHoy: 1.2, pnl: 23.3, dias: 240, rsi: 58, originalPct: 15, buyDate: '2023-11-01' },
  { ticker: 'NVDA', name: 'NVIDIA Corp.', sector: 'Tecnología', invertido: 10000, valorActual: 24000, varHoy: -2.1, pnl: 140.0, dias: 180, rsi: 72, originalPct: 10, buyDate: '2024-01-15' },
  { ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Tecnología', invertido: 20000, valorActual: 23500, varHoy: 0.8, pnl: 17.5, dias: 310, rsi: 54, originalPct: 20, buyDate: '2023-08-20' },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Finanzas', invertido: 12000, valorActual: 13200, varHoy: -0.4, pnl: 10.0, dias: 120, rsi: 48, originalPct: 12, buyDate: '2024-03-10' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Salud', invertido: 8000, valorActual: 7400, varHoy: -0.1, pnl: -7.5, dias: 410, rsi: 38, originalPct: 8, buyDate: '2023-05-12' },
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'Energía', invertido: 9000, valorActual: 10100, varHoy: 1.5, pnl: 12.2, dias: 90, rsi: 62, originalPct: 9, buyDate: '2024-04-05' },
  { ticker: 'TSLA', name: 'Tesla Inc.', sector: 'Consumo Ciclico', invertido: 11000, valorActual: 8800, varHoy: -3.5, pnl: -20.0, dias: 200, rsi: 41, originalPct: 11, buyDate: '2023-12-10' },
  { ticker: 'AMZN', name: 'Amazon.com', sector: 'Consumo Ciclico', invertido: 15000, valorActual: 18200, varHoy: 2.1, pnl: 21.3, dias: 290, rsi: 65, originalPct: 15, buyDate: '2023-09-01' },
];

const BENCHMARK_PERF: Record<string, { ticker: string; rendimiento: number; sp500: number }[]> = {
  YTD: [
    { ticker: 'NVDA', rendimiento: 45.2, sp500: 12.1 },
    { ticker: 'AAPL', rendimiento: 15.4, sp500: 12.1 },
    { ticker: 'AMZN', rendimiento: 18.2, sp500: 12.1 },
    { ticker: 'TSLA', rendimiento: -12.5, sp500: 12.1 },
    { ticker: 'JNJ', rendimiento: -3.1, sp500: 12.1 },
  ],
  '1Y': [
    { ticker: 'NVDA', rendimiento: 140.0, sp500: 22.5 },
    { ticker: 'AAPL', rendimiento: 23.3, sp500: 22.5 },
    { ticker: 'AMZN', rendimiento: 21.3, sp500: 22.5 },
    { ticker: 'TSLA', rendimiento: -20.0, sp500: 22.5 },
    { ticker: 'JNJ', rendimiento: -7.5, sp500: 22.5 },
  ],
  '5Y': [
    { ticker: 'NVDA', rendimiento: 1250.0, sp500: 85.0 },
    { ticker: 'AAPL', rendimiento: 280.0, sp500: 85.0 },
    { ticker: 'AMZN', rendimiento: 95.0, sp500: 85.0 },
    { ticker: 'TSLA', rendimiento: 650.0, sp500: 85.0 },
    { ticker: 'JNJ', rendimiento: 12.0, sp500: 85.0 },
  ],
  MAX: [
    { ticker: 'NVDA', rendimiento: 2100.0, sp500: 150.0 },
    { ticker: 'AAPL', rendimiento: 450.0, sp500: 150.0 },
    { ticker: 'AMZN', rendimiento: 310.0, sp500: 150.0 },
    { ticker: 'TSLA', rendimiento: 890.0, sp500: 150.0 },
    { ticker: 'JNJ', rendimiento: 45.0, sp500: 150.0 },
  ]
};

const SECTOR_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export default function PortfolioDashboard() {
  // States
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('valorActual');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [timeframe, setTimeframe] = useState<'YTD' | '1Y' | '5Y' | 'MAX'>('1Y');

  // --- FILA 1: KPIs ---
  const kpis = useMemo(() => {
    const totalInvertido = PORTFOLIO_DATA.reduce((acc, item) => acc + item.invertido, 0);
    const valorActual = PORTFOLIO_DATA.reduce((acc, item) => acc + item.valorActual, 0);
    const pnlLatenteAbs = valorActual - totalInvertido;
    const pnlLatentePct = (pnlLatenteAbs / totalInvertido) * 100;
    
    // Variación del día promedio ponderada por valor actual
    const varHoy = PORTFOLIO_DATA.reduce((acc, item) => acc + (item.varHoy * item.valorActual), 0) / valorActual;
    
    const enGananciaCount = PORTFOLIO_DATA.filter(item => item.pnl > 0).length;
    const enGananciaPct = (enGananciaCount / PORTFOLIO_DATA.length) * 100;
    
    const diasPromedio = Math.round(
      PORTFOLIO_DATA.reduce((acc, item) => acc + item.dias, 0) / PORTFOLIO_DATA.length
    );
    
    const rsiPromedio = Math.round(
      PORTFOLIO_DATA.reduce((acc, item) => acc + item.rsi, 0) / PORTFOLIO_DATA.length
    );

    return {
      totalInvertido,
      valorActual,
      pnlLatenteAbs,
      pnlLatentePct,
      varHoy,
      enGananciaPct,
      diasPromedio,
      rsiPromedio
    };
  }, []);

  // --- FILA 2: Lógica de Tabla ---
  const filteredAndSortedPositions = useMemo(() => {
    const totalVal = kpis.valorActual;
    return PORTFOLIO_DATA
      .map(item => ({
        ...item,
        actualPct: (item.valorActual / totalVal) * 100
      }))
      .filter(item => 
        item.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        let valA = a[sortField as keyof typeof a];
        let valB = b[sortField as keyof typeof b];
        
        if (typeof valA === 'string') {
          return sortOrder === 'asc' 
            ? (valA as string).localeCompare(valB as string)
            : (valB as string).localeCompare(valA as string);
        }
        return sortOrder === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
      });
  }, [searchTerm, sortField, sortOrder, kpis.valorActual]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // --- FILA 4: Top 5 & PnL por Sector ---
  const top5Gainers = useMemo(() => {
    return [...PORTFOLIO_DATA].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  }, []);

  const top5Losers = useMemo(() => {
    return [...PORTFOLIO_DATA].sort((a, b) => a.pnl - b.pnl).slice(0, 5);
  }, []);

  const sectorPnL = useMemo(() => {
    const sectors: Record<string, number> = {};
    PORTFOLIO_DATA.forEach(item => {
      const pnlDollar = item.valorActual - item.invertido;
      sectors[item.sector] = (sectors[item.sector] || 0) + pnlDollar;
    });
    return Object.entries(sectors).map(([sector, pnl]) => ({ sector, pnl }));
  }, []);

  // --- FILA 5: Sector Dona & Tiempo ---
  const sectorAllocation = useMemo(() => {
    const sectors: Record<string, number> = {};
    const total = kpis.valorActual;
    PORTFOLIO_DATA.forEach(item => {
      sectors[item.sector] = (sectors[item.sector] || 0) + item.valorActual;
    });
    return Object.entries(sectors).map(([name, value]) => ({
      name,
      value: Number(((value / total) * 100).toFixed(1))
    }));
  }, [kpis.valorActual]);

  const timeHorizontalData = useMemo(() => {
    return [...PORTFOLIO_DATA]
      .sort((a, b) => b.dias - a.dias)
      .map(item => ({ ticker: item.ticker, dias: item.dias }));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-8 font-sans">
      
      {/* ================= FILA 1 — 7 KPIs ================= */}
      <section className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">Total Invertido</span>
          <span className="text-xl font-bold mt-2">${kpis.totalInvertido.toLocaleString()}</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">Valor Actual</span>
          <span className="text-xl font-bold mt-2">${kpis.valorActual.toLocaleString()}</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">PnL Latente</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className={`text-xl font-bold ${kpis.pnlLatenteAbs >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${kpis.pnlLatenteAbs.toLocaleString()}
            </span>
            <span className={`text-xs ${kpis.pnlLatentePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ({kpis.pnlLatentePct > 0 ? '+' : ''}{kpis.pnlLatentePct.toFixed(1)}%)
            </span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">Variación Hoy</span>
          <div className="mt-2 flex items-center gap-1">
            {kpis.varHoy >= 0 ? <ArrowUpRight className="w-4 h-4 text-emerald-400" /> : <ArrowDownRight className="w-4 h-4 text-rose-400" />}
            <span className={`text-xl font-bold ${kpis.varHoy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {kpis.varHoy.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">En Ganancia %</span>
          <span className="text-xl font-bold mt-2 text-emerald-400">{kpis.enGananciaPct.toFixed(0)}%</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">Días Promedio</span>
          <span className="text-xl font-bold mt-2">{kpis.diasPromedio} días</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">RSI Promedio</span>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xl font-bold">{kpis.rsiPromedio}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${kpis.rsiPromedio > 70 ? 'bg-rose-950 text-rose-400' : kpis.rsiPromedio < 30 ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-800 text-slate-300'}`}>
              {kpis.rsiPromedio > 70 ? 'Sobrecompra' : kpis.rsiPromedio < 30 ? 'Sobrevenda' : 'Neutral'}
            </span>
          </div>
        </div>
      </section>

      {/* ================= FILA 2 — TABLA DE POSICIONES ================= */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" /> Posiciones en Cartera
          </h2>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar Ticker o Nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4 cursor-pointer hover:text-white" onClick={() => handleSort('ticker')}>Ticker</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white" onClick={() => handleSort('sector')}>Sector</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('invertido')}>Invertido</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('valorActual')}>Valor Actual</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('pnl')}>PnL (%)</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('varHoy')}>Var Hoy</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('originalPct')}>% Orig.</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('actualPct')}>% Act.</th>
                <th className="py-3 px-4 cursor-pointer hover:text-white text-right" onClick={() => handleSort('rsi')}>RSI</th>
                <th className="py-3 px-4 text-center">TradingView</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredAndSortedPositions.map((row) => (
                <tr key={row.ticker} className="hover:bg-slate-800/50 transition-colors">
                  <td className="py-3 px-4 font-semibold text-white">
                    {row.ticker}
                    <span className="block text-xs font-normal text-slate-400">{row.name}</span>
                  </td>
                  <td className="py-3 px-4"><span className="bg-slate-800 px-2 py-1 rounded text-xs">{row.sector}</span></td>
                  <td className="py-3 px-4 text-right">${row.invertido.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right">${row.valorActual.toLocaleString()}</td>
                  <td className={`py-3 px-4 text-right font-medium ${row.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {row.pnl > 0 ? '+' : ''}{row.pnl.toFixed(1)}%
                  </td>
                  <td className={`py-3 px-4 text-right ${row.varHoy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {row.varHoy > 0 ? '+' : ''}{row.varHoy.toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-right text-slate-400">{row.originalPct}%</td>
                  <td className="py-3 px-4 text-right font-medium text-blue-400">{row.actualPct.toFixed(1)}%</td>
                  <td className="py-3 px-4 text-right">{row.rsi}</td>
                  <td className="py-3 px-4 text-center">
                    <a
                      href={`https://www.tradingview.com/symbols/${row.ticker}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-blue-400 hover:text-blue-300"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================= FILA 3 — RENDIMIENTO vs S&P 500 ================= */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-emerald-400" /> Rendimiento % por Posición vs S&P 500
          </h2>
          <div className="flex bg-slate-950 p-1 border border-slate-800 rounded-lg">
            {(['YTD', '1Y', '5Y', 'MAX'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  timeframe === tf ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={BENCHMARK_PERF[timeframe]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="ticker" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" unit="%" />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
              <Legend />
              <Bar dataKey="rendimiento" name="Rendimiento Activo (%)" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sp500" name="S&P 500 Benchmark (%)" fill="#64748B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ================= FILA 4 — TOP 5 + PnL POR SECTOR ================= */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top 5 Ganancias */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-md font-bold mb-4 text-emerald-400 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Top 5 Ganancias
          </h3>
          <ul className="space-y-3">
            {top5Gainers.map((item) => (
              <li key={item.ticker} className="flex justify-between items-center bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <div>
                  <span className="font-bold text-sm">{item.ticker}</span>
                  <span className="text-xs block text-slate-400">{item.sector}</span>
                </div>
                <span className="text-emerald-400 font-semibold text-sm">+{item.pnl.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Top 5 Pérdidas */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-md font-bold mb-4 text-rose-400 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 rotate-180" /> Top 5 Pérdidas
          </h3>
          <ul className="space-y-3">
            {top5Losers.map((item) => (
              <li key={item.ticker} className="flex justify-between items-center bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <div>
                  <span className="font-bold text-sm">{item.ticker}</span>
                  <span className="text-xs block text-slate-400">{item.sector}</span>
                </div>
                <span className="text-rose-400 font-semibold text-sm">{item.pnl.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>

        {/* PnL Latente por Sector */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-md font-bold mb-4 text-blue-400 flex items-center gap-2">
            <PieChart className="w-4 h-4" /> PnL Latente por Sector ($)
          </h3>
          <div className="space-y-3">
            {sectorPnL.map((item) => (
              <div key={item.sector} className="flex justify-between items-center bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-sm text-slate-300">{item.sector}</span>
                <span className={`text-sm font-semibold ${item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {item.pnl >= 0 ? '+' : ''}${item.pnl.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FILA 5 — DONA SECTOR + TIEMPO + DÍAS POR TICKER ================= */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dona por sector */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-md font-bold mb-2">Distribución por Sector</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RePie>
                <Pie data={sectorAllocation} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {sectorAllocation.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={SECTOR_COLORS[index % SECTOR_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                <Legend />
              </RePie>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tiempo en Posición (Resumen) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-md font-bold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-400" /> Tiempo en Posición
            </h3>
            <div className="space-y-4">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 block">Posición más Antigua</span>
                <span className="text-md font-bold text-purple-400">JNJ (410 días)</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 block">Posición más Reciente</span>
                <span className="text-md font-bold text-blue-400">XOM (90 días)</span>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 border-t border-slate-800 pt-3">
            El tiempo promedio total ponderado de la cartera actual es de <strong className="text-slate-300">{kpis.diasPromedio} días</strong>.
          </div>
        </div>

        {/* Días por Ticker Horizontal */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-md font-bold mb-2">Días Acumulados por Ticker</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeHorizontalData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#94a3b8" />
                <YAxis dataKey="ticker" type="category" stroke="#94a3b8" width={50} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                <Bar dataKey="dias" name="Días" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

    </div>
  );
}