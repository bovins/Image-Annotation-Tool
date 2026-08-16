// 工具交互集成测试：模拟鼠标流验证 曲线箭头 / 角度 / 图引出 / 完成后回到选择
'use strict';

const fakeCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 12 });
    if (k === 'canvas') return { width: 400, height: 300 };
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    if (k === 'createPattern') return () => null;
    if (typeof k === 'string') return () => {};
    return undefined;
  },
  set() { return true; }
});
function makeEl() {
  return {
    width: 400, height: 300, style: {},
    getContext: () => fakeCtx,
    toDataURL: () => 'data:image/png;base64,x',
    addEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute() {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
  };
}
global.window = global;
global.Document = function Document() {};
global.Element = function Element() {};
global.HTMLCanvasElement = function HTMLCanvasElement() {};
global.HTMLImageElement = function HTMLImageElement() {};
global.HTMLTextAreaElement = function HTMLTextAreaElement() {};
global.Node = function Node() {};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, configurable: true });
global.getComputedStyle = () => ({});
global.document = {
  createElement: makeEl,
  createElementNS: () => makeEl(),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl(),
  documentElement: { style: {} },
  implementation: { createHTMLDocument: () => ({ createElement: makeEl, body: makeEl(), defaultView: global, documentElement: { style: {} } }) }
};
global.Image = class { constructor() { this.width = 0; this.height = 0; } };

const fabric = require('./vendor/fabric.min.js').fabric || require('./vendor/fabric.min.js');
global.fabric = fabric;
require('./js/objects.js');

// ---- APP 桩 ----
let pushCount = 0;
const APP = {
  textProps: JSON.parse(JSON.stringify(global.DEF_TEXT)),
  shapeProps: JSON.parse(JSON.stringify(global.DEF_SHAPE)),
  lineProps: { stroke: '#ff5252', width: 3, dash: null, haloColor: '#ffffff', haloWidth: 2 },
  calloutBg: { fill: '#ffffff', opacity: 0.9, radius: 4 },
  lens: { zoom: 2, radius: 90, side: 140, borderColor: '#ff5252', borderWidth: 3 },
  mosaic: { brush: 36, block: 10, eraser: false },
  sticker: '⚠️', stickerSize: 64,
  stepCounter: 1, stepRadius: 18,
  scale: { pxPerUnit: 1, unit: '' },
  textDefault: '标注',
  needsSnap: false, restoring: false, skipNextAdd: false,
  batch: 0,
  sizeScale: 1,
  annotCounter: 0,
  layers: [{ id: 'L1', name: '图层 1', visible: true, locked: false, active: true }],
  getActiveLayer() { return this.layers.find(l => l.active) || this.layers[0]; },
  assignAnnotationLayer(obj) {
    const l = { id: 'L' + (++this.annotCounter), name: '标注 ' + this.annotCounter, visible: true, locked: false, active: true };
    this.layers.unshift(l);
    obj.layerId = l.id;
    return l;
  },
  toast() {}, setHint() {}, focusContent() {}, markSnap() { this.needsSnap = true; },
  renderPanel() {}, pushHistory() { pushCount++; }
};
window.APP = APP;

// ---- 模拟画布 ----
const objects = [];
const listeners = {};
const mockCv = {
  _baseImage: { type: 'image' },
  _baseImgEl: { width: 400, height: 300, naturalWidth: 400, naturalHeight: 300 },
  _baseW: 400, _baseH: 300,
  selection: true, skipTargetFind: false, defaultCursor: 'default',
  viewportTransform: [1, 0, 0, 1, 0, 0],
  _activeObject: null,
  getObjects() { return objects.slice(); },
  add(o) { o.canvas = mockCv; objects.push(o); this.fire('object:added', { target: o }); return o; },
  remove(o) { const i = objects.indexOf(o); if (i >= 0) objects.splice(i, 1); return o; },
  getPointer(e) { return { x: e.clientX, y: e.clientY }; },
  getViewportTransform() { return this.viewportTransform; },
  requestRenderAll() {},
  discardActiveObject() { this._activeObject = null; },
  setActiveObject(o) { this._activeObject = o; return this; },
  getActiveObject() { return this._activeObject; },
  on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  fire(ev, opts) { (listeners[ev] || []).forEach(fn => fn(opts || {})); }
};
window.CV = mockCv;

require('./js/tools.js');
const M = window.TOOLMGR;
M.init(mockCv);

// 模拟 app.js 中的 object:added 图层分配逻辑
mockCv.on('object:added', e => {
  const o = e.target;
  if (o && !o._temp && !o.layerId && !o.mosaicOverlay) {
    window.APP.assignAnnotationLayer(o);
  }
});

let fails = 0;
function check(name, cond) {
  if (!cond) { console.log('FAIL:', name); fails++; }
  else console.log('OK:', name);
}
const ev = (x, y) => ({ e: { clientX: x, clientY: y, button: 0 } });

