/**
 * app.js - 应用入口：工具栏、快捷键、导入/导出、Toast、自动保存、启动
 */
"use strict";

// ============ Toast ============
const Toast = (() => {
  const container = document.getElementById("toast-container");
  function show(msg, type = "info", ms = 2400) {
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add("hide");
      setTimeout(() => t.remove(), 300);
    }, ms);
  }
  return { show };
})();

// ============ 自动保存（防抖，localStorage） ============
const AutoSave = (() => {
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => State.saveLocal(), 400);
  }
  function init() {
    State.on("diagram-changed", schedule);
    State.on("diagrams-changed", schedule);
    State.on("diagram-switched", schedule);
  }
  return { init };
})();

// ============ 导入 / 导出 ============
const IO = (() => {

  function exportAll() {
    const md = Markdown.serializeAll(State.state.diagrams);
    const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
    Markdown.downloadText(`接口流程图-${ts}.md`, md);
    Toast.show("已导出全部流程图（.md）", "success");
  }

  function exportCurrent() {
    const d = State.getDiagram();
    if (!d) return;
    const md = "# 接口流程图\n\n" + Markdown.serializeDiagram(d) + "\n";
    Markdown.downloadText(`${d.name}.md`, md);
    Toast.show(`已导出「${d.name}」`, "success");
  }

  function importFiles(files) {
    // 先固化为普通数组：change 处理器会同步清空 input.value，
    // 原 FileList 在异步的 reader.onload 前已失效（length 变 0），导致完成判定失配
    const list = Array.from(files || []);
    if (!list.length) return;
    let totalDiagrams = 0, totalFiles = 0;
    let done = 0;
    const failures = [];

    list.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          const diagrams = Markdown.parse(text);
          if (diagrams.length) {
            diagrams.forEach((d) => {
              // 重新生成 id 并重写边引用，避免与现有数据冲突
              d.id = State.uid("d");
              const idMap = new Map();
              d.nodes.forEach((n) => {
                const newId = State.uid("n");
                idMap.set(n.id, newId);
                n.id = newId;
              });
              d.edges.forEach((e) => {
                e.from = idMap.get(e.from) || e.from;
                e.to = idMap.get(e.to) || e.to;
              });
              State.state.diagrams.push(d);
              totalDiagrams++;
            });
            totalFiles++;
          } else {
            failures.push(`${file.name}：未识别到流程定义（需要 \`\`\`flow 代码块）`);
          }
        } catch (err) {
          failures.push(`${file.name}：解析失败（${err.message}）`);
        }
        if (++done === list.length) finish();
      };
      reader.onerror = () => {
        failures.push(`${file.name}：读取失败`);
        if (++done === list.length) finish();
      };
      reader.readAsText(file, "utf-8");
    });

    function finish() {
      if (totalDiagrams) {
        State.commit();
        State.emit("diagrams-changed");
        State.switchDiagram(State.state.diagrams[State.state.diagrams.length - totalDiagrams].id);
        Canvas.render();
        Canvas.fitView();
        Toast.show(`导入成功：${totalFiles} 个文件，共 ${totalDiagrams} 个流程图`, "success", 3200);
      }
      failures.forEach((f) => Toast.show(f, "error", 4000));
    }
  }

  function setup() {
    document.getElementById("btn-export").addEventListener("click", exportAll);
    document.getElementById("btn-import").addEventListener("click", () => {
      document.getElementById("file-input").click();
    });
    document.getElementById("file-input").addEventListener("change", (e) => {
      importFiles(e.target.files);
      e.target.value = "";
    });
    // 拖拽 .md 文件到窗口导入
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      const mdFiles = Array.from(e.dataTransfer.files).filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
      if (mdFiles.length) importFiles(mdFiles);
    });
    setupFlowchartModal();
  }

  // ============ Mermaid flowchart 粘贴导入 ============
  const flowchartModal = () => document.getElementById("flowchart-modal");

  function setupFlowchartModal() {
    const modal = flowchartModal();
    const open = () => {
      modal.hidden = false;
      const ta = document.getElementById("flowchart-text");
      ta.value = "";
      setTimeout(() => ta.focus(), 50);
    };
    const close = () => { modal.hidden = true; };

    document.getElementById("btn-import-flowchart").addEventListener("click", open);
    document.getElementById("flowchart-cancel").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.getElementById("flowchart-confirm").addEventListener("click", importFlowchartText);
    // Esc 关闭 / Ctrl+Enter 快捷导入
    modal.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) importFlowchartText();
    });
  }

  function importFlowchartText() {
    const text = document.getElementById("flowchart-text").value;
    const name = document.getElementById("flowchart-name").value.trim() || "导入的流程图";
    const diagrams = Markdown.parseMermaid(text);
    if (!diagrams.length || !diagrams[0].edges.length) {
      Toast.show("未识别到流程内容：需要 flowchart/graph 声明和 --> 连线", "error", 4000);
      return;
    }
    const d = diagrams[0];
    d.id = State.uid("d");
    d.name = name;
    State.state.diagrams.push(d);
    State.commit();
    State.emit("diagrams-changed");
    State.switchDiagram(d.id);
    Canvas.render();
    Canvas.fitView();
    flowchartModal().hidden = true;
    Toast.show(`导入成功：${d.nodes.length} 节点、${d.edges.length} 连线`, "success", 3200);
  }

  return { setup, exportAll, exportCurrent, importFiles };
})();

