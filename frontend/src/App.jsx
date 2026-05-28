import { useEffect, useState, useMemo, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   STADIUM COMMAND — Real-Time Flash Sale Engine
   Bird-eye stadium view with interactive stand zoom & coupon dispatch
   ═══════════════════════════════════════════════════════════════ */

const API = "http://localhost:8000";

/* ── Seeded RNG for stable positions ── */
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/* ── Stand config ── */
const STANDS = {
  N: { name: "North Stand", shortName: "North", color: "#38bdf8", pct: 78, rows: 7, cols: 44 },
  S: { name: "South Stand", shortName: "South", color: "#a78bfa", pct: 82, rows: 7, cols: 44 },
  W: { name: "West Stand",  shortName: "West",  color: "#f59e0b", pct: 65, rows: 8, cols: 13 },
  E: { name: "East Stand",  shortName: "East",  color: "#f97316", pct: 71, rows: 8, cols: 13 },
};

/* ── Generate audience dots in stands (between inner track and outer rim) ── */
function generateStandDots() {
  const rng = mkRng(0xDEADBEEF);
  const CX = 340, CY = 240, RX = 318, RY = 220;
  const INNER_RX = 246, INNER_RY = 166;
  const FL = 100, FR = 580, FT = 86, FB = 394;
  const dots = [];

  while (dots.length < 620) {
    const ang = rng() * Math.PI * 2;
    const r   = Math.sqrt(rng());
    const x   = CX + Math.cos(ang) * RX * r;
    const y   = CY + Math.sin(ang) * RY * r;
    const tx  = x - CX, ty = y - CY;
    const inOuter = (tx / RX) ** 2 + (ty / RY) ** 2 <= 0.99;
    const inInner = (tx / INNER_RX) ** 2 + (ty / INNER_RY) ** 2 <= 1.0;
    const onField = x > FL + 5 && x < FR - 5 && y > FT + 5 && y < FB - 5;
    if (!inOuter || inInner || onField) continue;
    const a = Math.atan2(ty, tx) * (180 / Math.PI);
    const sec = a >= -45 && a < 45 ? "E"
              : a >= 45  && a < 135 ? "S"
              : a >= 135 || a < -135 ? "W" : "N";
    dots.push({ x, y, id: dots.length, sec });
  }
  return dots;
}

/* ── Generate zoom-view dots for a stand in a regular grid ── */
function generateZoomDots(key) {
  const s = STANDS[key];
  const rng = mkRng(0xABCD ^ key.charCodeAt(0) * 31);
  const dots = [];
  const W = 620, H = 200, PAD = 20;
  const cw = (W - PAD * 2) / s.cols;
  const ch = (H - PAD * 2) / s.rows;

  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const x = PAD + c * cw + cw / 2 + (rng() - 0.5) * cw * 0.25;
      const y = PAD + r * ch + ch / 2 + (rng() - 0.5) * ch * 0.25;
      const occupied = rng() < s.pct / 100;
      dots.push({ x: 30 + x, y: 30 + y, r, c, occupied, id: `${key}-${r}-${c}` });
    }
  }
  return dots;
}

