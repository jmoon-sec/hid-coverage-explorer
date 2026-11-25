/* Deferred-Work Coverage Frontier — 세 개의 연결된 뷰.
 *
 *   A  Campaign Pulse        드라이버별 커버리지 궤적 + 남은 양        (T1)
 *   B  Deferral Depth Layers 같은 워커가 어느 깊이에서 도는가          (T2)
 *   C  Instrumentation Payoff 추적을 이어붙여 번 PC 와 그곳의 결함     (T3)
 *
 * 선택은 드라이버 하나다. 어느 뷰에서 고르든 나머지 둘이 따라 반응한다.
 */
const S = {
  drivers: [],  funcs: [],  depth: [],  series: new Map(),
  edges: [],    wq: new Set(), defB: null,
  bFrontierOnly: false, bHideFull: false,
  END: 0,       sel: null,  sortA: "uncovered", sortC: "gained", showAll: false,
};
const tip = d3.select("#tip");
const fmt = d3.format(",");

const showTip = (ev, html) => tip.html(html).style("opacity", 1)
  .style("left", Math.min(ev.clientX + 14, innerWidth - 310) + "px")
  .style("top", (ev.clientY + 16) + "px");
const hideTip = () => tip.style("opacity", 0);

/* 분 → 사람이 읽는 길이 */
const dur = m => m == null || m === "" ? "—"
  : m < 90 ? `${Math.round(m)}분` : `${(m / 60).toFixed(1)}시간`;

/* ── 적재 ─────────────────────────────────────────────────────────── */
Promise.all([
  d3.csv("data/drivers.csv", d3.autoType),
  d3.csv("data/functions.csv", d3.autoType),
  d3.csv("data/trajectory.csv", d3.autoType),
  d3.csv("data/depth_dispatches.csv", d3.autoType),
  d3.csv("data/call_edges.csv", d3.autoType),
]).then(([drv, fns, traj, dep, edg]) => {
  S.drivers = drv.filter(d => d.total > 0);
  S.funcs = fns;
  S.depth = dep;
  S.END = d3.max(traj, d => d.minute) || 1;

  /* 드라이버별 누적 커버리지 계단 — 함수별 최신값을 더해 간다 */
  for (const [name, rows] of d3.group(traj, d => d.driver)) {
    rows.sort((a, b) => a.minute - b.minute);
    const cur = new Map(); const pts = [{ minute: 0, cov: 0 }];
    for (const r of rows) {
      cur.set(r.func, r.covered);
      pts.push({ minute: r.minute, cov: d3.sum(cur.values()) });
    }
    pts.push({ minute: S.END, cov: pts[pts.length - 1].cov });
    S.series.set(name, pts);
  }

  /* 호출 엣지 — 드라이버·완전커버 여부를 미리 붙여둔다 */
  const base = p => { const b = p.split("/").pop(); return b.endsWith(".c") ? b.slice(0, -2) : b; };
  S.edges = edg.map(e => ({
    ...e,
    caller_drv: base(e.caller_file), callee_drv: base(e.callee_file),
    caller_full: e.caller_tot > 0 && e.caller_cov === e.caller_tot,
    callee_full: e.callee_tot > 0 && e.callee_cov === e.callee_tot,
  }));
  S.wq = new Set(dep.map(d => d.func));

  /* 함수 이름 → 드라이버 (B 에서 노드를 눌렀을 때 쓴다) */
  S.fnDriver = new Map();
  for (const f of fns) if (!S.fnDriver.has(f.func)) S.fnDriver.set(f.func, f.driver);

  const act = S.drivers.filter(d => d.last_gain_min !== "" && d.last_gain_min != null);
  d3.select("#meta").text(
    `${fmt(fns.length)} functions · ${S.drivers.length} drivers · ${act.length} 개가 커버리지를 얻었다 · 30.4 h`);
  d3.select("#fstat").text(
    `gained 측정 ${fmt(fns.filter(f => f.gained !== "" && f.gained != null).length)} / ${fmt(fns.length)} 함수`);

  S.defB = defaultDriverB();
  buildChips(); buildSortbars(); renderA(); renderB(); renderC();
  addEventListener("resize", () => { renderB(); renderC(); });
});

