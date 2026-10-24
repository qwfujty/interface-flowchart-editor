/**
 * panels.js - 左侧面板（流程图列表/节点面板/边界接口） + 右侧属性面板
 */
"use strict";

const Panels = (() => {

  // ============ 流程图列表 ============
  function renderDiagramList() {
    const ul = document.getElementById("diagram-list");
    ul.innerHTML = "";
    const { diagrams, activeId } = State.state;
    for (const d of diagrams) {
      const li = document.createElement("li");
      if (d.id === activeId) li.classList.add("active");
      li.dataset.id = d.id;

      const name = document.createElement("span");
      name.className = "dg-name";
      name.textContent = d.name;
      name.title = "双击重命名";
      li.appendChild(name);

      const count = document.createElement("span");
      count.className = "dg-count";
      count.textContent = d.nodes.length;
      li.appendChild(count);

      const del = document.createElement("button");
      del.className = "dg-del";
      del.title = "删除此流程图";
      del.textContent = "✕";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (State.state.diagrams.length <= 1) {
          Toast.show("至少保留一个流程图", "info");
          return;
        }
        if (confirm(`确定删除流程图「${d.name}」？`)) {
          State.removeDiagram(d.id);
          Toast.show("已删除", "success");
        }
      });
      li.appendChild(del);

      li.addEventListener("click", () => State.switchDiagram(d.id));
      li.addEventListener("dblclick", (e) => {
        if (e.target === del) return;
        const input = document.createElement("input");
        input.className = "inline-edit";
        input.value = d.name;
        input.style.cssText = "position:fixed;z-index:99;width:150px";
        const r = name.getBoundingClientRect();
        input.style.left = r.left + "px";
        input.style.top = r.top + "px";
        document.body.appendChild(input);
        input.focus();
        input.select();
        const done = () => {
          const v = input.value.trim();
          input.remove();
          if (v && v !== d.name) State.renameDiagram(d.id, v);
        };
        input.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Enter") input.blur();
          if (ev.key === "Escape") { input.value = d.name; input.blur(); }
        });
        input.addEventListener("blur", done);
      });

      ul.appendChild(li);
    }
  }

  // ============ 边界接口面板 ============
  function refreshBoundary() {
    const box = document.getElementById("boundary-list");
    if (!box) return;
    const d = State.getDiagram();
    if (!d || !d.nodes.length) {
      box.innerHTML = '<span class="boundary-empty">暂无节点，从上方拖入「接口」节点开始</span>';
      return;
    }
    const { entries, exits } = State.analyzeBoundaries(d);
    const parts = [];
    if (!entries.length && !exits.length) {
      box.innerHTML = '<span class="boundary-empty">当前图尚无接口节点（边界 = 接口）</span>';
      return;
    }
    for (const n of entries) {
      parts.push(item(n, "in", entries.includes(n) && exits.includes(n) ? "both" : "in"));
    }
    const entryIds = new Set(entries.map((n) => n.id));
    for (const n of exits) {
      if (entryIds.has(n.id)) continue; // both 已显示
      parts.push(item(n, "out", "out"));
    }
    function item(n, _, dir) {
      const div = document.createElement("div");
      div.className = "boundary-item";
      const tag = document.createElement("span");
      tag.className = "b-dir " + dir;
      tag.textContent = dir === "both" ? "孤" : dir === "in" ? "入口" : "出口";
      const path = document.createElement("span");
      path.className = "b-path";
      path.textContent = `${n.method} ${n.path}`;
      path.title = `${n.name}\n${n.method} ${n.path}`;
      div.appendChild(tag);
      div.appendChild(path);
      div.addEventListener("click", () => {
        State.select([n.id], []);
        Canvas.centerOn(n);
      });
      return div;
    }
    box.innerHTML = "";
    parts.forEach((p) => box.appendChild(p));
  }

  // ============ 节点面板：大类 + 小类（模板） ============
  const PALETTE_META = {
    api:     { tag: "API", small: "流程边界 · METHOD /path" },
    process: { tag: "□",   small: "业务逻辑步骤" },
    decision:{ tag: "◆",   small: "条件分支" },
    data:    { tag: "▤",   small: "存储 / 读写" },
  };

  function canvasCenterOffset() {
    const svg = document.getElementById("canvas");
    const r = svg.getBoundingClientRect();
    return {
      wx: (r.width / 2 - Canvas.view.x) / Canvas.view.k - 80,
      wy: (r.height / 2 - Canvas.view.y) / Canvas.view.k - 26,
    };
  }

  // 用模板（小类）创建节点
  function createFromTemplate(tpl, wx, wy) {
    const n = State.createNode(tpl.category, wx, wy, {
      name: tpl.name,
      desc: tpl.desc,
      color: tpl.color,
      ...(tpl.category === "api" ? { method: tpl.method, path: tpl.path } : {}),
      ...(Array.isArray(tpl.data) ? { data: tpl.data } : {}), // 数据节点子段
    });
    State.addNode(n);
    State.select([n.id], []);
    Toast.show(`已按小类「${tpl.name}」添加节点`, "success");
  }

  function renderPalette() {
    const box = document.getElementById("node-palette");
    box.innerHTML = "";

    for (const type of Object.keys(PALETTE_META)) {
      const meta = PALETTE_META[type];
      const group = document.createElement("div");
      group.className = "palette-group";

      // ---- 大类头（拖入 = 默认节点） ----
      const head = document.createElement("div");
      head.className = "palette-item";
      head.dataset.type = type;
      head.draggable = true;
      head.innerHTML = `
        <span class="palette-shape shape-${type}">${meta.tag}</span>
        <div class="palette-info"><b>${State.NODE_TYPE_META[type].label}</b><small>${meta.small}</small></div>`;
      head.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/node-type", type);
        e.dataTransfer.effectAllowed = "copy";
      });
      head.addEventListener("dblclick", () => {
        const { wx, wy } = canvasCenterOffset();
        const n = State.createNode(type, wx, wy);
        State.addNode(n);
        State.select([n.id], []);
        Toast.show(`已添加「${State.NODE_TYPE_META[type].label}」节点`, "success");
      });
      group.appendChild(head);

      // ---- 该大类下的小类列表 ----
      const tpls = State.getTemplates(type);
      const list = document.createElement("div");
      list.className = "template-list";
      for (const tpl of tpls) {
        const row = document.createElement("div");
        row.className = "template-item";
        row.draggable = true;
        row.title = `${tpl.name}（拖入或双击添加）`;
        const sub = tpl.category === "api" ? `${tpl.method} ${tpl.path}` : (tpl.desc || "—");
        row.innerHTML = `
          <span class="tpl-dot" style="background:${tpl.color}"></span>
          <span class="tpl-name"></span>
          <span class="tpl-sub"></span>
          <button class="tpl-del" title="删除此小类">✕</button>`;
        row.querySelector(".tpl-name").textContent = tpl.name;
        row.querySelector(".tpl-sub").textContent = sub;

        row.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/node-template", tpl.id);
          e.dataTransfer.setData("text/node-type", tpl.category); // 兜底
          e.dataTransfer.effectAllowed = "copy";
        });
        row.addEventListener("dblclick", () => {
          const { wx, wy } = canvasCenterOffset();
          createFromTemplate(tpl, wx, wy);
        });
        row.querySelector(".tpl-del").addEventListener("click", (e) => {
          e.stopPropagation();
          State.removeTemplate(tpl.id);
          Toast.show(`已删除小类「${tpl.name}」`, "info");
        });
        list.appendChild(row);
      }
      group.appendChild(list);
      box.appendChild(group);
    }
  }

  // 「存为小类」：把当前选中节点配置保存为其大类下的小类
  function saveSelectedAsTemplate() {
    const d = State.getDiagram();
    if (!d) return;
    const id = [...State.selection.nodes][0];
    const n = d.nodes.find((x) => x.id === id);
    if (!n) return;
    const name = prompt(`存为「${State.NODE_TYPE_META[n.type].label}」大类下的小类，名称：`, n.name);
    if (name === null) return;
    const trim = name.trim();
    if (!trim) { Toast.show("小类名称不能为空", "error"); return; }
    State.addTemplate({
      category: n.type,
      name: trim,
      ...(n.type === "api" ? { method: n.method, path: n.path } : {}),
      color: n.color,
      desc: n.desc || "",
      ...(Array.isArray(n.data) ? { data: n.data } : {}), // 数据节点子段随小类保存
    });
    Toast.show(`已存为小类「${trim}」`, "success");
  }

  // ============ 右侧属性面板 ============
  const $id = (id) => document.getElementById(id);

  function refreshInspector() {
    const d = State.getDiagram();
    const { nodes, edges } = State.selection;
    const emptyBox = $id("inspector-empty");
    const nodeBox = $id("inspector-node");
    const edgeBox = $id("inspector-edge");

    emptyBox.hidden = false;
    nodeBox.hidden = true;
    edgeBox.hidden = true;

    if (nodes.size === 1 && d) {
      const n = d.nodes.find((x) => x.id === [...nodes][0]);
      if (n) {
        emptyBox.hidden = true;
        nodeBox.hidden = false;
        fillNodeForm(n);
      }
    } else if (edges.size === 1 && d) {
      const e = d.edges.find((x) => x.id === [...edges][0]);
      if (e) {
        emptyBox.hidden = true;
        edgeBox.hidden = false;
        fillEdgeForm(e);
      }
    } else if (nodes.size > 1) {
      $id("inspector-empty").querySelector("p").innerHTML = `已选中 ${nodes.size} 个节点<br>（拖动可整体移动）`;
    }
  }

  function fillNodeForm(n) {
    currentTarget = { kind: "node", id: n.id };
    const badge = $id("node-type-badge");
    badge.textContent = State.NODE_TYPE_META[n.type].label;
    badge.style.background = n.color;

    $id("field-node-api").style.display = n.type === "api" ? "" : "none";
    $id("field-node-path").style.display = n.type === "api" ? "" : "none";
    $id("field-node-data").style.display = n.type === "data" ? "" : "none";

    const nameEl = $id("prop-node-name");
    const methodEl = $id("prop-node-method");
    const pathEl = $id("prop-node-path");
    const descEl = $id("prop-node-desc");
    const colorEl = $id("prop-node-color");

    nameEl.value = n.name;
    if (n.type === "api") {
      methodEl.value = n.method;
      pathEl.value = n.path;
    }
    descEl.value = n.desc || "";
    colorEl.value = n.color;

    // 边界标记说明
    const tagBox = $id("node-boundary-tag");
    const d = State.getDiagram();
    const { entries, exits } = State.analyzeBoundaries(d);
    const isEntry = entries.some((x) => x.id === n.id);
    const isExit = exits.some((x) => x.id === n.id);
    if (n.type === "api" && (isEntry || isExit)) {
      tagBox.hidden = false;
      const tagEl = tagBox.querySelector("span");
      if (isEntry && isExit) { tagEl.textContent = "孤立接口（未连接）"; tagEl.className = "bt-both"; }
      else if (isEntry) { tagEl.textContent = "入口接口（流程边界）"; tagEl.className = "bt-entry"; }
      else { tagEl.textContent = "出口接口（流程边界）"; tagEl.className = "bt-exit"; }
    } else {
      tagBox.hidden = true;
    }

    // ---- 绑定实时编辑（避免重复绑定：先克隆替换） ----
    rebind("prop-node-name", n.id, (val, id) => liveUpdate(id, { name: val || "未命名" }));
    rebind("prop-node-method", n.id, (val, id) => liveUpdate(id, { method: val }));
    rebind("prop-node-path", n.id, (val, id) => liveUpdate(id, { path: val.trim() || "/" }));
    rebind("prop-node-desc", n.id, (val, id) => liveUpdate(id, { desc: val }));
    rebind("prop-node-color", n.id, (val, id) => liveUpdate(id, { color: val }));

    // 数据节点的子段区块
    if (n.type === "data") renderDataBlock(n, "node");
  }

  function liveUpdate(id, patch) {
    State.updateNode(id, patch);
    State.commit();
    State.emit("diagram-changed");
  }

  // 实时编辑绑定：input 事件走 _handler（每次选中刷新引用），change 统一 commit
  function rebind(inputId, key, handler) {
    const elx = $id(inputId);
    if (!elx._wired) {
      elx._wired = true;
      elx.addEventListener("input", () => elx._handler && elx._handler());
      elx.addEventListener("change", () => State.commit());
    }
    elx._handler = () => handler(elx.value, key);
  }

  let currentTarget = null; // 当前属性面板展示的实体：{ kind: 'node'|'edge', id }

  function fillEdgeForm(e) {
    currentTarget = { kind: "edge", id: e.id };
    const labelEl = $id("prop-edge-label");
    const styleEl = $id("prop-edge-style");
    labelEl.value = e.label || "";
    styleEl.value = e.style || "solid";
    rebind("prop-edge-label", e.id, (val, id) => {
      State.updateEdge(id, { label: val });
      State.emit("diagram-changed");
    });
    rebind("prop-edge-style", e.id, (val, id) => {
      State.updateEdge(id, { style: val });
      State.emit("diagram-changed");
    });
    renderDataBlock(e, "edge");
  }

  // 按 kind+id 取最新实体对象
  function entityById(kind, id) {
    const d = State.getDiagram();
    if (!d) return null;
    return (kind === "edge" ? d.edges : d.nodes).find((x) => x.id === id) || null;
  }

  // ---- 数据子段区块（连线与数据节点共用）：类型 / 限制 / 说明描述 ----
  function renderDataBlock(entity, kind) {
    const list = $id(kind === "edge" ? "edge-data-list" : "node-data-list");
    const countEl = $id(kind === "edge" ? "edge-data-count" : "node-data-count");
    list.innerHTML = "";
    const data = entity.data || [];
    countEl.textContent = data.length;

    if (!data.length) {
      list.innerHTML = '<div class="data-empty">暂无子段，点击下方按钮添加</div>';
      return;
    }

    const notify = () => {
      if (kind === "edge") State.updateEdge(entity.id, {});
      else State.updateNode(entity.id, {});
      State.commit();
    };

    data.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "data-row";
      row.innerHTML = `
        <div class="data-line1">
          <input class="d-type" placeholder="类型">
          <input class="d-limit" placeholder="限制">
          <button class="d-del" title="删除此子段">✕</button>
        </div>
        <input class="d-desc" placeholder="说明描述">`;
      const typeEl = row.querySelector(".d-type");
      const limitEl = row.querySelector(".d-limit");
      const descEl = row.querySelector(".d-desc");
      typeEl.value = f.type || "";
      limitEl.value = f.limit || "";
      descEl.value = f.desc || "";

      // 输入实时写入（不重建 DOM，避免丢焦点）
      const upd = () => {
        const cur = entityById(kind, entity.id);
        if (!cur || !cur.data || !cur.data[i]) return;
        cur.data[i].type = typeEl.value;
        cur.data[i].limit = limitEl.value;
        cur.data[i].desc = descEl.value;
        notify();
      };
      [typeEl, limitEl, descEl].forEach((inp) => {
        inp.addEventListener("input", upd);
        inp.addEventListener("change", () => State.emit("diagram-changed"));
      });

      // 删除子段
      row.querySelector(".d-del").addEventListener("click", () => {
        const cur = entityById(kind, entity.id);
        if (!cur) return;
        cur.data.splice(i, 1);
        notify();
        renderDataBlock(cur, kind);
      });
      list.appendChild(row);
    });
  }

  // 「＋ 添加子段」：边和节点各一个按钮，按当前面板目标操作
  function addDataField(kind) {
    const cur = entityById(kind, currentTarget?.id);
    if (!cur || currentTarget.kind !== kind) return;
    cur.data = [...(cur.data || []), { type: "", limit: "", desc: "" }];
    if (kind === "edge") State.updateEdge(cur.id, {});
    else State.updateNode(cur.id, {});
    State.commit();
    renderDataBlock(cur, kind);
    const listId = kind === "edge" ? "edge-data-list" : "node-data-list";
    const first = $id(listId).querySelector(".data-row:last-child .d-type");
    if (first) first.focus();
  }

  function setupDataButtons() {
    $id("btn-add-data").addEventListener("click", () => addDataField("edge"));
    $id("btn-add-node-data").addEventListener("click", () => addDataField("node"));
  }

  // ============ 按钮动作 ============
  function setupInspectorButtons() {
    $id("btn-delete-node").addEventListener("click", () => {
      const ids = [...State.selection.nodes];
      if (ids.length) State.removeNodes(ids);
    });
    $id("btn-duplicate-node").addEventListener("click", () => {
      const d = State.getDiagram();
      const id = [...State.selection.nodes][0];
      const n = d.nodes.find((x) => x.id === id);
      if (!n) return;
      const copy = State.createNode(n.type, n.x + 30, n.y + 30, {
        name: n.name, desc: n.desc,
        ...(n.type === "api" ? { method: n.method, path: n.path } : {}),
        ...(Array.isArray(n.data) ? { data: n.data } : {}), // 数据节点子段
      });
      State.addNode(copy);
      State.select([copy.id], []);
      Toast.show("已复制节点", "success");
    });
    $id("btn-reset-color").addEventListener("click", () => {
      const id = [...State.selection.nodes][0];
      if (id) liveUpdate(id, { color: State.NODE_TYPE_META[nodeType(id)].color });
    });
    $id("btn-delete-edge").addEventListener("click", () => {
      const ids = [...State.selection.edges];
      if (ids.length) State.removeEdges(ids);
    });
  }

  function nodeType(id) {
    const d = State.getDiagram();
    return d.nodes.find((n) => n.id === id)?.type || "process";
  }

  // ============ 初始化 ============
  function init() {
    setupInspectorButtons();
    setupDataButtons();
    $id("btn-save-template").addEventListener("click", saveSelectedAsTemplate);
    State.on("templates-changed", renderPalette);

    document.getElementById("btn-new-diagram").addEventListener("click", () => {
      const name = prompt("流程图名称：", "新流程图");
      if (name === null) return;
      State.addDiagram(name.trim() || "新流程图");
      Toast.show("已创建，拖入接口节点开始", "success");
    });

    State.on("diagrams-changed", renderDiagramList);
    State.on("diagram-switched", () => {
      renderDiagramList();
      refreshInspector();
      refreshBoundary();
    });
    State.on("selection-changed", refreshInspector);
    State.on("diagram-changed", () => {
      renderDiagramList();
      refreshBoundary();
    });
  }

  return { init, renderDiagramList, renderPalette, refreshBoundary, refreshInspector };
})();
