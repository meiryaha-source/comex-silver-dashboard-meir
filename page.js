"use client";

import { useEffect, useMemo, useState } from "react";

function fmt(n) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
function fmtShort(n) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(Math.round(n));
}
function fmtPct(n, digits = 2) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
function sign(n) {
  if (n === null || n === undefined || !isFinite(n)) return "";
  return n > 0 ? "+" : "";
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export default function Home() {
  const [live, setLive] = useState(null);
  const [hist, setHist] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setErr("");

      const [rLive, rHist] = await Promise.all([
        fetch("/api/comex-silver", { cache: "no-store" }),
        fetch("/data/history.json", { cache: "no-store" }),
      ]);

      const jLive = await rLive.json();
      const jHist = await rHist.json().catch(() => []);

      if (!jLive.ok) setErr(jLive.error || "שגיאה");
      setLive(jLive);

      if (Array.isArray(jHist)) setHist(jHist);
      else setHist([]);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const histSorted = useMemo(() => {
    const a = Array.isArray(hist) ? hist.slice() : [];
    a.sort((x,y) => String(x.date).localeCompare(String(y.date)));
    return a.filter(p => typeof p.totalOz === "number" && isFinite(p.totalOz));
  }, [hist]);

  const last30 = useMemo(() => histSorted.slice(Math.max(0, histSorted.length - 30)), [histSorted]);
  const last60 = useMemo(() => histSorted.slice(Math.max(0, histSorted.length - 60)), [histSorted]);

  const stats30 = useMemo(() => computeStats(last30), [last30]);
  const stats7 = useMemo(() => computeStats(histSorted.slice(Math.max(0, histSorted.length - 7))), [histSorted]);

  const trend = useMemo(() => {
    // Simple trend score based on last30 slope
    if (last30.length < 2) return { score: 0, label: "אין מספיק היסטוריה", dir: "flat" };
    const first = last30[0].totalOz;
    const last = last30[last30.length - 1].totalOz;
    const ch = last - first;
    const pct = (first ? (ch / first) * 100 : 0);
    const dir = Math.abs(pct) < 0.15 ? "flat" : (pct > 0 ? "up" : "down");
    const score = clamp(Math.abs(pct) / 2.5, 0, 1); // 0..1
    const label = `${sign(pct)}${fmtPct(pct, 2)} ב-30 יום`;
    return { score, label, dir };
  }, [last30]);

  const interesting = useMemo(() => {
    if (!live?.ok) return null;
    const t = live.totalOz ?? null;
    const reg = live.registeredOz ?? null;
    const eli = live.eligibleOz ?? null;

    const regShare = live.registeredSharePct ?? null;
    const eliShare = live.eligibleSharePct ?? null;
    const regEliRatio = (reg != null && eli != null && eli !== 0) ? reg / eli : null;

    const dailyMoveOz = live.changeOz ?? null;
    const dailyMovePct = live.changePct ?? null;

    // Simple “pressure” heuristic (NOT a prediction): more pressure when Registered share is low AND recent outflows are strong.
    const outflow30 = stats30.change != null ? -stats30.change : null; // positive = outflow
    const outflow30pct = (stats30.first && stats30.last) ? ((stats30.first - stats30.last) / stats30.first) * 100 : null;

    let pressure = null;
    if (regShare != null && outflow30pct != null) {
      const lowReg = clamp((25 - regShare) / 25, 0, 1);          // 0 when regShare>=25%
      const outflow = clamp(outflow30pct / 6, 0, 1);             // 1 at ~6% outflow/30d
      pressure = clamp(0.55 * lowReg + 0.45 * outflow, 0, 1);    // 0..1
    }

    return { regShare, eliShare, regEliRatio, t, reg, eli, dailyMoveOz, dailyMovePct, pressure };
  }, [live, stats30]);

  const alerts = useMemo(() => {
    const a = [];
    if (!live?.ok) return a;

    if (live.changePct != null && Math.abs(live.changePct) >= 1.0) {
      a.push({ type: live.changePct > 0 ? "up" : "down", title: "שינוי יומי חריג", desc: `${sign(live.changePct)}${fmtPct(live.changePct, 2)} מול היום הקודם` });
    }
    if (stats30.changePct != null && Math.abs(stats30.changePct) >= 3.0) {
      a.push({ type: stats30.changePct > 0 ? "up" : "down", title: "תנועה חזקה ב-30 יום", desc: `${sign(stats30.changePct)}${fmtPct(stats30.changePct, 2)} ב-30 יום` });
    }
    if (interesting?.regShare != null && interesting.regShare < 15) {
      a.push({ type: "warn", title: "Registered נמוך יחסית", desc: `רק ${fmtPct(interesting.regShare, 2)} מהסה״כ נמצא ב-Registered` });
    }
    if (interesting?.pressure != null && interesting.pressure >= 0.75) {
      a.push({ type: "warn", title: "לחץ גבוה במדד פנימי", desc: "שילוב של Registered נמוך + ירידה מצטברת ב-30 יום (אינדיקציה פנימית, לא ניבוי)." });
    }
    return a.slice(0, 4);
  }, [live, stats30, interesting]);

  return (
    <main style={{ maxWidth: 1120, margin: "40px auto", padding: 16, fontFamily: "system-ui", direction: "rtl" }}>
      <TopBar loading={loading} onRefresh={load} live={live} />

      {err && <ErrorBox err={err} />}

      <section style={grid2}>
        <GlassPanel>
          <SectionTitle title="מדדי ליבה" subtitle="הנתונים הרשמיים מתוך הדוח היומי של CME" />
          <div style={kpiGrid}>
            <KPI
              label="סה״כ מלאי (Total)"
              value={fmt(live?.totalOz)}
              sub={live?.activityDate ? `תאריך פעילות: ${live.activityDate}` : (live?.reportDate ? `דוח: ${live.reportDate}` : "")}
              right={<Sparkline data={last30.map(d => d.totalOz)} />}
            />
            <KPI
              label="Registered (זמין למסירה)"
              value={fmt(live?.registeredOz)}
              sub={interesting ? `נתח מהסה״כ: ${fmtPct(interesting.regShare, 2)}` : ""}
            />
            <KPI
              label="Eligible (עומד בתקן)"
              value={fmt(live?.eligibleOz)}
              sub={interesting ? `נתח מהסה״כ: ${fmtPct(interesting.eliShare, 2)}` : ""}
            />
            <KPI
              label="שינוי יומי"
              value={live?.changeOz == null ? "—" : `${sign(live.changeOz)}${fmt(live.changeOz)} oz`}
              sub={live?.changePct == null ? "" : `${sign(live.changePct)}${fmtPct(live.changePct, 3)} מול Prev Total`}
              accent={live?.changeOz != null ? (live.changeOz >= 0 ? "up" : "down") : "neutral"}
            />
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <MiniCard title="טרנד 30 יום" value={trend.label} badge={trend.dir} />
            <MiniCard title="ממוצע שינוי יומי (7 ימים)" value={stats7.avgDailyChange == null ? "—" : `${sign(stats7.avgDailyChange)}${fmtShort(stats7.avgDailyChange)} oz`} />
            <MiniCard title="טווח 30 יום" value={(stats30.min != null && stats30.max != null) ? `${fmtShort(stats30.min)} → ${fmtShort(stats30.max)}` : "—"} />
            <MiniCard title="יחס Registered / Eligible" value={interesting?.regEliRatio == null ? "—" : interesting.regEliRatio.toFixed(3)} />
          </div>
        </GlassPanel>

        <GlassPanel>
          <SectionTitle title="גרף 30 יום" subtitle="סה״כ מלאי (Total) + קריאת מצב" />
          <div style={{ marginTop: 10 }}>
            <LineChart
              data={last30.map(d => ({ x: d.date, y: d.totalOz }))}
              height={250}
              valueFormatter={(v) => fmtShort(v)}
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <MiniCard title="שינוי מצטבר 30 יום" value={stats30.change == null ? "—" : `${sign(stats30.change)}${fmtShort(stats30.change)} oz`} badge={stats30.change != null ? (stats30.change >= 0 ? "up" : "down") : "flat"} />
            <MiniCard title="אחוז שינוי 30 יום" value={stats30.changePct == null ? "—" : `${sign(stats30.changePct)}${fmtPct(stats30.changePct, 2)}`} badge={stats30.changePct != null ? (stats30.changePct >= 0 ? "up" : "down") : "flat"} />
            <MiniCard title="סטיית תקן 30 יום" value={stats30.std == null ? "—" : `${fmtShort(stats30.std)} oz`} />
            <MiniCard title="עודכן באתר" value={live?.fetchedAt ? new Date(live.fetchedAt).toLocaleString("he-IL") : "—"} />
          </div>

          {alerts?.length ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>התראות (חוקים פשוטים)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                {alerts.map((a, i) => <AlertCard key={i} {...a} />)}
              </div>
            </div>
          ) : null}
        </GlassPanel>
      </section>

      <section style={{ marginTop: 16, ...grid2 }}>
        <GlassPanel>
          <SectionTitle title="מחסנים גדולים" subtitle="Top 8 לפי סה״כ מלאי" />
          <Table rows={live?.topByTotal || []} showChange={false} />
        </GlassPanel>
        <GlassPanel>
          <SectionTitle title="מי זז הכי הרבה היום" subtitle="Top 5 לפי גודל שינוי" />
          <Table rows={live?.movers || []} showChange />
        </GlassPanel>
      </section>

      <section style={{ marginTop: 16 }}>
        <GlassPanel>
          <SectionTitle title="הורדות וכלים" subtitle="מועיל לשיתוף/בדיקה" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <ActionCard
              title="הורד היסטוריה (JSON)"
              desc="הקובץ שמזין את הגרף"
              cta="הורדה"
              href="/data/history.json"
            />
            <ActionCard
              title="פתח מקור רשמי"
              desc="CME – Silver_stocks.xls"
              cta="פתיחה"
              href={live?.source || "https://www.cmegroup.com/delivery_reports/Silver_stocks.xls"}
              external
            />
            <ActionCard
              title="הורד CSV (30 יום)"
              desc="הכי נוח לאקסל/Sheets"
              cta="הורדה"
              onClick={() => downloadCSV(last30)}
            />
            <ActionCard
              title="הסבר קצר"
              desc="מה זה Registered/Eligible?"
              cta="קריאה"
              onClick={() => alert("Registered = מלאי במעמד 'deliverable' למסירה. Eligible = עומד בתקן אך לא מסומן למסירה. Total = סך הכל במחסני COMEX לפי הדוח היומי של CME.")}
            />
          </div>
        </GlassPanel>
      </section>

      <footer style={{ marginTop: 18, opacity: 0.75, fontSize: 12, lineHeight: 1.7 }}>
        הערה: הדוח מתעדכן לרוב פעם ביום. “שינוי יומי” מחושב מול העמודה <span style={{ fontFamily: "monospace" }}>Prev Total</span> בדוח.
        <div style={{ marginTop: 6, opacity: 0.8 }}>
          היסטוריית 30 יום נוצרת אוטומטית על ידי GitHub Actions (סקריפט שמעדכן את <span style={{ fontFamily: "monospace" }}>public/data/history.json</span> פעם ביום).
        </div>
      </footer>

      {/* Reminder pill */}
      <div style={reminderStyle} title="תזכורת">
        Not your keys, not your coin
      </div>
    </main>
  );
}