const NOW = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/* ══════════════════════════════════════════════════════════════ */
export default function App() {
  const [stats, setStats]           = useState({ active_users: 0, inside_stadium: 0, coupons_sent: 0, goals_today: 0 });
  const [connected, setConnected]   = useState(true);
  const [selectedStand, setSelected]= useState(null);
  const [couponSet, setCouponSet]   = useState(new Set());
  const [couponTimer, setTimer]     = useState(0);
  const [goalActive, setGoalActive] = useState(false);
  const [events, setEvents]         = useState([
    { type: "sys", msg: "System online — stream monitoring active", ts: NOW() },
  ]);
  const tickRef   = useRef(null);
  const allDots   = useMemo(() => generateStandDots(), []);
  const zoomDots  = useMemo(() => ({
    N: generateZoomDots("N"),
    S: generateZoomDots("S"),
    W: generateZoomDots("W"),
    E: generateZoomDots("E"),
  }), []);

  /* section dot counts */
  const secCounts = useMemo(() =>
    allDots.reduce((a, d) => { a[d.sec] = (a[d.sec] || 0) + 1; return a; }, {}),
  [allDots]);

  function pushEvent(type, msg) {
    setEvents(prev => [{ type, msg, ts: NOW() }, ...prev].slice(0, 40));
  }

  /* poll backend */
  const loadStats = useCallback(async () => {
    try {
      const { data } = await (await import("axios")).default.get(`${API}/stats`);
      setStats(data); setConnected(true);
    } catch { setConnected(false); }
  }, []);

  useEffect(() => {
    loadStats();
    const iv = setInterval(loadStats, 3000);
    return () => { clearInterval(iv); clearInterval(tickRef.current); };
  }, [loadStats]);

  /* ── GOAL ── */
  async function handleGoal() {
    try {
      await (await import("axios")).default.get(`${API}/goal`);
    } catch { /* backend optional */ }
    setGoalActive(true);
    setTimeout(() => setGoalActive(false), 3800);
    pushEvent("goal", "Goal scored — flash sale activated");

    const shuffled = [...allDots].sort(() => Math.random() - 0.5);
    const count    = Math.floor(allDots.length * 0.58);
    const sel      = new Set(shuffled.slice(0, count).map(d => d.id));
    setCouponSet(sel);
    setTimeout(() => pushEvent("coupon", `${stats.coupons_sent?.toLocaleString()} coupons dispatched via Kafka`), 700);

    clearInterval(tickRef.current);
    setTimer(300);
    tickRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) {
          clearInterval(tickRef.current);
          setCouponSet(new Set());
          pushEvent("sys", "Offer window closed — coupons expired");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    loadStats();
  }

  /* ── stand selection ── */
  function toggleStand(key) {
    setSelected(prev => prev === key ? null : key);
    pushEvent("info", `Viewing ${STANDS[key].name} — ${secCounts[key] || 0} tracked positions`);
  }

  const cvr     = stats.inside_stadium > 0 ? ((stats.coupons_sent / stats.inside_stadium) * 100).toFixed(1) : "0.0";
  const revenue = ((stats.coupons_sent || 0) * 12.5).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const evColor = { goal: "#00c87c", coupon: "#f59e0b", sys: "#38bdf8", info: "#a78bfa", err: "#f87171" };

  /* ════════════════════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #020b14; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #0d2035; border-radius: 2px; }

        /* ── Stand hover ── */
        .stand-section { transition: fill .18s, stroke .18s; cursor: pointer; }
        .stand-section:hover { filter: brightness(1.25); }

        /* ── Dots ── */
        @keyframes coupon-pulse { 0%,100%{opacity:.95} 50%{opacity:.3} }
        .dot-coupon { animation: coupon-pulse 1.7s ease-in-out infinite; }

        /* ── Goal banner ── */
        @keyframes banner-in {
          0%   { opacity:0; transform:translate(-50%,-60%) scale(.7); }
          15%  { opacity:1; transform:translate(-50%,-50%) scale(1.05); }
          25%  { transform:translate(-50%,-50%) scale(1); }
          75%  { opacity:1; }
          100% { opacity:0; transform:translate(-50%,-42%) scale(1.08); }
        }
        .goal-banner { animation: banner-in 3.8s ease-out forwards; }

        /* ── Ripple ── */
        @keyframes ripple-out { 0%{r:4;stroke-opacity:.8} 100%{r:200;stroke-opacity:0} }
        .ripple { animation: ripple-out 2s ease-out forwards; }
        .ripple-2 { animation: ripple-out 2s ease-out .4s forwards; }
        .ripple-3 { animation: ripple-out 2s ease-out .8s forwards; }

        /* ── Field flash ── */
        @keyframes field-flash { 0%,100%{opacity:1} 40%{opacity:.55} }
        .field-flash { animation: field-flash .5s ease-in-out 6; }

        /* ── Blink ── */
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        .blink { animation: blink 1s ease-in-out infinite; }
        .blink-slow { animation: blink 1.4s ease-in-out infinite; }

        /* ── Slide in ── */
        @keyframes slide-down { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .slide-in { animation: slide-down .2s ease-out; }

        /* ── Zoom panel ── */
        @keyframes zoom-reveal { from{opacity:0;transform:scaleY(.92)} to{opacity:1;transform:scaleY(1)} }
        .zoom-panel { animation: zoom-reveal .22s ease-out; transform-origin: top; }

        /* ── Metric card hover ── */
        .metric-card { transition: border-color .2s, transform .15s; }
        .metric-card:hover { transform: translateY(-1px); }

        /* ── Goal button ── */
        .goal-btn { transition: background .2s, transform .1s, box-shadow .2s; }
        .goal-btn:hover { background: rgba(0,200,100,.18) !important; }
        .goal-btn:active { transform: scale(.97); }
      `}</style>

      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        background: "#020b14",
        minHeight: "100vh",
        color: "#cde4f5",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}>

        {/* ══ HEADER ══ */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 22px", background: "#030e1c",
          borderBottom: "1px solid #0a1e30",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <svg width={34} height={34} viewBox="0 0 34 34">
              <rect width={34} height={34} rx={7} fill="rgba(0,200,124,.1)" />
              <ellipse cx={17} cy={17} rx={9} ry={9} fill="none" stroke="#00c87c" strokeWidth={1.6} />
              <line x1={17} y1={8} x2={17} y2={26} stroke="#00c87c" strokeWidth={1.4} />
              <line x1={8} y1={17} x2={26} y2={17} stroke="#00c87c" strokeWidth={1.4} />
              <circle cx={17} cy={17} r={2.5} fill="#00c87c" />
            </svg>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: ".06em", lineHeight: 1, color: "#e8f5ff" }}>
                STADIUM COMMAND
              </div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#1e4060", letterSpacing: ".14em", marginTop: 2 }}>
                REAL-TIME FLASH SALE ENGINE · KAFKA STREAM
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* connection status */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'JetBrains Mono'", fontSize: 10, color: "#29566e" }}>
              <div className="blink" style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#00c87c" : "#f87171" }} />
              {connected ? "KAFKA CONNECTED" : "STREAM OFFLINE"}
            </div>
            {/* LIVE badge */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 4,
              border: "1px solid #3a0808", background: "#0e0202",
              fontFamily: "'JetBrains Mono'", fontSize: 10, color: "#ff5555", letterSpacing: ".12em",
            }}>
              <div className="blink-slow" style={{ width: 5, height: 5, borderRadius: "50%", background: "#ff4444" }} />
              LIVE
            </div>
            {/* Goal button */}
            <button
              className="goal-btn"
              onClick={handleGoal}
              style={{
                padding: "8px 18px",
                background: goalActive ? "rgba(0,200,124,.16)" : "transparent",
                border: "1.5px solid #00c87c",
                borderRadius: 7, color: "#00c87c",
                fontSize: 15, fontWeight: 800,
                fontFamily: "'Barlow Condensed'", letterSpacing: ".1em",
                cursor: "pointer",
              }}
            >
              ⚽ GOAL SCORED
            </button>
          </div>
        </header>

        {/* ══ METRIC CARDS ══ */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, padding: "10px 22px" }}>
          {[
            { label: "ACTIVE USERS",  value: stats.active_users?.toLocaleString()   ?? "--", accent: "#38bdf8" },
            { label: "IN STADIUM",    value: stats.inside_stadium?.toLocaleString() ?? "--", accent: "#00c87c" },
            { label: "COUPONS SENT",  value: stats.coupons_sent?.toLocaleString()   ?? "--", accent: "#f59e0b" },
            { label: "GOALS TODAY",   value: stats.goals_today                      ?? "--", accent: "#f97316" },
            { label: "CONVERSION",    value: `${cvr}%`,                                      accent: "#a78bfa" },
          ].map(c => (
            <div key={c.label} className="metric-card" style={{
              background: "#040e1c", borderRadius: 9,
              border: "1px solid #0b1e30", borderTop: `2px solid ${c.accent}`,
              padding: "11px 14px",
            }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", letterSpacing: ".13em", marginBottom: 5 }}>{c.label}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: c.accent, lineHeight: 1 }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* ══ MAIN LAYOUT ══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 8, padding: "0 22px 22px", flex: 1 }}>

          {/* ── LEFT: Stadium View ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

            {/* Stadium SVG Panel */}
            <div style={{
              background: "#040e1c", borderRadius: 11,
              border: "1px solid #0b1e30", padding: "13px 16px",
              position: "relative", overflow: "hidden",
            }}>
              {/* panel header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".05em", color: "#e8f5ff" }}>
                    LIVE STADIUM BIRD-EYE VIEW
                  </div>
                  
                </div>
                <div style={{ display: "flex", gap: 14 }}>
                  {[
                    { c: "#38bdf8", l: "Attendee" },
                    { c: "#f59e0b", l: "Coupon" },
                  ].map(x => (
                    <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <svg width={8} height={8}><circle cx={4} cy={4} r={3.5} fill={x.c} /></svg>
                      <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#29566e" }}>{x.l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Bird-Eye SVG ── */}
              <svg viewBox="0 0 680 480" style={{ width: "100%", display: "block" }}>
                <defs>
                  <radialGradient id="fieldGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#0c5c24" />
                    <stop offset="100%" stopColor="#062e12" />
                  </radialGradient>
                  <radialGradient id="stadGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#071828" />
                    <stop offset="100%" stopColor="#020b14" />
                  </radialGradient>
                </defs>

                {/* outer stand body */}
                <ellipse cx={340} cy={240} rx={325} ry={228} fill="url(#stadGrad)" stroke="#0c2035" strokeWidth={1} />

                {/* ── Stand sections (clickable) ── */}
                {/* North */}
                <path
                  className="stand-section"
                  d="M32 158 Q110 16 340 16 Q570 16 648 158 L598 174 Q528 38 340 38 Q152 38 82 174 Z"
                  fill={selectedStand === "N" ? "rgba(56,189,248,.22)" : "#091828"}
                  stroke={selectedStand === "N" ? "#38bdf8" : "#0d2540"}
                  strokeWidth={selectedStand === "N" ? 1.5 : 0.5}
                  onClick={() => toggleStand("N")}
                />
                {/* South */}
                <path
                  className="stand-section"
                  d="M32 322 Q110 464 340 464 Q570 464 648 322 L598 306 Q528 442 340 442 Q152 442 82 306 Z"
                  fill={selectedStand === "S" ? "rgba(167,139,250,.22)" : "#091828"}
                  stroke={selectedStand === "S" ? "#a78bfa" : "#0d2540"}
                  strokeWidth={selectedStand === "S" ? 1.5 : 0.5}
                  onClick={() => toggleStand("S")}
                />
                {/* West */}
                <path
                  className="stand-section"
                  d="M32 158 Q18 196 18 240 Q18 284 32 322 L82 306 Q70 276 70 240 Q70 204 82 174 Z"
                  fill={selectedStand === "W" ? "rgba(245,158,11,.22)" : "#091828"}
                  stroke={selectedStand === "W" ? "#f59e0b" : "#0d2540"}
                  strokeWidth={selectedStand === "W" ? 1.5 : 0.5}
                  onClick={() => toggleStand("W")}
                />
                {/* East */}
                <path
                  className="stand-section"
                  d="M648 158 Q662 196 662 240 Q662 284 648 322 L598 306 Q610 276 610 240 Q610 204 598 174 Z"
                  fill={selectedStand === "E" ? "rgba(249,115,22,.22)" : "#091828"}
                  stroke={selectedStand === "E" ? "#f97316" : "#0d2540"}
                  strokeWidth={selectedStand === "E" ? 1.5 : 0.5}
                  onClick={() => toggleStand("E")}
                />

                {/* track ring */}
                <ellipse cx={340} cy={240} rx={250} ry={170} fill="#030c1a" stroke="#0a1e30" strokeWidth={0.5} />

                {/* field */}
                <rect
                  x={100} y={86} width={480} height={308} rx={4}
                  fill="url(#fieldGrad)"
                  className={goalActive ? "field-flash" : ""}
                />

                {/* field markings */}
                <rect x={111} y={97} width={458} height={286} fill="none" stroke="rgba(255,255,255,.17)" strokeWidth={1.2} />
                <line x1={340} y1={97} x2={340} y2={383} stroke="rgba(255,255,255,.17)" strokeWidth={1.2} />
                <circle cx={340} cy={240} r={40} fill="none" stroke="rgba(255,255,255,.17)" strokeWidth={1.2} />
                <circle cx={340} cy={240} r={3}  fill="rgba(255,255,255,.28)" />
                <rect x={111} y={172} width={74}  height={136} fill="none" stroke="rgba(255,255,255,.11)" strokeWidth={1.2} />
                <rect x={495} y={172} width={74}  height={136} fill="none" stroke="rgba(255,255,255,.11)" strokeWidth={1.2} />
                <rect x={111} y={212} width={34}  height={56}  fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={1.2} />
                <rect x={535} y={212} width={34}  height={56}  fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={1.2} />
                <rect x={80}  y={214} width={31}  height={52}  fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={1.4} />
                <rect x={569} y={214} width={31}  height={52}  fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={1.4} />
                <circle cx={164} cy={240} r={2.5} fill="rgba(255,255,255,.22)" />
                <circle cx={516} cy={240} r={2.5} fill="rgba(255,255,255,.22)" />
                <path d="M185 195 A40 40 0 0 1 185 285" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={1.2} />
                <path d="M495 195 A40 40 0 0 0 495 285" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={1.2} />
                <path d="M111 97  A9 9 0 0 1 120 106"  fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={1.2} />
                <path d="M569 97  A9 9 0 0 0 560 106"  fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={1.2} />
                <path d="M111 383 A9 9 0 0 0 120 374"  fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={1.2} />
                <path d="M569 383 A9 9 0 0 1 560 374"  fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={1.2} />

                {/* Goal overlay tint */}
                {goalActive && <ellipse cx={340} cy={240} rx={325} ry={228} fill="rgba(0,200,100,.07)" />}

                {/* Ripple rings */}
                {goalActive && <>
                  <circle cx={340} cy={240} r={4} fill="none" stroke="#00c87c" strokeWidth={1.8} className="ripple" />
                  <circle cx={340} cy={240} r={4} fill="none" stroke="#00c87c" strokeWidth={1.4} className="ripple-2" />
                  <circle cx={340} cy={240} r={4} fill="none" stroke="#00c87c" strokeWidth={1} className="ripple-3" />
                </>}

                {/* Stand labels */}
                <text x={340} y={31} textAnchor="middle" fill={selectedStand === "N" ? "#38bdf8" : "rgba(255,255,255,.28)"}
                  style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, letterSpacing: 3 }}>NORTH STAND</text>
                <text x={340} y={458} textAnchor="middle" fill={selectedStand === "S" ? "#a78bfa" : "rgba(255,255,255,.28)"}
                  style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, letterSpacing: 3 }}>SOUTH STAND</text>
                <text x={25} y={244} textAnchor="middle" fill={selectedStand === "W" ? "#f59e0b" : "rgba(255,255,255,.22)"}
                  style={{ fontFamily: "'JetBrains Mono'", fontSize: 9 }}>W</text>
                <text x={655} y={244} textAnchor="middle" fill={selectedStand === "E" ? "#f97316" : "rgba(255,255,255,.22)"}
                  style={{ fontFamily: "'JetBrains Mono'", fontSize: 9 }}>E</text>

                {/* Selected stand capacity badge */}
                {selectedStand && (() => {
                  const badges = { N: [340,60], S: [340,425], W: [54,240], E: [626,240] };
                  const [bx, by] = badges[selectedStand];
                  const s = STANDS[selectedStand];
                  return (
                    <g>
                      <rect x={bx - 38} y={by - 10} width={76} height={20} rx={4} fill="rgba(2,11,20,.85)" stroke={s.color} strokeWidth={0.8} />
                      <text x={bx} y={by + 4} textAnchor="middle"
                        fill={s.color}
                        style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, fontWeight: 600 }}>
                        {secCounts[selectedStand] || 0} seats
                      </text>
                    </g>
                  );
                })()}

                {/* Audience dots */}
                {allDots.map(dot => {
                  const hasCoupon = couponSet.has(dot.id);
                  const isInSelected = selectedStand === dot.sec;
                  const dimmed = selectedStand && !isInSelected;
                  return (
                    <circle
                      key={dot.id}
                      cx={dot.x} cy={dot.y}
                      r={hasCoupon ? 3.2 : isInSelected ? 2.8 : 2.2}
                      fill={hasCoupon ? "#f59e0b" : isInSelected ? STANDS[dot.sec].color : "#38bdf8"}
                      opacity={hasCoupon ? 0.95 : dimmed ? 0.18 : 0.62}
                      className={hasCoupon ? "dot-coupon" : ""}
                    />
                  );
                })}

                {/* Offer countdown overlay */}
                {couponTimer > 0 && (
                  <g>
                    <rect x={520} y={396} width={132} height={58} rx={7} fill="rgba(2,8,18,.94)" stroke="#7a4d00" strokeWidth={1} />
                    <text x={530} y={413} fill="#29566e" style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5, letterSpacing: ".12em" }}>OFFER EXPIRES</text>
                    <text x={530} y={434} fill="#f59e0b" style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 600, letterSpacing: ".04em" }}>{fmt(couponTimer)}</text>
                    <rect x={530} y={444} width={112} height={2} rx={1} fill="#1a0e00" />
                    <rect x={530} y={444} width={112 * (couponTimer / 300)} height={2} rx={1} fill="#f59e0b" />
                  </g>
                )}
              </svg>

              {/* Goal banner */}
              {goalActive && (
                <div className="goal-banner" style={{
                  position: "absolute", top: "50%", left: "50%",
                  background: "#00c87c", color: "#020b14",
                  fontSize: 52, fontWeight: 900, letterSpacing: ".12em",
                  padding: "12px 40px", borderRadius: 9,
                  pointerEvents: "none",
                }}>
                  GOAL!
                </div>
              )}
            </div>

            {/* ── STAND ZOOM PANEL ── */}
            {selectedStand && (
              <div className="zoom-panel" style={{
                background: "#040e1c", borderRadius: 11,
                border: `1px solid ${STANDS[selectedStand].color}44`,
                padding: "13px 16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: STANDS[selectedStand].color, letterSpacing: ".04em" }}>
                      {STANDS[selectedStand].name.toUpperCase()}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#29566e", marginLeft: 10 }}>
                      SEAT MAP · {STANDS[selectedStand].rows} ROWS · {STANDS[selectedStand].cols} COLS · {STANDS[selectedStand].pct}% OCCUPIED
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {couponSet.size > 0 && (
                      <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#f59e0b" }}>
                        🎟 {zoomDots[selectedStand].filter(d => d.occupied && couponSet.size > 0).length} coupons active
                      </div>
                    )}
                    <button
                      onClick={() => setSelected(null)}
                      style={{
                        background: "none", border: "0.5px solid #1a3550",
                        borderRadius: 5, padding: "3px 10px", fontSize: 12,
                        color: "#29566e", cursor: "pointer", fontFamily: "'Barlow Condensed'", letterSpacing: ".06em",
                      }}
                    >
                      ✕ CLOSE
                    </button>
                  </div>
                </div>

                {/* Zoom SVG */}
                <ZoomView
                  standKey={selectedStand}
                  dots={zoomDots[selectedStand]}
                  stand={STANDS[selectedStand]}
                  couponActive={couponSet.size > 0}
                />

                {/* Row legend */}
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  {[
                    { c: STANDS[selectedStand].color, l: "Occupied seat" },
                    { c: "#f59e0b", l: "Coupon sent" },
                    { c: "#0d2035", l: "Empty seat" },
                  ].map(x => (
                    <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <svg width={8} height={8}><circle cx={4} cy={4} r={3.5} fill={x.c} /></svg>
                      <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#29566e" }}>{x.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

            {/* Revenue */}
            <div style={{ background: "#040e1c", border: "1px solid #0b1e30", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", letterSpacing: ".13em", marginBottom: 5 }}>EST. REVENUE IMPACT</div>
              <div style={{ fontSize: 32, fontWeight: 900, color: "#00c87c", lineHeight: 1 }}>${revenue}</div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#1a3550", marginTop: 4 }}>avg. $12.50 per coupon</div>
            </div>

            {/* Active offer */}
            <div style={{
              background: "#040e1c",
              border: `1px solid ${couponTimer > 0 ? "#5a3500" : "#0b1e30"}`,
              borderRadius: 10, padding: "12px 14px",
            }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", letterSpacing: ".13em", marginBottom: 7 }}>ACTIVE OFFER</div>
              {couponTimer > 0 ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#f59e0b", letterSpacing: ".04em" }}>50% FLASH DISCOUNT</span>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#f59e0b" }}>{stats.coupons_sent?.toLocaleString()} sent</span>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#29566e" }}>Closes in {fmt(couponTimer)}</div>
                  <div style={{ height: 3, background: "#0d1e2e", borderRadius: 2, marginTop: 8 }}>
                    <div style={{ height: "100%", width: `${(couponTimer / 300) * 100}%`, background: "#f59e0b", borderRadius: 2, transition: "width 1s linear" }} />
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, color: "#0e2535" }}>No active offer running</div>
              )}
            </div>

            {/* Stand occupancy bars */}
            <div style={{ background: "#040e1c", border: "1px solid #0b1e30", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", letterSpacing: ".13em", marginBottom: 10 }}>STAND OCCUPANCY</div>
              {Object.entries(STANDS).map(([k, s]) => {
                const total = secCounts[k] || 0;
                const occ   = Math.round(total * s.pct / 100);
                const couponsInSection = stats.coupons_sent?.toLocaleString() > 0
                  ? allDots.filter(d => d.sec === k && couponSet.has(d.id)).length : 0;
                return (
                  <div
                    key={k}
                    onClick={() => toggleStand(k)}
                    style={{ marginBottom: 10, cursor: "pointer", padding: "4px 6px", borderRadius: 6, background: selectedStand === k ? `${s.color}11` : "transparent", transition: "background .2s" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: selectedStand === k ? s.color : "#b4d5ea" }}>{s.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#29566e" }}>
                        {occ}/{total} · {s.pct}%
                        {couponsInSection > 0 && <span style={{ color: "#f59e0b", marginLeft: 4 }}>🎟{couponsInSection}</span>}
                      </span>
                    </div>
                    <div style={{ height: 3, background: "#071525", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${s.pct}%`, background: `linear-gradient(90deg, ${s.color}66, ${s.color})`, borderRadius: 2, transition: "width .5s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* GPS distribution */}
            <div style={{ background: "#040e1c", border: "1px solid #0b1e30", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", letterSpacing: ".13em", marginBottom: 8 }}>GPS DISTRIBUTION</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 8px" }}>
                {[
                  { label: "Inside Zone",  val: stats.inside_stadium?.toLocaleString() ?? "--", col: "#00c87c" },
                  { label: "Outer Zone",   val: ((stats.active_users||0) - (stats.inside_stadium||0)).toLocaleString(), col: "#38bdf8" },
                  { label: "Coupon Rate",  val: `${cvr}%`,  col: "#f59e0b" },
                  { label: "Scan Cycle",   val: "1s",       col: "#a78bfa" },
                ].map(x => (
                  <div key={x.label} style={{ background: "#030c18", borderRadius: 6, padding: "7px 9px" }}>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", marginBottom: 3 }}>{x.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: x.col }}>{x.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Event log */}
            <div style={{
              background: "#040e1c", border: "1px solid #0b1e30", borderRadius: 10,
              padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", minHeight: 180,
            }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#1e4060", letterSpacing: ".13em", marginBottom: 8 }}>EVENT LOG</div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {events.map((ev, i) => {
                  const col = evColor[ev.type] || "#29566e";
                  return (
                    <div key={i} className="slide-in" style={{
                      display: "flex", gap: 7, alignItems: "flex-start",
                      padding: "5px 0", borderTop: i > 0 ? "1px solid #060f1a" : "none",
                    }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: col, marginTop: 4, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 11, color: "#7aa8c0", lineHeight: 1.4 }}>{ev.msg}</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, color: "#0e2535", marginTop: 1 }}>{ev.ts}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   ZOOM VIEW — Detailed seat map for selected stand
   ══════════════════════════════════════════════════════════════ */
function ZoomView({ standKey, dots, stand, couponActive }) {
  const rng = useMemo(() => mkRng(0xFEED ^ standKey.charCodeAt(0)), [standKey]);
  const isNS = standKey === "N" || standKey === "S";

  return (
    <svg viewBox={`0 0 680 ${isNS ? 230 : 260}`} style={{ width: "100%", display: "block", borderRadius: 8 }}>
      {/* background */}
      <rect x={0} y={0} width={680} height={isNS ? 230 : 260} fill="#030c18" />

      {/* Row stripe backgrounds */}
      {Array.from({ length: stand.rows }, (_, r) => {
        const H = isNS ? 190 : 220;
        const PAD = 30;
        const ch = (H - PAD * 2) / stand.rows;
        const ry = PAD + r * ch;
        return (
          <rect key={r} x={30} y={ry} width={620} height={ch * 0.88}
            fill={r % 2 === 0 ? "rgba(255,255,255,.018)" : "rgba(255,255,255,.006)"}
            rx={2}
          />
        );
      })}

      {/* Row numbers */}
      {Array.from({ length: stand.rows }, (_, r) => {
        const H = isNS ? 190 : 220;
        const PAD = 30;
        const ch = (H - PAD * 2) / stand.rows;
        const ry = PAD + r * ch + ch / 2 + 4;
        return (
          <text key={r} x={18} y={ry} textAnchor="middle"
            fill="rgba(255,255,255,.18)"
            style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5 }}>
            R{r + 1}
          </text>
        );
      })}

      {/* Dots */}
      {dots.map(dot => {
        if (!dot.occupied) {
          return (
            <circle key={dot.id} cx={dot.x} cy={dot.y} r={isNS ? 3 : 4.5}
              fill="#0d2035" stroke="#132840" strokeWidth={0.5} />
          );
        }
        const hasCoupon = couponActive && (dot.r * stand.cols + dot.c) % 3 !== 0;
        return (
          <circle
            key={dot.id}
            cx={dot.x} cy={dot.y}
            r={hasCoupon ? (isNS ? 3.8 : 5) : (isNS ? 3.2 : 4.5)}
            fill={hasCoupon ? "#f59e0b" : stand.color}
            opacity={hasCoupon ? 0.95 : 0.75}
            className={hasCoupon ? "dot-coupon" : ""}
          />
        );
      })}

      {/* "Pitch side" label */}
      <text x={340} y={isNS ? 222 : 252} textAnchor="middle"
        fill="rgba(255,255,255,.15)"
        style={{ fontFamily: "'JetBrains Mono'", fontSize: 8, letterSpacing: 3 }}>
        ← PITCH SIDE →
      </text>

      {/* Col numbers (sparse) */}
      {Array.from({ length: Math.ceil(stand.cols / 5) }, (_, ci) => {
        const c = ci * 5;
        const W = 620, PAD = 30;
        const cw = (W - PAD * 2) / stand.cols;
        const cx = 30 + PAD + c * cw + cw / 2;
        return (
          <text key={c} x={cx} y={18} textAnchor="middle"
            fill="rgba(255,255,255,.18)"
            style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5 }}>
            C{c + 1}
          </text>
        );
      })}
    </svg>
  );
}