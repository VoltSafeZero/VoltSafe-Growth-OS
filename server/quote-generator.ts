import ExcelJS from "exceljs";

export interface QuoteLineItemData {
  name: string;
  description?: string;
  category: string;
  qty: number;
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
  lineTotal: number;
  unitType?: string;
  isRecurring?: boolean;
}

export interface QuoteData {
  quoteNumber: string;
  version: number;
  status: string;
  country: string;
  currency: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  marinaAddress?: string;
  siteAddress?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  entitlementNumber?: string;
  licensedTo?: string;
  paymentTermDeposit: number;
  paymentTermProduction: number;
  paymentTermInstall: number;
  taxRate: number;
  taxAmount: number;
  hardwareSubtotal: number;
  softwareSubtotal: number;
  subtotal: number;
  total: number;
  depositDue: number;
  slipsCount?: number;
  validUntil?: Date | string | null;
  notes?: string;
  assumptions?: string;
  exclusions?: string;
  lineItems: QuoteLineItemData[];
  createdAt: Date | string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", CAD: "CA$", MXN: "MX$", GBP: "£", EUR: "€", AUD: "A$",
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || "$";
}

function fmt(amount: number, currency: string): string {
  const sym = getCurrencySymbol(currency);
  return `${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function generateInvoiceHtml(q: QuoteData): string {
  const sym = getCurrencySymbol(q.currency);
  const hwItems = q.lineItems.filter(i => i.category === "hardware");
  const swItems = q.lineItems.filter(i => i.category === "saas" || i.category === "software");
  const otherItems = q.lineItems.filter(i => i.category !== "hardware" && i.category !== "saas" && i.category !== "software");

  const depositAmt = q.total * (q.paymentTermDeposit / 100);
  const productionAmt = q.total * (q.paymentTermProduction / 100);
  const installAmt = q.total * (q.paymentTermInstall / 100);

  const lineRow = (item: QuoteLineItemData) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:500;font-size:13px;">${item.name}</div>
        ${item.description ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${item.description}</div>` : ""}
        ${item.isRecurring ? `<div style="font-size:10px;color:#3b82f6;margin-top:2px;">Annual subscription</div>` : ""}
      </td>
      <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.qty}</td>
      <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.listPrice > 0 ? fmt(item.listPrice, q.currency) : "—"}</td>
      <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}</td>
      <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:13px;">${fmt(item.unitPrice, q.currency)}</td>
      <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:500;">${fmt(item.lineTotal, q.currency)}</td>
    </tr>`;

  const sectionHeader = (label: string, color: string) => `
    <tr>
      <td colspan="6" style="padding:8px 12px;background:${color};font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#374151;">${label}</td>
    </tr>`;

  let lineItemsHtml = "";
  if (hwItems.length > 0) {
    lineItemsHtml += sectionHeader("Hardware", "#f0fdf4");
    hwItems.forEach(i => { lineItemsHtml += lineRow(i); });
  }
  if (swItems.length > 0) {
    lineItemsHtml += sectionHeader("Software / SaaS", "#eff6ff");
    swItems.forEach(i => { lineItemsHtml += lineRow(i); });
  }
  if (otherItems.length > 0) {
    lineItemsHtml += sectionHeader("Other", "#fafafa");
    otherItems.forEach(i => { lineItemsHtml += lineRow(i); });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pro Forma Invoice ${q.quoteNumber} — VoltSafe Inc.</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #111827; background: #fff; font-size: 14px; }
  .page { max-width: 900px; margin: 0 auto; padding: 40px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 20px; }
  }
  .print-btn { position: fixed; top: 20px; right: 20px; background: #1e3a5f; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 3px solid #1e3a5f; }
  .company-info h1 { font-size: 24px; font-weight: 800; color: #1e3a5f; letter-spacing: -0.5px; }
  .company-info p { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .invoice-meta { text-align: right; }
  .invoice-meta .invoice-title { font-size: 28px; font-weight: 800; color: #1e3a5f; text-transform: uppercase; letter-spacing: 2px; }
  .invoice-meta .invoice-number { font-size: 16px; font-weight: 700; color: #374151; margin-top: 4px; font-family: monospace; }
  .invoice-meta .invoice-date { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .info-box h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #9ca3af; font-weight: 700; margin-bottom: 8px; }
  .info-box p { font-size: 13px; color: #374151; line-height: 1.5; }
  .info-box .strong { font-weight: 600; font-size: 14px; color: #111827; }
  .entitlement-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 28px; display: flex; gap: 24px; flex-wrap: wrap; }
  .entitlement-box .field { flex: 1; min-width: 180px; }
  .entitlement-box .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #3b82f6; font-weight: 700; }
  .entitlement-box .value { font-size: 13px; color: #1e40af; font-weight: 600; margin-top: 2px; }
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .items-table th { background: #1e3a5f; color: #fff; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
  .items-table th.right { text-align: right; }
  .items-table th.center { text-align: center; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { width: 320px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
  .totals-row.subtotal { color: #374151; }
  .totals-row.tax { color: #374151; }
  .totals-row.total { font-size: 18px; font-weight: 800; color: #1e3a5f; padding: 12px 0 4px; border-bottom: 2px solid #1e3a5f; border-top: 2px solid #1e3a5f; margin-top: 4px; }
  .payment-section { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .payment-section h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #166534; margin-bottom: 12px; }
  .payment-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .payment-item { text-align: center; background: #fff; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; }
  .payment-item .pct { font-size: 20px; font-weight: 800; color: #166534; }
  .payment-item .label { font-size: 10px; color: #6b7280; margin: 2px 0; }
  .payment-item .amount { font-size: 13px; font-weight: 700; color: #111827; }
  .terms-section { font-size: 11px; color: #6b7280; line-height: 1.6; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  .terms-section h4 { font-size: 11px; font-weight: 700; color: #374151; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 2px solid #1e3a5f; display: flex; justify-content: space-between; align-items: center; }
  .footer .voltsafe { font-weight: 800; font-size: 14px; color: #1e3a5f; }
  .footer .website { font-size: 11px; color: #6b7280; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge-draft { background: #f3f4f6; color: #6b7280; }
  .badge-sent { background: #dbeafe; color: #1d4ed8; }
  .badge-accepted { background: #dcfce7; color: #166534; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save PDF</button>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="company-info">
      <h1>VoltSafe Inc.</h1>
      <p>1090 W Georgia St, Suite 1100</p>
      <p>Vancouver, BC V6E 3V7, Canada</p>
      <p>hello@voltsafe.com · voltsafe.com</p>
    </div>
    <div class="invoice-meta">
      <div class="invoice-title">Pro Forma Invoice</div>
      <div class="invoice-number">${q.quoteNumber}</div>
      <div class="invoice-date">Issue Date: ${fmtDate(q.createdAt)}</div>
      ${q.validUntil ? `<div class="invoice-date">Valid Until: ${fmtDate(q.validUntil)}</div>` : ""}
      <div style="margin-top:8px;"><span class="badge badge-${q.status}">${q.status}</span></div>
    </div>
  </div>

  <!-- Bill To / Site Info -->
  <div class="info-grid">
    <div class="info-box">
      <h3>Bill To</h3>
      ${q.customerName ? `<p class="strong">${q.customerName}</p>` : ""}
      ${q.customerEmail ? `<p>${q.customerEmail}</p>` : ""}
      ${q.customerPhone ? `<p>${q.customerPhone}</p>` : ""}
      ${q.marinaAddress ? `<p style="margin-top:6px;">${q.marinaAddress.replace(/\n/g, "<br>")}</p>` : ""}
    </div>
    <div class="info-box">
      <h3>Site / Installation Address</h3>
      ${q.siteAddress ? `<p>${q.siteAddress.replace(/\n/g, "<br>")}</p>` : `<p style="color:#9ca3af;">Same as billing address</p>`}
      ${q.slipsCount ? `<p style="margin-top:8px;"><strong>Slip Count:</strong> ${q.slipsCount}</p>` : ""}
      <p style="margin-top:8px;"><strong>Currency:</strong> ${q.currency} (${getCurrencySymbol(q.currency)})</p>
    </div>
  </div>

  <!-- Entitlement / License Info -->
  ${(q.entitlementNumber || q.licensedTo || q.billingPeriodStart) ? `
  <div class="entitlement-box">
    ${q.entitlementNumber ? `<div class="field"><div class="label">Entitlement #</div><div class="value">${q.entitlementNumber}</div></div>` : ""}
    ${q.licensedTo ? `<div class="field"><div class="label">Licensed To</div><div class="value">${q.licensedTo}</div></div>` : ""}
    ${q.billingPeriodStart ? `<div class="field"><div class="label">Billing Period</div><div class="value">${q.billingPeriodStart}${q.billingPeriodEnd ? ` — ${q.billingPeriodEnd}` : ""}</div></div>` : ""}
  </div>` : ""}

  <!-- Line Items -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:40%;">Description</th>
        <th class="center" style="width:8%;">Qty</th>
        <th class="right" style="width:14%;">List Price</th>
        <th class="center" style="width:10%;">Disc. %</th>
        <th class="right" style="width:14%;">Unit Price</th>
        <th class="right" style="width:14%;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHtml}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals-section">
    <div class="totals-box">
      ${q.hardwareSubtotal > 0 ? `<div class="totals-row subtotal"><span>Hardware Subtotal</span><span>${fmt(q.hardwareSubtotal, q.currency)}</span></div>` : ""}
      ${q.softwareSubtotal > 0 ? `<div class="totals-row subtotal"><span>Software Subtotal</span><span>${fmt(q.softwareSubtotal, q.currency)}</span></div>` : ""}
      <div class="totals-row subtotal"><span>Subtotal</span><span>${fmt(q.subtotal, q.currency)}</span></div>
      ${q.taxRate > 0 ? `<div class="totals-row tax"><span>Tax (${(q.taxRate * 100).toFixed(0)}%)</span><span>${fmt(q.taxAmount, q.currency)}</span></div>` : ""}
      <div class="totals-row total"><span>TOTAL DUE</span><span>${fmt(q.total, q.currency)}</span></div>
    </div>
  </div>

  <!-- Payment Terms -->
  <div class="payment-section">
    <h3>Payment Terms</h3>
    <div class="payment-grid">
      <div class="payment-item">
        <div class="pct">${q.paymentTermDeposit}%</div>
        <div class="label">Deposit (upon signing)</div>
        <div class="amount">${fmt(depositAmt, q.currency)}</div>
      </div>
      <div class="payment-item">
        <div class="pct">${q.paymentTermProduction}%</div>
        <div class="label">Production (build start)</div>
        <div class="amount">${fmt(productionAmt, q.currency)}</div>
      </div>
      <div class="payment-item">
        <div class="pct">${q.paymentTermInstall}%</div>
        <div class="label">Installation (delivery)</div>
        <div class="amount">${fmt(installAmt, q.currency)}</div>
      </div>
    </div>
  </div>

  <!-- Notes / Assumptions -->
  ${q.notes ? `<div style="margin-bottom:16px;"><h4 style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Notes</h4><p style="font-size:12px;color:#374151;white-space:pre-wrap;">${q.notes}</p></div>` : ""}
  ${q.assumptions ? `<div style="margin-bottom:16px;"><h4 style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Assumptions</h4><p style="font-size:12px;color:#374151;white-space:pre-wrap;">${q.assumptions}</p></div>` : ""}
  ${q.exclusions ? `<div style="margin-bottom:16px;"><h4 style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Exclusions</h4><p style="font-size:12px;color:#374151;white-space:pre-wrap;">${q.exclusions}</p></div>` : ""}

  <!-- Wire Transfer -->
  <div class="terms-section">
    <h4>Wire Transfer / Payment Information</h4>
    <p>Bank: RBC Royal Bank of Canada · Account Name: VoltSafe Inc. · Transit: 04652 · Institution: 003 · Account: 1007183</p>
    <p style="margin-top:6px;">Please reference invoice number <strong>${q.quoteNumber}</strong> in your payment.</p>
    <p style="margin-top:10px;font-style:italic;">This is a pro forma invoice. Goods and services will be provided upon receipt of deposit payment. All prices are in ${q.currency} and exclude applicable taxes unless noted. This quote is valid for 30 days from issue date. VoltSafe Inc. reserves the right to adjust pricing after expiry.</p>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>
      <div class="voltsafe">VoltSafe Inc.</div>
      <div class="website">voltsafe.com</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af;">
      <div>${q.quoteNumber} · v${q.version}</div>
      <div>Generated ${fmtDate(new Date())}</div>
    </div>
  </div>

</div>
<script>
  // Auto-print when opened with ?print=1
  if (window.location.search.includes('print=1')) {
    window.addEventListener('load', () => setTimeout(() => window.print(), 300));
  }
</script>
</body>
</html>`;
}

