import type { Zlecenie } from "./types";
import { getCompany, type CompanySettings } from "./store";
import { formatPrice, brutto } from "./ui";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";

export async function exportPdf(z: Zlecenie): Promise<void> {
  const company = getCompany();
  const totals = calcTotals(z);
  const hasMarkup = (z.markup_materials || 0) > 0 || (z.markup_labor || 0) > 0;
  const today = new Date().toLocaleDateString("pl-PL", { year: "numeric", month: "long", day: "numeric" });

  const html = buildHtml(z, company, totals, hasMarkup, today);

  // Default filename
  const safeName = z.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, "").replace(/\s+/g, "_");
  const defaultName = `Kosztorys_${safeName}_${new Date().toISOString().slice(0, 10)}`;

  try {
    // Show native "Save As" dialog
    const filePath = await save({
      title: "Zapisz kosztorys",
      defaultPath: `${defaultName}.html`,
      filters: [
        { name: "Dokument HTML (otwórz w przeglądarce → Drukuj → Zapisz jako PDF)", extensions: ["html"] },
      ],
    });

    if (!filePath) return; // User cancelled

    // Write file
    await writeTextFile(filePath, html);

    // Open in default browser — user can print to PDF from there
    await open(filePath);

  } catch (err) {
    console.error("Export error:", err);
    // Fallback: open in new window (old behavior)
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "width=800,height=1100");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