/* ── 상단 칩 ──────────────────────────────────────────────────────── */
function buildChips() {
  const c = d3.select("#chips");
  const draw = () => {
    c.selectAll("*").remove();
    c.append("div").attr("class", "chip" + (S.showAll ? "" : " on"))
      .text(S.showAll ? "전체 드라이버" : "커버리지 있는 것만")
      .on("click", () => { S.showAll = !S.showAll; draw(); renderA(); });
    if (S.sel) {
      c.append("div").attr("class", "chip clear").text(`✕ ${S.sel}`)
        .on("click", () => select(null));
    }
  };
  S._chips = draw; draw();
}

function buildSortbars() {
  const A = [["uncovered", "남은 PC"], ["cold_min", "식은 시간"], ["gained", "gained"], ["n_bugs", "결함"]];
  d3.select("#sortA").selectAll("div").data(A).join("div")
    .attr("class", d => "sortbtn" + (d[0] === S.sortA ? " on" : ""))
    .text(d => d[1])
    .on("click", (e, d) => { S.sortA = d[0]; buildSortbars(); renderA(); });

  const B = [["frontier", "경계만"], ["all", "전체 호출"], ["hidefull", "완전커버 숨김"]];
  d3.select("#sortB").selectAll("div").data(B).join("div")
    .attr("class", d => "sortbtn" + (
      (d[0] === "frontier" && S.bFrontierOnly) ||
      (d[0] === "all" && !S.bFrontierOnly) ||
      (d[0] === "hidefull" && S.bHideFull) ? " on" : ""))
    .text(d => d[1])
    .on("click", (e, d) => {
      if (d[0] === "hidefull") S.bHideFull = !S.bHideFull;
      else S.bFrontierOnly = (d[0] === "frontier");
      buildSortbars(); renderB();
    });

  const C = [["gained", "gained"], ["n_bugs", "결함"]];
  d3.select("#sortC").selectAll("div").data(C).join("div")
    .attr("class", d => "sortbtn" + (d[0] === S.sortC ? " on" : ""))
    .text(d => d[1])
    .on("click", (e, d) => { S.sortC = d[0]; buildSortbars(); renderC(); });
}

/* ── 선택 전파 ────────────────────────────────────────────────────── */
function select(name) {
  S.sel = (S.sel === name) ? null : name;
  S._chips(); renderA(); renderB(); renderC();
}