// ============ 键盘快捷键 ============
function setupShortcuts() {
  window.addEventListener("keydown", (e) => {
    // 输入框内不响应
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;

    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); State.undo(); }
    else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); State.redo(); }
    else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const d = State.getDiagram();
      if (d) State.select(d.nodes.map((n) => n.id), d.edges.map((x) => x.id));
    }
    else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      IO.exportAll();
    }
    else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      document.getElementById("btn-duplicate-node").click();
    }
    else if (e.key === "Delete" || e.key === "Backspace") {
      const { nodes, edges } = State.selection;
      if (nodes.size || edges.size) {
        e.preventDefault();
        if (nodes.size) State.removeNodes([...nodes]);
        if (edges.size) State.removeEdges([...edges]);
      }
    }
    else if (e.key === "Escape") {
      State.clearSelection();
    }
    else if (e.key === "f" || e.key === "F") {
      if (!mod) Canvas.fitView();
    }
  });
}

// ============ 工具栏 ============
function setupToolbar() {
  document.getElementById("btn-undo").addEventListener("click", () => State.undo());
  document.getElementById("btn-redo").addEventListener("click", () => State.redo());
  document.getElementById("btn-zoom-in").addEventListener("click", () => Canvas.setZoom(Canvas.getZoom() * 1.2));
  document.getElementById("btn-zoom-out").addEventListener("click", () => Canvas.setZoom(Canvas.getZoom() / 1.2));
  document.getElementById("btn-zoom-reset").addEventListener("click", () => Canvas.setZoom(1));
  document.getElementById("btn-fit").addEventListener("click", () => Canvas.fitView());
  document.getElementById("btn-auto-layout").addEventListener("click", () => {
    const d = State.getDiagram();
    if (!d || !d.nodes.length) return;
    Markdown.autoLayout(d, { force: true });
    State.commit();
    State.emit("diagram-changed");
    Canvas.fitView();
    Toast.show("已按接口边界自动分层排列", "success");
  });
}

// ============ 示例流程图（首次启动） ============
function buildDemoDiagram() {
  const d = {
    id: State.uid("d"),
    name: "用户注册流程（示例）",
    nodes: [],
    edges: [],
  };
  const mk = (type, name, x, y, extra = {}) => {
    const n = State.createNode(type, x, y, { name, ...extra });
    d.nodes.push(n);
    return n;
  };
  const api1 = mk("api", "注册接口", 60, 200, { method: "POST", path: "/api/auth/register" });
  const p1  = mk("process", "参数校验", 330, 200);
  const dec = mk("decision", "邮箱已注册？", 570, 190);
  const p2  = mk("process", "密码加密", 820, 100);
  const data= mk("data", "写入用户表", 820, 300);
  const p3  = mk("process", "生成 Token", 1080, 100);
  const api2 = mk("api", "返回用户信息", 1310, 100, { method: "GET", path: "/api/user/profile" });
  const api3 = mk("api", "登录已有账号", 1080, 320, { method: "POST", path: "/api/auth/login" });

  const link = (a, b, label = "", style = "solid", fp = "right", tp = "left") => {
    d.edges.push(State.createEdge(a.id, b.id, { label, style, fromPort: fp, toPort: tp }));
  };
  link(api1, p1);
  link(p1, dec);
  link(dec, p2, "否");
  link(dec, api3, "是", "solid", "bottom", "left");
  link(p2, p3);
  link(p2, data, "", "dashed", "bottom", "top");
  link(p3, api2);
  return d;
}

// ============ 启动 ============
(function boot() {
  const saved = (() => {
    try { return localStorage.getItem("api-flow-editor-v1"); } catch (e) { return null; }
  })();
  State.init(saved ? null : buildDemoDiagram());

  setupToolbar();
  IO.setup();
  setupShortcuts();
  AutoSave.init();
  Canvas.init();
  Panels.init();

  Panels.renderDiagramList();
  Panels.renderPalette();
  Canvas.render();
  Panels.refreshBoundary();
  Panels.refreshInspector();

  // 首次使用提示
  if (!saved) {
    setTimeout(() => Toast.show("欢迎使用！从左侧拖入节点，悬停节点边缘可拉出连线；所有修改自动保存", "info", 5200), 600);
  }
})();