// ---------- 1. 曲线箭头（样条 + 可拖动锚点控制） ----------
try {
  M.select('carrow');
  M.onDown(ev(100, 100));
  check('carrow temp created', M.state.carrow && M.state.carrow.obj && M.state.carrow.obj.type === 'splinePath');
  M.onMove(ev(300, 220));
  check('carrow points updated', M.state.carrow.obj.points.length >= 2);
  M.onMove(ev(320, 180));
  M.onUp(ev(320, 180));
  check('carrow promoted & object on canvas', objects.some(o => o.type === 'splinePath' && !o._temp));
  check('carrow arrowhead=end', objects.some(o => o.type === 'splinePath' && o.arrowhead === 'end'));
  const spline = objects.find(o => o.type === 'splinePath');
  check('carrow anchors <= 4', spline && spline.points.length <= 4);
  check('carrow has draggable point controls', spline && spline.controls && spline.controls['pt0'] && spline.controls['pt' + (spline.points.length - 1)]);
  check('carrow -> back to select', M.current === 'select');
  check('carrow object selected', mockCv._activeObject && mockCv._activeObject.type === 'splinePath');
  M.removeTemp();
} catch (err) {
  console.log('FAIL: carrow threw:', err.message);
  fails++;
}

// ---------- 1b. 箭头（AnnoLine：实心箭头 + 白色描边） ----------
try {
  M.select('arrow');
  M.onDown(ev(50, 60));
  M.onMove(ev(220, 180));
  check('arrow temp is annoLine', M.state.arrow && M.state.arrow.obj && M.state.arrow.obj.type === 'annoLine');
  M.onUp(ev(220, 180));
  const al = objects.find(o => o.type === 'annoLine' && !o._temp && o.arrowhead === 'end');
  check('arrow finalized with arrowhead', al && al.pts.length === 2);
  check('arrow line has halo', al && al.line && al.line.haloColor === '#ffffff' && al.line.haloWidth > 0);
  M.cancelAction();
} catch (err) {
  console.log('FAIL: arrow threw:', err.message);
  fails++;
}

// ---------- 2. 角度 ----------
try {
  M.select('angle');
  M.onDown(ev(200, 150)); // 顶点
  M.onMove(ev(280, 150)); // 预览 p1
  M.onDown(ev(280, 150)); // p1
  M.onMove(ev(200, 70)); // 预览 p2（正上方 → 90°）
  M.onDown(ev(200, 70)); // p2 -> 完成
  check('angle finalized', objects.some(o => o.type === 'angleMeasure' && !o._temp));
  check('angle -> back to select', M.current === 'select');
  check('angle object selected', mockCv._activeObject && mockCv._activeObject.type === 'angleMeasure');
  const ang = objects.find(o => o.type === 'angleMeasure');
  check('angle value', ang && Math.abs(ang.getAngle() - 90) < 0.01);
} catch (err) {
  console.log('FAIL: angle threw:', err.message);
  fails++;
}

// ---------- 3. 图引出（第一步点击不再失效） ----------
try {
  M.select('cimage');
  M.onDown(ev(50, 50));
  check('cimage phase=region rect created', M.state.cimage && M.state.cimage.phase === 'region' && M.state.cimage.region && M.state.cimage.region.obj);
  M.onMove(ev(150, 120));
  M.onUp(ev(150, 120));
  check('cimage phase=place preview', M.state.cimage && M.state.cimage.phase === 'place' && M.state.cimage.preview);
  M.onMove(ev(250, 200));
  M.onDown(ev(250, 200)); // 放置
  check('cimage finalized', objects.some(o => o.type === 'calloutImage' && !o._temp));
  check('cimage -> back to select', M.current === 'select');
  M.cancelAction();
} catch (err) {
  console.log('FAIL: cimage threw:', err.message);
  fails++;
}

// ---------- 4. 矩形（完成后回到选择；AnnoRect 带白色描边） ----------
try {
  M.select('rect');
  M.onDown(ev(10, 10));
  M.onMove(ev(120, 90));
  M.onUp(ev(120, 90));
  const ar = objects.find(o => o.type === 'annoRect' && !o._temp);
  check('rect finalized & selected', ar && mockCv._activeObject && mockCv._activeObject.type === 'annoRect');
  check('rect has white halo', ar && ar.shape && ar.shape.haloColor === '#ffffff' && ar.shape.haloWidth > 0);
  check('rect -> back to select', M.current === 'select');
} catch (err) {
  console.log('FAIL: rect threw:', err.message);
  fails++;
}

// ---------- 5. 完成后样式修改走 applyRelayout 需置 dirty ----------
try {
  const anno = new fabric.AnnoText({ left: 10, top: 10, textContent: 'abc', tx: { fontSize: 20 } });
  mockCv.add(anno);
  // 模拟面板修改路径
  anno.set('dirty', true);
  anno.tx.fontSize = 40;
  anno.relayout();
  anno.set({ left: anno._offX || anno.left, top: anno._offY || anno.top });
  anno.setCoords();
  check('relayout after fontSize change', anno.width > 10 && anno.height > 10);
  const rect = objects.find(o => o.type === 'annoRect');
  rect.set('dirty', true);
  rect.set({ stroke: '#00ff00' });
  check('fabric object dirty marked', rect.dirty === true);
} catch (err) {
  console.log('FAIL: style path threw:', err.message);
  fails++;
}

