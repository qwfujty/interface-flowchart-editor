/**
 * test-markdown.js - Markdown 解析器往返测试（Node 环境）
 * 运行：node test/test-markdown.js
 * 说明：markdown.js 依赖 State（仅用 NODE_SIZE / NODE_TYPE_META / analyzeBoundaries），
 *       此处用最小 stub 替代 DOM 环境。
 */
"use strict";
const fs = require("fs");
const path = require("path");

// ---- State stub（与 state.js 中常量一致） ----
global.State = {
  NODE_SIZE: {
    api: { w: 190, h: 62 },
    process: { w: 160, h: 52 },
    decision: { w: 170, h: 84 },
    data: { w: 160, h: 58 },
  },
  NODE_TYPE_META: {
    api: { label: "接口", color: "#4f6ef7" },
    process: { label: "处理", color: "#64748b" },
    decision: { label: "判断", color: "#d97706" },
    data: { label: "数据", color: "#059669" },
  },
  analyzeBoundaries(diagram) {
    const hasIn = new Set(diagram.edges.map((e) => e.to));
    const hasOut = new Set(diagram.edges.map((e) => e.from));
    const entries = [], exits = [];
    for (const n of diagram.nodes) {
      if (n.type !== "api") continue;
      if (!hasIn.has(n.id)) entries.push(n);
      if (!hasOut.has(n.id)) exits.push(n);
    }
    return { entries, exits };
  },
};

// 加载 markdown.js（IIFE 赋值给 const Markdown，此处改写为全局挂载后 eval）
const src = fs.readFileSync(path.join(__dirname, "..", "js", "markdown.js"), "utf-8");
eval(src.replace(/^const Markdown =/m, "globalThis.Markdown ="));

const MD = globalThis.Markdown;
if (!MD) { console.error("FAIL: Markdown 模块未加载"); process.exit(1); }

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

// ================= 用例 1：完整格式解析 =================
console.log("\n[1] 完整格式解析");
const md1 = `# 接口流程图

## 用户注册流程

### 边界接口

- 入口: POST /api/auth/register（注册接口）
- 出口: GET /api/user/profile（返回用户信息）

### 流程定义

\`\`\`flow
n1[API|注册接口|POST /api/auth/register] @(60,200)
n2[PROC|参数校验] @(330,200)
n3{DECISION|邮箱已注册？} @(570,190)
n4[API|登录已有账号|POST /api/auth/login] @(1080,320]
n1 --> n2
n2 --> n3
n3 -->|是| n4
n3 -->|否| n5[PROC|密码加密]
n5 -.-> n6[DATA|写入用户表]
\`\`\`

### 节点说明

| 名称 | 类型 | 接口 | 说明 |
| --- | --- | --- | --- |
| 注册接口 | 接口 | POST /api/auth/register | 流程入口 |
`;
const r1 = MD.parse(md1);
t("解析出 1 个流程图", r1.length === 1, `实际 ${r1.length}`);
t("图名正确", r1[0]?.name === "用户注册流程", r1[0]?.name);
t("节点数 = 6", r1[0]?.nodes.length === 6, `实际 ${r1[0]?.nodes.length}`);
t("边数 = 5", r1[0]?.edges.length === 5, `实际 ${r1[0]?.edges.length}`);
const n1 = r1[0]?.nodes.find((n) => n.name === "注册接口");
t("API 节点 method/path", n1?.method === "POST" && n1?.path === "/api/auth/register", JSON.stringify(n1));
t("坐标解析", n1?.x === 60 && n1?.y === 200, `${n1?.x},${n1?.y}`);
const n4 = r1[0]?.nodes.find((n) => n.name === "登录已有账号");
t("容忍行尾笔误的 ]", !!n4, "内联节点未解析");
t("内联节点注册", r1[0]?.nodes.some((n) => n.name === "密码加密"));
const dashedEdge = r1[0]?.edges.find((e) => e.style === "dashed");
t("虚线边解析", !!dashedEdge);
const labeledEdge = r1[0]?.edges.find((e) => e.label === "是");
t("边标签解析", !!labeledEdge);
// 无坐标节点被自动布局
const n5 = r1[0]?.nodes.find((n) => n.name === "密码加密");
const n6 = r1[0]?.nodes.find((n) => n.name === "写入用户表");
t("无坐标节点已自动布局", n5?.x != null && n6?.y != null);

