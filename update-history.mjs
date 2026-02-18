import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const CME_XLS_URL = "https://www.cmegroup.com/delivery_reports/Silver_stocks.xls";
const OUT_PATH = path.join(process.cwd(), "public", "data", "history.json");

function toNumberSafe(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toDateISO(mdyOrDmy) {
  // Accept '2/13/2026' or '02/13/2026'
  const s = String(mdyOrDmy || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.toISOString().slice(0, 10);
}

async function main() {
  const res = await fetch(CME_XLS_URL, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status}`);
    process.exit(1);
  }

  const arrayBuffer = await res.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  // Find "Report Date" and "Activity Date" lines (usually near top)
  let reportDate = null;
  let activityDate = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const line = (rows[i] || []).map(x => String(x ?? "").trim());
    const joined = line.join(" ").toUpperCase();

    // Example: "Report Date: 2/13/2026"
    const rd = joined.match(/REPORT\s+DATE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (rd && !reportDate) reportDate = toDateISO(rd[1]);

    // Example: "Activity Date: 2/12/2026"
    const ad = joined.match(/ACTIVITY\s+DATE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (ad && !activityDate) activityDate = toDateISO(ad[1]);
  }

  // Find header row containing REGISTERED and ELIGIBLE
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    const line = (rows[i] || []).map(x => String(x ?? "").toUpperCase());
    if (line.some(x => x.includes("REGISTERED")) && line.some(x => x.includes("ELIGIBLE"))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    console.error("Could not locate header row.");
    process.exit(1);
  }

  const header = rows[headerRowIdx].map(v => String(v ?? "").toUpperCase());
  const idxRegistered = header.findIndex(x => x.includes("REGISTERED"));
  const idxEligible = header.findIndex(x => x.includes("ELIGIBLE"));
  const idxTotal = header.findIndex(x => x.includes("TOTAL"));
  const idxPrevTotal = header.findIndex(x => x.includes("PREV") && x.includes("TOTAL"));

  // Locate totals row (first column contains TOTAL)
  let totalRow = null;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const firstCell = String((rows[i] || [])[0] ?? "").toUpperCase();
    if (firstCell.includes("TOTAL")) {
      totalRow = rows[i];
      break;
    }
  }
  if (!totalRow) {
    console.error("Could not locate totals row.");
    process.exit(1);
  }

  const registeredOz = toNumberSafe(totalRow[idxRegistered]);
  const eligibleOz = toNumberSafe(totalRow[idxEligible]);
  const totalOz = idxTotal >= 0 ? toNumberSafe(totalRow[idxTotal]) : ((registeredOz ?? 0) + (eligibleOz ?? 0));
  const prevTotalOz = idxPrevTotal >= 0 ? toNumberSafe(totalRow[idxPrevTotal]) : null;

  const changeOz = (prevTotalOz != null && totalOz != null) ? (totalOz - prevTotalOz) : null;
  const changePct = (prevTotalOz != null && totalOz != null && prevTotalOz !== 0) ? (changeOz / prevTotalOz) * 100 : null;

  const pointDate = activityDate || reportDate || new Date().toISOString().slice(0, 10);

  const newPoint = {
    date: pointDate,         // YYYY-MM-DD
    reportDate: reportDate,  // YYYY-MM-DD or null
    registeredOz,
    eligibleOz,
    totalOz,
    prevTotalOz,
    changeOz,
    changePct
  };

  let hist = [];
  try {
    hist = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    if (!Array.isArray(hist)) hist = [];
  } catch {
    hist = [];
  }

  // Upsert by date
  const idx = hist.findIndex(p => p.date === newPoint.date);
  if (idx >= 0) hist[idx] = newPoint;
  else hist.push(newPoint);

  // Sort + keep last 120 points
  hist.sort((a,b) => String(a.date).localeCompare(String(b.date)));
  if (hist.length > 120) hist = hist.slice(hist.length - 120);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(hist, null, 2) + "\n");

  console.log("Updated history with:", newPoint);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