/* ---------- helpers ---------- */

function computeStats(points) {
  const p = (points || []).filter(x => typeof x.totalOz === "number" && isFinite(x.totalOz));
  if (!p.length) return { min: null, max: null, first: null, last: null, change: null, changePct: null, std: null, avgDailyChange: null };
  const ys = p.map(x => x.totalOz);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const first = p[0].totalOz;
  const last = p[p.length - 1].totalOz;
  const change = last - first;
  const changePct = first ? (change / first) * 100 : null;

  // daily changes
  const diffs = [];
  for (let i = 1; i < p.length; i++) diffs.push(p[i].totalOz - p[i-1].totalOz);
  const avgDailyChange = diffs.length ? diffs.reduce((a,b)=>a+b,0)/diffs.length : null;

  // std dev
  const mean = ys.reduce((a,b)=>a+b,0)/ys.length;
  const variance = ys.length > 1 ? ys.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(ys.length-1) : 0;
  const std = Math.sqrt(variance);

  return { min, max, first, last, change, changePct, std, avgDailyChange };
}

function downloadCSV(points) {
  const rows = (points || []).map(p => ({
    date: p.date,
    totalOz: p.totalOz,
    registeredOz: p.registeredOz ?? "",
    eligibleOz: p.eligibleOz ?? "",
    changeOz: p.changeOz ?? "",
    changePct: p.changePct ?? ""
  }));

  const header = ["date","totalOz","registeredOz","eligibleOz","changeOz","changePct"];
  const lines = [header.join(",")].concat(rows.map(r => header.map(k => String(r[k] ?? "").replaceAll(",", "")).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "comex_silver_30d.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- UI components ---------- */

function TopBar({ loading, onRefresh, live }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 34, letterSpacing: 0.2 }}>דשבורד COMEX Silver</h1>
          <Badge kind="info">CME</Badge>
          {live?.ok ? <Badge kind="good">Live</Badge> : <Badge kind="muted">—</Badge>}
        </div>
        <p style={{ marginTop: 8, opacity: 0.82, maxWidth: 860, lineHeight: 1.55 }}>
          תצוגה מקצועית למלאי כסף במחסני COMEX: KPI, גרף 30 יום, טבלאות מחסנים ומדדים שימושיים למסחר/מעקב.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={onRefresh} disabled={loading} style={btnStyle(loading)}>
          {loading ? "טוען..." : "רענן"}
        </button>
      </div>
    </div>
  );
}