// ================= 用例 2：多图文档 =================
console.log("\n[2] 多图文档 + 无坐标自动布局");
const md2 = `# 集合

## 图A

\`\`\`flow
a[API|查询|GET /api/a] --> b[PROC|处理]
b --> c[API|返回|GET /api/c]
\`\`\`

## 图B

\`\`\`flow
x[API|X|GET /api/x] --> y{DECISION|Y?}
y -->|ok| z[DATA|Z]
\`\`\`
`;
const r2 = MD.parse(md2);
t("解析出 2 个流程图", r2.length === 2, `实际 ${r2.length}`);
t("图A 名称", r2[0]?.name === "图A");
t("图A 边数", r2[0]?.edges.length === 2);
t("图B 判断节点", r2[1]?.nodes.some((n) => n.type === "decision"));
t("图B 全部节点有坐标", r2[1]?.nodes.every((n) => n.x != null && n.y != null));

// ================= 用例 3：序列化 → 解析 往返 =================
console.log("\n[3] 序列化→解析 往返一致性");
const demo = {
  id: "d_demo", name: "往返测试图",
  nodes: [
    { id: "a", type: "api", name: "注册接口", method: "POST", path: "/api/auth/register", x: 10, y: 20, w: 190, h: 62, desc: "入口" },
    { id: "b", type: "process", name: "校验", x: 300, y: 20, w: 160, h: 52, desc: "" },
    { id: "c", type: "decision", name: "通过?", x: 550, y: 10, w: 170, h: 84, desc: "" },
    { id: "d", type: "data", name: "存库", x: 800, y: 20, w: 160, h: 58, desc: "MySQL" },
    { id: "e", type: "api", name: "返回结果", method: "GET", path: "/api/result", x: 1050, y: 20, w: 190, h: 62, desc: "" },
  ],
  edges: [
    { id: "e1", from: "a", to: "b", fromPort: "right", toPort: "left", label: "", style: "solid" },
    { id: "e2", from: "b", to: "c", fromPort: "right", toPort: "left", label: "", style: "solid" },
    { id: "e3", from: "c", to: "d", fromPort: "right", toPort: "left", label: "是", style: "solid" },
    { id: "e4", from: "d", to: "e", fromPort: "right", toPort: "left", label: "", style: "dashed" },
  ],
};
const md3 = MD.serializeAll([demo]);
const r3 = MD.parse(md3);
t("往返后图数一致", r3.length === 1);
t("往返后节点数一致", r3[0]?.nodes.length === demo.nodes.length, `${r3[0]?.nodes.length} vs ${demo.nodes.length}`);
t("往返后边数一致", r3[0]?.edges.length === demo.edges.length);
const sortKey = (n) => n.name;
const orig = [...demo.nodes].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
const parsed = [...(r3[0]?.nodes || [])].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
let roundOK = true;
for (let i = 0; i < orig.length; i++) {
  const a = orig[i], b = parsed[i];
  if (a.name !== b.name || a.type !== b.type || a.x !== b.x || a.y !== b.y) roundOK = false;
  if (a.type === "api" && (a.method !== b.method || a.path !== b.path)) roundOK = false;
  if (a.desc !== b.desc) roundOK = false;
}
t("节点属性（名称/类型/坐标/接口/说明）全部一致", roundOK);
const edgesOK =
  r3[0].edges.filter((e) => e.label === "是").length === 1 &&
  r3[0].edges.filter((e) => e.style === "dashed").length === 1 &&
  r3[0].edges.filter((e) => e.style === "solid").length === 3;
t("边属性（标签/样式）往返一致", edgesOK);

// ================= 用例 4：边界接口分析（序列化输出） =================
console.log("\n[4] 边界接口写入文档");
t("导出文本含入口标记", md3.includes("- 入口: POST /api/auth/register"));
t("导出文本含出口标记", md3.includes("- 出口: GET /api/result"));

// ================= 用例 5：容错 =================
console.log("\n[5] 容错");
const r5 = MD.parse("完全没有流程的普通文档\n## 只是标题\n- 列表项");
t("普通文档 → 0 图", r5.length === 0);
const r5b = MD.parse("```flow\nghost --> phantom\n```");
t("未定义节点 → 自动补 PROC", r5b[0]?.nodes.length === 2 && r5b[0].edges.length === 1);
const r5c = MD.parse("```flow\nA --> A\n```");
t("自环边被忽略", r5c.length === 0 || r5c[0].edges.length === 0);
const r5d = MD.parse("```flow\nn1[API|X|POST /api/x] @(50,60)\n```\n只定义节点没有边");
t("无边的孤立节点图", r5d[0]?.nodes.length === 1 && r5d[0].edges.length === 0);

