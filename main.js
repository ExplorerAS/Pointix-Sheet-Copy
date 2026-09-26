const { Plugin, PluginSettingTab, Setting, Notice, Platform, setIcon } = require("obsidian");

const text = v => String(v ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
const valueOf = c => {
  if (!c) return "";
  if (c.v !== undefined && c.v !== null) return text(c.v);
  if (c?.p?.body?.dataStream != null) return text(c.p.body.dataStream);
  const link = c?.p?.body?.customRanges?.find?.(r => r?.properties?.url)?.properties?.url;
  return text(link);
};
const formulaOf = c => {
  const f = text(c?.f).trim();
  return !f ? "" : f.startsWith("=") ? f : `=${f}`;
};
const toTsv = rows => rows.map(r => r.map(v => text(v).replace(/\t/g, " ")).join("\t")).join("\n");
const csvCell = v => /[",\n]/.test(text(v)) ? `"${text(v).replace(/"/g, '""')}"` : text(v);
const toCsv = rows => rows.map(r => r.map(csvCell).join(",")).join("\n");
const mdCell = v => text(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
const toMarkdown = rows => {
  if (!rows.length) return "";
  const width = Math.max(1, ...rows.map(r => r.length));
  const normalized = rows.map(r => Array.from({ length: width }, (_, i) => mdCell(r[i] ?? "")));
  return [`| ${normalized[0].join(" | ")} |`, `| ${normalized[0].map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map(r => `| ${r.join(" | ")} |`)].join("\n");
};

const mergeContentAndFormulas = (content = [], formulas = []) => {
  const height = Math.max(content.length, formulas.length);
  const rows = [];
  for (let r = 0; r < height; r++) {
    const width = Math.max(content[r]?.length || 0, formulas[r]?.length || 0);
    rows.push(Array.from({ length: width }, (_, c) => formulas[r]?.[c] || content[r]?.[c] || ""));
  }
  return rows;
};

const numberFrom = (object, keys) => {
  if (!object) return null;
  for (const key of keys) try {
    let value = object[key];
    if (typeof value === "function") value = value.call(object);
    if (value === null || value === undefined || value === "") continue;
    if (Number.isFinite(Number(value))) return Number(value);
  } catch (_) {}
  return null;
};

const rangeBounds = range => {
  if (!range) return null;
  let descriptor = range;
  try { descriptor = range.getRange?.() || range; } catch (_) {}
  const row = numberFrom(descriptor, ["startRow", "row", "getStartRow", "getRow", "getRowIndex"])
    ?? numberFrom(range, ["getStartRow", "getRow", "getRowIndex", "startRow", "row"]);
  const col = numberFrom(descriptor, ["startColumn", "column", "col", "getStartColumn", "getColumn", "getColumnIndex"])
    ?? numberFrom(range, ["getStartColumn", "getColumn", "getColumnIndex", "startColumn", "column", "col"]);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return null;
  const rowCount = numberFrom(range, ["getNumRows", "getRowCount", "getHeight", "rowCount", "height"]);
  const colCount = numberFrom(range, ["getNumColumns", "getColumnCount", "getWidth", "columnCount", "width"]);
  const rawEndRow = numberFrom(descriptor, ["endRow", "getEndRow", "lastRow", "getLastRow"])
    ?? numberFrom(range, ["getEndRow", "getLastRow", "endRow", "lastRow"]);
  const rawEndCol = numberFrom(descriptor, ["endColumn", "getEndColumn", "lastColumn", "getLastColumn"])
    ?? numberFrom(range, ["getEndColumn", "getLastColumn", "endColumn", "lastColumn"]);
  const endRow = Math.max(row, Number.isInteger(rawEndRow) ? rawEndRow : row + Math.max(1, rowCount ?? 1) - 1);
  const endCol = Math.max(col, Number.isInteger(rawEndCol) ? rawEndCol : col + Math.max(1, colCount ?? 1) - 1);
  return { row, col, endRow, endCol };
};


// ---------- Formato (colores y diseño) ----------
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeColor = v => {
  const s = String(v ?? "").trim();
  return /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\))$/i.test(s) ? s : "";
};
const colorOf = c => safeColor(c && typeof c === "object" ? c.rgb : c);
const BORDER = { 1: "1px solid", 2: "1px solid", 3: "1px dotted", 4: "1px dashed", 5: "1px dashed", 6: "1px dotted",
  7: "3px double", 8: "2px solid", 9: "2px dashed", 10: "2px dashed", 11: "2px dotted", 12: "2px dashed", 13: "3px solid" };
const on = v => v === 1 || v === true;
const styleToCss = st => {
  if (!st) return "";
  const css = [];
  if (st.ff) css.push(`font-family:'${String(st.ff).replace(/['";<>\\]/g, "")}'`);
  if (Number(st.fs) > 0) css.push(`font-size:${Number(st.fs)}pt`);
  if (on(st.bl)) css.push("font-weight:bold");
  if (on(st.it)) css.push("font-style:italic");
  const deco = [];
  if (on(st.ul?.s)) deco.push("underline");
  if (on(st.st?.s)) deco.push("line-through");
  if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
  const cl = colorOf(st.cl); if (cl) css.push(`color:${cl}`);
  const bg = colorOf(st.bg); if (bg) css.push(`background-color:${bg}`);
  const ht = { 1: "left", 2: "center", 3: "right", 4: "justify" }[st.ht]; if (ht) css.push(`text-align:${ht}`);
  const vt = { 1: "top", 2: "middle", 3: "bottom" }[st.vt]; if (vt) css.push(`vertical-align:${vt}`);
  if (st.tb === 3) css.push("white-space:normal");
  for (const [k, side] of [["t", "top"], ["b", "bottom"], ["l", "left"], ["r", "right"]]) {
    const b = st.bd?.[k]; if (!b || !b.s) continue;
    css.push(`border-${side}:${BORDER[b.s] || "1px solid"} ${colorOf(b.cl) || "#000000"}`);
  }
  return css.join(";");
};
const resolveStyle = (styles, s) => typeof s === "string" ? (styles?.[s] || null) : (s && typeof s === "object" ? s : null);
const mergeStyles = (...list) => {
  const out = {};
  for (const s of list) if (s) for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === null) continue;
    out[k] = k === "bd" && typeof v === "object" ? { ...(out.bd || {}), ...v } : v;
  }
  return out;
};
const cellAt = (sheet, r, c) => sheet?.cellData?.[r]?.[c] ?? sheet?.cellData?.[String(r)]?.[String(c)] ?? null;
const richHtml = (cell, styles) => {
  const body = cell?.p?.body; if (!body?.dataStream) return null;
  const raw = String(body.dataStream), limit = raw.replace(/[\r\n]+$/, "").length;
  const runs = (body.textRuns || []).filter(r => r && Number.isInteger(r.st) && Number.isInteger(r.ed)).sort((a, b) => a.st - b.st);
  if (!runs.length) return null;
  const piece = (from, to, css = "") => {
    const t = esc(raw.slice(from, Math.min(to, limit))).replace(/\r\n?|\n/g, "<br>");
    return !t ? "" : css ? `<span style="${css}">${t}</span>` : t;
  };
  let html = "", pos = 0;
  for (const r of runs) {
    if (r.st > pos) html += piece(pos, r.st);
    const st = Math.max(r.st, pos);
    if (r.ed > st) html += piece(st, r.ed, styleToCss(resolveStyle(null, r.ts)));
    pos = Math.max(pos, r.ed);
  }
  if (pos < limit) html += piece(pos, limit);
  return html;
};
const buildHtmlTable = ({ sheet = {}, styles = {}, bounds, texts = null, formulas = null }) => {
  const { row, col, endRow, endCol } = bounds;
  const covered = new Set(), spans = new Map();
  for (const m of sheet.mergeData || []) {
    const sr = m?.startRow, sc = m?.startColumn, er = m?.endRow, ec = m?.endColumn;
    if (![sr, sc, er, ec].every(Number.isInteger)) continue;
    if (sr < row || sr > endRow || sc < col || sc > endCol) continue;
    const rs = Math.min(er, endRow) - sr + 1, cs = Math.min(ec, endCol) - sc + 1;
    if (rs <= 1 && cs <= 1) continue;
    spans.set(`${sr}:${sc}`, { rs, cs });
    for (let r = sr; r < sr + rs; r++) for (let c = sc; c < sc + cs; c++) if (r !== sr || c !== sc) covered.add(`${r}:${c}`);
  }
  const colW = c => Math.round(Number(sheet.columnData?.[c]?.w) || Number(sheet.defaultColumnWidth) || 88);
  const rowH = r => Math.round(Number(sheet.rowData?.[r]?.h) || Number(sheet.defaultRowHeight) || 24);
  let html = '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed"><colgroup>';
  for (let c = col; c <= endCol; c++) html += `<col width="${colW(c)}" style="width:${colW(c)}px">`;
  html += "</colgroup><tbody>";
  for (let r = row; r <= endRow; r++) {
    html += `<tr style="height:${rowH(r)}px">`;
    for (let c = col; c <= endCol; c++) {
      const key = `${r}:${c}`; if (covered.has(key)) continue;
      const cell = cellAt(sheet, r, c), i = r - row, j = c - col;
      const style = mergeStyles(resolveStyle(styles, sheet.columnData?.[c]?.s), resolveStyle(styles, sheet.rowData?.[r]?.s), resolveStyle(styles, cell?.s));
      const f = text(formulas?.[i]?.[j]);
      let content;
      if (f) content = esc(f);
      else content = richHtml(cell, styles) ?? esc(texts?.[i]?.[j] ?? valueOf(cell)).replace(/\n/g, "<br>");
      const span = spans.get(key);
      const attrs = span ? `${span.rs > 1 ? ` rowspan="${span.rs}"` : ""}${span.cs > 1 ? ` colspan="${span.cs}"` : ""}` : "";
      const css = styleToCss(style);
      html += `<td${attrs}${css ? ` style="${css}"` : ""}>${content}</td>`;
    }
    html += "</tr>";
  }
  return html + "</tbody></table>";
};
const htmlDocument = table => `<html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
const pickSheet = (book, id, name) => {
  const sheets = book?.sheets; if (!sheets) return null;
  if (id && sheets[id]) return sheets[id];
  if (name) for (const s of Object.values(sheets)) if (s?.name === name) return s;
  return sheets[book.sheetOrder?.[0]] || Object.values(sheets)[0] || null;
};
const colName = n => { let s = ""; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1 = b => {
  const s = `${colName(b.col)}${b.row + 1}`;
  return b.row === b.endRow && b.col === b.endCol ? s : `${s}:${colName(b.endCol)}${b.endRow + 1}`;
};
const DEFAULT_SETTINGS = { altPan: true, diagnostics: false };
const parseRef = value => {
  const m = String(value ?? "").trim().match(/^(?:.*!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i);
  if (!m) return null;
  const col = letters => { let n = 0; for (const c of letters.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
  const r1 = Number(m[2]) - 1, c1 = col(m[1]), r2 = m[4] ? Number(m[4]) - 1 : r1, c2 = m[3] ? col(m[3]) : c1;
  if (r1 < 0 || r2 < 0) return null;
  return { row: Math.min(r1, r2), col: Math.min(c1, c2), endRow: Math.max(r1, r2), endCol: Math.max(c1, c2) };
};

class PointixSheetCopySettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pointix Sheet Copy" });
    new Setting(containerEl)
      .setName("Mover hojas incrustadas con Alt + arrastrar (PC)")
      .setDesc("Con el puntero sobre una hoja incrustada en una nota, mantén Alt y arrastra para desplazarla sin usar las barritas.")
      .addToggle(t => t.setValue(this.plugin.settings.altPan).onChange(async v => { this.plugin.settings.altPan = v; await this.plugin.saveData(this.plugin.settings); }));
    const save = async () => { await this.plugin.saveData(this.plugin.settings); };
    new Setting(containerEl)
      .setName("Diagnóstico de selección en el móvil")
      .setDesc("Muestra en la barra de rango qué toques recibe el complemento. Útil si algo no responde: toma una captura y compártela.")
      .addToggle(t => t.setValue(this.plugin.settings.diagnostics).onChange(async v => { this.plugin.settings.diagnostics = v; await save(); }));
    containerEl.createEl("h3", { text: "Privacidad local, sin letra pequeña" });
    containerEl.createEl("p", {
      text: "Este complemento no hace solicitudes de red, no usa telemetría, no crea cuentas y no recopila credenciales. Lee únicamente la hoja activa cuando tú ordenas copiar y entrega el resultado al portapapeles normal del dispositivo.",
    });
    containerEl.createEl("p", {
      text: "El contenido no sale de tu dispositivo por medio de Pointix Sheet Copy. Sheet Plus, Obsidian Sync, el sistema operativo y otros complementos conservan sus propias políticas.",
    });
    containerEl.createEl("h3", { text: "Contacto y apoyo voluntario" });
    const contact = containerEl.createEl("p");
    contact.appendText("Soporte: ");
    contact.createEl("a", { text: "servicios.globix@gmail.com", href: "mailto:servicios.globix@gmail.com" });
    const support = containerEl.createEl("p");
    support.appendText("Si el complemento te resulta útil: ");
    support.createEl("a", { text: "Invítanos un café en Ko-fi", href: "https://ko-fi.com/exprorerit" });
    containerEl.createEl("p", { text: "El apoyo es opcional: no desbloquea funciones, no cambia la privacidad y no crea ninguna cuenta dentro del complemento." });
  }
}

const ACTION_GROUPS = [
  ["Texto", [
    ["copy", "Copiar contenido · WPS, Excel, Sheet Plus y más", "content"],
    ["sigma", "Copiar fórmula de la celda", "formula"],
    ["copy-check", "Copiar contenido y fórmula", "smart"],
  ]],
  ["Con formato", [
    ["paintbrush", "Copiar con formato, colores y diseño", "styled"],
    ["palette", "Copiar formato, contenido y fórmula", "styled-formula"],
  ]],
  ["Otros formatos", [
    ["file-text", "Copiar como tabla Markdown", "markdown"],
    ["file-spreadsheet", "Copiar como CSV", "csv"],
  ]],
];

class PointixSheetCopy extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this._cachedApi = null; this._boundApi = null; this._boundLeaf = null; this._apiDisposers = []; this._lastApiCell = null;
    this._lastPath = null; this._lastMtime = null; this._bookCache = null;
    this._lastTap = null; this._blockedPointerId = null; this._lastCopyAt = 0; this._dt = 430; this._dd = 34;
    this._suppressEditUntil = 0; this._copyPanel = null; this._mobileButton = null;
    this._range = null; this._pan = null; this._panClickUntil = 0; this._editing = false; this._lastPointer = null; this._keyboardQuietUntil = 0; this._touch = null; this._rangeTap = null; this._injApi = null; this._panelState = null;
    this._lastPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this._listeners = [
      [document, "pointix-sheet-copy-request", this._onCopyRequest.bind(this)],
      [document, "pointerdown", this._onPointerDown.bind(this)],
      [document, "pointerup", this._onPointerUp.bind(this)],
      [document, "pointercancel", this._onPointerUp.bind(this)],
      [document, "click", this._guard.bind(this)],
      [document, "dblclick", this._guard.bind(this)],
      [document, "contextmenu", this._onContextMenu.bind(this)],
      [document, "keydown", this._onKey.bind(this)],
      [document, "keyup", this._onKey.bind(this)],
      [document, "focusin", this._onFocusIn.bind(this)],
      [window, "pointerdown", this._onRangeTouch.bind(this)],
      [window, "pointermove", this._onRangeTouch.bind(this)],
      [window, "pointerup", this._onRangeTouch.bind(this)],
      [window, "pointercancel", this._onRangeTouch.bind(this)],
      [window, "blur", () => document.body.classList.remove("pointix-alt")],
    ];
    for (const [target, name, fn] of this._listeners) target.addEventListener(name, fn, true);
    this.registerEvent(this.app.vault.on("modify", f => {
      if (f?.path === this._lastPath) { this._lastMtime = null; this._bookCache = null; }
    }));
    const onLayout = () => {
      this._syncMobileButton();
      if (this._range && !this._activeSheetView()) this._endRange();
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", onLayout));
    this.registerEvent(this.app.workspace.on("layout-change", onLayout));
    this._addCommands();
    this.addSettingTab(new PointixSheetCopySettings(this.app, this));
    this.registerInterval(window.setInterval(() => { this._ensureApiEvents(); this._syncMobileButton(); }, 1200));
    window.setTimeout(() => { this._ensureApiEvents(); this._syncMobileButton(); }, 650);
  }

  onunload() {
    for (const [target, name, fn] of this._listeners || []) target.removeEventListener(name, fn, true);
    this._endPan(); this._endRange(); this._closeCopyPanel();
    document.body.classList.remove("pointix-alt");
    this._clearApiEvents();
  }

  _addCommands() {
    for (const [id, name, callback] of [
      ["open-copy-panel", "Abrir panel de copiado", () => this._openPanelFromCommand()],
      ["copy-cell-value", "Copiar valor de la celda", () => this._copyCell("value")],
      ["copy-cell-formula", "Copiar fórmula de la celda", () => this._copyCell("formula")],
      ["copy-selection-content", "Copiar contenido · WPS, Excel, Sheet Plus y más", () => this._copySelection("content")],
      ["copy-selection-smart", "Copiar contenido y fórmula", () => this._copySelection("smart")],
      ["copy-selection-styled", "Copiar con formato, colores y diseño", () => this._copySelection("styled")],
      ["copy-selection-styled-formula", "Copiar formato, contenido y fórmula", () => this._copySelection("styled-formula")],
      ["select-area", "Seleccionar rango para copiar", () => this._beginRange()],
      ["copy-selection-csv", "Copiar selección como CSV", () => this._copySelection("csv")],
      ["copy-selection-markdown", "Copiar selección como tabla Markdown", () => this._copySelection("markdown")],
    ]) this.addCommand({ id, name, callback });
  }

  async _openPanelFromCommand() {
    if (this._range) return this._openPanelForRange();
    const selection = await this._getSelection(true);
    if (!selection) return void new Notice("Pointix: selecciona una celda primero");
    this._showCopyMenu(selection, this._lastPoint);
  }

  // ---------- Vista activa ----------
  _activeSheetView() {
    try {
      const view = this.app?.workspace?.activeLeaf?.view;
      if (view?.getViewType?.() !== "excel-pro-view") return null;
      const el = view.containerEl;
      if (el && (typeof el.isShown === "function" ? !el.isShown() : !el.getClientRects().length)) return null;
      return view;
    } catch (_) { return null; }
  }

  // ---------- Menú contextual / panel ----------
  _onContextMenu(e) {
    if (!this._isSupportedSheet(e)) return;
    if (Date.now() <= this._suppressEditUntil) return void this._eat(e);
    const api = this._resolveApi();
    const domSelection = this._selectionFromDom();
    const selection = (domSelection ? { ...domSelection, ...this._sheetIdentity(api), api, apiRange: null } : null)
      || this._selectionFromApi(api);
    if (!selection) return;
    this._lastPoint = { x: Number(e.clientX || window.innerWidth / 2), y: Number(e.clientY || window.innerHeight / 2) };
    if (this._range) {
      // Dentro del modo rango, dejar presionado no abre nada: el dedo sigue seleccionando.
      if (Platform.isMobile) return void this._eat(e);
      return void this._openPanelForRange();
    }
    if (Platform.isMobile) {
      this._eat(e);
      this._showCopyMenu(selection, this._lastPoint);
      // En el móvil la celda presionada se selecciona al soltar el dedo: el panel se actualiza entonces.
      const refresh = () => {
        window.removeEventListener("pointerup", refresh, true);
        window.setTimeout(async () => {
          const st = this._panelState; if (!st) return;
          const fresh = await this._getSelection(true);
          if (fresh && this._panelState === st) st.update(fresh);
        }, 180);
      };
      window.addEventListener("pointerup", refresh, true);
      window.setTimeout(() => refresh(), 1500);
    } else {
      // Sheet Plus abre su propio menú; el nuestro se coloca a un lado.
      window.setTimeout(() => this._showCopyMenu(selection, this._lastPoint), 30);
    }
  }

  _showCopyMenu(selection = null, point = this._lastPoint, rangeDone = false) {
    if (Platform.isMobile) this._showMobileSheet(selection, rangeDone);
    else this._showDesktopPanel(selection, point, rangeDone);
  }

  _fillPanel(panel, selection, rangeDone) {
    const head = panel.createDiv({ cls: "pointix-copy-heading" });
    head.createSpan({ cls: "pointix-copy-title", text: "Pointix Sheet Copy" });
    const state = { selection };
    const badge = head.createSpan({ cls: "pointix-copy-range", text: selection ? a1(selection) : "" });
    state.update = fresh => { state.selection = fresh; badge.textContent = a1(fresh); };
    this._panelState = state;
    const close = head.createEl("button", { cls: "pointix-copy-close", attr: { type: "button", "aria-label": "Cerrar" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this._closeCopyPanel());
    const list = panel.createDiv({ cls: "pointix-copy-list" });
    if (!rangeDone) {
      const pick = list.createEl("button", { cls: "pointix-copy-action is-range", attr: { type: "button" } });
      setIcon(pick.createSpan({ cls: "pointix-copy-icon" }), "scan");
      pick.createSpan({ text: "Seleccionar rango…" });
      pick.addEventListener("click", () => { const s = state.selection; this._closeCopyPanel(); void this._beginRange(s); });
    }
    for (const [title, actions] of ACTION_GROUPS) {
      list.createDiv({ cls: "pointix-copy-group", text: title });
      for (const [icon, label, action] of actions) {
        const button = list.createEl("button", {
          cls: "pointix-copy-action",
          attr: { type: "button" },
        });
        setIcon(button.createSpan({ cls: "pointix-copy-icon" }), icon);
        button.createSpan({ text: label });
        button.addEventListener("click", () => {
          const s = state.selection;
          this._closeCopyPanel();
          void this._copySelection(action, s);
        });
      }
    }
    return list;
  }

  _showMobileSheet(selection, rangeDone) {
    this._closeCopyPanel();
    const backdrop = document.body.createDiv({ cls: "pointix-copy-backdrop" });
    const panel = document.body.createDiv({ cls: "pointix-copy-panel is-sheet", attr: { role: "menu" } });
    panel.createDiv({ cls: "pointix-copy-grip" });
    this._fillPanel(panel, selection, rangeDone);
    // Deslizar dentro del panel no lo cierra ni mueve la hoja de atrás.
    for (const name of ["touchmove", "pointermove", "wheel"]) panel.addEventListener(name, e => e.stopPropagation());
    backdrop.addEventListener("pointerdown", e => { this._eat(e); this._closeCopyPanel(); });
    // Se acomoda sobre el teclado o la barra inferior y nunca queda cortado.
    const vv = window.visualViewport;
    const place = () => {
      const visibleBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const covered = Math.max(0, window.innerHeight - visibleBottom);
      panel.style.bottom = `calc(${Math.round(covered) + 10}px + env(safe-area-inset-bottom, 0px))`;
      panel.style.maxHeight = `${Math.round((vv ? vv.height : window.innerHeight) * 0.72)}px`;
    };
    place();
    vv?.addEventListener("resize", place); vv?.addEventListener("scroll", place);
    this._copyPanel = { element: panel, backdrop, vv, place };
    this._syncMobileButton();
  }

  _closeCopyPanel() {
    const p = this._copyPanel; if (!p) return;
    if (p.timer) window.clearInterval(p.timer);
    if (p.outside) document.removeEventListener("pointerdown", p.outside, true);
    if (p.resize) window.removeEventListener("resize", p.resize);
    if (p.vv && p.place) { p.vv.removeEventListener("resize", p.place); p.vv.removeEventListener("scroll", p.place); }
    p.element?.remove(); p.backdrop?.remove();
    this._copyPanel = null; this._panelState = null;
    this._syncMobileButton();
  }

  _nativeMenuRect(point, own) {
    const nodes = document.querySelectorAll(
      '.univer-grid.univer-overflow-y-auto.univer-shadow-md, [class*="univer-context-menu"], [role="menu"]'
    );
    const candidates = [...nodes].filter(el => !own.contains(el) && !el.closest?.(".pointix-copy-panel"))
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ el, rect }) => rect.width >= 170 && rect.height >= 140 &&
        rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight &&
        getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none");
    const distance = rect => Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - rect.right),
      Math.max(rect.top - point.y, 0, point.y - rect.bottom)
    );
    candidates.sort((a, b) => distance(a.rect) - distance(b.rect) || b.rect.height - a.rect.height);
    return candidates[0]?.rect || null;
  }

  _positionCopyPanel(panel, point) {
    const rect = this._nativeMenuRect(point, panel);
    const margin = 8, gap = 10, vw = window.innerWidth, vh = window.innerHeight;
    panel.style.width = "";
    if (rect) {
      const sideSpace = Math.max(rect.left - gap - margin, vw - rect.right - gap - margin);
      if (sideSpace >= 150) panel.style.width = `${Math.min(312, sideSpace)}px`;
    }
    const width = Math.min(panel.offsetWidth, vw - margin * 2), height = Math.min(panel.offsetHeight, vh - margin * 2);
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    let x = clamp(point.x + gap, margin, vw - width - margin);
    let y = clamp(point.y, margin, vh - height - margin);
    if (rect) {
      const places = [
        { x: rect.right + gap, y: rect.top, fits: vw - rect.right - gap - margin >= width },
        { x: rect.left - width - gap, y: rect.top, fits: rect.left - gap - margin >= width },
        { x: rect.left, y: rect.top - height - gap, fits: rect.top - gap - margin >= height },
        { x: rect.left, y: rect.bottom + gap, fits: vh - rect.bottom - gap - margin >= height },
      ];
      const place = places.find(p => p.fits);
      if (place) { x = clamp(place.x, margin, vw - width - margin); y = clamp(place.y, margin, vh - height - margin); }
      else {
        const right = vw - rect.right, left = rect.left;
        x = clamp(right >= left ? rect.right + gap : rect.left - width - gap, margin, vw - width - margin);
        y = clamp(rect.top, margin, vh - height - margin);
      }
    } else x = point.x + 270 + gap + width <= vw - margin
      ? point.x + 270 + gap : clamp(point.x - 270 - width - gap, margin, vw - width - margin);
    panel.style.left = `${x}px`; panel.style.top = `${y}px`;
  }

  _showDesktopPanel(selection, point, rangeDone) {
    this._closeCopyPanel();
    const panel = document.body.createDiv({ cls: "pointix-copy-panel", attr: { role: "menu" } });
    this._fillPanel(panel, selection, rangeDone);
    const state = { element: panel, timer: null, resize: () => this._positionCopyPanel(panel, point), outside: e => {
      if (!panel.contains(e.target)) this._closeCopyPanel();
    } }; this._copyPanel = state;
    window.addEventListener("resize", state.resize);
    this._positionCopyPanel(panel, point);
    let checks = 0;
    state.timer = window.setInterval(() => {
      if (this._copyPanel !== state || ++checks > 12) return void window.clearInterval(state.timer);
      this._positionCopyPanel(panel, point);
    }, 50);
    window.setTimeout(() => {
      if (this._copyPanel === state) document.addEventListener("pointerdown", state.outside, true);
    }, 80);
  }

  _syncMobileButton() {
    // El botón flotante se eliminó: el panel se abre dejando presionada una celda.
    document.querySelectorAll(".pointix-copy-mobile-launcher").forEach(el => el.remove());
  }

  // ---------- Selección de rango ----------
  // En el móvil, Pointix Navigation convierte cada toque en un clic sintético y cada arrastre en desplazamiento.
  // Por eso, mientras la barra de rango está activa, Copy atiende los toques antes que Navigation:
  //   · un toque = Mayús + clic en esa celda, la hoja extiende la selección desde la celda inicial;
  //   · arrastrar = arrastre de ratón, la hoja selecciona como en la PC;
  //   · doble toque = abrir el panel de copiado.
  // La casilla de nombre de la hoja (A6:D12) es la referencia de lo que realmente está seleccionado.
  async _beginRange(startingSelection = null) {
    const sel = await this._getSelection(true) || startingSelection;
    if (!sel) return void new Notice("Pointix: primero selecciona una celda");
    this._closeCopyPanel(); this._endRange();
    this._range = {
      api: sel.api || null, sheetId: sel.sheetId || "", sheetName: sel.sheetName || "",
      anchor: { row: sel.row, col: sel.col }, end: { row: sel.endRow, col: sel.endCol },
      bounds: { row: sel.row, col: sel.col, endRow: sel.endRow, endCol: sel.endCol },
      lastDom: undefined, expect: null, settleUntil: 0, retried: false, panMode: false,
      timer: null, bar: null, label: null, hint: null, dragDir: null,
    };
    this._showRangeBar();
    this._updateRangeLabel();
    this._range.timer = window.setInterval(() => this._pollRange(), 140);
  }

  _rangeBounds() { return this._range ? { ...this._range.bounds } : null; }

  _normalize(a, b) {
    return { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col), endRow: Math.max(a.row, b.row), endCol: Math.max(a.col, b.col) };
  }

  _updateRangeLabel() {
    const r = this._range; if (r?.label) r.label.textContent = a1(r.bounds);
  }

  _setRangeFromBounds(b, anchorHint = null) {
    const r = this._range; if (!r) return;
    r.bounds = { row: b.row, col: b.col, endRow: b.endRow, endCol: b.endCol };
    const corners = [
      { row: b.row, col: b.col }, { row: b.row, col: b.endCol }, { row: b.endRow, col: b.col }, { row: b.endRow, col: b.endCol },
    ];
    let anchor = anchorHint || corners.find(c => c.row === r.anchor.row && c.col === r.anchor.col) || corners[0];
    r.anchor = anchor;
    r.end = { row: anchor.row === b.row ? b.endRow : b.row, col: anchor.col === b.col ? b.endCol : b.col };
    this._updateRangeLabel();
  }

  // Aplica el rango en la hoja visible: primero con la API de esa misma hoja; si la casilla de nombre
  // no cambia, lo escribe en la casilla de nombre, que siempre pertenece a la hoja que ves.
  _applyRange() {
    const r = this._range; if (!r) return;
    const b = this._normalize(r.anchor, r.end);
    r.bounds = b; r.expect = this._key(b); r.retried = false;
    let applied = false;
    const api = this._resolveApi();
    if (api) try {
      const wb = api.getActiveWorkbook?.();
      const ws = wb?.getActiveSheet?.();
      const range = ws?.getRange?.(b.row, b.col, b.endRow - b.row + 1, b.endCol - b.col + 1);
      if (range?.activate) { range.activate(); applied = true; }
    } catch (_) {}
    if (!applied) this._typeNameBox(a1(b));
    r.settleUntil = Date.now() + 260;
    this._keyboardQuietUntil = Date.now() + 1500;
    this._updateRangeLabel();
  }

  _key(b) { return b ? `${b.row}:${b.col}:${b.endRow}:${b.endCol}` : null; }

  _pollRange() {
    const r = this._range; if (!r) return;
    if (!this._activeSheetView()) return this._endRange();
    if (this._touch && Date.now() - this._touch.at < 1500) return; // esperar a que termine el gesto
    const dom = this._selectionFromDom(), domKey = this._key(dom);
    if (!dom) return this._pollRangeFromApi();
    if (Date.now() < r.settleUntil) { r.lastDom = domKey; return; }
    // Lo que aplicamos no llegó a la hoja visible: se reintenta por la casilla de nombre.
    if (r.expect) {
      if (domKey === r.expect) { r.expect = null; r.lastDom = domKey; return; }
      if (!r.retried && domKey === r.lastDom) {
        r.retried = true; this._typeNameBox(a1(r.bounds));
        r.settleUntil = Date.now() + 320; this._keyboardQuietUntil = Date.now() + 1500; return;
      }
      r.expect = null;
    }
    if (r.lastDom === undefined) { r.lastDom = domKey; return; }
    if (domKey === r.lastDom) return;
    r.lastDom = domKey;
    const single = dom.row === dom.endRow && dom.col === dom.endCol;
    const viaGesture = r.fromGesture && Date.now() - (r.gestureAt || 0) < 1500;
    if (single && !viaGesture) {
      // Tocaste una celda sin Mayús (PC o modo mover): esa celda es el final del rango.
      r.end = { row: dom.row, col: dom.col };
      this._applyRange();
    } else {
      // La hoja ya hizo la selección (Mayús + toque, arrastre o celdas combinadas): se adopta tal cual.
      let hint = null;
      if (r.dragDir) hint = { row: r.dragDir.up ? dom.endRow : dom.row, col: r.dragDir.left ? dom.endCol : dom.col };
      this._setRangeFromBounds(dom, hint);
    }
    r.fromGesture = false; r.dragDir = null;
  }

  _pollRangeFromApi() {
    const r = this._range, api = this._resolveApi(); if (!r || !api) return;
    const sel = this._selectionFromApi(api); if (!sel) return;
    const key = this._key(sel);
    if (Date.now() < r.settleUntil) { r.lastDom = key; return; }
    if (r.lastDom === undefined) { r.lastDom = key; return; }
    if (key === r.lastDom) return;
    r.lastDom = key;
    if (sel.row === sel.endRow && sel.col === sel.endCol && !(r.fromGesture && Date.now() - (r.gestureAt || 0) < 1500)) { r.end = { row: sel.row, col: sel.col }; this._applyRange(); }
    else this._setRangeFromBounds(sel);
    r.fromGesture = false;
  }

  _nudge(dr, dc) {
    const r = this._range; if (!r) return;
    r.end = { row: Math.max(0, r.end.row + dr), col: Math.max(0, r.end.col + dc) };
    this._arrowFocusUntil = Date.now() + 1200;
    this._blurSheetEditor();
    this._applyRange();
    window.setTimeout(() => this._blurSheetEditor(), 120);
    this._diag("flecha");
  }

  _nameBoxInput() {
    const root = this._activeSheetView()?.containerEl || this.app?.workspace?.activeLeaf?.view?.containerEl;
    if (!root) return null;
    const exact = root.querySelector('div.univer-w-24 > input');
    if (exact) return exact;
    for (const el of root.querySelectorAll('[class*="univer"] input')) if (parseRef(el.value)) return el;
    return null;
  }

  _typeNameBox(ref) {
    const input = this._nameBoxInput(); if (!input) return false;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, ref); else input.value = ref;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      window.setTimeout(() => {
        const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
        input.dispatchEvent(new KeyboardEvent("keydown", init));
        input.dispatchEvent(new KeyboardEvent("keyup", init));
      }, 40);
      return true;
    } catch (_) { return false; }
  }

  // Toques del dedo mientras la barra está activa (se atienden antes que Navigation).
  _onRangeTouch(e) {
    const r = this._range;
    if (!r || !Platform.isMobile || !this._isTouch(e)) return;
    let t = this._touch;
    if (t && Date.now() - t.at > 1500) { if (t.drag) this._synthMouse(t.canvas, "up", t.x, t.y); this._touch = t = null; }
    if (e.type === "pointerdown") {
      this._diag("toque recibido");
      if (r.panMode) return;
      if (t) { if (t.drag) this._synthMouse(t.canvas, "up", t.x, t.y); this._touch = t = null; }
      if (!this._isSupportedSheet(e)) return;
      const canvas = e.composedPath?.().find(n => n?.tagName === "CANVAS"); if (!canvas) return;
      this._eat(e);
      this._touch = { id: e.pointerId, canvas, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, drag: false, at: Date.now() };
      return;
    }
    if (!t || e.pointerId !== t.id) return;
    this._eat(e);
    t.at = Date.now();
    if (e.type === "pointermove") {
      t.x = e.clientX; t.y = e.clientY;
      if (!t.drag && Math.hypot(t.x - t.x0, t.y - t.y0) > 12) {
        t.drag = true; r.fromGesture = true; r.gestureAt = Date.now();
        this._synthMouse(t.canvas, "down", t.x0, t.y0);
        this._diag("arrastre iniciado");
      }
      if (t.drag) this._synthMouse(t.canvas, "move", t.x, t.y);
      return;
    }
    this._touch = null;
    if (t.drag) {
      this._synthMouse(t.canvas, "up", t.x, t.y);
      r.fromGesture = true; r.gestureAt = Date.now(); r.dragDir = { up: t.y < t.y0, left: t.x < t.x0 };
      this._keyboardQuietUntil = Date.now() + 1500;
      return;
    }
    if (e.type === "pointercancel") return;
    const now = Date.now(), last = this._rangeTap;
    if (last && now - last.at < 420 && Math.hypot(t.x - last.x, t.y - last.y) < 36) {
      this._rangeTap = null;
      return void window.setTimeout(() => this._openPanelForRange(), 180);
    }
    this._rangeTap = { at: now, x: t.x, y: t.y };
    r.fromGesture = true; r.gestureAt = now;
    this._keyboardQuietUntil = now + 1500;
    // Mayús + clic: la hoja extiende la selección desde la celda inicial hasta la tocada.
    this._synthMouse(t.canvas, "down", t.x, t.y, true);
    this._synthMouse(t.canvas, "up", t.x, t.y, true);
    this._synthMouse(t.canvas, "click", t.x, t.y, true);
    this._diag("toque aplicado");
  }

  _diag(what) {
    const r = this._range; if (!r || !this.settings?.diagnostics || !r.diag) return;
    r.diagCount = (r.diagCount || 0) + 1;
    const box = this._nameBoxInput();
    r.diag.textContent = `#${r.diagCount} ${what} · casilla ${box ? box.value : "no encontrada"} · API ${this._injApi ? "hoja visible" : "sin enlace"}`;
  }

  _synthMouse(canvas, phase, x, y, shiftKey = false) {
    try {
      const common = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, shiftKey };
      const pointer = (type, buttons) => {
        if (typeof PointerEvent === "function")
          canvas.dispatchEvent(new PointerEvent(type, { ...common, pointerId: 8708, pointerType: "mouse", isPrimary: true, buttons, pressure: buttons ? 0.5 : 0 }));
      };
      if (phase === "down") { pointer("pointerdown", 1); canvas.dispatchEvent(new MouseEvent("mousedown", { ...common, buttons: 1, detail: 1 })); }
      else if (phase === "move") { pointer("pointermove", 1); canvas.dispatchEvent(new MouseEvent("mousemove", { ...common, buttons: 1 })); }
      else if (phase === "up") { pointer("pointerup", 0); canvas.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0, detail: 1 })); }
      else canvas.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0, detail: 1 }));
    } catch (_) {}
  }

  _showRangeBar() {
    const r = this._range;
    const bar = document.body.createDiv({ cls: "pointix-range-bar" + (Platform.isMobile ? " is-mobile" : "") });
    // Encabezado: se presiona y se arrastra para mover la barra a cualquier parte de la pantalla.
    const head = bar.createDiv({ cls: "pointix-range-head", attr: { title: "Arrastra para mover" } });
    setIcon(head.createSpan({ cls: "pointix-range-grip" }), "grip-horizontal");
    head.createSpan({ cls: "pointix-range-title", text: "Pointix Sheet Copy" });
    r.label = head.createSpan({ cls: "pointix-range-label" });
    const info = bar.createDiv({ cls: "pointix-range-info" });
    r.hint = info.createSpan({ cls: "pointix-range-hint" });
    if (this.settings?.diagnostics) { r.diag = info.createSpan({ cls: "pointix-range-diag" }); r.diag.textContent = "diagnóstico activo"; }
    const setHint = () => {
      r.hint.textContent = !Platform.isMobile ? "Haz clic en la celda final o usa las flechas"
        : r.panMode ? "Modo mover: arrastra para desplazarte por la hoja" : "Toca la celda final, arrastra o usa las flechas";
    };
    setHint();
    const row = bar.createDiv({ cls: "pointix-range-buttons" });
    const btn = (icon, label, fn, cls = "") => {
      const b = row.createEl("button", { cls: "pointix-range-btn " + cls, attr: { type: "button", "aria-label": label } });
      setIcon(b, icon); if (cls.includes("is-primary")) b.createSpan({ text: label });
      b.addEventListener("pointerdown", e => e.preventDefault());
      b.addEventListener("click", e => { e.preventDefault(); fn(b); });
      return b;
    };
    btn("arrow-left", "Una columna menos", () => this._nudge(0, -1));
    btn("arrow-up", "Una fila menos", () => this._nudge(-1, 0));
    btn("arrow-down", "Una fila más", () => this._nudge(1, 0));
    btn("arrow-right", "Una columna más", () => this._nudge(0, 1));
    if (Platform.isMobile) btn("hand", "Mover la hoja", b => {
      r.panMode = !r.panMode; b.classList.toggle("is-active", r.panMode); setHint();
    }, "is-toggle");
    btn("copy", "Copiar…", () => this._openPanelForRange(), "is-primary");
    btn("x", "Cancelar", () => this._endRange(), "is-cancel");
    r.bar = bar;

    // Posición: la que elegiste la última vez; si no, abajo al centro. Siempre dentro de la parte visible,
    // así que cuando aparece el teclado la barra sube sola y al esconderse regresa a su lugar.
    const vv = window.visualViewport;
    const area = () => ({ x: vv ? vv.offsetLeft : 0, y: vv ? vv.offsetTop : 0, w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
    const place = () => {
      const A = area(), w = bar.offsetWidth, h = bar.offsetHeight;
      let x, y;
      const saved = this.settings?.rangeBarPos;
      if (saved && Number.isFinite(saved.fx) && Number.isFinite(saved.fy)) { x = saved.fx * window.innerWidth; y = saved.fy * window.innerHeight; }
      else { x = A.x + (A.w - w) / 2; y = A.y + A.h - h - (Platform.isMobile ? 90 : 24); }
      bar.style.left = `${Math.round(clamp(x, A.x + 4, A.x + A.w - w - 4))}px`;
      bar.style.top = `${Math.round(clamp(y, A.y + 4, A.y + A.h - h - 4))}px`;
    };
    place();
    r.place = place;
    if (vv) { vv.addEventListener("resize", place); vv.addEventListener("scroll", place); }
    window.addEventListener("resize", place);
    r.unplace = () => {
      if (vv) { vv.removeEventListener("resize", place); vv.removeEventListener("scroll", place); }
      window.removeEventListener("resize", place);
    };

    let drag = null;
    head.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault(); e.stopPropagation();
      drag = { id: e.pointerId, dx: e.clientX - bar.offsetLeft, dy: e.clientY - bar.offsetTop };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      bar.classList.add("is-dragging");
    });
    head.addEventListener("pointermove", e => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault(); e.stopPropagation();
      const A = area();
      const x = clamp(e.clientX - drag.dx, A.x + 4, A.x + A.w - bar.offsetWidth - 4);
      const y = clamp(e.clientY - drag.dy, A.y + 4, A.y + A.h - bar.offsetHeight - 4);
      bar.style.left = `${Math.round(x)}px`; bar.style.top = `${Math.round(y)}px`;
    });
    const drop = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null; bar.classList.remove("is-dragging");
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      this.settings.rangeBarPos = { fx: bar.offsetLeft / window.innerWidth, fy: bar.offsetTop / window.innerHeight };
      void this.saveData(this.settings);
    };
    head.addEventListener("pointerup", drop);
    head.addEventListener("pointercancel", drop);
    head.addEventListener("dblclick", () => { delete this.settings.rangeBarPos; void this.saveData(this.settings); place(); });
  }

  _openPanelForRange() {
    const r = this._range; if (!r) return;
    const dom = this._selectionFromDom();
    const b = dom || this._normalize(r.anchor, r.end);
    const api = this._resolveApi() || r.api;
    const selection = { ...b, ...this._sheetIdentity(api), api, apiRange: null };
    selection.apiRange = this._apiRangeFor(selection);
    this._endRange();
    this._suppressEditUntil = Date.now() + 800;
    this._showCopyMenu(selection, this._lastPoint, true);
  }

  _endRange() {
    const r = this._range; if (!r) return;
    if (r.timer) window.clearInterval(r.timer);
    r.unplace?.();
    r.bar?.remove();
    this._range = null; this._touch = null; this._rangeTap = null;
  }

  // ---------- Alt + arrastrar en hojas incrustadas (PC) ----------
  _onKey(e) {
    if (Platform.isMobile) return;
    document.body.classList.toggle("pointix-alt", !!e.altKey && !!this.settings?.altPan);
  }

  _startPan(e) {
    const canvas = e.composedPath?.().find(n => n?.tagName === "CANVAS");
    if (!canvas) return false;
    this._eat(e);
    const pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, canvas };
    pan.move = ev => {
      if (ev.pointerId !== pan.id) return;
      this._eat(ev);
      const dx = pan.x - ev.clientX, dy = pan.y - ev.clientY;
      pan.x = ev.clientX; pan.y = ev.clientY;
      const init = { bubbles: true, cancelable: true, clientX: pan.sx, clientY: pan.sy, deltaMode: 0 };
      try {
        if (dy) canvas.dispatchEvent(new WheelEvent("wheel", { ...init, deltaY: dy }));
        if (dx) canvas.dispatchEvent(new WheelEvent("wheel", { ...init, deltaX: dx }));
      } catch (_) {}
    };
    pan.up = ev => { if (ev.pointerId !== pan.id) return; this._eat(ev); this._endPan(); };
    window.addEventListener("pointermove", pan.move, true);
    window.addEventListener("pointerup", pan.up, true);
    window.addEventListener("pointercancel", pan.up, true);
    document.body.classList.add("pointix-panning");
    this._pan = pan;
    return true;
  }

  _endPan() {
    const pan = this._pan; if (!pan) return;
    window.removeEventListener("pointermove", pan.move, true);
    window.removeEventListener("pointerup", pan.up, true);
    window.removeEventListener("pointercancel", pan.up, true);
    document.body.classList.remove("pointix-panning");
    this._pan = null; this._panClickUntil = Date.now() + 350;
  }

  // ---------- Contexto de hoja ----------
  _navigationOn() { try { return !!this.app?.plugins?.enabledPlugins?.has?.("pointix-sheet-navigation"); } catch (_) { return false; } }
  _isTouch(e) { return ["touch", "pen"].includes(String(e?.pointerType || "").toLowerCase()); }
  _sheetContext(e) {
    try {
      const path = e?.composedPath?.() || [];
      const embed = path.find(node => {
        const classes = String(node?.className || "").toLowerCase();
        const id = String(node?.id || "").toLowerCase();
        return classes.includes("lj-sheet-iframe") || classes.includes("lj-embed-content") || id.startsWith("univer-embed-");
      }) || null;
      const isSheet = !!embed || path.some(node => {
        const classes = String(node?.className || "").toLowerCase();
        const id = String(node?.id || "").toLowerCase();
        return classes.includes("univer") || id.includes("univer");
      });
      return { isSheet, embed };
    } catch (_) { return { isSheet: false, embed: null }; }
  }
  _isSupportedSheet(e) {
    const context = this._sheetContext(e);
    if (!context.isSheet || context.embed) return false;
    try { return this.app?.workspace?.activeLeaf?.view?.getViewType?.() === "excel-pro-view"; }
    catch (_) { return false; }
  }
  _eat(e) { try { e.preventDefault(); } catch (_) {} try { e.stopPropagation(); } catch (_) {} try { e.stopImmediatePropagation?.(); } catch (_) {} }

  async _onCopyRequest() {
    if (this._range) return this._openPanelForRange();
    this._lastCopyAt = Date.now(); await new Promise(r => window.setTimeout(r, 18)); await this._copyCell("value");
  }

  _onFocusIn(e) {
    // El teclado se deja como lo maneja Sheet Plus, salvo cuando lo abre una flecha de la barra.
    if (!Platform.isMobile || Date.now() > (this._arrowFocusUntil || 0)) return;
    const t = e.target;
    if (!t?.matches?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
    if (!t.closest?.('[class*="univer"], [id*="univer"]')) return;
    window.setTimeout(() => { if (document.activeElement === t) t.blur(); }, 0);
    return;
    if (!t?.matches?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
    const view = this._activeSheetView();
    if (!view?.containerEl?.contains?.(t) || !t.closest?.('[class*="univer"], [id*="univer"]')) return;
    const p = this._lastPointer, now = Date.now();
    const fromGridTap = p && p.grid && now - p.at < 900;
    const automatic = !p || now - p.at > 1500 || now < this._keyboardQuietUntil;
    // Tocar la barra de fórmulas u otro campo sí abre el teclado.
    if (!fromGridTap && !automatic) return;
    window.setTimeout(() => { if (!this._editing && document.activeElement === t) t.blur(); }, 60);
  }

  _onPointerDown(e) {
    try { this._lastPointer = { at: Date.now(), grid: !!e.composedPath?.().some(n => n?.tagName === "CANVAS") }; } catch (_) {}
    this._lastPoint = { x: Number(e.clientX || window.innerWidth / 2), y: Number(e.clientY || window.innerHeight / 2) };
    if (!Platform.isMobile && e.altKey && e.button === 0 && this.settings?.altPan && this._sheetContext(e).embed) {
      if (this._startPan(e)) return;
    }
    // Durante la selección de rango no se intercepta nada: Sheet Plus y Navigation trabajan normal.
    if (this._range) return;
    if (this._navigationOn() || !this._isTouch(e) || !this._isSupportedSheet(e)) return;
    const now = Date.now(), x = Number(e.clientX || 0), y = Number(e.clientY || 0), p = this._lastTap;
    if (p && now - p.time > 0 && now - p.time <= this._dt && Math.hypot(x - p.x, y - p.y) <= this._dd) {
      this._blockedPointerId = e.pointerId; this._lastTap = null; this._lastCopyAt = now; this._eat(e); void this._copyCell("value");
    }
  }
  _onPointerUp(e) {
    if (this._range || this._pan) return;
    if (this._isTouch(e)) {
      if (this._navigationOn()) return;
      if (this._blockedPointerId !== null && e.pointerId === this._blockedPointerId) { this._eat(e); this._blockedPointerId = null; return; }
      if (this._isSupportedSheet(e)) this._lastTap = { time: Date.now(), x: Number(e.clientX || 0), y: Number(e.clientY || 0) };
      return;
    }
    if ((e.ctrlKey || e.metaKey) && this._isSupportedSheet(e)) window.setTimeout(() => void this._copyCell("value"), 20);
  }
  _guard(e) {
    if (Date.now() <= this._panClickUntil && this._sheetContext(e).embed) return void this._eat(e);
    if (!this._isSupportedSheet(e) || this._range) return;
    if (Date.now() <= this._suppressEditUntil || (this._lastCopyAt && Date.now() - this._lastCopyAt <= 900)) this._eat(e);
  }

  _blurSheetEditor() {
    if (!Platform.isMobile) return;
    try {
      const a = document.activeElement;
      if (a?.matches?.('input, textarea, [contenteditable="true"], [contenteditable=""]') && a.closest?.('[class*="univer"], [id*="univer"]')) a.blur();
    } catch (_) {}
  }

  _dismissSheetEditor() {
    try {
      const active = document.activeElement;
      if (!active || typeof active.blur !== "function") return;
      const root = this.app?.workspace?.activeLeaf?.view?.containerEl;
      const isEditor = active.matches?.('input, textarea, [contenteditable="true"]');
      const isInsideSheet = root?.contains?.(active) || active.closest?.('[class*="univer"], [id*="univer"]');
      if (isEditor && isInsideSheet) active.blur();
    } catch (_) {}
  }

  // ---------- Copiado ----------
  async _copyCell(mode, selected = null) {
    this._ensureApiEvents();
    const sel = selected || await this._getSelection(true);
    if (!sel) return void new Notice("Pointix: no pude detectar la celda");
    const matrix = await this._matrix(sel, mode), value = matrix?.[0]?.[0] ?? "";
    if (!value) return void new Notice(mode === "formula" ? "Pointix: la celda no contiene una fórmula" : "Pointix: celda vacía o no legible");
    return this._clip(value, mode === "formula" ? "Fórmula copiada" : "Celda copiada");
  }
  async _copySelection(format, selected = null) {
    this._ensureApiEvents();
    const sel = selected || await this._getSelection(true);
    if (!sel) return void new Notice("Pointix: no pude detectar la selección");
    if (format === "styled" || format === "styled-formula") return this._copyStyled(sel, format === "styled-formula");
    const mode = format === "formula" ? "formula" : format === "smart" ? "smart" : "value";
    const matrix = await this._matrix(sel, mode);
    if (!matrix?.length) return void new Notice("Pointix: selección vacía o no legible");
    if (format === "formula" && !matrix.some(row => row.some(Boolean))) return void new Notice("Pointix: la selección no contiene fórmulas");
    const serializers = { content: toTsv, formula: toTsv, smart: toTsv, table: toTsv, csv: toCsv, markdown: toMarkdown };
    const notices = {
      content: "Contenido copiado", formula: "Fórmula copiada", smart: "Contenido y fórmulas copiados",
      table: "Tabla copiada conservando filas y columnas", csv: "Selección copiada como CSV", markdown: "Tabla Markdown copiada",
    };
    return this._clip(serializers[format](matrix), notices[format]);
  }

  async _copyStyled(sel, withFormulas) {
    const bounds = { row: sel.row, col: sel.col, endRow: sel.endRow, endCol: sel.endCol };
    const range = sel.apiRange || this._apiRangeFor(sel);
    let texts = this._matrixFromRange(range, "value");
    let formulas = withFormulas ? this._matrixFromRange(range, "formula") : null;
    let book = this._snapshot(sel.api || this._cachedApi || this._boundApi);
    let sheet = pickSheet(book, sel.sheetId, sel.sheetName);
    if (!sheet) {
      const legacy = await this._loadLegacy();
      if (legacy?.book) { book = legacy.book; sheet = pickSheet(book, sel.sheetId, sel.sheetName); }
    }
    if (!texts && !sheet && !(range && typeof range.generateHTML === "function")) return void new Notice("Pointix: no pude leer la selección");
    const grid = fn => Array.from({ length: bounds.endRow - bounds.row + 1 }, (_, i) =>
      Array.from({ length: bounds.endCol - bounds.col + 1 }, (_, j) => fn(cellAt(sheet, bounds.row + i, bounds.col + j))));
    if (!texts) texts = grid(valueOf);
    else if (sheet) texts = texts.map((row, i) => row.map((v, j) => v || valueOf(cellAt(sheet, bounds.row + i, bounds.col + j))));
    if (withFormulas && !formulas && sheet) formulas = grid(formulaOf);
    let html = null;
    if (!withFormulas && range && typeof range.generateHTML === "function") {
      try { const native = range.generateHTML(); if (native && /<table/i.test(native)) html = native; } catch (_) {}
    }
    if (!html) html = htmlDocument(buildHtmlTable({ sheet: sheet || {}, styles: book?.styles || {}, bounds, texts, formulas }));
    const plain = toTsv(withFormulas ? mergeContentAndFormulas(texts, formulas || []) : texts);
    const notice = sheet || /<table/i.test(html)
      ? (withFormulas ? "Copiado con formato, contenido y fórmulas" : "Copiado con formato: colores y diseño")
      : "Copiado sin colores: no pude leer el formato de esta hoja";
    return this._clipRich(html, plain, notice);
  }

  async _clipRich(html, plain, notice) {
    if (!Platform.isMobile) try {
      const clipboard = require("electron")?.clipboard;
      if (clipboard?.write) { clipboard.write({ html, text: plain }); new Notice(notice); return true; }
    } catch (_) {}
    const viaCopyEvent = () => {
      const handler = e => {
        e.clipboardData.setData("text/html", html); e.clipboardData.setData("text/plain", plain);
        e.preventDefault(); e.stopImmediatePropagation();
      };
      const t = document.createElement("textarea"); t.value = plain; t.readOnly = true;
      Object.assign(t.style, { position: "fixed", opacity: "0", left: "-9999px" });
      document.body.appendChild(t); t.select();
      document.addEventListener("copy", handler, true);
      try { return document.execCommand("copy"); } catch (_) { return false; }
      finally { document.removeEventListener("copy", handler, true); t.remove(); }
    };
    if (Platform.isMobile) {
      // En Android, la escritura moderna guarda el HTML como archivo (content://…html). El evento copy no.
      if (viaCopyEvent()) { new Notice(notice); return true; }
      return this._clip(plain, "Copiado sin colores: este dispositivo no aceptó el formato");
    }
    try {
      if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        })]);
        new Notice(notice); return true;
      }
    } catch (_) {}
    if (viaCopyEvent()) { new Notice(notice); return true; }
    return this._clip(plain, "Copiado sin colores: este dispositivo no aceptó el formato");
  }

  _apiRangeFor(sel) {
    try {
      const api = sel.api || this._cachedApi || this._boundApi;
      const wb = api?.getActiveWorkbook?.() || api?.getCurrentWorkbook?.() || api?.getActiveUnit?.();
      const ws = wb?.getActiveSheet?.() || wb?.getActiveWorksheet?.();
      if (!ws) return null;
      let id = ""; try { id = String(ws.getSheetId?.() ?? ws.getId?.() ?? ""); } catch (_) {}
      if (sel.sheetId && id && id !== sel.sheetId) return null;
      return ws.getRange?.(sel.row, sel.col, sel.endRow - sel.row + 1, sel.endCol - sel.col + 1) || null;
    } catch (_) { return null; }
  }

  _ensureApiEvents(preferred = null) {
    const activeLeaf = this.app?.workspace?.activeLeaf || null;
    if (!preferred) {
      const inj = this._visibleInjector();
      if (inj) preferred = this._injApi?.inj === inj && this._isLiveApi(this._injApi.api) ? this._injApi.api : this._resolveApi();
      else if (this._boundApi && this._boundLeaf === activeLeaf && this._isLiveApi(this._boundApi)) return this._boundApi;
    }
    if (preferred && preferred === this._boundApi && this._boundLeaf === activeLeaf) return preferred;
    const api = preferred || this._resolveApi();
    if (!api) {
      if (this._boundApi) this._clearApiEvents();
      this._cachedApi = null;
      return null;
    }
    if (api === this._boundApi) return api;
    this._clearApiEvents(); this._boundApi = api; this._boundLeaf = activeLeaf; this._cachedApi = api; this._editing = false;
    for (const name of ["CellClicked", "BeforeSheetEditStart", "SheetEditStarted", "SheetEditEnded"]) try {
      const eventName = api?.Event?.[name]; if (!eventName) continue;
      const d = api.addEvent(eventName, p => {
        if (name === "BeforeSheetEditStart") { if (this._range || Date.now() <= this._suppressEditUntil) p.cancel = true; }
        else if (name === "SheetEditStarted") this._editing = true;
        else if (name === "SheetEditEnded") this._editing = false;
        else this._remember(p);
      });
      if (typeof d === "function") this._apiDisposers.push(d); else if (d?.dispose) this._apiDisposers.push(() => d.dispose());
    } catch (_) {}
    return api;
  }
  _clearApiEvents() { for (const d of this._apiDisposers || []) try { d(); } catch (_) {} this._apiDisposers = []; this._boundApi = null; this._boundLeaf = null; }
  _remember(p) {
    const row = Number(p?.row), col = Number(p?.column ?? p?.col); if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return;
    const ws = p?.worksheet; let sheetId = "", sheetName = "";
    try { sheetId = String(ws?.getSheetId?.() ?? ws?.getId?.() ?? ""); } catch (_) {}
    try { sheetName = String(ws?.getName?.() ?? ws?.getSheetName?.() ?? ""); } catch (_) {}
    this._lastApiCell = { row, col, endRow: row, endCol: col, sheetId, sheetName, api: this._boundApi, time: Date.now() };
  }

  async _matrix(sel, mode) {
    const range = sel.apiRange || this._apiRangeFor(sel);
    if (mode === "smart") {
      const content = this._matrixFromRange(range, "value");
      const formulas = this._matrixFromRange(range, "formula");
      if (content || formulas) return mergeContentAndFormulas(content || [], formulas || []);
    } else {
      const direct = this._matrixFromRange(range, mode); if (direct) return direct;
    }
    const snapshot = this._snapshot(sel.api), data = snapshot ? this._bookData(snapshot) : await this._loadLegacy();
    const sheet = this._resolve(data, sel.sheetId, sel.sheetName); if (!sheet) return null;
    const rows = [];
    for (let r = sel.row; r <= sel.endRow; r++) { const row = [];
      for (let c = sel.col; c <= sel.endCol; c++) { const cell = cellAt(sheet, r, c); row.push(mode === "formula" ? formulaOf(cell) : mode === "smart" ? formulaOf(cell) || valueOf(cell) : valueOf(cell)); }
      rows.push(row);
    }
    return rows;
  }
  _matrixFromRange(range, mode) {
    if (!range) return null;
    const methods = mode === "formula" ? ["getFormulas", "getFormula"] : mode === "raw" ? ["getRawValues", "getValues", "getRawValue", "getValue"] : ["getDisplayValues", "getValues", "getDisplayValue", "getValue"];
    for (const method of methods) try {
      if (typeof range[method] !== "function") continue; const result = range[method](); if (result == null) continue;
      const matrix = Array.isArray(result) ? (Array.isArray(result[0]) ? result : [result]) : [[result]];
      return matrix.map(row => row.map(v => mode === "formula" && v ? formulaOf({ f: v }) : text(v)));
    } catch (_) {}
    return null;
  }
  _snapshot(api) { try { const wb = api?.getActiveWorkbook?.() || api?.getCurrentWorkbook?.() || api?.getActiveUnit?.(); return wb?.save?.() || wb?.getSnapshot?.() || null; } catch (_) { return null; } }
  _bookData(book) { if (!book?.sheets) return null; const sheets = new Map(); for (const [id, s] of Object.entries(book.sheets)) sheets.set(id, { id, name: s.name || "", cellData: s.cellData || {} }); return { book, sheets }; }
  async _loadLegacy() {
    const f = this.app.workspace.getActiveFile(); if (!f || f.extension !== "md") return null; const mt = Number(f.stat?.mtime || 0);
    if (this._lastPath === f.path && this._lastMtime === mt && this._bookCache) return this._bookCache;
    const raw = await this.app.vault.read(f), match = raw.match(/```sheet\s*([\s\S]*?)```/); if (!match) return null;
    let book; try { book = JSON.parse(match[1]); } catch (_) { return null; }
    this._lastPath = f.path; this._lastMtime = mt; return this._bookCache = this._bookData(book);
  }
  _resolve(data, id, name) {
    if (!data) return null; let sheet = id && data.sheets.get(String(id));
    if (!sheet && name) for (const candidate of data.sheets.values()) if (candidate.name === name) { sheet = candidate; break; }
    if (!sheet) sheet = data.sheets.get(data.book.sheetOrder?.[0]) || [...data.sheets.values()][0]; return sheet || null;
  }
  async _clip(value, notice) {
    try { await navigator.clipboard.writeText(String(value)); new Notice(notice); return true; }
    catch (error) { try { const t = document.createElement("textarea"); t.value = String(value); t.readOnly = true; Object.assign(t.style, { position: "fixed", opacity: "0", left: "-9999px" }); document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); if (!ok) throw error; new Notice(notice); return true; } catch (_) { new Notice("Pointix: no pude copiar"); return false; } }
  }

  async _getSelection(force = false) {
    const dom = this._selectionFromDom();
    const api = this._resolveApi();
    if (api) this._ensureApiEvents(api);
    if (dom) return { ...dom, ...this._sheetIdentity(api), api, apiRange: null };
    const fromApi = this._selectionFromApi(api);
    if (fromApi) return fromApi;
    if (api && this._lastApiCell?.api === api) return { ...this._lastApiCell, api };
    return null;
  }
  // La API correcta es la de la hoja que se ve: se toma el inyector de Univer desde el lienzo visible.
  _visibleInjector() {
    const root = this._activeSheetView()?.containerEl; if (!root) return null;
    const canvases = [...root.querySelectorAll("canvas")].filter(c => c.getClientRects().length);
    for (const canvas of canvases) {
      let el = canvas.parentElement, hops = 0;
      while (el && hops++ < 40) {
        let key = null; try { key = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")); } catch (_) {}
        if (key) {
          let f = el[key], n = 0;
          while (f && n++ < 600) {
            for (const node of [f, f.alternate]) {
              const inj = node?.memoizedProps?.value?.injector;
              if (inj && typeof inj.get === "function" && typeof inj.createInstance === "function") return inj;
            }
            f = f.return;
          }
          break;
        }
        el = el.parentElement;
      }
    }
    return null;
  }
  _resolveApi() {
    const view = this._activeSheetView() || this.app?.workspace?.activeLeaf?.view;
    try { if (view?.getViewType?.() !== "excel-pro-view") return null; } catch (_) { return null; }
    const inj = this._visibleInjector();
    if (inj) {
      if (this._injApi?.inj === inj && this._isLiveApi(this._injApi.api)) return this._injApi.api;
      const fromTree = this._apisFromTree();
      const candidates = fromTree.length ? fromTree : this._allApiCandidates();
      let api = candidates.find(a => a?._injector === inj) || null;
      if (!api) for (const c of candidates) {
        try { const made = c?.constructor?.newAPI?.(inj); if (this._isLiveApi(made)) { api = made; break; } } catch (_) {}
      }
      if (api) { this._injApi = { inj, api }; this._cachedApi = api; return api; }
    }
    // Búsqueda pesada: como mucho una vez cada 8 segundos, para que el teléfono no se trabe.
    const now = Date.now();
    if (this._slowFind && now - this._slowFind.at < 8000) return this._slowFind.api;
    const api = this._findApi();
    this._slowFind = { at: now, api };
    return api;
  }
  // Sheet Plus guarda su API dentro de sus componentes: se recorre desde el lienzo visible hacia arriba.
  _apisFromTree() {
    const root = this._activeSheetView()?.containerEl; if (!root) return [];
    const looks = x => { try { return !!x && typeof x.getActiveWorkbook === "function"; } catch (_) { return false; } };
    const out = [];
    const canvas = [...root.querySelectorAll("canvas")].find(c => c.getClientRects().length);
    let el = canvas?.parentElement, hops = 0;
    const seen = new Set();
    while (el && el !== document.body && hops++ < 80) {
      let key = null; try { key = Object.keys(el).find(k => k.startsWith("__reactFiber$")); } catch (_) {}
      if (key) {
        let f = el[key], n = 0;
        while (f && n++ < 800) {
          if (seen.has(f)) break; seen.add(f);
          for (const node of [f, f.alternate]) {
            const v = node?.memoizedProps?.value;
            if (v && looks(v.univerApi) && !out.includes(v.univerApi)) out.push(v.univerApi);
            let h = node?.memoizedState, k = 0;
            while (h && typeof h === "object" && k++ < 40) { if (looks(h.memoizedState) && !out.includes(h.memoizedState)) out.push(h.memoizedState); h = h.next; }
          }
          f = f.return;
        }
      }
      el = el.parentElement;
    }
    return out;
  }
  _allApiCandidates() {
    const view = this.app?.workspace?.activeLeaf?.view;
    const plugins = Object.entries(this.app?.plugins?.plugins || {}).filter(([id]) => /sheet|excel|univer/i.test(id)).map(([, p]) => p);
    const list = [...this._searchApis(view ? [view] : [], 8), ...this._searchApis(plugins, 8)];
    return [...new Set(list)];
  }
  _contains(sel, cell) {
    return !!sel && !!cell && cell.row >= sel.row && cell.row <= sel.endRow && cell.col >= sel.col && cell.col <= sel.endCol;
  }
  _sheetIdentity(api) {
    let sheetId = "", sheetName = "";
    try {
      const wb = api?.getActiveWorkbook?.() || api?.getCurrentWorkbook?.() || api?.getActiveUnit?.();
      const ws = wb?.getActiveSheet?.() || wb?.getActiveWorksheet?.();
      try { sheetId = String(ws?.getSheetId?.() ?? ws?.getId?.() ?? ""); } catch (_) {}
      try { sheetName = String(ws?.getName?.() ?? ws?.getSheetName?.() ?? ""); } catch (_) {}
    } catch (_) {}
    return { sheetId, sheetName };
  }
  _selectionFromApi(api) {
    if (!api) return null; try {
      const wb = api.getActiveWorkbook?.() || api.getCurrentWorkbook?.() || api.getActiveUnit?.();
      const ws = wb?.getActiveSheet?.() || wb?.getActiveWorksheet?.() || api.getActiveSheet?.();
      const range = ws?.getSelection?.()?.getActiveRange?.() || wb?.getActiveRange?.() ||
        ws?.getActiveRange?.() || ws?.getActiveSelection?.()?.getActiveRange?.(); if (!ws || !range) return null;
      const bounds = rangeBounds(range); if (!bounds) return null;
      let sheetId = "", sheetName = ""; try { sheetId = String(ws.getSheetId?.() ?? ws.getId?.() ?? ""); } catch (_) {} try { sheetName = String(ws.getName?.() ?? ws.getSheetName?.() ?? ""); } catch (_) {}
      return { ...bounds, sheetId, sheetName, api, apiRange: range };
    } catch (_) { return null; }
  }
  _num(o, keys) { return numberFrom(o, keys); }
  _isLiveApi(api) {
    try { return !!(api?.getActiveWorkbook?.() || api?.getCurrentWorkbook?.() || api?.getActiveUnit?.()); }
    catch (_) { return false; }
  }
  _searchApis(roots, limit = 6) {
    const looks = x => { try { return !!x && (typeof x.getActiveWorkbook === "function" || (typeof x.getActiveUnit === "function" && typeof x.executeCommand === "function")); } catch (_) { return false; } };
    const found = [], queue = roots.map(value => ({ value, depth: 0 })), seen = new Set(); let visited = 0, cursor = 0;
    while (cursor < queue.length && visited < 30000 && found.length < limit) {
      const { value, depth } = queue[cursor++];
      if (!value || !["object", "function"].includes(typeof value) || seen.has(value)) continue;
      seen.add(value); visited++;
      if (looks(value)) { found.push(value); continue; }
      if (depth >= 12) continue;
      let names; try { names = Object.getOwnPropertyNames(value); } catch (_) { continue; }
      for (const name of names) {
        if (["app", "parent", "containerEl", "ownerDocument", "window", "document"].includes(name)) continue;
        let child; try { const d = Object.getOwnPropertyDescriptor(value, name); if (d?.get && !("value" in d)) continue; child = value[name]; } catch (_) { continue; }
        if (child && ["object", "function"].includes(typeof child)) queue.push({ value: child, depth: depth + 1 });
      }
    }
    return found;
  }
  _findApi(dom = this._selectionFromDom()) {
    const view = this.app?.workspace?.activeLeaf?.view;
    try { if (view?.getViewType?.() !== "excel-pro-view") return null; } catch (_) { return null; }
    // Primero SOLO dentro de la pestaña activa, para no tomar la hoja de otra pestaña abierta.
    let candidates = this._searchApis([view]);
    if (!candidates.length) {
      const plugins = Object.entries(this.app?.plugins?.plugins || {})
        .filter(([id]) => /sheet|excel|univer/i.test(id)).map(([, p]) => p);
      candidates = this._searchApis(plugins);
    }
    const live = candidates.filter(a => this._isLiveApi(a)), pool = live.length ? live : candidates;
    if (dom) { const match = pool.find(a => this._contains(this._selectionFromApi(a), dom)); if (match) return match; }
    return pool[0] || null;
  }
  _selectionFromDom() {
    const box = this._nameBoxInput();
    const fromBox = box ? parseRef(box.value) : null;
    if (fromBox) return { ...fromBox, sheetId: "", sheetName: "" };
    const selector = '[class*="univer"] input,[class*="univer"] [aria-label]';
    const root = this.app?.workspace?.activeLeaf?.view?.containerEl || document;
    for (const el of root.querySelectorAll(selector)) {
      let s = ""; try { s = String(el.value ?? el.getAttribute?.("aria-label") ?? "").trim(); } catch (_) {}
      const b = parseRef(s); if (b) return { ...b, sheetId: "", sheetName: "" };
    }
    return null;
  }
}

module.exports = PointixSheetCopy;
module.exports.__test = { text, valueOf, formulaOf, toTsv, toCsv, toMarkdown, mergeContentAndFormulas, numberFrom, rangeBounds, styleToCss, buildHtmlTable, htmlDocument, pickSheet, a1 };
