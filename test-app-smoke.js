// app.js 冒烟测试：验证启动、多图标签页、历史(含图层/马赛克瘦身)、导出选项持久化
// 运行：node test-app-smoke.js
'use strict';

const fakeCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 12 });
    if (k === 'canvas') return { width: 900, height: 600 };
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    if (k === 'createPattern') return () => null;
    if (typeof k === 'string') return () => {};
    return undefined;
  },
  set() { return true; }
});

function makeEl(id) {
  const listeners = {};
  const el = {
    id: id || '',
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, dataset: {}, children: [],
    width: 900, height: 600,
    value: '', checked: false, textContent: '', type: '', className: '',
    _html: '',
    getContext: () => fakeCtx,
    toDataURL: () => 'data:image/png;base64,AAA',
    toBlob(cb) { cb(new Blob(['fake-png'])); },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach(fn => fn(ev)); },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    setAttribute() {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    click() {}, focus() {}, blur() {}, select() {}, setPointerCapture() {}, releasePointerCapture() {},
    remove() {}
  };
  Object.defineProperty(el, 'innerHTML', {
    set(v) { el._html = v; el.children.length = 0; },
    get() { return el._html; }
  });
  return el;
}

// ---- 全局桩 ----
global.window = global;
global.Document = function Document() {};
global.Element = function Element() {};
global.HTMLCanvasElement = function HTMLCanvasElement() {};
global.HTMLImageElement = function HTMLImageElement() {};
global.HTMLTextAreaElement = function HTMLTextAreaElement() {};
global.Node = function Node() {};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, configurable: true });
global.getComputedStyle = () => ({});
global.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.localStorage = (() => {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; }
  };
})();

