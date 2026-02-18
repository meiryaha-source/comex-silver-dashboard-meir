import * as XLSX from "xlsx";

export const runtime = "nodejs";

const CME_XLS_URL = "https://www.cmegroup.com/delivery_reports/Silver_stocks.xls";

function toNumberSafe(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toDateISO(mdy) {
  const s = String(mdy || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  return new Date(Date.UTC(yyyy, mm - 1, dd)).toISOString().slice(0, 10);
}

export async function GET() {
  const res = await fetch(CME_XLS_URL, { cache: "no-store" });
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `Failed to fetch CME XLS: ${res.status}` },
      { status: 502 }
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  // Parse report/activity dates (usually near top)
  let reportDate = null;
  let activityDate = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const joined = (rows[i] || []).map(x => String(x ?? "").trim()).join(" ").toUpperCase();
    const rd = joined.match(/REPORT\s+DATE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (rd && !reportDate) reportDate = toDateISO(rd[1]);
    const ad = joined.match(/ACTIVITY\s+DATE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (ad && !activityDate) activityDate = toDateISO(ad[1]);
  }

  // Find header row containing REGISTERED and ELIGIBLE
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 120); i++) {
    const line = (rows[i] || []).map((x) => String(x ?? "").toUpperCase());
    if (line.some((x) => x.includes("REGISTERED")) && line.some((x) => x.includes("ELIGIBLE"))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return Response.json(
      { ok: false, error: "Could not locate header row (REGISTERED/ELIGIBLE) in XLS." },
      { status: 500 }
    );
  }

  const header = rows[headerRowIdx].map((v) => String(v ?? "").toUpperCase());
  const idxDepository = 0;
  const idxRegistered = header.findIndex((x) => x.includes("REGISTERED"));
  const idxEligible = header.findIndex((x) => x.includes("ELIGIBLE"));
  const idxTotal = header.findIndex((x) => x.includes("TOTAL"));
  const idxPrevTotal = header.findIndex((x) => x.includes("PREV") && x.includes("TOTAL"));
  const idxChange = header.findIndex((x) => x === "CHANGE" || (x.includes("CHANGE") && !x.includes("%")));

  // Read depository rows until TOTAL
  const depositories = [];
  let totalRow = null;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const dep = String(r[idxDepository] ?? "").trim();

    if (!dep) continue;

    const depUpper = dep.toUpperCase();
    if (depUpper.includes("TOTAL")) {
      totalRow = r;
      break;
    }

    const registeredOz = toNumberSafe(r[idxRegistered]);
    const eligibleOz = toNumberSafe(r[idxEligible]);
    const totalOz = idxTotal >= 0 ? toNumberSafe(r[idxTotal]) : ((registeredOz ?? 0) + (eligibleOz ?? 0));
    const prevTotalOz = idxPrevTotal >= 0 ? toNumberSafe(r[idxPrevTotal]) : null;
    const changeOz = idxChange >= 0 ? toNumberSafe(r[idxChange]) : (prevTotalOz != null && totalOz != null ? totalOz - prevTotalOz : null);

    // Keep only rows that actually have data
    if (registeredOz == null && eligibleOz == null && totalOz == null) continue;

    depositories.push({
      depository: dep,
      registeredOz,
      eligibleOz,
      totalOz,
      changeOz
    });
  }

  if (!totalRow) {
    return Response.json(
      { ok: false, error: "Could not locate totals row in XLS." },
      { status: 500 }
    );
  }

  const registeredOz = toNumberSafe(totalRow[idxRegistered]);
  const eligibleOz = toNumberSafe(totalRow[idxEligible]);
  const totalOz = idxTotal >= 0 ? toNumberSafe(totalRow[idxTotal]) : (
    (registeredOz ?? 0) + (eligibleOz ?? 0)
  );
  const prevTotalOz = idxPrevTotal >= 0 ? toNumberSafe(totalRow[idxPrevTotal]) : null;

  const changeOz = (prevTotalOz != null && totalOz != null) ? (totalOz - prevTotalOz) : null;
  const changePct = (prevTotalOz != null && totalOz != null && prevTotalOz !== 0) ? (changeOz / prevTotalOz) * 100 : null;

  const registeredSharePct = (totalOz && registeredOz != null) ? (registeredOz / totalOz) * 100 : null;
  const eligibleSharePct = (totalOz && eligibleOz != null) ? (eligibleOz / totalOz) * 100 : null;

  // Biggest movers today
  const movers = [...depositories]
    .filter(d => d.changeOz != null)
    .sort((a,b) => Math.abs(b.changeOz) - Math.abs(a.changeOz))
    .slice(0, 5);

  // Top depositories by total
  const topByTotal = [...depositories]
    .filter(d => d.totalOz != null)
    .sort((a,b) => (b.totalOz ?? 0) - (a.totalOz ?? 0))
    .slice(0, 8);

  return new Response(
    JSON.stringify({
      ok: true,
      source: CME_XLS_URL,
      activityDate,
      reportDate,
      registeredOz,
      eligibleOz,
      totalOz,
      prevTotalOz,
      changeOz,
      changePct,
      registeredSharePct,
      eligibleSharePct,
      topByTotal,
      movers,
      fetchedAt: new Date().toISOString(),
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