// ================= 用例 6：特殊字符 =================
console.log("\n[6] 特殊字符");
const tricky = { id: "t", name: "含|竖线", method: "GET", path: "/api/a?x=1", x: 1, y: 2, w: 190, h: 62, desc: "说明|有竖线", type: "api" };
const md6 = MD.serializeAll([{ id: "d", name: "特殊字符", nodes: [tricky, { id: "p", type: "process", name: "普通", x: 5, y: 6, w: 160, h: 52, desc: "" }], edges: [{ id: "e", from: "t", to: "p", label: "带|标签", fromPort: "right", toPort: "left", style: "solid" }] }]);
const r6 = MD.parse(md6);
t("竖线转义往返（名称）", r6[0]?.nodes.some((n) => n.name.includes("竖线")));
t("竖线转义往返（标签）", r6[0]?.edges.some((e) => (e.label || "").includes("标签")));

// ================= 用例 7：连线数据子段 =================
console.log("\n[7] 连线数据子段（类型|限制|说明）");
const md7src = `\`\`\`flow
n1[API|A|GET /api/a] --> n2[PROC|B]
  data: string | ≤32 | 用户名
  data: number | 0-100 |
n2 --> n3[DATA|C]
\`\`\`
`;
const r7 = MD.parse(md7src);
const e1 = r7[0]?.edges.find((e) => e.label === undefined || e.label === "");
t("data: 行归属到上一条边", r7[0]?.edges[0]?.data?.length === 2, JSON.stringify(r7[0]?.edges[0]?.data));
t("第二条边无 data", !r7[0]?.edges[1]?.data);
t("子段三字段解析", r7[0]?.edges[0]?.data[0]?.type === "string" && r7[0]?.edges[0]?.data[0]?.limit === "≤32" && r7[0]?.edges[0]?.data[0]?.desc === "用户名");
t("空字段保留结构", r7[0]?.edges[0]?.data[1]?.desc === "");
// 往返
const demo7 = {
  id: "d7", name: "数据子段往返",
  nodes: [
    { id: "a", type: "api", name: "A", method: "GET", path: "/api/a", x: 1, y: 2, w: 190, h: 62, desc: "" },
    { id: "b", type: "process", name: "B", x: 3, y: 4, w: 160, h: 52, desc: "" },
  ],
  edges: [
    { id: "e1", from: "a", to: "b", fromPort: "right", toPort: "left", label: "成功", style: "solid",
      data: [
        { type: "string", limit: "≤32", desc: "用户名" },
        { type: "array<number>", limit: "max 10 项", desc: "ID 列表" },
      ] },
  ],
};
const md7 = MD.serializeAll([demo7]);
const r7b = MD.parse(md7);
t("序列化含 data: 行", md7.includes("data: string | ≤32 | 用户名"));
const rtEdge = r7b[0]?.edges[0];
t("子段数量往返一致", rtEdge?.data?.length === 2);
t("子段内容往返一致", rtEdge?.data?.[1]?.type === "array<number>" && rtEdge?.data?.[1]?.limit === "max 10 项" && rtEdge?.data?.[1]?.desc === "ID 列表");
t("标签往返不受 data 行影响", rtEdge?.label === "成功");