function GlassPanel({ children }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 22,
      border: "1px solid rgba(230,237,243,0.12)",
      background: "linear-gradient(180deg, rgba(230,237,243,0.08), rgba(230,237,243,0.05))",
      boxShadow: "0 12px 30px rgba(0,0,0,0.35)"
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {subtitle ? <div style={{ opacity: 0.75, fontSize: 13 }}>{subtitle}</div> : null}
      </div>
    </div>
  );
}

function Badge({ kind = "muted", children }) {
  const map = {
    good: { bg: "rgba(34,197,94,0.16)", br: "rgba(34,197,94,0.35)", tx: "rgba(187,247,208,0.98)" },
    info: { bg: "rgba(125,211,252,0.16)", br: "rgba(125,211,252,0.35)", tx: "rgba(186,230,253,0.98)" },
    warn: { bg: "rgba(251,191,36,0.16)", br: "rgba(251,191,36,0.35)", tx: "rgba(253,230,138,0.98)" },
    muted:{ bg: "rgba(230,237,243,0.10)", br: "rgba(230,237,243,0.18)", tx: "rgba(230,237,243,0.85)" }
  }[kind];

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 10px",
      borderRadius: 999,
      border: `1px solid ${map.br}`,
      background: map.bg,
      color: map.tx,
      fontSize: 12,
      fontWeight: 700
    }}>
      {children}
    </span>
  );
}

