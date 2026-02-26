// ─── Wielowalutowość — kursy NBP ─────────────────────────────────

export interface ExchangeRate {
  code: string;
  currency: string;
  mid: number;
  effectiveDate: string;
}

export interface HistoricalRate {
  date: string;
  mid: number;
}

const CACHE_KEY = "pp_exchange_rates";
const CACHE_TTL = 4 * 3600 * 1000; // 4h

let rates: ExchangeRate[] = [];

export function getCachedRates(): ExchangeRate[] {
  if (rates.length > 0) return rates;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        rates = cached.rates;
        return rates;
      }
    }
  } catch {}
  return [];
}

export async function fetchExchangeRates(): Promise<ExchangeRate[]> {
  try {
    const resp = await fetch("https://api.nbp.pl/api/exchangerates/tables/a/?format=json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return getCachedRates();
    const data = await resp.json();
    const table = data[0];
    rates = (table.rates || []).map((r: any) => ({
      code: r.code,
      currency: r.currency,
      mid: r.mid,
      effectiveDate: table.effectiveDate,
    }));
    // Cache
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), rates }));
    return rates;
  } catch {
    return getCachedRates();
  }
}

export function getRate(code: string): number | null {
  const r = rates.find(x => x.code === code);
  return r ? r.mid : null;
}

export function convertToPLN(amount: number, fromCurrency: string): number {
  if (fromCurrency === "PLN") return amount;
  const rate = getRate(fromCurrency);
  if (!rate) return amount;
  return Math.round(amount * rate * 100) / 100;
}

export function convertFromPLN(amountPLN: number, toCurrency: string): number {
  if (toCurrency === "PLN") return amountPLN;
  const rate = getRate(toCurrency);
  if (!rate) return amountPLN;
  return Math.round(amountPLN / rate * 100) / 100;
}

export function formatCurrency(amount: number, currency: string): string {
  return `${amount.toFixed(2).replace(".", ",")} ${currency}`;
}

export async function fetchHistoricalRates(code: string, days: number): Promise<HistoricalRate[]> {
  const cacheKey = `pp_rate_history_${code}`;
  const cacheTTL = 12 * 3600 * 1000; // 12h

  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
    }
  } catch {}

  try {
    const resp = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${code}/last/${days}/?format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) return [];

    const data = await resp.json();
    const rates: HistoricalRate[] = (data.rates || []).map((r: any) => ({
      date: r.effectiveDate,
      mid: r.mid
    }));

    // Cache the data
    localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: rates }));
    return rates;
  } catch {
    return [];
  }
}

export type ChartRange = "7d" | "30d" | "90d" | "180d" | "1y";

export const CHART_RANGE_DAYS: Record<ChartRange, number> = {
  "7d": 7, "30d": 30, "90d": 90, "180d": 180, "1y": 255,
};
export const CHART_RANGE_LABELS: Record<ChartRange, string> = {
  "7d": "1T", "30d": "1M", "90d": "3M", "180d": "6M", "1y": "1R",
};