/* ── View A — Campaign Pulse ──────────────────────────────────────── */
function renderA() {
  const num = v => (v === "" || v == null) ? -1 : +v;
  let rows = S.drivers.filter(d => S.showAll || (d.last_gain_min !== "" && d.last_gain_min != null));
  rows = rows.sort((a, b) => num(b[S.sortA]) - num(a[S.sortA]) || d3.ascending(a.driver, b.driver));

  const maxLeft = d3.max(rows, d => d.uncovered) || 1;

  const sel = d3.select("#rowsA").selectAll("div.row").data(rows, d => d.driver);
  sel.exit().remove();
  const en = sel.enter().append("div").attr("class", "row")
    .on("click", (e, d) => select(d.driver))
    .on("mousemove", (e, d) => showTip(e,
      `<b>${d.driver}</b><br>함수 ${d.n_funcs} · full ${d.n_full} partial ${d.n_partial} none ${d.n_none}` +
      `<br>covered ${fmt(d.covered)} / ${fmt(d.total)} PC` +
      `<br>남은 PC ${fmt(d.uncovered)}` +
      `<br>마지막 획득 ${d.cold_min === "" || d.cold_min == null ? "없음" : dur(d.cold_min) + " 전"}` +
      (d.gained !== "" && d.gained != null ? `<br>gained ${d.gained > 0 ? "+" : ""}${d.gained} PC` : "") +
      (d.n_bugs ? `<br>결함 ${d.n_bugs}건` : "")))
    .on("mouseleave", hideTip);

  en.append("div").attr("class", "rname");
  en.append("div").attr("class", "rspark");
  en.append("div").attr("class", "rnum rleft");
  en.append("div").attr("class", "rstack");
  en.append("div").attr("class", "rbug");

  const all = en.merge(sel)
    .attr("class", d => "row"
      + (S.sel === d.driver ? " sel" : "")
      + (S.sel && S.sel !== d.driver ? " dim" : ""))
    .order();

  all.select(".rname").text(d => d.driver);
  all.select(".rleft").text(d => fmt(d.uncovered));
  all.select(".rbug").text(d => d.n_bugs || "");

  /* 궤적 — viewBox 를 늘려 쓰므로 선 굵기는 non-scaling-stroke 로 고정한다 */
  const W = 400, H = 20;
  all.select(".rspark").each(function (d) {
    const pts = S.series.get(d.driver);
    const g = d3.select(this);
    g.selectAll("*").remove();
    const svg = g.append("svg").attr("width", "100%").attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "none");

    svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", H - .5).attr("y2", H - .5)
      .attr("stroke", "#eceff2").attr("vector-effect", "non-scaling-stroke");

    if (!pts) return;
    const hot = d.cold_min !== "" && d.cold_min != null && d.cold_min < 60;
    const col = hot ? "var(--warm)" : "var(--cold)";
    /* 행마다 제 최대값으로 정규화한다 — 여기서 묻는 건 "얼마나" 가 아니라
       "아직 오르는가" 이고, 절대량은 오른쪽 left 열과 누적막대가 말한다.
       공통 축을 쓰면 hid-core(633) 때문에 나머지 50여 행이 전부 납작해진다. */
    const x = d3.scaleLinear([0, S.END], [0, W]);
    const y = d3.scaleLinear([0, d3.max(pts, p => p.cov) || 1], [H - 1, 1]);

    svg.append("path").datum(pts)
      .attr("fill", col).attr("fill-opacity", .18)
      .attr("d", d3.area().curve(d3.curveStepAfter)
        .x(p => x(p.minute)).y0(H - .5).y1(p => y(p.cov)));
    svg.append("path").datum(pts)
      .attr("fill", "none").attr("stroke", col).attr("stroke-width", 1.4)
      .attr("vector-effect", "non-scaling-stroke")
      .attr("d", d3.line().curve(d3.curveStepAfter)
        .x(p => x(p.minute)).y(p => y(p.cov)));
    /* 마지막 획득 지점 — 오른쪽 끝에서 멀수록 오래 식은 것이다 */
    const last = pts[pts.length - 2] || pts[0];
    svg.append("circle").attr("cx", x(last.minute)).attr("cy", y(last.cov)).attr("r", 2.2)
      .attr("fill", col).attr("vector-effect", "non-scaling-stroke");
  });

  /* 함수 상태 누적막대 */
  all.select(".rstack").each(function (d) {
    const w = 76, h = 9, n = Math.max(d.n_funcs, 1);
    const g = d3.select(this); g.selectAll("*").remove();
    const svg = g.append("svg").attr("width", w).attr("height", h);
    let x = 0;
    for (const [k, c] of [["n_full", "var(--full)"], ["n_partial", "var(--partial)"], ["n_none", "var(--none)"]]) {
      const ww = d[k] / n * w;
      if (ww > 0) svg.append("rect").attr("x", x).attr("y", 0).attr("width", Math.max(ww, .7))
        .attr("height", h).attr("fill", c);
      x += ww;
    }
  });
}

/* ── View B — Call Graph ──────────────────────────────────────────────
 *
 * 제안서 Task 2: "퍼저가 이미 닿은 코드에서 한 번만 더 호출하면 되는 함수는?"
 * 그래서 x 는 호출 깊이, 색은 커버리지 밴드, 그리고 **커버된 함수에서
 * 미커버 함수로 가는 엣지(경계)** 를 주황으로 따로 그린다. 그 주황 화살표
 * 하나하나가 "가장 싼 다음 표적"이다.
 *
 * 엣지는 vmlinux 를 디스어셈블해 얻은 **직접 call** 이다. HID 는 .probe /
 * .raw_event 를 함수 포인터로 부르므로 그 경로는 정적으로 안 보인다 —
 * 워크큐에서 도는 함수에 코너 마크를 찍어 그 빈자리를 표시한다.
 */