// ================= 用例 8：数据节点的数据子段 =================
console.log("\n[8] 数据节点子段（类型|限制|说明）");
// 规则：data: 行归属于上一个完整行——节点行→节点，边行→边（导出总是独立分行，无歧义）
const md8src = `\`\`\`flow
n1[API|A|GET /api/a] @(1,1)
n2[DATA|用户表] @(2,2)
  data: string | unique | 用户邮箱
  data: datetime | NOT NULL | 创建时间
n1 --> n2
n3[DATA|日志表] @(10,20)
  data: json | 可空 | 扩展字段
n2 --> n3
\`\`\`
`;
const r8 = MD.parse(md8src);
const nUser = r8[0]?.nodes.find((n) => n.name === "用户表");
const nLog = r8[0]?.nodes.find((n) => n.name === "日志表");
t("节点子段归属正确（用户表 2 条）", nUser?.data?.length === 2, JSON.stringify(nUser?.data));
t("节点子段归属正确（日志表 1 条）", nLog?.data?.length === 1);
t("节点子段三字段解析", nUser?.data?.[0]?.type === "string" && nUser?.data?.[0]?.limit === "unique" && nUser?.data?.[0]?.desc === "用户邮箱");
t("边不带节点子段", !r8[0]?.edges?.[0]?.data && !r8[0]?.edges?.[1]?.data);
// 往返
const demo8 = {
  id: "d8", name: "节点子段往返",
  nodes: [
    { id: "a", type: "api", name: "A", method: "GET", path: "/api/a", x: 1, y: 2, w: 190, h: 62, desc: "" },
    { id: "b", type: "data", name: "用户表", x: 3, y: 4, w: 160, h: 58, desc: "",
      data: [{ type: "bigint", limit: "PK 自增", desc: "用户ID" }] },
  ],
  edges: [{ id: "e1", from: "a", to: "b", fromPort: "right", toPort: "left", label: "", style: "solid" }],
};
const md8 = MD.serializeAll([demo8]);
const r8b = MD.parse(md8);
const rbNode = r8b[0]?.nodes.find((n) => n.name === "用户表");
t("节点子段数量往返一致", rbNode?.data?.length === 1);
t("节点子段内容往返一致", rbNode?.data?.[0]?.type === "bigint" && rbNode?.data?.[0]?.limit === "PK 自增" && rbNode?.data?.[0]?.desc === "用户ID");
t("序列化位置在节点行后", /^\s*data: bigint \| PK 自增 \| 用户ID$/m.test(md8));