const els = {};
// 记录 document 上的监听器（fabric 拖动时把 mouseup 绑在 document 上），供拖动模拟使用
const docListeners = {};
const docStub = {
  createElement: (tag) => makeEl(tag),
  createElementNS: () => makeEl('svg'),
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  querySelectorAll: () => [],
  addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
  removeEventListener(ev, fn) { const a = docListeners[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
  dispatchEvent(ev) { (docListeners[ev.type] || []).slice().forEach(fn => fn(ev)); },
  body: makeEl('body'),
  defaultView: global,
  documentElement: { style: {} },
  // fabric 的 UMD 头：document 不是 Document 实例时会走 createHTMLDocument 分支
  implementation: { createHTMLDocument: () => docStub }
};
global.document = docStub;
global.Image = class {
  constructor() { this.width = 0; this.height = 0; this.naturalWidth = 400; this.naturalHeight = 300; this._src = ''; }
  addEventListener() {}
  set src(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
  get src() { return this._src; }
};
global.URL.createObjectURL = () => 'blob:fake';
global.URL.revokeObjectURL = () => {};
global.ClipboardItem = function ClipboardItem() {};

let fails = 0;
function check(name, cond) {
  if (!cond) { console.log('FAIL:', name); fails++; }
  else console.log('OK:', name);
}

(async () => {
  // ---- 加载 fabric + 自定义库 + app.js ----
  const fabric = require('./vendor/fabric.min.js').fabric || require('./vendor/fabric.min.js');
  global.fabric = fabric;
  require('./js/objects.js');
  require('./js/tools.js');
  require('./js/app.js'); // IIFE 启动：创建画布、绑定事件、渲染面板/图层/标签页

  const APP = window.APP;
  const CV = window.CV;
  const M = window.TOOLMGR;

  check('APP 暴露', !!APP);
  check('CV 创建（fabric.Canvas）', !!CV && typeof CV.add === 'function');
  check('启动后无标签页', APP.tabs.length === 0);
  check('tabbar 渲染出「＋ 新图」', els.tabbar && els.tabbar.children.length >= 1);

  // ---- 全局样式：线条颜色修改应写入 lineProps.stroke（回归：曾写入无效的 lp.color） ----
  let lineSec = null;
  (function walk(e) {
    if (!e) return;
    if (e.className === 'sec' && e.children[0] && e.children[0].textContent === '线条样式') lineSec = e;
    (e.children || []).forEach(walk);
  })(els.globalStyleBox);
  let lineColorInput = null;
  (function collect(e) {
    if (!e) return;
    if (e.type === 'color') lineColorInput = lineColorInput || e;
    (e.children || []).forEach(collect);
  })(lineSec);
  if (lineColorInput) {
    lineColorInput.value = '#00ff00';
    lineColorInput.dispatchEvent({ type: 'input' });
  }
  check('全局线条颜色写入 lineProps.stroke', lineColorInput && APP.lineProps.stroke === '#00ff00');

  const tick = () => new Promise(r => setTimeout(r, 20));
  const upload = () => els.fileInput.dispatchEvent({
    type: 'change', target: { files: [{ type: 'image/png', name: 'a.png' }], value: '' }
  });
  const drawRect = () => {
    M.select('rect');
    M.onDown({ e: { clientX: 50, clientY: 60, button: 0 } });
    M.onMove({ e: { clientX: 180, clientY: 140, button: 0 } });
    M.onUp({ e: { clientX: 180, clientY: 140, button: 0 } });
  };
  const drawLine = () => {
    M.select('line');
    M.onDown({ e: { clientX: 40, clientY: 200, button: 0 } });
    M.onMove({ e: { clientX: 160, clientY: 240, button: 0 } });
    M.onUp({ e: { clientX: 160, clientY: 240, button: 0 } });
  };

  // ---- 1. 上传第一张图 → 打开标签页 ----
  upload();
  await tick();
  check('标签页 1 已打开', APP.tabs.length === 1 && APP.activeTabIndex === 0);
  check('画布有底图', !!CV._baseImage && CV._baseW === 400 && CV._baseH === 300);
  check('tabbar 显示标签', els.tabbar.children.length >= 2);

  // ---- 2. 画一个矩形标注 → 图层 + 历史 ----
  drawRect();
  await tick();
  const rects = () => CV.getObjects().filter(o => o.type === 'annoRect');
  check('矩形标注已添加', rects().length === 1);
  check('标注自动建层', APP.layers.length >= 2 && APP.layers.some(l => l.name && l.name.indexOf('标注') === 0));

  // 全局线条颜色已改为 #00ff00 → 新画的直线应使用新颜色
  drawLine();
  await tick();
  const lines = () => CV.getObjects().filter(o => o.type === 'annoLine');
  check('新直线使用全局线条颜色', lines().length === 1 && lines()[0].line.color === '#00ff00');

  // ---- 控制点拖动回归：缩放≠1 时松手位置必须与鼠标落点一致（曾重复逆视口变换导致半速跟手/整体乱跑） ----
  const mk = (cx, cy, type) => ({ clientX: cx, clientY: cy, button: 0, type, preventDefault() {}, stopPropagation() {} });
  const screenOf = (o, pt) => {
    const vt = CV.viewportTransform;
    const full = fabric.util.multiplyTransformMatrices(vt, o.calcTransformMatrix());
    return fabric.util.transformPoint(o.pointToLocal(pt), full);
  };
  const simDrag = (obj, getPos, dx, dy) => {
    const hp = screenOf(obj, getPos(obj));
    CV.setActiveObject(obj);
    CV.upperCanvasEl.dispatchEvent(mk(hp.x, hp.y, 'mousedown'));
    CV.upperCanvasEl.dispatchEvent(mk(hp.x + dx, hp.y + dy, 'mousemove'));
    docStub.dispatchEvent(mk(hp.x + dx, hp.y + dy, 'mouseup')); // fabric 把 mouseup 绑在 document
  };
  // 1) 缩放 2x + 平移下拖锚点
  M.select('ctext');
  M.onDown({ e: { clientX: 60, clientY: 250, button: 0 } });
  M.onMove({ e: { clientX: 200, clientY: 230, button: 0 } });
  M.onUp({ e: { clientX: 200, clientY: 230, button: 0 } });
  await tick();
  const ct1 = CV.getObjects().find(o => o.type === 'calloutText');
  CV.setViewportTransform([2, 0, 0, 2, 80, 30]);
  const s0 = screenOf(ct1, ct1.anchor);
  simDrag(ct1, o => o.anchor, 50, 30);
  await tick();
  const s1 = screenOf(ct1, ct1.anchor);
  check('缩放2x拖锚点：落点与鼠标一致', Math.abs(s1.x - (s0.x + 50)) < 0.01 && Math.abs(s1.y - (s0.y + 30)) < 0.01);
  // 2) 角点缩放 1.5x（bake 后 scale=1）再拖锚点越出包围盒
  ct1.set({ scaleX: 1.5, scaleY: 1.5 });
  CV.fire('object:modified', { target: ct1 });
  await tick();
  check('角点缩放被合并进内容（scale=1）', Math.abs(ct1.scaleX - 1) < 0.001);
  CV.setViewportTransform([1, 0, 0, 1, 0, 0]);
  const s2 = screenOf(ct1, ct1.anchor);
  simDrag(ct1, o => o.anchor, -45, 25);
  await tick();
  const s3 = screenOf(ct1, ct1.anchor);
  check('缩放后拖锚点越界：落点与鼠标一致', Math.abs(s3.x - (s2.x - 45)) < 0.01 && Math.abs(s3.y - (s2.y + 25)) < 0.01);
  CV.setViewportTransform([1, 0, 0, 1, 0, 0]);

  // ---- 3. 打开第二张图 → 多标签切换 ----
  upload();
  await tick();
  check('标签页 2 已打开', APP.tabs.length === 2 && APP.activeTabIndex === 1);
  check('新标签画布为空', rects().length === 0);
  // 打开标签 2 时 saveCurrentTab 已把标签 1 的历史同步到 tab.hist
  check('历史含初始+矩形 2 条', APP.tabs[0].hist.undo.length >= 2);
  const entryShape = (() => {
    try {
      const e = APP.tabs[0].hist.undo[APP.tabs[0].hist.undo.length - 1];
      return e && typeof e.objs === 'string' && e.objs.length > 0 &&
        Array.isArray(e.layers) && ('mosaic' in e);
    } catch (err) { return false; }
  })();
  check('历史条目 {objs,mosaic,layers}', entryShape);

  // 标签元素：children[0] 是「＋ 新图」按钮，之后是各 tab
  const tabEls = els.tabbar.children.slice(1);
  check('找到两个标签元素', tabEls.length === 2);

  // 切回标签 1
  tabEls[0].onclick();
  await tick();
  check('切回标签 1', APP.activeTabIndex === 0);
  check('标签 1 矩形仍在', rects().length === 1);
  check('标签 1 历史保留', APP.tabs[0].hist.undo.length >= 2);
  // 切回后标签 2 也被保存过 → 有初始历史
  check('新标签也有初始历史', APP.tabs[1].hist.undo.length >= 1);

  // 切到标签 2 并关闭（关闭的是当前标签页）
  tabEls[1].onclick();
  await tick();
  check('切到标签 2', APP.activeTabIndex === 1);
  const closeTwo = tabEls[1].children[0];
  closeTwo.onclick({ stopPropagation() {} });
  await tick();
  check('关闭标签 2', APP.tabs.length === 1 && APP.activeTabIndex === 0);
  check('关闭后矩形仍保留', rects().length === 1);

  // ---- 4. 撤销/重做（含图层） ----
  // 关闭后标签 1 已重新激活，模块级 hist 同步自 tabs[0].hist
  const histLen = APP.__hist.undo.length;
  CV.setActiveObject(rects()[0]);
  els.btnDel.onclick();
  await tick();
  check('删除后历史增长', APP.__hist.undo.length === histLen + 1);
  check('矩形已删除', rects().length === 0);
  els.btnUndo.onclick();
  await tick();
  check('撤销恢复矩形', rects().length === 1);
  els.btnRedo.onclick();
  await tick();
  check('重做再删除矩形', rects().length === 0);

  // ---- 5. 导出选项持久化 + 导出流程 ----
  // 定位「导出选项」区块，通过其中的 分辨率/JPG质量/包含外部 控件触发 onChange → saveUserData
  let exportSec = null;
  (function walk(e) {
    if (!e) return;
    if (e.className === 'sec' && e.children[0] && e.children[0].textContent === '导出选项') exportSec = e;
    (e.children || []).forEach(walk);
  })(els.panelContent);
  let scaleSel = null, jpgRange = null, includeCheck = null;
  (function collect(e) {
    if (!e) return;
    if (e.className === 'iselect') scaleSel = scaleSel || e;
    if (e.type === 'range') jpgRange = jpgRange || e;
    if (e.type === 'checkbox') includeCheck = includeCheck || e;
    (e.children || []).forEach(collect);
  })(exportSec);
  if (scaleSel) { scaleSel.value = '2'; scaleSel.dispatchEvent({ type: 'change' }); }
  if (jpgRange) { jpgRange.value = '60'; jpgRange.dispatchEvent({ type: 'input' }); } // rangeField 只监听 input
  if (includeCheck) { includeCheck.checked = false; includeCheck.dispatchEvent({ type: 'change' }); }
  let saved = JSON.parse(global.localStorage.getItem('anno-userdata') || '{}');
  check('exportOpts 通过面板持久化',
    saved.exportOpts && saved.exportOpts.scale === 2 &&
    Math.abs(saved.exportOpts.jpegQuality - 0.6) < 0.001 && saved.exportOpts.includeOutside === false);
  // 直接改 exportOpts 后走导出流程应无异常
  APP.exportOpts.scale = 1;
  let exportOk = true;
  try {
    els.btnExport.onclick();
    await tick();
  } catch (err) {
    exportOk = false;
    console.log('导出异常:', err && err.message);
  }
  check('导出（PNG）流程无异常', exportOk);

  // ---- 6. 图层操作进入历史 ----
  const layersBefore = APP.__hist.undo.length;
  els.btnAddLayer.onclick();
  await tick();
  check('新建图层进入历史', APP.__hist.undo.length === layersBefore + 1);
  check('新图层已创建', APP.layers.length >= 2 && APP.layers.some(l => l.name && l.name.indexOf('图层') === 0));
  // 撤销应移除新图层（图层操作可撤销）
  els.btnUndo.onclick();
  await tick();
  check('撤销移除新图层', !APP.layers.some(l => l.name && l.name.indexOf('图层 2') === 0));

  console.log('\napp smoke fails:', fails);
  process.exit(fails ? 1 : 0);
})().catch(err => {
  console.log('SMOKE CRASH:', err && err.stack || err);
  process.exit(1);
});