export function renderCurrencyChart(code: string, data: HistoricalRate[], activeRange: ChartRange = "30d"): string {
  if (data.length === 0) return "";

  const width = 520;
  const height = 220;
  const pad = { top: 12, right: 16, bottom: 36, left: 52 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const values = data.map(d => d.mid);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal || 0.001;
  // Add 5% padding on y axis
  const yMin = minVal - valRange * 0.05;
  const yMax = maxVal + valRange * 0.05;
  const yRange = yMax - yMin;

  const scaleY = (v: number) => pad.top + ch - ((v - yMin) / yRange) * ch;
  const scaleX = (i: number) => pad.left + (i / (data.length - 1 || 1)) * cw;

  // Current vs first — trend color
  const first = data[0].mid;
  const last = data[data.length - 1].mid;
  const isUp = last >= first;
  const lineColor = isUp ? "var(--success)" : "var(--danger)";
  const changeVal = last - first;
  const changePct = first > 0 ? ((changeVal / first) * 100).toFixed(2) : "0.00";
  const changeSign = isUp ? "+" : "";

  // Build smooth line path (catmull-rom → cubic bezier)
  const points = data.map((d, i) => ({ x: scaleX(i), y: scaleY(d.mid) }));

  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[Math.min(points.length - 1, i + 1)];
    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  // Fill area path (gradient beneath the line)
  const fillD = pathD + ` L ${points[points.length - 1].x} ${pad.top + ch} L ${points[0].x} ${pad.top + ch} Z`;

  // Horizontal grid lines
  const ySteps = 4;
  let gridLines = "";
  for (let i = 0; i <= ySteps; i++) {
    const val = yMin + (yRange / ySteps) * i;
    const y = scaleY(val);
    gridLines += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3" />`;
    gridLines += `<text x="${pad.left - 8}" y="${y + 3.5}" font-size="9" text-anchor="end" fill="var(--text-muted)" font-family="var(--font-mono)">${val.toFixed(4)}</text>`;
  }

  // X-axis date labels (spread ~5 labels)
  const labelCount = Math.min(data.length, 5);
  let xLabels = "";
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round(i * (data.length - 1) / (labelCount - 1 || 1));
    const x = scaleX(idx);
    const d = new Date(data[idx].date + "T12:00:00");
    const label = d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
    xLabels += `<text x="${x}" y="${height - 4}" font-size="9" text-anchor="middle" fill="var(--text-muted)">${label}</text>`;
  }

  // Invisible hover rects for each data point (for tooltip)
  const slotW = cw / (data.length - 1 || 1);
  let hoverRects = "";
  data.forEach((point, idx) => {
    const x = scaleX(idx);
    const rx = idx === 0 ? pad.left : x - slotW / 2;
    const rw = idx === 0 || idx === data.length - 1 ? slotW / 2 : slotW;
    const d = new Date(point.date + "T12:00:00");
    const dateLabel = d.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
    hoverRects += `
      <rect x="${rx}" y="${pad.top}" width="${rw}" height="${ch}" fill="transparent" class="chart-hover-zone" data-idx="${idx}" />
      <g class="chart-tooltip-group" data-idx="${idx}" style="display:none;pointer-events:none">
        <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + ch}" stroke="var(--text-muted)" stroke-width="0.5" stroke-dasharray="2,2" />
        <circle cx="${x}" cy="${scaleY(point.mid)}" r="4" fill="${lineColor}" stroke="var(--bg-secondary)" stroke-width="2" />
        <rect x="${x - 42}" y="${scaleY(point.mid) - 28}" width="84" height="22" rx="4" fill="var(--bg-tertiary)" stroke="var(--border)" stroke-width="0.5" />
        <text x="${x}" y="${scaleY(point.mid) - 13}" font-size="10" text-anchor="middle" fill="var(--text-primary)" font-weight="600" font-family="var(--font-mono)">${point.mid.toFixed(4)}</text>
        <text x="${x}" y="${pad.top + ch + 12}" font-size="8" text-anchor="middle" fill="var(--text-muted)">${dateLabel}</text>
      </g>
    `;
  });

  // Range selector tabs
  const rangeTabs = (Object.keys(CHART_RANGE_LABELS) as ChartRange[]).map(r => {
    const active = r === activeRange;
    return `<button class="chart-range-btn${active ? " active" : ""}" data-chart-range="${r}">${CHART_RANGE_LABELS[r]}</button>`;
  }).join("");

  // Gradient ID unique per code
  const gradId = `grad-${code.toLowerCase()}`;

  return `
    <div class="currency-chart-container">
      <div class="currency-chart-header">
        <div class="currency-chart-info">
          <span class="currency-chart-code">${code}/PLN</span>
          <span class="currency-chart-rate">${last.toFixed(4)}</span>
          <span class="currency-chart-change" style="color:${lineColor}">${changeSign}${changeVal.toFixed(4)} (${changeSign}${changePct}%)</span>
        </div>
        <div class="chart-range-selector">${rangeTabs}</div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" class="currency-chart-svg" data-chart-code="${code}">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.15" />
            <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
          </linearGradient>
        </defs>

        ${gridLines}

        <path d="${fillD}" fill="url(#${gradId})" />
        <path d="${pathD}" stroke="${lineColor}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />

        ${xLabels}
        ${hoverRects}
      </svg>
    </div>
  `;
}

/** Bind hover interactions on rendered chart SVGs (call after inserting into DOM) */
export function bindChartHover(container: HTMLElement): void {
  container.querySelectorAll<SVGRectElement>(".chart-hover-zone").forEach(rect => {
    const svg = rect.closest("svg")!;
    const idx = rect.dataset.idx!;
    rect.addEventListener("mouseenter", () => {
      svg.querySelectorAll(".chart-tooltip-group").forEach(g => (g as SVGElement).style.display = "none");
      const tip = svg.querySelector(`.chart-tooltip-group[data-idx="${idx}"]`) as SVGElement | null;
      if (tip) tip.style.display = "";
    });
    rect.addEventListener("mouseleave", () => {
      const tip = svg.querySelector(`.chart-tooltip-group[data-idx="${idx}"]`) as SVGElement | null;
      if (tip) tip.style.display = "none";
    });
  });
}

export const POPULAR_CURRENCIES = [
  "PLN", "EUR", "USD", "GBP", "CZK", "CHF",
  "SEK", "NOK", "DKK", "HUF", "RON", "BGN",
  "HRK", "TRY", "JPY", "CNY", "CAD", "AUD"
];
