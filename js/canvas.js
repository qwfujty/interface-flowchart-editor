/**
 * canvas.js - SVG 画布：渲染 + 交互（拖拽/连线/框选/缩放平移/行内编辑）
 */
"use strict";

const Canvas = (() => {
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("canvas");
  const wrap = document.getElementById("canvas-wrap");
  const viewport = document.getElementById("viewport");
  const layerEdges = document.getElementById("layer-edges");
  const layerNodes = document.getElementById("layer-nodes");
  const layerOverlay = document.getElementById("layer-overlay");

  let view = { x: 80, y: 60, k: 1 };
  let drag = null;         // 当前交互状态
  let spaceHeld = false;
  let editorEl = null;     // 行内编辑框

  // ================= 工具 =================
  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, attrs = {}, parent = null) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function worldPos(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  }
  function localScreen(wx, wy) { // world → wrap 内相对坐标
    return { x: wx * view.k + view.x, y: wy * view.k + view.y };
  }

  function applyView() {
    viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // 文本宽度估算截断（中文≈fs，西文≈0.58fs）
  function fitText(s, maxW, fs) {
    s = String(s ?? "");
    let w = 0, out = "";
    for (const ch of s) {
      const cw = /[\u2E80-\uFFFD]/.test(ch) ? fs : fs * 0.58;
      if (w + cw > maxW - 4) return out + "…";
      out += ch; w += cw;
    }
    return out;
  }

  function getDiagram() { return State.getDiagram(); }
  function nodeById(id) { return getDiagram()?.nodes.find((n) => n.id === id) || null; }

  // ================= 端口 / 路径 =================
  function portPos(n, port) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    switch (port) {
      case "left":   return { x: n.x, y: cy, dx: -1, dy: 0 };
      case "right":  return { x: n.x + n.w, y: cy, dx: 1, dy: 0 };
      case "top":    return { x: cx, y: n.y, dx: 0, dy: -1 };
      case "bottom": return { x: cx, y: n.y + n.h, dx: 0, dy: 1 };
    }
    return { x: cx, y: cy, dx: 1, dy: 0 };
  }

  function edgeD(p1, p2) {
    const off = Math.max(50, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35);
    const c1 = { x: p1.x + p1.dx * off, y: p1.y + p1.dy * off };
    const c2 = { x: p2.x + p2.dx * off, y: p2.y + p2.dy * off };
    return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }

  // ================= 渲染 =================
  function render() {
    const d = getDiagram();
    layerEdges.innerHTML = "";
    layerNodes.innerHTML = "";
    layerOverlay.innerHTML = "";
    if (!d) return;

    const { entries, exits } = State.analyzeBoundaries(d);
    const entrySet = new Set(entries.map((n) => n.id));
    const exitSet = new Set(exits.map((n) => n.id));

    const nodeMap = new Map(d.nodes.map((n) => [n.id, n]));

    // ---- 辀 ----
    for (const e of d.edges) {
      const from = nodeMap.get(e.from), to = nodeMap.get(e.to);
      if (!from || !to) continue;
      layerEdges.appendChild(makeEdgeG(e, from, to));
    }

    // ---- 节点 ----
    for (const n of d.nodes) {
      layerNodes.appendChild(makeNodeG(n, entrySet.has(n.id), exitSet.has(n.id)));
    }

    updateStatus();
    if (typeof Panels !== "undefined" && Panels.refreshBoundary) Panels.refreshBoundary();
  }

  function makeNodeG(n, isEntry, isExit) {
    const g = el("g", { class: "node-g", transform: `translate(${n.x} ${n.y})`, "data-id": n.id });
    if (State.selection.nodes.has(n.id)) g.classList.add("selected");

    const body = (tag, attrs) => { const b = el(tag, { class: "node-body", ...attrs }, g); return b; };

    // ---- 形状 ----
    if (n.type === "decision") {
      body("polygon", {
        points: `${n.w / 2},0 ${n.w},${n.h / 2} ${n.w / 2},${n.h} 0,${n.h / 2}`,
        fill: n.color,
      });
    } else if (n.type === "data") {
      const ry = 9, rx = n.w / 2;
      body("path", {
        d: `M 0,${ry} V ${n.h - ry} A ${rx} ${ry} 0 0 0 ${n.w},${n.h - ry} V ${ry}`,
        fill: n.color,
      });
      body("ellipse", { cx: n.w / 2, cy: ry, rx, ry, fill: n.color, opacity: 0.55 });
    } else {
      body("rect", {
        x: 0, y: 0, width: n.w, height: n.h,
        rx: n.type === "api" ? 12 : 6, fill: n.color,
      });
    }

    // ---- 文本 ----
    if (n.type === "api") {
      // 方法徽章
      el("rect", { x: 8, y: 6, width: Math.max(34, n.method.length * 7.2 + 10), height: 15, rx: 4, fill: "rgba(255,255,255,.24)" }, g);
      el("text", { x: 8 + Math.max(34, n.method.length * 7.2 + 10) / 2, y: 17, class: "node-badge" }, g)
        .textContent = n.method;
      // 名称 + 路径
      el("text", { x: n.w / 2, y: 36, class: "node-label" }, g)
        .textContent = fitText(n.name, n.w - 20, 12);
      el("text", { x: n.w / 2, y: 52, class: "node-sub" }, g)
        .textContent = fitText(n.path, n.w - 16, 10);
      // 边界标记（接口即边界）
      if (isEntry) boundaryTag(g, n, "入口", "#10b981", "left");
      if (isExit) boundaryTag(g, n, "出口", "#4f6ef7", "right");
    } else if (n.type === "decision") {
      el("text", { x: n.w / 2, y: n.h / 2 + 4, class: "node-label" }, g)
        .textContent = fitText(n.name, n.w * 0.62, 12);
    } else if (n.type === "data") {
      el("text", { x: n.w / 2, y: n.h / 2 + 10, class: "node-label" }, g)
        .textContent = fitText(n.name, n.w - 18, 12);
    } else {
      el("text", { x: n.w / 2, y: n.h / 2 + 4.5, class: "node-label" }, g)
        .textContent = fitText(n.name, n.w - 16, 12);
    }

    // ---- 端口 ----
    for (const p of ["left", "right", "top", "bottom"]) {
      const pp = portPos({ ...n, x: 0, y: 0 }, p);
      el("circle", { class: "port", "data-port": p, cx: pp.x, cy: pp.y, r: 5 }, g);
    }
    return g;
  }

  function boundaryTag(g, n, text, color, side) {
    const w = 32, h = 15;
    const x = side === "left" ? 0 : n.w - w;
    const y = -h - 3; // 悬挂在节点框外顶部，不与内容冲突
    // 先底色，再文字（顺序不能反）
    el("rect", { x, y, width: w, height: h, rx: 4, fill: color, opacity: 0.95 }, g);
    const t = el("text", { x: x + w / 2, y: y + 11.5, class: "node-badge", fill: "#fff" }, g);
    t.textContent = text;
  }

  function makeEdgeG(e, from, to) {
    const g = el("g", { "data-id": e.id, "data-kind": "edge" });
    if (State.selection.edges.has(e.id)) g.classList.add("edge-selected");

    const p1 = portPos(from, e.fromPort || "right");
    const p2 = portPos(to, e.toPort || "left");
    const d = edgeD(p1, p2);

    const path = el("path", {
      class: "edge-path" + (e.style === "dashed" ? " dashed" : "") + (State.selection.edges.has(e.id) ? " edge-selected" : ""),
      d,
      "marker-end": `url(#${State.selection.edges.has(e.id) ? "arrowhead-selected" : "arrowhead"})`,
    }, g);

    // 标签
    if (e.label) {
      const len = path.getTotalLength();
      const pt = path.getPointAtLength(len / 2);
      const tw = fitText(e.label, 200, 11).length;
      const bg = el("rect", {
        class: "edge-label-bg",
        x: pt.x - (e.label.length * 11 + 10) / 2, y: pt.y - 9,
        width: e.label.length * 11 + 10, height: 18, rx: 5,
      }, g);
      el("text", { x: pt.x, y: pt.y + 1, class: "edge-label-text" }, g).textContent = e.label;
    }
    return g;
  }

  // ================= 交互 =================
  function nodeGOf(target) { return target.closest?.(".node-g"); }
  function edgeGOf(target) { return target.closest?.('[data-kind="edge"]'); }

  function onPointerDown(e) {
    if (editorEl) commitEditor();
    svg.focus();

    // 中键 / 空格 → 平移
    if (e.button === 1 || spaceHeld) {
      startPan(e);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const portEl = e.target.closest?.(".port");
    const nodeG = nodeGOf(e.target);
    const edgeG = edgeGOf(e.target);

    if (portEl && nodeG) {
      startConnect(e, nodeG.dataset.id, portEl.dataset.port);
      return;
    }
    if (nodeG) {
      handleNodePointerDown(e, nodeG.dataset.id);
      return;
    }
    if (edgeG) {
      if (e.ctrlKey || e.metaKey) {
        const cur = new Set(State.selection.edges);
        cur.has(edgeG.dataset.id) ? cur.delete(edgeG.dataset.id) : cur.add(edgeG.dataset.id);
        State.select([...State.selection.nodes], [...cur]);
      } else {
        State.select([], [edgeG.dataset.id]);
      }
      return;
    }
    // 空白：框选
    if (!e.ctrlKey && !e.metaKey) State.clearSelection();
    startMarquee(e, e.ctrlKey || e.metaKey);
  }

  // ---- 节点按下：选择 + 准备拖动 ----
  function handleNodePointerDown(e, nodeId) {
    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    let sel = [...State.selection.nodes];
    if (multi) {
      sel = sel.includes(nodeId) ? sel.filter((i) => i !== nodeId) : [...sel, nodeId];
    } else if (!sel.includes(nodeId)) {
      sel = [nodeId];
    }
    State.select(sel, []);
    if (!sel.includes(nodeId)) return; // ctrl 取消选中后不拖动

    const d = getDiagram();
    const wp = worldPos(e);
    drag = {
      mode: "node",
      moved: false,
      startW: wp,
      items: sel
        .map((id) => nodeById(id))
        .filter(Boolean)
        .map((n) => ({ id: n.id, g: layerNodes.querySelector(`.node-g[data-id="${n.id}"]`), ox: n.x - wp.x, oy: n.y - wp.y })),
      edges: d.edges
        .filter((ed) => sel.includes(ed.from) || sel.includes(ed.to))
        .map((ed) => ({ e: ed, g: layerEdges.querySelector(`[data-id="${ed.id}"]`) })),
    };
  }

  function startPan(e) {
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add("panning");
  }

  function startMarquee(e, additive) {
    const wp = worldPos(e);
    drag = {
      mode: "marquee", additive,
      startW: wp,
      base: additive ? [...State.selection.nodes] : [],
      rect: el("rect", { class: "marquee-rect", fill: "rgba(79,110,247,.08)", stroke: "#4f6ef7", "stroke-width": 1, "stroke-dasharray": "4 3" }, layerOverlay),
    };
  }

  function startConnect(e, nodeId, port) {
    drag = {
      mode: "connect",
      fromId: nodeId, fromPort: port,
      path: el("path", { class: "temp-edge", "marker-end": "url(#arrowhead-temp)" }, layerOverlay),
    };
    svg.classList.add("connecting");
    updateConnect(e);
  }

  function updateConnect(e) {
    const n = nodeById(drag.fromId);
    if (!n) return;
    const p1 = portPos(n, drag.fromPort);
    const wp = worldPos(e);
    const p2 = { x: wp.x, y: wp.y, dx: -p1.dx, dy: -p1.dy };
    drag.path.setAttribute("d", edgeD(p1, p2));

    // 高亮潜在目标
    layerNodes.querySelectorAll(".connect-target").forEach((g) => g.classList.remove("connect-target"));
    const target = connectTargetAt(e);
    if (target && target.dataset.id !== drag.fromId) target.classList.add("connect-target");
  }

  function connectTargetAt(e) {
    const below = document.elementFromPoint(e.clientX, e.clientY);
    return nodeGOf(below);
  }

  // ---- pointermove ----
  function onPointerMove(e) {
    const wp = worldPos(e);
    updateStatusPos(wp);

    if (!drag) return;
    switch (drag.mode) {
      case "pan": {
        view.x = drag.vx + (e.clientX - drag.sx);
        view.y = drag.vy + (e.clientY - drag.sy);
        applyView();
        break;
      }
      case "node": {
        if (!drag.moved && Math.hypot(wp.x - drag.startW.x, wp.y - drag.startW.y) < 3) break;
        drag.moved = true;
        for (const it of drag.items) {
          it.g.setAttribute("transform", `translate(${Math.round(wp.x + it.ox)} ${Math.round(wp.y + it.oy)})`);
        }
        refreshDragEdges();
        break;
      }
      case "marquee": {
        const x = Math.min(drag.startW.x, wp.x), y = Math.min(drag.startW.y, wp.y);
        const w = Math.abs(wp.x - drag.startW.x), h = Math.abs(wp.y - drag.startW.y);
        Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => drag.rect.setAttribute(k, v));
        break;
      }
      case "connect":
        updateConnect(e);
        break;
    }
  }

  // 拖动时增量更新相连边
  function refreshDragEdges() {
    for (const { e, g } of drag.edges) {
      if (!g) continue;
      const from = nodeById(e.from), to = nodeById(e.to);
      if (!from || !to) continue;
      const p1 = portPos(from, e.fromPort), p2 = portPos(to, e.toPort);
      const path = g.querySelector(".edge-path");
      path.setAttribute("d", edgeD(p1, p2));
      if (e.label) {
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(len / 2);
        const bg = g.querySelector(".edge-label-bg");
        const text = g.querySelector(".edge-label-text");
        if (bg) {
          bg.setAttribute("x", pt.x - (e.label.length * 11 + 10) / 2);
          bg.setAttribute("y", pt.y - 9);
        }
        if (text) { text.setAttribute("x", pt.x); text.setAttribute("y", pt.y + 1); }
      }
    }
  }

  // ---- pointerup ----
  function onPointerUp(e) {
    if (!drag) return;
    const mode = drag.mode;
    const ctx = drag;
    drag = null;
    svg.classList.remove("panning", "connecting");

    if (mode === "node" && ctx.moved) {
      const wp = worldPos(e);
      const patch = {};
      for (const it of ctx.items) {
        patch[it.id] = { x: Math.round(wp.x + it.ox), y: Math.round(wp.y + it.oy) };
      }
      const d = getDiagram();
      for (const n of d.nodes) if (patch[n.id]) Object.assign(n, patch[n.id]);
      State.commit();
      State.emit("diagram-changed");
    } else if (mode === "marquee") {
      const wp = worldPos(e);
      const bx = { x: Math.min(ctx.startW.x, wp.x), y: Math.min(ctx.startW.y, wp.y), w: Math.abs(wp.x - ctx.startW.x), h: Math.abs(wp.y - ctx.startW.y) };
      const d = getDiagram();
      const hit = d.nodes
        .filter((n) => n.x < bx.x + bx.w && n.x + n.w > bx.x && n.y < bx.y + bx.h && n.y + n.h > bx.y)
        .map((n) => n.id);
      State.select([...new Set([...ctx.base, ...hit])], []);
    } else if (mode === "connect") {
      ctx.path.remove();
      layerNodes.querySelectorAll(".connect-target").forEach((g) => g.classList.remove("connect-target"));
      const targetG = connectTargetAt(e);
      if (targetG && targetG.dataset.id !== ctx.fromId) {
        const toNode = nodeById(targetG.dataset.id);
        const fromNode = nodeById(ctx.fromId);
        const wp = worldPos(e);
        const toPort = pickEntryPort(toNode, wp.x, wp.y);
        const edge = State.createEdge(ctx.fromId, toNode.id, { fromPort: ctx.fromPort, toPort });
        const added = State.addEdge(edge);
        if (!added && typeof Toast !== "undefined") Toast.show("该方向连线已存在", "info");
      }
    }
    render();
  }

  function pickEntryPort(node, px, py) {
    // 不取反：释放点落在目标节点哪一侧，就连到哪一侧的端口
    const dx = px - (node.x + node.w / 2), dy = py - (node.y + node.h / 2);
    if (Math.abs(dx) / node.w > Math.abs(dy) / node.h) return dx > 0 ? "right" : "left";
    return dy > 0 ? "bottom" : "top";
  }

  // ---- 缩放 ----
  function onWheel(e) {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const k2 = clamp(view.k * factor, 0.2, 3);
    view.x = mx - (mx - view.x) * (k2 / view.k);
    view.y = my - (my - view.y) * (k2 / view.k);
    view.k = k2;
    applyView();
    updateZoomLabel();
  }

  function setZoom(k, centerScreen) {
    const r = svg.getBoundingClientRect();
    const mx = centerScreen?.x ?? r.width / 2, my = centerScreen?.y ?? r.height / 2;
    const k2 = clamp(k, 0.2, 3);
    view.x = mx - (mx - view.x) * (k2 / view.k);
    view.y = my - (my - view.y) * (k2 / view.k);
    view.k = k2;
    applyView();
    updateZoomLabel();
  }

  function fitView() {
    const d = getDiagram();
    if (!d || !d.nodes.length) { view = { x: 80, y: 60, k: 1 }; applyView(); updateZoomLabel(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of d.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    const r = svg.getBoundingClientRect();
    const pad = 60;
    const k = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), 0.2, 1.5);
    view.k = k;
    view.x = (r.width - (maxX - minX) * k) / 2 - minX * k;
    view.y = (r.height - (maxY - minY) * k) / 2 - minY * k;
    applyView();
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const btn = document.getElementById("btn-zoom-reset");
    if (btn) btn.textContent = Math.round(view.k * 100) + "%";
  }

  // 将某节点居中显示
  function centerOn(node) {
    const r = svg.getBoundingClientRect();
    setZoom(1);
    view.x = r.width / 2 - (node.x + node.w / 2);
    view.y = r.height / 2 - (node.y + node.h / 2);
    applyView();
    updateZoomLabel();
  }

  // ---- 双击：行内编辑 ----
  function onDblClick(e) {
    const nodeG = nodeGOf(e.target);
    if (nodeG) {
      const n = nodeById(nodeG.dataset.id);
      if (!n) return;
      // 编辑名称（api 节点名称行 y=37，其余居中）
      const lineY = n.type === "api" ? 30 : n.type === "data" ? n.h / 2 + 3 : n.h / 2 - 2;
      const sp = localScreen(n.x + 10, n.y + lineY);
      openEditor(sp.x, sp.y, n.w * view.k - 20, n.name, (val) => {
        if (val && val !== n.name) { State.updateNode(n.id, { name: val }); State.commit(); State.emit("diagram-changed"); }
      });
      return;
    }
    const edgeG = edgeGOf(e.target);
    if (edgeG && (e.target.classList.contains("edge-label-text") || e.target.classList.contains("edge-label-bg"))) {
      const d = getDiagram();
      const ed = d.edges.find((x) => x.id === edgeG.dataset.id);
      if (!ed) return;
      const sp = localScreen(worldPos(e).x, worldPos(e).y);
      openEditor(sp.x - 60, sp.y - 16, 120, ed.label || "", (val) => {
        if (val !== ed.label) { State.updateEdge(ed.id, { label: val }); State.commit(); State.emit("diagram-changed"); }
      });
    }
  }

  function openEditor(x, y, width, value, onDone) {
    commitEditor();
    editorEl = document.createElement("input");
    editorEl.className = "inline-edit";
    editorEl.value = value;
    editorEl.style.left = x + "px";
    editorEl.style.top = y + "px";
    editorEl.style.width = Math.max(90, width) + "px";
    wrap.appendChild(editorEl);
    editorEl.focus();
    editorEl.select();
    const finish = (ok) => {
      const val = editorEl.value.trim();
      const cb = editorEl._cb;
      editorEl.remove();
      editorEl = null;
      if (ok) cb(val);
    };
    editorEl._cb = onDone;
    editorEl.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") finish(true);
      if (ev.key === "Escape") finish(false);
    });
    editorEl.addEventListener("blur", () => finish(true));
  }

  function commitEditor() {
    if (editorEl) {
      const el2 = editorEl;
      const val = el2.value.trim();
      el2.remove();
      editorEl = null;
      el2._cb && el2._cb(val);
    }
  }

  // ---- 拖放创建节点（从左侧面板） ----
  function setupDrop() {
    const hint = document.getElementById("drop-hint");
    ["dragenter", "dragover"].forEach((ev) =>
      wrap.addEventListener(ev, (e) => { e.preventDefault(); hint.classList.add("show"); }));
    ["dragleave", "drop"].forEach((ev) =>
      wrap.addEventListener(ev, (e) => { e.preventDefault(); hint.classList.remove("show"); }));
    wrap.addEventListener("drop", (e) => {
      const wp = worldPos(e);
      // 优先：小类（模板）拖入
      const tplId = e.dataTransfer.getData("text/node-template");
      let n = null;
      if (tplId) {
        const tpl = State.getTemplate(tplId);
        if (tpl) {
          n = State.createNode(tpl.category, wp.x - 80, wp.y - 26, {
            name: tpl.name, desc: tpl.desc, color: tpl.color,
            ...(tpl.category === "api" ? { method: tpl.method, path: tpl.path } : {}),
            ...(Array.isArray(tpl.data) ? { data: tpl.data } : {}), // 数据节点子段
          });
        }
      }
      // 兜底：大类默认节点
      if (!n) {
        const type = e.dataTransfer.getData("text/node-type");
        if (!type) return;
        n = State.createNode(type, wp.x - 80, wp.y - 26);
      }
      State.addNode(n);
      State.select([n.id], []);
      render();
    });
  }

  // ---- 状态栏 ----
  function updateStatusPos(wp) {
    const elPos = document.getElementById("status-pos");
    if (elPos) elPos.textContent = `x: ${Math.round(wp.x)}, y: ${Math.round(wp.y)}`;
  }
  function updateStatus() {
    const d = getDiagram();
    const elC = document.getElementById("status-count");
    if (elC && d) elC.textContent = `${d.nodes.length} 节点 · ${d.edges.length} 连线`;
  }

  // ================= 初始化 =================
  function init() {
    svg.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("dblclick", onDblClick);
    svg.setAttribute("tabindex", "0");

    // 空格平移
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !editorEl && e.target === svg) { spaceHeld = true; e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceHeld = false; });

    setupDrop();
    applyView();

    State.on("diagram-changed", render);
    State.on("diagram-switched", () => { render(); });
    State.on("selection-changed", () => {
      // 只更新 class，不重建 DOM
      layerNodes.querySelectorAll(".node-g").forEach((g) =>
        g.classList.toggle("selected", State.selection.nodes.has(g.dataset.id)));
      layerEdges.querySelectorAll(".edge-path").forEach((p) => {
        const sel = State.selection.edges.has(p.closest("[data-kind=edge]").dataset.id);
        p.classList.toggle("edge-selected", sel);
        p.setAttribute("marker-end", `url(#${sel ? "arrowhead-selected" : "arrowhead"})`);
      });
    });
    State.on("history-changed", () => {
      document.getElementById("btn-undo").disabled = !State.canUndo;
      document.getElementById("btn-redo").disabled = !State.canRedo;
    });
  }

  return {
    init, render, fitView, setZoom, centerOn,
    get view() { return view; },
    getZoom: () => view.k,
    openEditor,
  };
})();