// ================= 用例 9：Mermaid flowchart 导入（用户提供的完整示例） =================
console.log("\n[9] Mermaid flowchart 导入");
const mermaidSample = `flowchart TD
    Start([开始界面]) -->|点击 开始逃生| Init["kaishiYouxi 初始化"]
    Init --> InitSet["深度=1200 体力=60 氧气=100 背包=空 步数=0"]
    InitSet --> GenLayer["shengchengCeng 生成当前层"]
    GenLayer --> GenDetail["随机泥土/岩石/空格<br/>放置井口与出生点<br/>撒资源 saZiyuan<br/>撒毒气 saDuqi<br/>BFS 检查可达性"]
    GenDetail --> Render["gengxinQuanbu 渲染画面"]
    Render --> Loop{"等待玩家输入"}

    Loop -->|WASD/方向键| Move["changshiYidong"]
    Loop -->|空格/向上爬| Climb["changshiPasheng"]
    Loop -->|休息| Rest["xiuxiYixia"]
    Loop -->|使用物品| Use["shiyongWupin"]
    Loop -->|丢弃物品| Drop["diuqiWupin"]

    Move --> MBound{"越界?"}
    MBound -->|是| Loop
    MBound -->|否| MType{"目标格类型?"}

    MType -->|岩石| MRock["提示无法挖掘"] --> Loop
    MType -->|泥土| MDirt{"体力≥3?"}
    MDirt -->|否| MNoT["提示体力不足"] --> Loop
    MDirt -->|是| MDig["体力-3 步数+1<br/>挖开泥土 jinxingWaJue"]
    MDig --> MRes{"埋有资源?"}
    MRes -->|是| MPick["拾取资源入背包<br/>背包满则放弃"] --> MEvent
    MRes -->|否| MEvent
    MEvent --> RandEvent

    MType -->|空洞/资源格| MEmpty{"体力≥1?"}
    MEmpty -->|否| MNoT
    MEmpty -->|是| MWalk["体力-1 步数+1 移动"]
    MWalk --> MRes2{"格上有资源?"}
    MRes2 -->|是| MPick
    MRes2 -->|否| MGas{"首次踏入毒气?"}
    MGas -->|是| MGasLoss["氧气-6"] --> MOxy
    MGas -->|否| MOxy
    MOxy["每步氧气-1"] --> OxyCheck

    RandEvent["触发随机事件 chufaShijian<br/>15% 概率"] --> RE{"事件类型?"}
    RE -->|塌方| RE1["体力-4"] --> OxyCheck
    RE -->|含气夹层| RE2["氧气-6"] --> OxyCheck
    RE -->|意外煤矿| RE3["煤矿+1"] --> OxyCheck
    RE -->|无事件| OxyCheck

    OxyCheck{"氧气≤0?"}
    OxyCheck -->|是| Fail
    OxyCheck -->|否| Render

    Climb --> CWell{"在井口?"}
    CWell -->|否| CNo["提示先找井口"] --> Loop
    CWell -->|是| CTili{"体力≥10?"}
    CTili -->|否| CNoT["提示体力不足"] --> Loop
    CTili -->|是| CClimb["体力-10 氧气-5 步数+1<br/>深度-100"]
    CClimb --> COxy{"氧气≤0?"}
    COxy -->|是| Fail
    COxy -->|否| CDepth{"深度≤0?"}
    CDepth -->|是| Win
    CDepth -->|否| GenLayer

    Rest --> RCheck{"氧气>15 且 体力未满?"}
    RCheck -->|否| RNo["提示无法休息"] --> Loop
    RCheck -->|是| RDo["氧气-15 体力+12 步数+1"] --> Render

    Use --> UDo["食物:体力+30 / 氧气瓶:氧气+40"] --> Render
    Drop --> DDo["从背包移除1件"] --> Render

    Win["jieshuYouxi 胜利<br/>计算物资总价值"] --> WinTitle{"总价值?"}
    WinTitle -->|≥600| T1["称号: 矿坑之王"] --> EndUI
    WinTitle -->|≥300| T2["称号: 满载而归的幸存者"] --> EndUI
    WinTitle -->|≥100| T3["称号: 小有收获的逃生者"] --> EndUI
    WinTitle -->|其他| T4["称号: 赤手空拳捡回一条命"] --> EndUI

    Fail["jieshuYouxi 失败<br/>记录死因与深度"] --> EndUI

    EndUI["显示结束界面<br/>展示步数/物资/体力/氧气"] --> Retry{"再试一次?"}
    Retry -->|是| Init
    Retry -->|否| Done([结束])
`;
const r9 = MD.parseMermaid(mermaidSample);
t("解析出 1 个流程图", r9.length === 1);
t("节点数 = 55", r9[0]?.nodes.length === 55, `实际 ${r9[0]?.nodes.length}`);
t("边数 = 79", r9[0]?.edges.length === 79, `实际 ${r9[0]?.edges.length}`);
const nm = (id) => r9[0].nodes.find((n) => n.id === id);
const ed = (a, b) => r9[0].edges.find((e) => e.from === a && e.to === b);
t("体育场→处理（Start）", nm("Start")?.type === "process" && nm("Start")?.name === "开始界面");
t("菱形→判断（Loop）", nm("Loop")?.type === "decision" && nm("Loop")?.name === "等待玩家输入");
t("引号矩形名称（Init）", nm("Init")?.name === "kaishiYouxi 初始化");
t("<br/> 清理（GenDetail）", nm("GenDetail")?.name.includes("撒资源 saZiyuan") && !nm("GenDetail")?.name.includes("<br"));
t("先引用后定义（RandEvent）", nm("RandEvent")?.name.includes("触发随机事件") && nm("RandEvent")?.name.includes("15% 概率"));
t("链式连写（MRock→Loop）", !!ed("MRock", "Loop") && nm("MRock")?.name === "提示无法挖掘");
t("链式连写（MPick→MEvent）", !!ed("MPick", "MEvent"));
t("边标签（MRes→MPick=是）", ed("MRes", "MPick")?.label === "是");
t("边标签（WinTitle→T1=≥600）", ed("WinTitle", "T1")?.label === "≥600");
t("多次引用不重复建节点（Fail 被多边引用）", r9[0].edges.filter((e) => e.to === "Fail").length === 2);
t("TD 方向全部节点有坐标", r9[0].nodes.every((n) => n.x != null && n.y != null));
t("无效文本 → 0 图", MD.parseMermaid("hello world\n普通文本").length === 0);
// 小语法集：虚线/粗线/圆柱/LR 方向
const r9b = MD.parseMermaid(`graph LR
A --> B[(用户表)]
B -.->|异步| C((通知))
C ==> D{完成?}
`);
t("graph LR + 圆柱→数据", r9b[0]?.nodes.find((n) => n.id === "B")?.type === "data" && r9b[0]?.nodes.find((n) => n.id === "B")?.name === "用户表");
t("虚线边（-.->）", r9b[0]?.edges.some((e) => e.from === "B" && e.style === "dashed" && e.label === "异步"));
t("粗线边（==>）当实线", r9b[0]?.edges.some((e) => e.from === "C" && e.style === "solid" && e.to === "D"));
// 往返：mermaid 导入 → 导出 .md → 再解析，结构无损
const md9 = MD.serializeAll([{ ...r9[0], id: "d9", name: "mermaid往返" }]);
const r9c = MD.parse(md9);
t("往返节点数一致", r9c[0]?.nodes.length === 55, `${r9c[0]?.nodes.length}`);
t("往返边数一致", r9c[0]?.edges.length === 79);
t("往返标签一致", r9c[0]?.edges.some((e) => e.label === "≥600"));
t("mermaid 导入的边都有唯一 id（点击选中依赖）",
  r9[0].edges.every((e) => e.id) && new Set(r9[0].edges.map((e) => e.id)).size === 79);
