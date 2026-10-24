/**
 * markdown.js - Markdown 导入/导出引擎
 *
 * 文件格式（人类可读、可直接编辑、可被本软件重新导入）：
 *
 *   # 接口流程图
 *
 *   ## 某业务流程
 *
 *   ### 边界接口
 *   - 入口: POST /api/a（接口名）
 *   - 出口: GET /api/b（接口名）
 *
 *   ### 流程定义
 *   ```flow
 *   n1[API|用户注册|POST /api/auth/register] @(120,80)
 *   n2[PROC|验证参数] @(360,80)
 *   n3{DECISION|邮箱已注册?} @(600,80)
 *   n1 --> n2
 *   n2 --> n3
 *   n3 -->|是| n4[API|返回错误|GET /api/error]
 *   n3 -.->|否| n5[DATA|保存记录]
 *   ```
 *
 *   ### 节点说明
 *   | 名称 | 类型 | 接口 | 说明 |
 *
 * 规则：
 *  - 节点:  id[TYPE|名称|接口路径|说明] @(x,y)   判断节点用 id{...}
 *  - TYPE:  API | PROC | DECISION | DATA
 *  - 边:    a --> b   /  a -->|标签| b   /  a -.->|标签| b（虚线）
 *  - 节点可单独成行，也可内联在边的任意一端
 *  - 流程图边界 = 接口节点（入口=无入边API，出口=无出边API），无传统开始/结束
 */
"use strict";