function KPI({ label, value, sub, accent = "neutral", right }) {
  const border = accent === "up" ? "rgba(34,197,94,0.38)" : accent === "down" ? "rgba(239,68,68,0.38)" : "rgba(230,237,243,0.12)";
  const bg = accent === "up" ? "rgba(34,197,94,0.10)" : accent === "down" ? "rgba(239,68,68,0.10)" : "rgba(11,18,32,0.45)";
  return (
    <div style={{ padding: 14, borderRadius: 18, background: bg, border: `1px solid ${border}`, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>{label}</div>
          <div style={{ marginTop: 6, fontSize: 32, fontWeight: 850, letterSpacing: 0.2 }}>{value}</div>
          {sub ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78 }}>{sub}</div> : null}
        </div>
        {right ? <div style={{ alignSelf: "center" }}>{right}</div> : null}
      </div>
    </div>
  );
}

function MiniCard({ title, value, badge }) {
  const kind = badge === "up" ? "good" : badge === "down" ? "warn" : badge === "flat" ? "muted" : "muted";
  return (
    <div style={{ padding: 14, borderRadius: 18, background: "rgba(11,18,32,0.45)", border: "1px solid rgba(230,237,243,0.12)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, opacity: 0.72 }}>{title}</div>
        {badge ? <Badge kind={kind}>{badge === "up" ? "↑" : badge === "down" ? "↓" : "•"}</Badge> : null}
      </div>
      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function AlertCard({ type, title, desc }) {
  const kind = type === "up" ? "good" : type === "down" ? "warn" : "warn";
  return (
    <div style={{ padding: 12, borderRadius: 18, border: "1px solid rgba(230,237,243,0.12)", background: "rgba(11,18,32,0.45)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 850 }}>{title}</div>
        <Badge kind={kind}>{type === "up" ? "Up" : type === "down" ? "Down" : "!"}</Badge>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

function Table({ rows, showChange }) {
  return (
    <div style={{ marginTop: 10, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "right", opacity: 0.75 }}>
            <th style={th}>מחסן</th>
            <th style={th}>סה״כ</th>
            <th style={th}>Registered</th>
            <th style={th}>Eligible</th>
            {showChange ? <th style={th}>Change</th> : null}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((r, idx) => (
            <tr key={idx} style={{ borderTop: "1px solid rgba(230,237,243,0.10)" }}>
              <td style={td}>{r.depository}</td>
              <td style={tdMono}>{fmtShort(r.totalOz)}</td>
              <td style={tdMono}>{fmtShort(r.registeredOz)}</td>
              <td style={tdMono}>{fmtShort(r.eligibleOz)}</td>
              {showChange ? (
                <td style={{ ...tdMono, color: r.changeOz > 0 ? "rgba(34,197,94,0.95)" : r.changeOz < 0 ? "rgba(239,68,68,0.95)" : "rgba(230,237,243,0.9)" }}>
                  {r.changeOz == null ? "—" : `${sign(r.changeOz)}${fmtShort(r.changeOz)}`}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionCard({ title, desc, cta, href, external, onClick }) {
  const Comp = href ? "a" : "button";
  const props = href
    ? { href, target: external ? "_blank" : undefined, rel: external ? "noreferrer" : undefined }
    : { onClick };

  return (
    <div style={{ padding: 14, borderRadius: 18, background: "rgba(11,18,32,0.45)", border: "1px solid rgba(230,237,243,0.12)" }}>
      <div style={{ fontSize: 13, fontWeight: 850 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78, lineHeight: 1.55 }}>{desc}</div>

      <Comp
        {...props}
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 14,
          border: "1px solid rgba(230,237,243,0.16)",
          background: "rgba(230,237,243,0.10)",
          color: "#e6edf3",
          textDecoration: "none",
          cursor: "pointer",
          fontWeight: 800
        }}
      >
        {cta} <span style={{ opacity: 0.7 }}>{external ? "↗" : ""}</span>
      </Comp>
    </div>
  );
}

/* ---------- charts (pure SVG) ---------- */

function Sparkline({ data }) {
  const w = 140;
  const h = 48;
  const pad = 4;
  const clean = (data || []).filter(v => typeof v === "number" && isFinite(v));
  if (clean.length < 2) return null;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = (max - min) || 1;

  const pts = clean.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (clean.length - 1);
    const y = pad + ((max - v) * (h - pad * 2)) / span;
    return { x, y };
  });

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const up = clean[clean.length - 1] >= clean[0];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ opacity: 0.95 }}>
      <path d={d} fill="none" stroke={up ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)"} strokeWidth="2.25" />
    </svg>
  );
}

function LineChart({ data, height = 250, valueFormatter }) {
  const width = 980;
  const pad = 30;

  const points = useMemo(() => {
    const clean = (data || []).filter(d => typeof d.y === "number" && isFinite(d.y));
    if (!clean.length) return { clean: [], minY: 0, maxY: 1, pts: [] };

    const ys = clean.map(d => d.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = (maxY - minY) || 1;

    const pts = clean.map((d, i) => {
      const x = pad + (i * (width - pad * 2)) / Math.max(1, clean.length - 1);
      const y = pad + ((maxY - d.y) * (height - pad * 2)) / span;
      return { x, y, label: d.x, value: d.y };
    });

    return { clean, minY, maxY, pts };
  }, [data, height]);

  if (!points.pts.length) {
    return (
      <div style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(230,237,243,0.12)", background: "rgba(11,18,32,0.45)", opacity: 0.9 }}>
        אין עדיין היסטוריה. אחרי שתעלה לגיטהאב ותפעיל Actions, זה יתמלא אוטומטית (פעם ביום).
      </div>
    );
  }

  const d = points.pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = points.pts[points.pts.length - 1];
  const first = points.pts[0];

  const up = last.value >= first.value;

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(230,237,243,0.12)", background: "rgba(11,18,32,0.45)", padding: 10, overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block" }}>
        {/* grid */}
        {[0,1,2,3].map(i => {
          const y = pad + (i * (height - pad * 2)) / 3;
          return <line key={i} x1={pad} y1={y} x2={width - pad} y2={y} stroke="rgba(230,237,243,0.10)" strokeWidth="1" />;
        })}

        {/* area */}
        <path
          d={`${d} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`}
          fill={up ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)"}
        />

        {/* line */}
        <path d={d} fill="none" stroke={up ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)"} strokeWidth="2.6" />

        {/* end dots */}
        <circle cx={first.x} cy={first.y} r="3.4" fill="rgba(230,237,243,0.75)" />
        <circle cx={last.x} cy={last.y} r="4.6" fill={up ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)"} />

        {/* labels */}
        <text x={pad} y={14} fill="rgba(230,237,243,0.75)" fontSize="12">
          {valueFormatter ? valueFormatter(points.maxY) : points.maxY}
        </text>
        <text x={pad} y={height - 8} fill="rgba(230,237,243,0.75)" fontSize="12">
          {valueFormatter ? valueFormatter(points.minY) : points.minY}
        </text>

        <text x={width - pad} y={14} textAnchor="end" fill="rgba(230,237,243,0.86)" fontSize="12">
          אחרון: {last.label} • {valueFormatter ? valueFormatter(last.value) : last.value}
        </text>
      </svg>
    </div>
  );
}

/* ---------- misc ---------- */

function ErrorBox({ err }) {
  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 18, background: "rgba(255,0,0,0.10)", border: "1px solid rgba(255,0,0,0.25)" }}>
      <div style={{ fontWeight: 900 }}>שגיאה</div>
      <div style={{ opacity: 0.92, marginTop: 6, lineHeight: 1.5 }}>{err}</div>
      <div style={{ opacity: 0.75, marginTop: 8, fontSize: 12 }}>
        טיפ: לפעמים CME חוסמים/מאטים בקשות. נסה רענון בעוד רגע.
      </div>
    </div>
  );
}

const grid2 = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
  gap: 16
};

const kpiGrid = {
  marginTop: 12,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12
};

const th = { padding: "10px 8px", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", whiteSpace: "nowrap", opacity: 0.95 };
const tdMono = { ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" };

const btnStyle = (loading) => ({
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid rgba(230,237,243,0.18)",
  background: loading ? "rgba(230,237,243,0.06)" : "rgba(230,237,243,0.10)",
  color: "#e6edf3",
  cursor: loading ? "not-allowed" : "pointer",
  fontWeight: 900
});

const reminderStyle = {
  position: "fixed",
  bottom: 16,
  left: 16,
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(230,237,243,0.16)",
  background: "rgba(7,11,20,0.72)",
  backdropFilter: "blur(10px)",
  boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
  fontWeight: 900,
  fontSize: 12,
  letterSpacing: 0.3,
  opacity: 0.92,
  zIndex: 9999
};