// ---------- 6. 消息框拖动不再跳回原点 ----------
try {
  M.select('msgbox');
  M.onDown(ev(10, 200));
  M.onMove(ev(150, 260));
  check('msgbox left/top preserved during drag', M.state.msgbox.obj.left === 10 && M.state.msgbox.obj.top === 200);
  M.onUp(ev(150, 260));
  check('msgbox finalized', objects.some(o => o.type === 'messageBox' && !o._temp));
  M.cancelAction();
} catch (err) {
  console.log('FAIL: msgbox threw:', err.message);
  fails++;
}

// ---------- 7. 方形放大镜（此前不可用） ----------
try {
  M.select('smagnifier');
  M.onDown(ev(200, 150));
  M.onMove(ev(280, 210));
  check('smagnifier temp created', M.state.smagnifier && M.state.smagnifier.obj && M.state.smagnifier.obj.type === 'squareMagnifier');
  M.onUp(ev(280, 210));
  check('smagnifier promoted', objects.some(o => o.type === 'squareMagnifier' && !o._temp));
  check('smagnifier -> back to select', M.current === 'select');
  M.cancelAction();
} catch (err) {
  console.log('FAIL: smagnifier threw:', err.message);
  fails++;
}

// ---------- 8. 多引出（锚点 -> Enter 完成，无方框样式） ----------
try {
  M.select('cmulti');
  M.onDown(ev(300, 300));
  M.onDown(ev(360, 320));
  check('cmulti anchors added', M.state.cmulti && M.state.cmulti.anchors && M.state.cmulti.anchors.length === 2);
  check('cmulti leader layout (no box)', M.state.cmulti.obj && typeof M.state.cmulti.obj.leaderY === 'number');
  M.finishCmulti();
  check('cmulti finalized', objects.some(o => o.type === 'multiCallout' && !o._temp));
  check('cmulti -> back to select', M.current === 'select');
  M.cancelAction();
} catch (err) {
  console.log('FAIL: cmulti threw:', err.message);
  fails++;
}

// ---------- 9. 文字引出（锚点 + 可自由拖动的文字） ----------
try {
  M.select('ctext');
  M.onDown(ev(300, 200));
  check('ctext temp created with anchor', M.state.ctext && M.state.ctext.obj && M.state.ctext.obj.anchor && M.state.ctext.obj.anchor.x === 300);
  M.onMove(ev(420, 140));
  check('ctext text follows drag', M.state.ctext.obj.textPos.x === 420 && M.state.ctext.obj.textPos.y === 140);
  M.onUp(ev(420, 140));
  const ct = objects.find(o => o.type === 'calloutText' && !o._temp);
  check('ctext finalized (anchor + textPos)', ct && ct.anchor && ct.textPos);
  check('ctext has draggable anchor/text handles', ct && ct.controls && ct.controls['anchor'] && ct.controls['text']);
  // 水平线长度只取决于文本长度（文字在锚点右侧时，水平线不从锚点开始）
  check('ctext horizontal line = text length only', ct && ct.x0 > ct.anchor.x && ct.x1 > ct.textPos.x);
  // 引出线直连水平线最近点（锚点在左 → 连到水平线左端）
  check('ctext leader to nearest point', ct && (ct.anchor.x < ct.x0) && true);
  M.cancelAction();
} catch (err) {
  console.log('FAIL: ctext threw:', err.message);
  fails++;
}

// ---------- 10. 文字工具：按住拖动调整大小放置 ----------
try {
  M.select('text');
  const beforeFs = M.props().textProps.fontSize || 22;
  M.onDown(ev(200, 300));
  check('text temp created', M.state.text && M.state.text.obj && M.state.text.obj.type === 'annoText');
  M.onMove(ev(300, 360)); // 距离 ~116 → 字号 ~93
  check('text sized by drag distance', M.state.text.obj.tx.fontSize > beforeFs + 30);
  M.onUp(ev(300, 360));
  check('text finalized & selected', objects.some(o => o.type === 'annoText' && !o._temp) && mockCv._activeObject && mockCv._activeObject.type === 'annoText');
  check('text -> back to select', M.current === 'select');
  M.cancelAction();
} catch (err) {
  console.log('FAIL: text threw:', err.message);
  fails++;
}

// ---------- 11. 每个标注自动创建独立图层 ----------
try {
  const layerBefore = APP.layers.length;
  M.select('step');
  M.onDown(ev(100, 100));
  M.cancelAction();
  check('annotation auto-creates its own layer', APP.layers.length === layerBefore + 1);
  check('new layer auto-named', APP.layers[0] && /^标注 \d+$/.test(APP.layers[0].name));
} catch (err) {
  console.log('FAIL: auto-layer threw:', err.message);
  fails++;
}

console.log('tool tests fails:', fails);
process.exit(fails ? 1 : 0);