const Markdown = (() => {

  const TYPE_ALIASES = {
    API: "api", IFACE: "api", INTERFACE: "api",
    PROC: "process", PROCESS: "process", STEP: "process",
    DECISION: "decision", COND: "decision", IF: "decision",
    DATA: "data", DB: "data", STORE: "data",
  };

  const TYPE_TAGS = { api: "API", process: "PROC", decision: "DECISION", data: "DATA" };

  // ---------- 小工具 ----------
  const sanitize = (s) =>
    String(s ?? "").replace(/[\[\]{}\|@\n\r]/g, " ").trim();

  const esc = (s) =>
    String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

  const unesc = (s) =>
    String(s ?? "").trim().replace(/\\\|/g, "|");

  // ---------- 解析单个节点 token ----------
  // 形如: n1[API|名称|路径|说明] 或 n1{DECISION|名称} 或纯 id "n1"
  // 返回 { id, def|null }
  function parseNodeToken(token) {
    token = token.trim();
    const m = token.match(/^([A-Za-z0-9_\-.]+)\s*([\[\{])([\s\S]*)$/);
    if (!m) return { id: token || null, def: null };

    const id = m[1];
    const open = m[2];
    const close = open === "[" ? "]" : "}";
    const closeIdx = m[3].lastIndexOf(close);
    if (closeIdx === -1) return { id, def: null };

    let inner = m[3].slice(0, closeIdx);
    const rest = m[3].slice(closeIdx + 1).trim();

    // 坐标 @(x,y)
    let x = null, y = null;
    const cm = rest.match(/^@\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
    if (cm) { x = Math.round(+cm[1]); y = Math.round(+cm[2]); }

    // 按 | 分段（支持 \| 转义）
    const parts = splitPipe(inner);
    const typeRaw = (parts.shift() || "").trim().toUpperCase();
    const type = TYPE_ALIASES[typeRaw];
    if (!type) return { id, def: null };

    const name = unesc(parts.shift() || "") || "未命名";
    let method = "GET", path = "", desc = "";
    if (type === "api") {
      const apiPart = unesc(parts.shift() || "");
      // 调用方法可自由填写（非空白、不含 /），后跟以 / 开头的路径
      const pm = apiPart.match(/^\s*([^\s/]+)\s+(\/\S*)\s*$/);
      if (pm) { method = pm[1]; path = pm[2]; }
      else if (apiPart.startsWith("/")) { path = apiPart; }
      else if (apiPart) { path = "/" + apiPart.replace(/^\/+/, ""); }
      desc = unesc(parts.shift() || "");
    } else {
      desc = unesc(parts.shift() || "");
    }

    return {
      id, def: { type, name, method, path, desc, x, y },
    };
  }

  function splitPipe(s) {
    const out = [];
    let cur = "", esc2 = false;
    for (const ch of s) {
      if (esc2) { cur += "\\" + ch; esc2 = false; continue; }
      if (ch === "\\") { esc2 = true; continue; }
      if (ch === "|") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  // ---------- 解析一行边 ----------
  // 返回 { from, to, label, style } 或 null
  function parseEdgeLine(line) {
    // 依次尝试 -.->（虚线）、-->、->、--
    const arrows = [
      { a: "-.->", style: "dashed" },
      { a: "-->",  style: "solid" },
      { a: "->",   style: "solid" },
      { a: "--",   style: "solid" },
    ];
    for (const { a, style } of arrows) {
      const idx = line.indexOf(a);
      if (idx === -1) continue;
      const left = line.slice(0, idx).trim();
      if (!left) continue;
      let right = line.slice(idx + a.length).trim();

      // 箭头后可选 |标签|（支持 \| 转义）
      let label = "";
      if (right.startsWith("|")) {
        let i = 1, buf = "";
        while (i < right.length) {
          if (right[i] === "\\" && right[i + 1] === "|") { buf += "|"; i += 2; continue; }
          if (right[i] === "|") break;
          buf += right[i]; i++;
        }
        if (i < right.length) { // 找到闭合 |
          label = buf.trim();
          right = right.slice(i + 1).trim();
        }
      }
      if (!right) continue;
      return {
        fromToken: left,
        toToken: right,
        label,
        style,
      };
    }
    return null;
  }

  // ---------- 解析整个文档 ----------
  /**
   * @returns {Array<{name, nodes, edges}>}  流程图数组
   */
  function parse(mdText) {
    const diagrams = [];
    const lines = String(mdText || "").split(/\r?\n/);

    let cur = null;          // 当前图
    let inFlow = false;      // 是否在 ```flow 块内
    let pendingName = null;  // 最近遇到的 ## 标题（图名）
    let lastEntity = null;   // 最近定义的实体（边或节点），data: 子段行的归属目标
    let edgeSeq = 0;         // 边序号（画布点击选中依赖边 id，解析器必须生成）
    const nodeIndex = new Map();  // id -> node（当前图）

    const ensureCur = () => {
      if (!cur) {
        cur = { name: pendingName || "未命名流程图", nodes: [], edges: [] };
        edgeSeq = 0;
        nodeIndex.clear();
        lastEntity = null;
        diagrams.push(cur);
      }
      return cur;
    };

    // 注册节点（含内联重复定义时的信息合并）
    const registerNode = (t) => {
      const exist = nodeIndex.get(t.id);
      const def = t.def;
      const size = State.NODE_SIZE[def.type] || State.NODE_SIZE.process;
      if (exist) {
        Object.assign(exist, {
          name: def.name || exist.name,
          desc: def.desc || exist.desc,
          ...(def.x != null ? { x: def.x } : {}),
          ...(def.y != null ? { y: def.y } : {}),
          ...(def.type === "api" && def.path ? { method: def.method, path: def.path } : {}),
        });
        return exist;
      }
      const node = {
        id: t.id,
        type: def.type,
        name: def.name,
        x: def.x, y: def.y,      // 可为 null（后续自动布局）
        w: size.w, h: size.h,
        desc: def.desc || "",
        color: State.NODE_TYPE_META[def.type].color,
      };
      if (def.type === "api") { node.method = def.method || "GET"; node.path = def.path || "/api/example"; }
      nodeIndex.set(t.id, node);
      cur.nodes.push(node);
      return node;
    };

    for (let raw of lines) {
      const line = raw.trim();

      // ``` 围栏切换
      if (/^(```|~~~)/.test(line)) {
        const tag = line.replace(/^(```|~~~)\s*/, "").toLowerCase();
        if (!inFlow && (tag === "flow" || tag === "flowchart" || tag === "graph")) { inFlow = true; ensureCur(); continue; }
        if (inFlow) { inFlow = false; continue; }
        continue;
      }

      if (inFlow) {
        if (!line || line.startsWith("%%") || line.startsWith("//")) continue;

        // data: 子段行（归属于最近定义的边或节点）—— 类型 | 限制 | 说明描述
        const dm = line.match(/^data\s*:\s*(.*)$/i);
        if (dm && lastEntity) {
          const parts = splitPipe(dm[1]);
          (lastEntity.data = lastEntity.data || []).push({
            type: unesc(parts[0] || "").trim(),
            limit: unesc(parts[1] || "").trim(),
            desc: unesc(parts[2] || "").trim(),
          });
          continue;
        }

        // 边？
        const edge = parseEdgeLine(line);
        if (edge) {
          const from = parseNodeToken(edge.fromToken);
          const to = parseNodeToken(edge.toToken);
          if (!from.id || !to.id || from.id === to.id) continue;
          ensureCur();
          // 注册内联节点
          if (from.def) registerNode(from);
          if (to.def) registerNode(to);
          // 纯 id 且未注册过 → 造一个默认 PROC 节点（容错）
          if (!nodeIndex.has(from.id)) registerNode({ id: from.id, def: { type: "process", name: from.id } });
          if (!nodeIndex.has(to.id)) registerNode({ id: to.id, def: { type: "process", name: to.id } });
          const edgeObj = {
            id: "e" + (++edgeSeq),
            from: from.id, to: to.id,
            label: edge.label, style: edge.style,
          };
          cur.edges.push(edgeObj);
          lastEntity = edgeObj;
          continue;
        }

        // 节点定义行
        const t = parseNodeToken(line);
        if (t.id && t.def) {
          ensureCur();
          lastEntity = registerNode(t);
          continue;
        }
        continue;
      }

      // flow 块外：一级/二级标题 → 记录图名；已有内容则结束当前图
      const h = line.match(/^#{1,2}\s+(.+)$/);
      if (h) {
        if (cur && (cur.nodes.length || cur.edges.length)) {
          cur = null;
          nodeIndex.clear();
          lastEntity = null;
        }
        pendingName = h[1].trim().replace(/^流程图[:：]\s*/, "");
        continue;
      }
    }

    const result = diagrams.filter((d) => d.nodes.length);
    // 自动布局：存在无坐标节点的图
    for (const d of result) {
      if (d.nodes.some((n) => n.x == null || n.y == null)) autoLayout(d);
    }
    return result;
  }

  // ---------- 自动布局（分层：入口接口在左，出口接口在右） ----------
  function autoLayout(diagram, opts = {}) {
    const { nodes, edges } = diagram;
    const idSet = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));

    // ---- 主线识别：入口(入度0) → 出口(出度0) ----
    // 对每个 入口-出口 组合求最短路径，选其中最长的一条作为主线（最深的贯穿线，
    // 覆盖节点最多、绕回判定范围最大）；无出口时退化为距入口最远的可达节点。
    // 排列前忽略「绕回主线的逆向边」（如游戏 死亡→重启→回主循环 的大回环），
    // 使主线节点不被拉深/卡层；边本身保留在图上，仅不参与排列计算；
    // 不追求去掉所有环——非主线的小环仍沿用 Kahn 卡层容错
    const indeg = new Map(nodes.map((n) => [n.id, 0]));
    const outdeg = new Map(nodes.map((n) => [n.id, 0]));
    const outAdj = new Map(nodes.map((n) => [n.id, []]));
    for (const e of validEdges) {
      indeg.set(e.to, indeg.get(e.to) + 1);
      outdeg.set(e.from, outdeg.get(e.from) + 1);
      outAdj.get(e.from).push(e);
    }

    const entries = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
    const exits = nodes.filter((n) => outdeg.get(n.id) === 0).map((n) => n.id);
    let tail = null;
    let mainPred = new Map();
    if (entries.length) {
      let bestDist = -1;
      for (const src of entries) {
        // 单源 BFS：本入口到各节点的最短距离与前驱
        const s1 = new Map([[src, 0]]), pred1 = new Map();
        const q = [src];
        for (let i = 0; i < q.length; i++) {
          const u = q[i];
          for (const e of outAdj.get(u)) {
            if (!s1.has(e.to)) { s1.set(e.to, s1.get(u) + 1); pred1.set(e.to, u); q.push(e.to); }
          }
        }
        if (exits.length) {
          for (const t of exits) {
            if (s1.has(t) && s1.get(t) > bestDist) { bestDist = s1.get(t); tail = t; mainPred = pred1; }
          }
        } else {
          for (const [v, d] of s1) {
            if (d > bestDist) { bestDist = d; tail = v; mainPred = pred1; }
          }
        }
      }
    }

    // 忽略集：目标在主线上、且源在目标的下游（从目标可达），但源不是该目标的主线前驱
    // —— 即「绕一圈回到主线」的逆向边；主线自身的前后边全部保留
    const ignored = new Set();
    if (tail !== null) {
      const onMain = new Set();
      for (let v = tail; v != null && !onMain.has(v); v = mainPred.get(v)) onMain.add(v);
      const descCache = new Map();
      const desc = (v) => {
        if (descCache.has(v)) return descCache.get(v);
        const seen = new Set(), st = [v];
        while (st.length) {
          const u = st.pop();
          for (const e of outAdj.get(u)) {
            if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); }
          }
        }
        descCache.set(v, seen);
        return seen;
      };
      for (const e of validEdges) {
        if (!onMain.has(e.to)) continue;
        if (mainPred.get(e.to) === e.from) continue;      // 主线前驱边豁免
        if (desc(e.to).has(e.from)) ignored.add(e);   // 绕回主线的逆向边 → 排列时忽略
      }
    }

    // ---- 最长路径分层（Kahn，作用于剔除逆向边后的边集） ----
    const level = new Map(nodes.map((n) => [n.id, 0]));
    const indeg2 = new Map(nodes.map((n) => [n.id, 0]));
    for (const e of validEdges) if (!ignored.has(e)) indeg2.set(e.to, indeg2.get(e.to) + 1);
    const queue = nodes.filter((n) => indeg2.get(n.id) === 0).map((n) => n.id);
    const seen = new Set(queue);
    while (queue.length) {
      const u = queue.shift();
      for (const e of outAdj.get(u)) {
        if (ignored.has(e)) continue;
        level.set(e.to, Math.max(level.get(e.to), level.get(u) + 1));
        indeg2.set(e.to, indeg2.get(e.to) - 1);
        if (indeg2.get(e.to) === 0 && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
    }

    // 按层分组
    const layers = new Map();
    for (const n of nodes) {
      const lv = level.get(n.id) || 0;
      if (!layers.has(lv)) layers.set(lv, []);
      layers.get(lv).push(n);
    }
    const maxCount = Math.max(...[...layers.values()].map((a) => a.length), 1);
    const LAYER_GAP = 280, ROW_GAP = 140, TOP = 60, LEFT = 60;
    // 垂直布局（mermaid TD/TB）：层沿 y 方向展开，层内水平排列
    const V_LAYER_GAP = 230, V_COL_GAP = 300;

    // force: 强制覆盖已有坐标（工具栏「自动布局」）；默认只补空坐标（md 导入渐进补位）
    const place = (n, x, y) => {
      if (opts.force) { n.x = x; n.y = y; }
      else { n.x = n.x ?? x; n.y = n.y ?? y; }
    };

    for (const [lv, arr] of layers) {
      // 层内排序：API 优先（边界靠外），其余按名称稳定
      arr.sort((a, b) => (a.type === "api" ? 0 : 1) - (b.type === "api" ? 0 : 1));
      if (opts.vertical) {
        const y = TOP + lv * V_LAYER_GAP;
        arr.forEach((n, i) =>
          place(n, Math.round(LEFT + i * V_COL_GAP + (maxCount - arr.length) * V_COL_GAP / 2), Math.round(y)));
      } else {
        const x = LEFT + lv * LAYER_GAP;
        arr.forEach((n, i) =>
          place(n, Math.round(x), Math.round(TOP + i * ROW_GAP + (maxCount - arr.length) * ROW_GAP / 2)));
      }
    }
    // 兜底：仍未有坐标（理论不会）
    for (const n of nodes) { if (n.x == null) n.x = 60; if (n.y == null) n.y = 60; }
  }

  // ---------- Mermaid flowchart 导入解析 ----------
  // 支持：flowchart/graph + 方向(TD/TB/BT/LR/RL)、--> / -.-> / ==> 箭头、|标签|、
  //       链式 A --> B --> C、形状映射（{x}→判断、[(x)]→数据、其余→处理）、<br/> 清理、
  //       先引用后定义（引用先占位，后到定义合并名称/类型）
  function parseMermaidShape(s) {
    s = (s || "").trim();
    if (!s) return null;
    const clean = (x) =>
      x.replace(/^["'`]+|["'`]+$/g, "")
       .replace(/<br\s*\/?>/gi, " ")
       .replace(/\s+/g, " ")
       .trim();
    let m;
    if ((m = s.match(/^\(\(\(([\s\S]*)\)\)\)$/))) return { type: "process", name: clean(m[1]) }; // 双圆
    if ((m = s.match(/^\(\(([\s\S]*)\)\)$/))) return { type: "process", name: clean(m[1]) };    // 圆
    if ((m = s.match(/^\(\[([\s\S]*)\]\)$/))) return { type: "process", name: clean(m[1]) };    // 体育场（开始/结束）
    if ((m = s.match(/^\[\(([\s\S]*)\)\]$/))) return { type: "data", name: clean(m[1]) };       // 圆柱（存储）
    if ((m = s.match(/^\{\{([\s\S]*)\}\}$/))) return { type: "process", name: clean(m[1]) };    // 六边形
    if ((m = s.match(/^\{([\s\S]*)\}$/))) return { type: "decision", name: clean(m[1]) };       // 菱形（判断）
    if ((m = s.match(/^\[([\s\S]*)\]$/))) return { type: "process", name: clean(m[1]) };        // 矩形 / 子程序
    if ((m = s.match(/^\(([\s\S]*)\)$/))) return { type: "process", name: clean(m[1]) };        // 圆角矩形
    if ((m = s.match(/^\/([\s\S]*)\/$/))) return { type: "process", name: clean(m[1]) };        // 平行四边形
    if ((m = s.match(/^\\([\s\S]*)\\$/))) return { type: "process", name: clean(m[1]) };        // 反平行四边形
    if ((m = s.match(/^>([\s\S]*)$/))) return { type: "process", name: clean(m[1]) };           // 旗形
    return null;
  }

  function parseMermaidNode(token) {
    token = (token || "").trim();
    if (!token) return { id: null, def: null };
    const idM = token.match(/^[A-Za-z0-9_\u4e00-\u9fa5]+/);
    if (!idM) return { id: null, def: null };
    const id = idM[0];
    const rest = token.slice(id.length).trim();
    if (!rest) return { id, def: null }; // 纯引用
    return { id, def: parseMermaidShape(rest) };
  }

  function parseMermaid(text) {
    const lines = String(text || "").split(/\r?\n/);
    let direction = "TD";
    let edgeSeq = 0;
    const nodes = new Map();
    const edges = [];

    const ensureNode = (id) => {
      if (!nodes.has(id)) {
        const size = State.NODE_SIZE.process;
        nodes.set(id, {
          id, type: "process", name: id,
          x: null, y: null, w: size.w, h: size.h,
          desc: "", color: State.NODE_TYPE_META.process.color,
        });
      }
      return nodes.get(id);
    };
    const defineNode = (id, def) => {
      const n = ensureNode(id);
      if (def) {
        if (def.name) n.name = def.name;
        if (def.type && def.type !== "process") {
          n.type = def.type;
          const s = State.NODE_SIZE[def.type];
          n.w = s.w; n.h = s.h;
          n.color = State.NODE_TYPE_META[def.type].color;
        }
      }
      return n;
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("%%")) continue;

      const dm = line.match(/^(?:flowchart|graph)\s+(TD|TB|BT|RL|LR)$/i);
      if (dm) { direction = dm[1].toUpperCase(); continue; }

      // 收集行内所有箭头（含 |标签|）
      const re = /(-\.->|==>|-->)\s*(?:\|([^|]*)\|)?/g;
      const arrows = [];
      let m;
      while ((m = re.exec(line))) {
        arrows.push({ style: m[1] === "-.->" ? "dashed" : "solid", label: (m[2] || "").trim(), start: m.index, end: re.lastIndex });
      }

      if (!arrows.length) {
        // 独立节点定义行：id[形状]
        const t = parseMermaidNode(line);
        if (t.id && t.def) defineNode(t.id, t.def);
        continue;
      }

      // 按箭头切段（支持链式）
      let cursor = 0;
      const parts = [];
      for (const a of arrows) {
        parts.push({ text: line.slice(cursor, a.start), arrow: a });
        cursor = a.end;
      }
      parts.push({ text: line.slice(cursor), arrow: null });

      for (let i = 0; i + 1 < parts.length; i++) {
        const fromTok = parseMermaidNode(parts[i].text);
        const toTok = parseMermaidNode(parts[i + 1].text);
        if (!fromTok.id || !toTok.id || fromTok.id === toTok.id) continue;
        if (fromTok.def) defineNode(fromTok.id, fromTok.def);
        if (toTok.def) defineNode(toTok.id, toTok.def);
        ensureNode(fromTok.id); ensureNode(toTok.id);
        edges.push({ id: "e" + (++edgeSeq), from: fromTok.id, to: toTok.id, label: parts[i].arrow.label, style: parts[i].arrow.style });
      }
    }

    if (!nodes.size) return [];

    const diagram = { id: null, name: null, nodes: [...nodes.values()], edges };
    // TD/TB（上→下）用垂直分层布局；LR/RL 用水平
    autoLayout(diagram, { vertical: !["LR", "RL"].includes(direction) });
    return [diagram];
  }

  // ---------- 序列化 ----------
  function serializeDiagram(diagram) {
    const idMap = new Map();
    diagram.nodes.forEach((n, i) => idMap.set(n.id, "n" + (i + 1)));

    const lines = [];

    // 标题
    lines.push(`## ${esc(diagram.name)}`, "");

    // 边界接口
    const { entries, exits } = State.analyzeBoundaries(diagram);
    if (entries.length || exits.length) {
      lines.push("### 边界接口", "");
      for (const n of entries) lines.push(`- 入口: ${n.method} ${n.path}（${esc(n.name)}）`);
      for (const n of exits) lines.push(`- 出口: ${n.method} ${n.path}（${esc(n.name)}）`);
      lines.push("");
    }

    // flow 块
    lines.push("### 流程定义", "");
    lines.push("```flow");
    const edgeLines = new Set();
    for (const n of diagram.nodes) {
      const open = n.type === "decision" ? "{" : "[";
      const close = n.type === "decision" ? "}" : "]";
      const tag = TYPE_TAGS[n.type] || "PROC";
      let inner = `${tag}|${esc(n.name)}`;
      if (n.type === "api") inner += `|${n.method} ${n.path}`;
      if (n.desc) inner += `|${esc(n.desc)}`;
      // 不输出坐标：导出的 .md 保持干净（可手编、可 diff），导入时自动布局
      lines.push(`${idMap.get(n.id)}${open}${inner}${close}`);
      // 数据节点的子段：类型 | 限制 | 说明描述
      for (const f of n.data || []) {
        lines.push(`  data: ${esc(f.type)} | ${esc(f.limit)} | ${esc(f.desc)}`);
      }
    }
    for (const e of diagram.edges) {
      const arrow = e.style === "dashed" ? "-.->" : "-->";
      const label = e.label ? `|${esc(e.label)}| ` : "";
      const key = `${e.from}>${e.to}`;
      if (edgeLines.has(key)) continue; // 去重
      edgeLines.add(key);
      lines.push(`${idMap.get(e.from)} ${arrow}${label}${idMap.get(e.to)}`);
      // 连线数据子段：类型 | 限制 | 说明描述
      for (const f of e.data || []) {
        lines.push(`  data: ${esc(f.type)} | ${esc(f.limit)} | ${esc(f.desc)}`);
      }
    }
    lines.push("```", "");

    // 节点说明表
    if (diagram.nodes.length) {
      lines.push("### 节点说明", "");
      lines.push("| 名称 | 类型 | 接口 | 说明 |");
      lines.push("| --- | --- | --- | --- |");
      for (const n of diagram.nodes) {
        const typeLabel = State.NODE_TYPE_META[n.type].label;
        const api = n.type === "api" ? `${n.method} ${n.path}` : "—";
        lines.push(`| ${esc(n.name)} | ${typeLabel} | ${api} | ${esc(n.desc) || "—"} |`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  function serializeAll(diagrams) {
    const parts = [];
    parts.push("# 接口流程图", "");
    parts.push("> 由接口流程图编辑器导出 · 流程边界为接口节点（入口/出口），无传统开始/结束节点。", "");
    for (const d of diagrams) parts.push(serializeDiagram(d));
    return parts.join("\n");
  }

  // ---------- 文件下载 ----------
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  return {
    parse,
    parseMermaid,
    serializeAll,
    serializeDiagram,
    autoLayout,
    downloadText,
    _internal: { parseNodeToken, parseEdgeLine, splitPipe, parseMermaidNode, parseMermaidShape }, // 测试用
  };
})();