function defaultDriverB() {
  const c = d3.rollup(
    S.edges.filter(e => e.caller_cov > 0 && e.callee_cov === 0),
    v => v.length, e => e.caller_drv);
  return d3.greatest([...c], d => d[1])?.[0] || null;
}

function renderB() {
  const host = d3.select("#plotB"); host.selectAll("*").remove();
  const box = host.node().getBoundingClientRect();
  const W = Math.max(box.width, 320), H = Math.max(box.height, 200);

  const drv = S.sel || S.defB;
  const sub = S.edges.filter(e => e.caller_drv === drv);
  if (!drv || !sub.length) {
    host.append("div").attr("class", "empty")
      .html("이 드라이버에서는 직접 호출 엣지가 잡히지 않았다.<br>"
          + "<small>HID 는 대부분 함수 포인터로 디스패치한다.</small>");
    return;
  }

  /* 경계만 보기 — 커버된 호출자와 그 미커버 피호출자만 남긴다 */
  const isFrontier = e => e.caller_cov > 0 && e.callee_cov === 0;
  let edges = S.bFrontierOnly ? sub.filter(isFrontier) : sub;
  if (S.bHideFull) edges = edges.filter(e => !(e.caller_full && e.callee_full));
  if (!edges.length) {
    host.append("div").attr("class", "empty").text("조건에 맞는 엣지가 없다.");
    return;
  }

  /* 노드 집합 */
  const info = new Map();
  for (const e of edges) {
    if (!info.has(e.caller)) info.set(e.caller, { f: e.caller, cov: e.caller_cov, tot: e.caller_tot, file: e.caller_file, ext: false });
    if (!info.has(e.callee)) info.set(e.callee, { f: e.callee, cov: e.callee_cov, tot: e.callee_tot, file: e.callee_file, ext: e.callee_drv !== drv });
  }
  const names = [...info.keys()];

  /* 호출 깊이 — 들어오는 엣지가 없는 곳이 깊이 0, 사이클은 한 번만 보정 */
  const indeg = new Map(names.map(n => [n, 0]));
  const out = new Map(names.map(n => [n, []]));
  for (const e of edges) {
    if (e.caller === e.callee) continue;
    indeg.set(e.callee, indeg.get(e.callee) + 1);
    out.get(e.caller).push(e.callee);
  }
  const depth = new Map(names.map(n => [n, 0]));
  const left = new Map(indeg);                       /* 위상정렬용 사본 */
  const q = names.filter(n => left.get(n) === 0);
  let head = 0;
  while (head < q.length) {
    const n = q[head++];
    for (const m of out.get(n)) {
      if (depth.get(m) < depth.get(n) + 1) depth.set(m, Math.min(depth.get(n) + 1, 12));
      const r = left.get(m) - 1;
      left.set(m, r);
      if (r === 0) q.push(m);
    }
  }
  /* 사이클에 걸려 큐에 못 들어온 노드 — 전임자 최대 깊이 + 1 로 한 번만 보정 */
  for (const n of names) {
    if (left.get(n) > 0) {
      const pre = edges.filter(e => e.callee === n && e.caller !== n)
                       .map(e => depth.get(e.caller) ?? 0);
      depth.set(n, Math.min((d3.max(pre) ?? 0) + 1, 12));
    }
  }

  /* 배치 */
  const maxD = d3.max(names, n => depth.get(n));
  const m = { t: 12, r: 12, b: 26, l: 12 };
  const colW = (W - m.l - m.r) / (maxD + 1);
  const BW = Math.max(50, Math.min(118, colW - 14));
  const byD = d3.group(names, n => depth.get(n));
  /* 가장 붐비는 열에 맞춰 상자 높이를 정한다 — 안 그러면 겹친다 */
  const lane = H - m.t - m.b;
  const tallest = d3.max(byD, ([, arr]) => arr.length) || 1;
  const step = Math.min(24, lane / tallest);
  const BH = Math.max(6, step - 3);
  const pos = new Map();
  for (const [d, arr] of byD) {
    arr.sort((a, b) => (info.get(b).tot - info.get(b).cov) - (info.get(a).tot - info.get(a).cov));
    const y0 = m.t + Math.max(0, (lane - step * arr.length) / 2);
    arr.forEach((n, i) => pos.set(n, { x: m.l + colW * d + (colW - BW) / 2, y: y0 + step * i }));
  }

  const svg = host.append("svg").attr("width", W).attr("height", H);
  svg.append("defs").append("marker").attr("id", "arrowF")
    .attr("viewBox", "0 0 8 8").attr("refX", 7).attr("refY", 4)
    .attr("markerWidth", 5).attr("markerHeight", 5).attr("orient", "auto")
    .append("path").attr("d", "M0,0 L8,4 L0,8 Z").attr("fill", "var(--cold)");

  const band = d => d.tot && d.cov === d.tot ? "var(--full)"
    : d.cov === 0 ? "var(--none)"
    : d.cov / d.tot > .5 ? "#5e9ae0" : "#b9d4f2";
  const ink = d => (d.tot && d.cov === d.tot) || (d.cov / d.tot > .5) ? "#fff" : "#2a3138";

  /* 엣지 — 경계는 주황 화살표로 앞에 그린다 */
  const path = e => {
    const a = pos.get(e.caller), b = pos.get(e.callee);
    const x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };
  const drawn = edges.filter(e => pos.has(e.caller) && pos.has(e.callee) && e.caller !== e.callee);
  svg.append("g").selectAll("path.e").data(drawn.filter(e => !isFrontier(e))).join("path")
    .attr("d", path).attr("fill", "none")
    .attr("stroke", "#c8d0d8").attr("stroke-width", 1).attr("stroke-opacity", .75);
  svg.append("g").selectAll("path.f").data(drawn.filter(isFrontier)).join("path")
    .attr("d", path).attr("fill", "none")
    .attr("stroke", "var(--cold)").attr("stroke-width", 1.7)
    .attr("marker-end", "url(#arrowF)");

  /* 노드 */
  const g = svg.append("g").selectAll("g").data(names.map(n => info.get(n))).join("g")
    .attr("transform", d => `translate(${pos.get(d.f).x},${pos.get(d.f).y})`)
    .style("cursor", "pointer")
    .on("mousemove", (ev, d) => showTip(ev,
      `<b>${d.f}</b><br>${d.file}<br>covered ${fmt(d.cov)} / ${fmt(d.tot)} PC`
      + (d.cov === 0 ? `<br><span style="color:#e8a05c">아직 한 번도 실행되지 않았다</span>` : "")
      + (S.wq.has(d.f) ? `<br>워크큐에서 실행됨` : "")))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { const t = S.fnDriver.get(d.f); if (t) select(t); });

  g.append("rect").attr("width", BW).attr("height", BH).attr("rx", 3)
    .attr("fill", d => band(d))
    .attr("stroke", d => d.ext ? "#9aa4ae" : "#aeb8c2")
    .attr("stroke-dasharray", d => d.ext ? "3,2" : null)
    .attr("stroke-width", 1);

  /* 워크큐에서 도는 함수 — 코너 마크 */
  g.filter(d => S.wq.has(d.f)).append("path")
    .attr("d", `M${BW - Math.min(9, BH)},${BH} L${BW},${BH} L${BW},${BH - Math.min(9, BH)} Z`)
    .attr("fill", "#7a4fd1");

  g.filter(() => BH >= 9).append("text").attr("x", 4).attr("y", BH / 2 + 3.2)
    .attr("font-size", Math.min(8.5, BH - 2)).attr("font-family", "var(--mono)")
    .attr("fill", d => ink(d))
    .text(d => { const w = Math.floor((BW - 8) / 4.9); return d.f.length > w ? d.f.slice(0, w - 1) + "…" : d.f; });

  /* 축 설명 */
  svg.append("text").attr("x", m.l).attr("y", H - 8)
    .attr("font-size", 9.5).attr("fill", "#6b7682")
    .text(`${drv} · 노드 ${names.length} · 경계 ${drawn.filter(isFrontier).length}개 · 왼쪽에서 오른쪽으로 호출 깊이`);
}