export async function generateQuoteXlsx(q: QuoteData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "VoltSafe CRM";
  wb.created = new Date();

  const ws = wb.addWorksheet("Invoice", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });

  ws.columns = [
    { key: "a", width: 38 },
    { key: "b", width: 10 },
    { key: "c", width: 14 },
    { key: "d", width: 10 },
    { key: "e", width: 14 },
    { key: "f", width: 14 },
  ];

  const navyFill: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e3a5f" } };
  const greenFill: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFf0fdf4" } };
  const blueFill: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFeff6ff" } };
  const grayFill: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFf9fafb" } };
  const lightBorder: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFe5e7eb" } };
  const borders = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };

  let row = 1;

  const addHeader = () => {
    ws.mergeCells(`A${row}:F${row}`);
    const r = ws.getRow(row);
    r.getCell("A").value = "VoltSafe Inc. — Pro Forma Invoice";
    r.getCell("A").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    r.getCell("A").fill = navyFill;
    r.getCell("A").alignment = { horizontal: "left", vertical: "middle" };
    r.height = 32;
    row++;

    ws.mergeCells(`A${row}:C${row}`);
    ws.mergeCells(`D${row}:F${row}`);
    const r2 = ws.getRow(row);
    r2.getCell("A").value = "1090 W Georgia St, Suite 1100, Vancouver BC V6E 3V7 · hello@voltsafe.com · voltsafe.com";
    r2.getCell("A").font = { size: 9, color: { argb: "FF6b7280" } };
    r2.getCell("D").value = q.quoteNumber;
    r2.getCell("D").font = { bold: true, size: 12, color: { argb: "FF1e3a5f" } };
    r2.getCell("D").alignment = { horizontal: "right" };
    row += 2;
  };

  const addInfoRow = (label: string, value: string) => {
    const r = ws.getRow(row);
    r.getCell("A").value = label;
    r.getCell("A").font = { bold: true, size: 10, color: { argb: "FF374151" } };
    r.getCell("B").value = value;
    r.getCell("B").font = { size: 10 };
    ws.mergeCells(`B${row}:F${row}`);
    row++;
  };

  const addSectionHeader = (label: string, fill: ExcelJS.FillPattern) => {
    ws.mergeCells(`A${row}:F${row}`);
    const r = ws.getRow(row);
    r.getCell("A").value = label.toUpperCase();
    r.getCell("A").font = { bold: true, size: 10, color: { argb: "FF374151" } };
    r.getCell("A").fill = fill;
    r.getCell("A").alignment = { horizontal: "left" };
    r.height = 22;
    row++;
  };

  const addTableHeader = () => {
    const r = ws.getRow(row);
    ["Description", "Qty", "List Price", "Disc %", "Unit Price", "Total"].forEach((h, ci) => {
      const cell = r.getCell(ci + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = navyFill;
      cell.alignment = { horizontal: ci > 0 ? "right" : "left", vertical: "middle" };
      cell.border = borders;
    });
    r.height = 22;
    row++;
  };

  const addLineRow = (item: QuoteLineItemData, altFill?: ExcelJS.FillPattern) => {
    const r = ws.getRow(row);
    const sym = getCurrencySymbol(q.currency);
    r.getCell(1).value = item.name + (item.description ? `\n${item.description}` : "");
    r.getCell(1).font = { size: 10 };
    if (altFill) r.getCell(1).fill = altFill;
    r.getCell(2).value = item.qty;
    r.getCell(2).alignment = { horizontal: "right" };
    r.getCell(3).value = item.listPrice > 0 ? item.listPrice : "";
    r.getCell(3).numFmt = item.listPrice > 0 ? `"${sym}"#,##0.00` : "";
    r.getCell(3).alignment = { horizontal: "right" };
    r.getCell(4).value = item.discountPercent > 0 ? item.discountPercent / 100 : "";
    r.getCell(4).numFmt = item.discountPercent > 0 ? "0%" : "";
    r.getCell(4).alignment = { horizontal: "right" };
    r.getCell(5).value = item.unitPrice;
    r.getCell(5).numFmt = `"${sym}"#,##0.00`;
    r.getCell(5).alignment = { horizontal: "right" };
    r.getCell(6).value = item.lineTotal;
    r.getCell(6).numFmt = `"${sym}"#,##0.00`;
    r.getCell(6).font = { bold: true, size: 10 };
    r.getCell(6).alignment = { horizontal: "right" };
    for (let c = 1; c <= 6; c++) {
      r.getCell(c).border = borders;
      if (altFill && c > 1) r.getCell(c).fill = altFill;
    }
    row++;
  };

  const addTotalRow = (label: string, amount: number, isBold = false, isTotal = false) => {
    ws.mergeCells(`A${row}:E${row}`);
    const r = ws.getRow(row);
    r.getCell("A").value = label;
    r.getCell("A").alignment = { horizontal: "right" };
    r.getCell("A").font = { bold: isBold, size: isTotal ? 12 : 10, color: isTotal ? { argb: "FF1e3a5f" } : undefined };
    r.getCell("F").value = amount;
    r.getCell("F").numFmt = `"${getCurrencySymbol(q.currency)}"#,##0.00`;
    r.getCell("F").font = { bold: isBold, size: isTotal ? 12 : 10, color: isTotal ? { argb: "FF1e3a5f" } : undefined };
    r.getCell("F").alignment = { horizontal: "right" };
    if (isTotal) {
      r.getCell("F").border = { top: { style: "medium", color: { argb: "FF1e3a5f" } }, bottom: { style: "medium", color: { argb: "FF1e3a5f" } } };
      r.height = 24;
    }
    row++;
  };

  addHeader();

  addInfoRow("Customer:", q.customerName || "");
  if (q.customerEmail) addInfoRow("Email:", q.customerEmail);
  if (q.marinaAddress) addInfoRow("Address:", q.marinaAddress);
  addInfoRow("Issue Date:", fmtDate(q.createdAt));
  if (q.validUntil) addInfoRow("Valid Until:", fmtDate(q.validUntil));
  addInfoRow("Currency:", q.currency);
  if (q.entitlementNumber) addInfoRow("Entitlement #:", q.entitlementNumber);
  if (q.licensedTo) addInfoRow("Licensed To:", q.licensedTo);
  if (q.billingPeriodStart) addInfoRow("Billing Period:", `${q.billingPeriodStart}${q.billingPeriodEnd ? ` – ${q.billingPeriodEnd}` : ""}`);
  row++;

  addTableHeader();

  const hwItems = q.lineItems.filter(i => i.category === "hardware");
  const swItems = q.lineItems.filter(i => i.category === "saas" || i.category === "software");
  const otherItems = q.lineItems.filter(i => i.category !== "hardware" && i.category !== "saas" && i.category !== "software");

  if (hwItems.length > 0) {
    addSectionHeader("Hardware", greenFill);
    hwItems.forEach(i => addLineRow(i, undefined));
  }
  if (swItems.length > 0) {
    addSectionHeader("Software / SaaS", blueFill);
    swItems.forEach(i => addLineRow(i, undefined));
  }
  if (otherItems.length > 0) {
    addSectionHeader("Other", grayFill);
    otherItems.forEach(i => addLineRow(i, undefined));
  }

  row++;
  if (q.hardwareSubtotal > 0) addTotalRow("Hardware Subtotal", q.hardwareSubtotal);
  if (q.softwareSubtotal > 0) addTotalRow("Software Subtotal", q.softwareSubtotal);
  addTotalRow("Subtotal", q.subtotal, true);
  if (q.taxRate > 0) addTotalRow(`Tax (${(q.taxRate * 100).toFixed(0)}%)`, q.taxAmount);
  addTotalRow("TOTAL DUE", q.total, true, true);

  row += 2;
  ws.mergeCells(`A${row}:F${row}`);
  ws.getRow(row).getCell("A").value = `PAYMENT TERMS: ${q.paymentTermDeposit}% deposit (${getCurrencySymbol(q.currency)}${(q.total * q.paymentTermDeposit / 100).toFixed(2)}) upon signing · ${q.paymentTermProduction}% on production start · ${q.paymentTermInstall}% on delivery`;
  ws.getRow(row).getCell("A").font = { bold: true, size: 10, color: { argb: "FF166534" } };
  ws.getRow(row).getCell("A").fill = greenFill;
  row++;

  row++;
  ws.mergeCells(`A${row}:F${row}`);
  ws.getRow(row).getCell("A").value = "Wire Transfer: RBC Royal Bank · VoltSafe Inc. · Transit: 04652 · Institution: 003 · Account: 1007183";
  ws.getRow(row).getCell("A").font = { size: 9, color: { argb: "FF6b7280" } };

  if (q.notes) {
    row++;
    ws.mergeCells(`A${row}:F${row}`);
    ws.getRow(row).getCell("A").value = `Notes: ${q.notes}`;
    ws.getRow(row).getCell("A").font = { size: 9, italic: true, color: { argb: "FF374151" } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