t("md 解析的边都有唯一 id", r1[0].edges.every((e) => e.id) && new Set(r1[0].edges.map((e) => e.id)).size === r1[0].edges.length);

// ================= 用例 10：autoLayout force 选项 =================
console.log("\n[10] autoLayout force（工具栏自动布局强制重排）");
const d10 = {
  id: "d10", name: "force测试",
  nodes: [
    { id: "a", type: "api",     name: "入口", method: "POST", path: "/a", x: 999, y: 888, w: 190, h: 62, desc: "" },
    { id: "b", type: "process", name: "处理", x: 777, y: 666, w: 160, h: 52, desc: "" },
    { id: "c", type: "api",     name: "出口", method: "GET", path: "/c", x: 555, y: 444, w: 190, h: 62, desc: "" },
  ],
  edges: [
    { id: "e1", from: "a", to: "b", label: "", style: "solid" },
    { id: "e2", from: "b", to: "c", label: "", style: "solid" },
  ],
};
// 默认（不传 force）：已有坐标不动
MD.autoLayout(d10);
t("默认模式保留已有坐标", d10.nodes.find((n) => n.id === "a").x === 999 && d10.nodes.find((n) => n.id === "b").y === 666);
// force：强制覆盖为分层坐标（a 第0层 x=60；b 第1层 x=340；c 第2层 x=620）
MD.autoLayout(d10, { force: true });
const na = d10.nodes.find((n) => n.id === "a"), nb = d10.nodes.find((n) => n.id === "b"), nc = d10.nodes.find((n) => n.id === "c");
t("force 覆盖坐标：a 落第0层", na.x === 60, `a.x=${na.x}`);
t("force 覆盖坐标：b 落第1层", nb.x === 60 + 280, `b.x=${nb.x}`);
t("force 覆盖坐标：c 落第2层", nc.x === 60 + 280 * 2, `c.x=${nc.x}`);
t("force 单列层内 y 相同", na.y === nb.y && nb.y === nc.y);
t("force 后坐标全为整数", d10.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.y)));

// ================= 用例 11：主线大回环（游戏重启主循环） =================
console.log("\n[11] 主线大回环：先忽略绕回主线的逆向边再排列");
const d11 = {
  id: "d11", name: "回环测试",
  nodes: [
    { id: "Entry",   type: "api",     name: "开始游戏", method: "POST", path: "/start", x: 1, y: 1, w: 190, h: 62, desc: "" },
    { id: "Loop",    type: "process", name: "主循环", x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "Win",     type: "api",     name: "通关", method: "GET", path: "/win", x: 1, y: 1, w: 190, h: 62, desc: "" },
    { id: "Fail",    type: "process", name: "死亡结算", x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "Restart", type: "process", name: "重启", x: 1, y: 1, w: 160, h: 52, desc: "" },
  ],
  edges: [
    { id: "e1", from: "Entry",   to: "Loop",  label: "", style: "solid" },
    { id: "e2", from: "Loop",    to: "Win",   label: "", style: "solid" },
    { id: "e3", from: "Loop",    to: "Fail",  label: "", style: "solid" },
    { id: "e4", from: "Fail",    to: "Restart", label: "", style: "solid" },
    { id: "e5", from: "Restart", to: "Loop",  label: "重启", style: "solid" }, // 绕回主线的逆向边
  ],
};
MD.autoLayout(d11, { force: true });
const n11 = (id) => d11.nodes.find((n) => n.id === id);
t("主线不被回边拉深：Loop 落第 1 层", n11("Loop").x === 60 + 280, `Loop.x=${n11("Loop").x}`);
t("通关与死亡同层（第 2 层）", n11("Win").x === 60 + 280 * 2 && n11("Fail").x === 60 + 280 * 2, `Win.x=${n11("Win").x},Fail.x=${n11("Fail").x}`);
t("重启链挂第 3 层（不被卡在入口列）", n11("Restart").x === 60 + 280 * 3 && n11("Restart").x > n11("Fail").x, `Restart.x=${n11("Restart").x}`);
t("忽略仅用于排列：边一条不删", d11.edges.length === 5);