// ─── HTML Builder ────────────────────────────────────────────────
function buildHtml(
  z: Zlecenie,
  company: CompanySettings,
  totals: ZlecenieTotals,
  hasMarkup: boolean,
  today: string
): string {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Kosztorys — ${esc(z.name)}</title>
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', -apple-system, Arial, sans-serif;
    font-size: 10px; line-height: 1.45; color: #1a1a2e;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #667eea; }
  .header-left { max-width: 55%; }
  .header-right { text-align: right; max-width: 40%; }
  .company-logo { max-width: 140px; max-height: 60px; object-fit: contain; margin-bottom: 6px; }
  .company-name { font-size: 16px; font-weight: 700; color: #1a1a2e; }
  .company-detail { font-size: 9px; color: #555; line-height: 1.6; }
  .doc-title { font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px; }
  .doc-date { font-size: 9px; color: #777; }
  .doc-number { font-size: 9px; color: #777; margin-top: 2px; }

  /* Info box */
  .info-box { display: flex; gap: 24px; margin-bottom: 20px; }
  .info-card { flex: 1; background: #f7f8fc; border-radius: 6px; padding: 12px 14px; }
  .info-label { font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 4px; }
  .info-value { font-size: 11px; font-weight: 500; }
  .info-sub { font-size: 9px; color: #666; margin-top: 2px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th {
    background: #667eea; color: #fff; font-weight: 600;
    padding: 7px 8px; font-size: 8.5px; text-transform: uppercase;
    letter-spacing: 0.04em; text-align: left;
  }
  thead th:first-child { border-radius: 4px 0 0 0; }
  thead th:last-child { border-radius: 0 4px 0 0; }
  thead th.right { text-align: right; }

  tbody td { padding: 6px 8px; font-size: 9.5px; border-bottom: 1px solid #eee; vertical-align: top; }
  tbody tr:nth-child(even) { background: #fafbfe; }
  .type-badge { font-size: 7.5px; font-weight: 600; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; }
  .type-mat { background: #fff3e0; color: #e65100; }
  .type-labor { background: #e8eaf6; color: #3949ab; }
  .mono { font-family: 'SF Mono', 'Cascadia Mono', 'Consolas', monospace; }
  .right { text-align: right; }
  .muted { color: #888; font-size: 8.5px; }

  /* Totals */
  .totals-wrap { display: flex; justify-content: flex-end; }
  .totals { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 10px; }
  .totals-row.sub { color: #666; font-size: 9px; }
  .totals-row.markup { color: #30a46c; }
  .totals-final { border-top: 2px solid #1a1a2e; padding-top: 8px; margin-top: 4px; font-size: 13px; font-weight: 700; }

  /* Footer */
  .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; }
  .footer-col { font-size: 8.5px; color: #888; line-height: 1.6; }
  .footer-col strong { color: #555; }

  /* Notes */
  .notes { margin-top: 20px; padding: 10px 14px; background: #f7f8fc; border-radius: 6px; font-size: 9px; color: #555; }
  .notes-label { font-weight: 600; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 3px; }

  /* Print banner - hide when printing */
  .print-banner { background: #667eea; color: #fff; padding: 12px 24px; text-align: center; font-size: 13px; margin-bottom: 20px; border-radius: 6px; }
  .print-banner a { color: #fff; font-weight: 700; text-decoration: underline; cursor: pointer; }
  @media print {
    .print-banner { display: none; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="print-banner">
  📄 Aby zapisać jako PDF: <a onclick="window.print()">Kliknij tutaj</a> lub użyj <strong>Ctrl+P</strong> (Cmd+P na Mac) → "Zapisz jako PDF"
</div>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    ${company.logo ? `<img src="${company.logo}" class="company-logo" /><br>` : ""}
    ${company.name ? `<div class="company-name">${esc(company.name)}</div>` : ""}
    ${renderCompanyDetails(company)}
  </div>
  <div class="header-right">
    <div class="doc-title">KOSZTORYS</div>
    <div class="doc-date">${today}</div>
    <div class="doc-number">Nr: PP/${z.id}/${new Date().getFullYear()}</div>
  </div>
</div>

<!-- INFO -->
<div class="info-box">
  <div class="info-card">
    <div class="info-label">Zlecenie</div>
    <div class="info-value">${esc(z.name)}</div>
    ${z.client ? `<div class="info-sub">Klient: ${esc(z.client)}</div>` : ""}
  </div>
  <div class="info-card">
    <div class="info-label">Podsumowanie</div>
    <div class="info-value">${z.items.length} pozycji</div>
    <div class="info-sub">Materiały: ${z.items.filter(i => i.type === "material").length} • Robocizna: ${z.items.filter(i => i.type === "labor").length}</div>
  </div>
  <div class="info-card">
    <div class="info-label">Wartość brutto</div>
    <div class="info-value" style="color:#667eea;font-size:14px">${formatPrice(totals.bruttoWithMarkup)} zł</div>
  </div>
</div>

<!-- TABLE -->
<table>
  <thead>
    <tr>
      <th style="width:28px">Lp.</th>
      <th style="width:50px">Typ</th>
      <th>Nazwa</th>
      <th style="width:36px">Jedn.</th>
      <th class="right" style="width:46px">Ilość</th>
      <th class="right" style="width:70px">Cena jedn.</th>
      <th class="right" style="width:76px">Wartość netto</th>
      <th class="right" style="width:36px">VAT</th>
      <th class="right" style="width:76px">Wartość brutto</th>
    </tr>
  </thead>
  <tbody>
    ${z.items.map((item, i) => {
      const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
      const priceWithMarkup = item.price_netto * (1 + markupPct / 100);
      const lineNetto = priceWithMarkup * item.quantity;
      const lineBrutto = brutto(lineNetto, item.vat_rate);
      const unitDisplay = item.unit === "m2" ? "m²" : item.unit === "m3" ? "m³" : item.unit;

      return `<tr>
        <td class="mono right">${i + 1}</td>
        <td><span class="type-badge ${item.type === "material" ? "type-mat" : "type-labor"}">${item.type === "material" ? "MAT" : "ROB"}</span></td>
        <td><strong>${esc(item.name)}</strong></td>
        <td>${unitDisplay}</td>
        <td class="mono right">${formatQty(item.quantity)}</td>
        <td class="mono right">${formatPrice(priceWithMarkup)}${hasMarkup && markupPct > 0 ? `<br><span class="muted">${formatPrice(item.price_netto)} +${markupPct}%</span>` : ""}</td>
        <td class="mono right">${formatPrice(lineNetto)}</td>
        <td class="right">${item.vat_rate}%</td>
        <td class="mono right"><strong>${formatPrice(lineBrutto)}</strong></td>
      </tr>`;
    }).join("")}
  </tbody>
</table>

<!-- TOTALS -->
<div class="totals-wrap">
  <div class="totals">
    ${hasMarkup ? `
      <div class="totals-row sub">
        <span>Netto (baza):</span>
        <span class="mono">${formatPrice(totals.nettoBase)} zł</span>
      </div>
      <div class="totals-row markup">
        <span>Narzut:</span>
        <span class="mono">+${formatPrice(totals.markupAmount)} zł</span>
      </div>
    ` : ""}
    <div class="totals-row">
      <span>Razem netto:</span>
      <span class="mono">${formatPrice(totals.nettoWithMarkup)} zł</span>
    </div>
    <div class="totals-row sub">
      <span>VAT:</span>
      <span class="mono">${formatPrice(totals.vat)} zł</span>
    </div>
    <div class="totals-row totals-final">
      <span>DO ZAPŁATY:</span>
      <span class="mono">${formatPrice(totals.bruttoWithMarkup)} zł</span>
    </div>
  </div>
</div>

${z.notes ? `
<div class="notes">
  <div class="notes-label">Uwagi</div>
  ${esc(z.notes)}
</div>
` : ""}

<!-- FOOTER -->
${renderFooter(company)}

</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatQty(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(".", ",");
}

function renderCompanyDetails(c: CompanySettings): string {
  const lines: string[] = [];
  if (c.nip) lines.push(`NIP: ${c.nip}`);
  const addr = [c.address, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (addr) lines.push(addr);
  const contact = [c.phone, c.email].filter(Boolean).join(" • ");
  if (contact) lines.push(contact);
  if (c.website) lines.push(c.website);

  return lines.length
    ? `<div class="company-detail">${lines.map(l => esc(l)).join("<br>")}</div>`
    : "";
}

function renderFooter(c: CompanySettings): string {
  const hasBank = c.bank_name || c.bank_account;
  const hasContact = c.phone || c.email || c.website;

  if (!hasBank && !hasContact && !c.name) return "";

  return `
    <div class="footer">
      <div class="footer-col">
        ${c.name ? `<strong>${esc(c.name)}</strong><br>` : ""}
        ${c.nip ? `NIP: ${esc(c.nip)}<br>` : ""}
        ${[c.address, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || ""}
      </div>
      ${hasContact ? `<div class="footer-col">
        ${c.phone ? `tel. ${esc(c.phone)}<br>` : ""}
        ${c.email ? `${esc(c.email)}<br>` : ""}
        ${c.website ? `${esc(c.website)}` : ""}
      </div>` : ""}
      ${hasBank ? `<div class="footer-col">
        <strong>Dane do przelewu:</strong><br>
        ${c.bank_name ? `${esc(c.bank_name)}<br>` : ""}
        ${c.bank_account ? esc(c.bank_account) : ""}
      </div>` : ""}
    </div>
  `;
}

interface ZlecenieTotals {
  nettoBase: number;
  markupAmount: number;
  nettoWithMarkup: number;
  vat: number;
  bruttoWithMarkup: number;
}

function calcTotals(z: Zlecenie): ZlecenieTotals {
  let nettoBase = 0;
  let nettoWithMarkup = 0;
  let bruttoWithMarkup = 0;

  for (const item of z.items) {
    const lineBase = item.price_netto * item.quantity;
    const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
    const lineWithMarkup = lineBase * (1 + markupPct / 100);
    nettoBase += lineBase;
    nettoWithMarkup += lineWithMarkup;
    bruttoWithMarkup += brutto(lineWithMarkup, item.vat_rate);
  }

  return {
    nettoBase,
    markupAmount: nettoWithMarkup - nettoBase,
    nettoWithMarkup,
    vat: bruttoWithMarkup - nettoWithMarkup,
    bruttoWithMarkup,
  };
}
