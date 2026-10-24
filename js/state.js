/**
 * state.js - 数据模型与状态管理
 * 核心概念：流程图以「接口节点」为边界（入口接口 = 无入边的 API 节点，出口接口 = 无出边的 API 节点），
 * 没有传统的"开始/结束"节点。
 */
"use strict";

const State = (() => {
  const STORAGE_KEY = "api-flow-editor-v1";
  const MAX_HISTORY = 60;

  // ---------- 工具 ----------
  const uid = (prefix = "id") =>
    prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  const clone = (obj) => JSON.parse(JSON.stringify(obj));

  const deepMerge = (base, patch) => {
    for (const k of Object.keys(patch)) {
      if (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
        deepMerge(base[k], patch[k]);
      } else {
        base[k] = patch[k];
      }
    }
    return base;
  };

  // ---------- 节点尺寸常量 ----------
  const NODE_SIZE = {
    api:      { w: 190, h: 62 },
    process:  { w: 160, h: 52 },
    decision: { w: 170, h: 84 },
    data:     { w: 160, h: 58 },
  };
  const NODE_TYPE_META = {
    api:      { label: "接口", color: "#4f6ef7" },
    process:  { label: "处理", color: "#64748b" },
    decision: { label: "判断", color: "#d97706" },
    data:     { label: "数据", color: "#059669" },
  };
  const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "WS"];

  // ---------- 数据 ----------
  let state = null;           // { diagrams: [...], activeId }
  let history = [];           // 撤销栈（快照）
  let future = [];            // 重做栈（快照）
  let suppressHistory = false;

  // ---------- 事件总线 ----------
  const listeners = new Map();
  const on = (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  };
  const emit = (event, payload) => {
    if (listeners.has(event)) listeners.get(event).forEach((fn) => { try { fn(payload); } catch (e) { console.error(`[emit ${event}]`, e); } });
    if (listeners.has("*")) listeners.get("*").forEach((fn) => { try { fn(event, payload); } catch (e) { console.error("[emit *]", e); } });
  };

  // ---------- 流程图操作 ----------
  function createNode(type, x, y, extra = {}) {
    const size = NODE_SIZE[type] || NODE_SIZE.process;
    const meta = NODE_TYPE_META[type] || NODE_TYPE_META.process;
    const node = {
      id: uid("n"),
      type,
      name: extra.name || meta.label,
      x: Math.round(x), y: Math.round(y),
      w: size.w, h: size.h,
      desc: extra.desc || "",
      color: extra.color || meta.color,
    };
    if (type === "api") {
      node.method = extra.method || "GET";
      node.path = extra.path || "/api/example";
    }
    if (Array.isArray(extra.data)) node.data = clone(extra.data); // 数据节点子段
    return node;
  }

  function createEdge(from, to, extra = {}) {
    return {
      id: uid("e"),
      from, to,
      fromPort: extra.fromPort || "right",
      toPort: extra.toPort || "left",
      label: extra.label || "",
      style: extra.style || "solid",
    };
  }

  function newDiagram(name) {
    return {
      id: uid("d"),
      name: name || "未命名流程图",
      nodes: [],
      edges: [],
    };
  }

  function getDiagram(id = state.activeId) {
    return state.diagrams.find((d) => d.id === id) || null;
  }

  function addDiagram(name) {
    const d = newDiagram(name);
    state.diagrams.push(d);
    state.activeId = d.id;
    commit();
    emit("diagrams-changed");
    emit("diagram-switched");
    return d;
  }

  function removeDiagram(id) {
    const idx = state.diagrams.findIndex((d) => d.id === id);
    if (idx === -1) return;
    state.diagrams.splice(idx, 1);
    if (state.activeId === id) {
      state.activeId = state.diagrams.length ? state.diagrams[Math.min(idx, state.diagrams.length - 1)].id : null;
    }
    if (!state.diagrams.length) addDiagramSilent();
    commit();
    emit("diagrams-changed");
    emit("diagram-switched");
  }

  function addDiagramSilent() {
    const d = newDiagram("新流程图");
    state.diagrams.push(d);
    state.activeId = d.id;
    return d;
  }

  function switchDiagram(id) {
    if (id === state.activeId) return;
    const d = getDiagram(id);
    if (!d) return;
    state.activeId = id;
    commit();
    emit("diagram-switched");
    emit("selection-changed");
  }

  function renameDiagram(id, name) {
    const d = getDiagram(id);
    if (!d || !name.trim()) return;
    d.name = name.trim();
    commit();
    emit("diagrams-changed");
  }

  // ---------- 节点/边 CRUD（针对当前激活图） ----------
  function addNode(node) {
    const d = getDiagram();
    if (!d) return null;
    d.nodes.push(node);
    commit();
    emit("diagram-changed");
    return node;
  }

  function updateNode(id, patch) {
    const d = getDiagram();
    if (!d) return;
    const n = d.nodes.find((n) => n.id === id);
    if (!n) return;
    Object.assign(n, patch);
    emit("diagram-changed");
    emit("node-updated", n);
  }

  function removeNodes(ids) {
    const d = getDiagram();
    if (!d) return;
    const set = new Set(ids);
    d.nodes = d.nodes.filter((n) => !set.has(n.id));
    d.edges = d.edges.filter((e) => !set.has(e.from) && !set.has(e.to));
    commit();
    emit("diagram-changed");
    emit("selection-changed");
  }

  function addEdge(edge) {
    const d = getDiagram();
    if (!d) return null;
    // 去重：同方向同端口已存在则拒绝
    const dup = d.edges.find((e) => e.from === edge.from && e.to === edge.to);
    if (dup) return null;
    d.edges.push(edge);
    commit();
    emit("diagram-changed");
    return edge;
  }

  function updateEdge(id, patch) {
    const d = getDiagram();
    if (!d) return;
    const e = d.edges.find((e) => e.id === id);
    if (!e) return;
    Object.assign(e, patch);
    emit("diagram-changed");
    emit("edge-updated", e);
  }

  function removeEdges(ids) {
    const d = getDiagram();
    if (!d) return;
    const set = new Set(ids);
    d.edges = d.edges.filter((e) => !set.has(e.id));
    commit();
    emit("diagram-changed");
    emit("selection-changed");
  }

  // ---------- 边界接口分析 ----------
  /**
   * 分析当前图的接口边界：
   * - entry: 入口接口（无入边的 API 节点）
   * - exit:  出口接口（无出边的 API 节点）
   */
  function analyzeBoundaries(diagram = getDiagram()) {
    if (!diagram) return { entries: [], exits: [] };
    const hasIn = new Set(diagram.edges.map((e) => e.to));
    const hasOut = new Set(diagram.edges.map((e) => e.from));
    const entries = [], exits = [];
    for (const n of diagram.nodes) {
      if (n.type !== "api") continue;
      if (!hasIn.has(n.id)) entries.push(n);
      if (!hasOut.has(n.id)) exits.push(n);
    }
    return { entries, exits };
  }

  // ---------- 历史（撤销/重做） ----------
  function snapshot() {
    return JSON.stringify({ diagrams: state.diagrams, activeId: state.activeId });
  }

  function commit() {
    if (suppressHistory) return;
    const snap = snapshot();
    if (history[history.length - 1] === snap) return;
    history.push(snap);
    if (history.length > MAX_HISTORY) history.shift();
    future = [];
    emit("history-changed");
    saveLocal();
  }

  function undo() {
    if (history.length < 2) return;
    future.push(history.pop());
    const prev = JSON.parse(history[history.length - 1]);
    state.diagrams = prev.diagrams;
    state.activeId = prev.activeId;
    saveLocal();
    emit("diagrams-changed");
    emit("diagram-switched");
    emit("diagram-changed");
    emit("selection-changed");
    emit("history-changed");
  }

  function redo() {
    if (!future.length) return;
    const next = future.pop();
    history.push(next);
    const s = JSON.parse(next);
    state.diagrams = s.diagrams;
    state.activeId = s.activeId;
    saveLocal();
    emit("diagrams-changed");
    emit("diagram-switched");
    emit("diagram-changed");
    emit("selection-changed");
    emit("history-changed");
  }

  // ---------- 持久化 ----------
  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { console.warn("localStorage 保存失败", e); }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.diagrams) || !s.diagrams.length) return null;
      return s;
    } catch (e) { return null; }
  }

  function replaceAll(newState) {
    state = newState;
    history = [snapshot()];
    future = [];
    saveLocal();
    emit("diagrams-changed");
    emit("diagram-switched");
    emit("diagram-changed");
    emit("selection-changed");
    emit("history-changed");
  }

  // ---------- 初始化 ----------
  function init(seedDiagram) {
    const saved = loadLocal();
    if (saved) {
      state = saved;
    } else if (seedDiagram) {
      state = { diagrams: [seedDiagram], activeId: seedDiagram.id };
    } else {
      state = { diagrams: [], activeId: null };
      addDiagramSilent();
    }
    history = [snapshot()];
    future = [];
  }

  // 选择状态（不进历史）
  const selection = { nodes: new Set(), edges: new Set() };
  function select(nodeIds = [], edgeIds = []) {
    selection.nodes = new Set(nodeIds);
    selection.edges = new Set(edgeIds);
    emit("selection-changed");
  }
  function clearSelection() {
    if (selection.nodes.size || selection.edges.size) {
      selection.nodes.clear();
      selection.edges.clear();
      emit("selection-changed");
    }
  }

  // ---------- 小类（节点模板）：大类 = 接口/处理/判断/数据 ----------
  const TPL_KEY = "api-flow-editor-templates-v1";
  let templates = null; // 惰性加载 [{id, category, name, method, path, color, desc}]

  function loadTemplates() {
    if (templates) return templates;
    try { templates = JSON.parse(localStorage.getItem(TPL_KEY)) || []; }
    catch (e) { templates = []; }
    return templates;
  }
  function saveTemplates() {
    try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)); } catch (e) {}
  }
  function addTemplate(t) {
    loadTemplates();
    templates.push({
      id: uid("tpl"),
      category: t.category,
      name: t.name,
      ...(t.category === "api" ? { method: t.method || "GET", path: t.path || "/api/example" } : {}),
      color: t.color || (NODE_TYPE_META[t.category] ? NODE_TYPE_META[t.category].color : "#64748b"),
      desc: t.desc || "",
      ...(Array.isArray(t.data) ? { data: clone(t.data) } : {}), // 数据节点子段
    });
    saveTemplates();
    emit("templates-changed");
    return templates[templates.length - 1];
  }
  function removeTemplate(id) {
    loadTemplates();
    templates = templates.filter((t) => t.id !== id);
    saveTemplates();
    emit("templates-changed");
  }
  function getTemplates(category) {
    loadTemplates();
    return category ? templates.filter((t) => t.category === category) : templates;
  }
  function getTemplate(id) {
    return loadTemplates().find((t) => t.id === id) || null;
  }

  return {
    NODE_SIZE, NODE_TYPE_META, HTTP_METHODS,
    uid, clone, deepMerge,
    init, getDiagram,
    addDiagram, removeDiagram, switchDiagram, renameDiagram,
    createNode, createEdge,
    addNode, updateNode, removeNodes,
    addEdge, updateEdge, removeEdges,
    analyzeBoundaries,
    commit, undo, redo,
    saveLocal,
    replaceAll,
    selection, select, clearSelection,
    addTemplate, removeTemplate, getTemplates, getTemplate,
    on, emit,
    get state() { return state; },
    get canUndo() { return history.length > 1; },
    get canRedo() { return future.length > 0; },
  };
})();