// ================= 用例 12：主线前驱豁免（环不误伤主线边） =================
console.log("\n[12] 主线前驱豁免：出口绕回不会误删主线边");
const d12 = {
  id: "d12", name: "豁免测试",
  nodes: [
    { id: "S", type: "api",     name: "入口", method: "POST", path: "/s", x: 1, y: 1, w: 190, h: 62, desc: "" },
    { id: "A", type: "process", name: "处理A", x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "B", type: "process", name: "处理B", x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "W", type: "api",     name: "出口", method: "GET", path: "/w", x: 1, y: 1, w: 190, h: 62, desc: "" },
  ],
  edges: [
    { id: "e1", from: "S", to: "A", label: "", style: "solid" },
    { id: "e2", from: "A", to: "B", label: "", style: "solid" },
    { id: "e3", from: "B", to: "W", label: "", style: "solid" },
    { id: "e4", from: "W", to: "A", label: "回环", style: "solid" }, // 出口绕回 A
  ],
};
MD.autoLayout(d12, { force: true });
const n12 = (id) => d12.nodes.find((n) => n.id === id);
t("主线边未被误伤：A/B/W 逐层推进", n12("A").x === 340 && n12("B").x === 620 && n12("W").x === 900, `A=${n12("A").x},B=${n12("B").x},W=${n12("W").x}`);
t("绕回边已忽略但保留在图上", d12.edges.length === 4);

// ================= 用例 13：多出口 → 选最长的贯穿线当主线 =================
console.log("\n[13] 多出口：所有入口-出口最短路径中最长者为主线");
const d13 = {
  id: "d13", name: "多出口主线",
  nodes: [
    { id: "E", type: "api",     name: "入口",   method: "POST", path: "/e", x: 1, y: 1, w: 190, h: 62, desc: "" },
    { id: "A", type: "process", name: "主循环", x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "B", type: "api",     name: "浅出口", method: "GET", path: "/b", x: 1, y: 1, w: 190, h: 62, desc: "" },
    { id: "C", type: "process", name: "中期",   x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "D", type: "process", name: "后期",   x: 1, y: 1, w: 160, h: 52, desc: "" },
    { id: "F", type: "api",     name: "深出口", method: "GET", path: "/f", x: 1, y: 1, w: 190, h: 62, desc: "" },
    { id: "R", type: "process", name: "重启",   x: 1, y: 1, w: 160, h: 52, desc: "" },
  ],
  edges: [
    { id: "e1", from: "E", to: "A", label: "", style: "solid" },
    { id: "e2", from: "A", to: "B", label: "", style: "solid" }, // 浅出口（2 跳）
    { id: "e3", from: "A", to: "C", label: "", style: "solid" },
    { id: "e4", from: "C", to: "D", label: "", style: "solid" },
    { id: "e5", from: "D", to: "F", label: "", style: "solid" }, // 深出口（4 跳）→ 主线
    { id: "e6", from: "D", to: "R", label: "", style: "solid" },
    { id: "e7", from: "R", to: "C", label: "重启", style: "solid" }, // 绕回主线中期节点
  ],
};
MD.autoLayout(d13, { force: true });
const n13 = (id) => d13.nodes.find((n) => n.id === id);
t("主线取最长贯穿线：深出口 F 落第 4 层", n13("F").x === 60 + 280 * 4, `F.x=${n13("F").x}`);
t("主线中期节点 C 不被回边拉深", n13("C").x === 60 + 280 * 2 && n13("D").x === 60 + 280 * 3, `C=${n13("C").x},D=${n13("D").x}`);
t("重启挂最深层且不卡层", n13("R").x === 60 + 280 * 4, `R.x=${n13("R").x}`);
t("边一条不删", d13.edges.length === 7);

// ================= 汇总 =================
console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