/* ── View C — Instrumentation Payoff ──────────────────────────────── */
function renderC() {
  const host = d3.select("#plotC"); host.selectAll("*").remove();
  const box = host.node().getBoundingClientRect();
  const W = Math.max(box.width, 320);

  let rows = S.drivers.filter(d => d.gained !== "" && d.gained != null && +d.gained > 0);
  rows.sort((a, b) => (+b[S.sortC] || 0) - (+a[S.sortC] || 0));
  if (!rows.length) { host.append("div").attr("class", "empty").text("측정된 구간이 없다"); return; }

  const rh = 17, m = { t: 8, r: 96, b: 34, l: 132 };   /* 축 눈금과 캡션이 겹치지 않게 */
  const H = m.t + rows.length * rh + m.b;
  const svg = host.append("svg").attr("width", W).attr("height", H);
  const x = d3.scaleLinear([0, d3.max(rows, d => +d.cov_trace_on)], [m.l, W - m.r]);

  const g = svg.append("g").selectAll("g").data(rows).join("g")
    .attr("transform", (d, i) => `translate(0,${m.t + i * rh})`)
    .style("cursor", "pointer")
    .attr("opacity", d => (S.sel && S.sel !== d.driver) ? .3 : 1)
    .on("click", (e, d) => select(d.driver))
    .on("mousemove", (e, d) => showTip(e,
      `<b>${d.driver}</b><br>추적 없이 ${fmt(d.cov_trace_off)} PC` +
      `<br>추적 켜고 ${fmt(d.cov_trace_on)} PC` +
      `<br><b>추가로 잡힌 PC +${d.gained}</b>` +
      `<br>측정된 함수 ${d.n_measured}개` + (d.n_bugs ? `<br>결함 ${d.n_bugs}건` : "")))
    .on("mouseleave", hideTip);

  g.append("text").attr("x", m.l - 8).attr("y", rh / 2 + 3).attr("text-anchor", "end")
    .attr("font-size", 10).attr("font-family", "var(--mono)")
    .attr("font-weight", d => S.sel === d.driver ? 600 : 400)
    .text(d => d.driver);

  g.append("rect").attr("x", m.l).attr("y", 2).attr("height", rh - 6)
    .attr("width", d => x(+d.cov_trace_off) - m.l).attr("fill", "var(--base)");
  g.append("rect").attr("y", 2).attr("height", rh - 6)
    .attr("x", d => x(+d.cov_trace_off))
    .attr("width", d => Math.max(x(+d.cov_trace_on) - x(+d.cov_trace_off), 1))
    .attr("fill", "var(--gain)");

  g.append("text").attr("x", W - m.r + 8).attr("y", rh / 2 + 3)
    .attr("font-size", 10).attr("font-family", "var(--mono)").attr("fill", "var(--gain)")
    .attr("font-weight", 600).text(d => `+${d.gained}`);
  g.append("text").attr("x", W - 10).attr("y", rh / 2 + 3).attr("text-anchor", "end")
    .attr("font-size", 10).attr("font-family", "var(--mono)").attr("fill", "var(--bug)")
    .attr("font-weight", 600).text(d => d.n_bugs || "·");

  svg.append("g").attr("transform", `translate(0,${m.t + rows.length * rh})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("~s")))
    .call(s => s.select(".domain").attr("stroke", "#cfd6dd"))
    .call(s => s.selectAll("text").attr("font-size", 9).attr("fill", "#6b7682"));
  svg.append("text").attr("x", m.l).attr("y", H - 4).attr("font-size", 9.5).attr("fill", "#6b7682")
    .html("program counters · ");
  svg.append("text").attr("x", m.l + 104).attr("y", H - 4).attr("font-size", 9.5)
    .attr("fill", "var(--gain)").attr("font-weight", 600).text("파랑 = 추적으로 추가된 PC");
  svg.append("text").attr("x", W - 10).attr("y", H - 4).attr("text-anchor", "end")
    .attr("font-size", 9.5).attr("fill", "var(--bug)").text("오른쪽 = 결함 건수");
}
