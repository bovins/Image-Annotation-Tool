// 集成渲染测试：StaticCanvas + 自定义对象 渲染/序列化/还原
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
    toDataURL: () => 'data:image/png;base64,AAA',
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

let fails = 0;
function check(name, cond) {
  if (!cond) { console.log('FAIL:', name); fails++; }
  else console.log('OK:', name);
}

try {
  const sc = new fabric.StaticCanvas(makeEl(), { enableRetinaScaling: false, backgroundColor: '#e9ebef' });
  sc.setDimensions({ width: 400, height: 300 });
  sc.viewportTransform = [1, 0, 0, 1, 0, 0];

  const make = (cls, opts) => {
    const o = new fabric[cls](opts);
    sc.add(o);
    return o;
  };
  make('AnnoText', { left: 10, top: 10, textContent: '文字ABC', tx: { fontSize: 24, letterSpacing: 2, underline: true, outlineWidth: 2 } });
  make('MessageBox', { left: 10, top: 60, boxW: 180, boxH: 60, textContent: '消息', shape: { fillColor: '#fff', fillOpacity: 1, cornerRadius: 10 } });
  make('StepNumber', { left: 60, top: 140, originX: 'center', originY: 'center', number: 5, radius: 20 });
  make('CalloutText', { left: 0, top: 0, anchor: { x: 40, y: 180 }, textPos: { x: 130, y: 150 }, textContent: '引出' });
  make('MultiCallout', { left: 0, top: 0, anchors: [{ x: 10, y: 220 }, { x: 80, y: 230 }], textContent: '多引' });
  make('CalloutRegion', { left: 0, top: 0, ellipse: { x: 180, y: 120, rx: 50, ry: 34 }, boxPos: { x: 250, y: 100 }, textContent: '区域' });
  make('CalloutImage', { left: 0, top: 0, region: { x: 20, y: 250, w: 60, h: 40 }, boxPos: { x: 100, y: 250 }, imgSrc: null });
  make('Dimension', { left: 0, top: 0, p1: { x: 200, y: 200 }, p2: { x: 320, y: 200 } });
  make('AngleMeasure', { left: 0, top: 0, v: { x: 220, y: 80 }, p1: { x: 280, y: 80 }, p2: { x: 220, y: 30 } });
  make('AreaMeasure', { left: 0, top: 0, points: [{ x: 250, y: 30 }, { x: 340, y: 30 }, { x: 340, y: 90 }, { x: 250, y: 90 }] });
  make('SplinePath', { left: 0, top: 0, points: [{ x: 30, y: 40 }, { x: 90, y: 60 }, { x: 150, y: 30 }], arrowhead: 'end', line: { color: '#f00', width: 3 } });
  make('AnnoLine', { left: 0, top: 0, pts: [{ x: 10, y: 120 }, { x: 180, y: 120 }], arrowhead: 'end', line: { color: '#0a0', width: 3, haloColor: '#ffffff', haloWidth: 2 } });
  make('AnnoRect', { left: 0, top: 0, rect: { x: 20, y: 160, w: 90, h: 50 }, shape: { stroke: '#00f', strokeWidth: 2, cornerRadius: 6, haloColor: '#ffffff', haloWidth: 2 } });
  const mag = make('Magnifier', { left: 120, top: 120, originX: 'center', originY: 'center', radius: 60, zoom: 2 });
  mag._canvasRef = sc;
  make('SquareMagnifier', { left: 300, top: 150, originX: 'center', originY: 'center', side: 80, zoom: 2 });
  const rect = make('Rect', { left: 10, top: 220, width: 60, height: 40, fill: 'rgba(255,0,0,0.4)', stroke: '#000', strokeWidth: 2 });
  const line = new fabric.Line([20, 260, 90, 260], { stroke: '#0f0', strokeWidth: 3 });
  sc.add(line);
  const path = new fabric.Path('M 100 250 L 160 250 L 150 244 L 160 250 L 150 256 Z', { stroke: '#00f', strokeWidth: 2, fill: 'transparent' });
  sc.add(path);

  // 渲染
  sc.renderAll();
  check('renderAll with all objects', true);
  check('rect renders', rect.width === 60);
  check('line renders', line.stroke === '#0f0');

  // 渲染
  sc.renderAll();
  check('renderAll with all objects', true);
  check('rect renders', rect.width === 60);
  check('line renders', line.stroke === '#0f0');

  // 放大镜快照
  let snap = null;
  try { snap = sc.toCanvasElement(1); check('toCanvasElement', !!snap); } catch (e) { check('toCanvasElement failed: ' + e.message, false); }
  if (snap) { mag._snap = snap; sc.renderAll(); check('magnifier render with snap', true); }

  // 序列化 + 还原
  const dimObj = sc.getObjects().find(o => o.type === 'dimension');
  if (dimObj) dimObj.shadow = { color: 'rgba(0,0,0,0.4)', blur: 3, offsetX: 1.5, offsetY: 1.5 };
  const json = sc.toJSON(['mosaicOverlay', 'fillColor', 'fillOpacity', 'cornerRadius', 'lockScalingX', 'lockScalingY', 'minScaleLimit', 'layerId']);
  check('toJSON has objects', Array.isArray(json.objects) && json.objects.length >= 15);
  check('toJSON excludes magnifier snapshot', json.objects.every(o => !('_snap' in o)));

  const sc2 = new fabric.StaticCanvas(makeEl(), { enableRetinaScaling: false });
  sc2.loadFromJSON(JSON.parse(JSON.stringify(json)), () => {
    const restoredTypes = sc2.getObjects().map(o => o.type).join(',');
    const jsonTypes = json.objects.map(o => o.type).join(',');
    console.log('JSON types:', jsonTypes);
    console.log('RESTORED types:', restoredTypes);
    check('loadFromJSON count', sc2.getObjects().length === json.objects.length);
    sc2.getObjects().forEach(o => {
      if (o.type === 'magnifier' || o.type === 'squareMagnifier') o._canvasRef = sc2;
    });
    sc2.renderAll();
    check('re-render after load', true);
    // 还原后尺寸与序列化一致
    const anno = sc2.getObjects().find(o => o.type === 'annoText');
    check('annoText text preserved', anno && anno.textContent === '文字ABC');
    check('annoText tx preserved', anno && anno.tx && anno.tx.fontSize === 24);
    const dim = sc2.getObjects().find(o => o.type === 'dimension');
    check('dimension label', dim && dim.label() === '120 px');
    check('shadow roundtrip', dim && dim.shadow && dim.shadow.color === 'rgba(0,0,0,0.4)');
    const area = sc2.getObjects().find(o => o.type === 'areaMeasure');
    check('area label', area && area.label().includes('5400'));
    check('area shoelace', area && area.area() === 5400);
    const ang = sc2.getObjects().find(o => o.type === 'angleMeasure');
    check('angle value ~90', ang && Math.abs(ang.getAngle() - 90) < 0.5);
    // 样条：控制点屏幕位置 + 锚点拖动换算
    const spl = sc2.getObjects().find(o => o.type === 'splinePath');
    check('spline restored with controls', spl && spl.controls && spl.controls['pt0'] && spl.controls['pt2']);
    if (spl) {
      const vt = sc2.viewportTransform;
      const full = fabric.util.multiplyTransformMatrices(vt, spl.calcTransformMatrix());
      const local = spl.pointToLocal(spl.points[1]);
      const expectScreen = fabric.util.transformPoint(local, full);
      const oCoord = spl.oCoords && spl.oCoords['pt1'];
      check('spline pt1 handle position', oCoord && Math.abs(oCoord.x - expectScreen.x) < 1 && Math.abs(oCoord.y - expectScreen.y) < 1);
      const before = { x: spl.points[1].x, y: spl.points[1].y };
      const otherBefore = [
        { x: spl.points[0].x, y: spl.points[0].y },
        { x: spl.points[2].x, y: spl.points[2].y }
      ];
      // 增量式拖动：同一 transform（按下点 ex/ey）跨多次移动复用
      const tr = { target: spl, ex: expectScreen.x, ey: expectScreen.y };
      spl.controls['pt1'].actionHandler({}, tr, expectScreen.x + 30, expectScreen.y - 20);
      const after = spl.points[1];
      check('spline pt1 dragged correctly', Math.abs(after.x - (before.x + 30)) < 2 && Math.abs(after.y - (before.y - 20)) < 2);
      check('spline other points stay fixed',
        Math.abs(spl.points[0].x - otherBefore[0].x) < 0.001 && Math.abs(spl.points[0].y - otherBefore[0].y) < 0.001 &&
        Math.abs(spl.points[2].x - otherBefore[1].x) < 0.001 && Math.abs(spl.points[2].y - otherBefore[1].y) < 0.001);
      // 后续拖动：继续按增量累加
      spl.controls['pt1'].actionHandler({}, tr, expectScreen.x + 60, expectScreen.y - 40);
      const after2 = spl.points[1];
      check('spline pt1 drag continues', Math.abs(after2.x - (after.x + 30)) < 2 && Math.abs(after2.y - (after.y - 20)) < 2);
      // 其他点的手柄屏幕位置也不得变化
      spl.setCoords();
      const o0 = spl.oCoords && spl.oCoords['pt0'];
      const expect0 = fabric.util.transformPoint(spl.pointToLocal(spl.points[0]),
        fabric.util.multiplyTransformMatrices(sc2.viewportTransform, spl.calcTransformMatrix()));
      check('spline other handles stay put', o0 && Math.abs(o0.x - expect0.x) < 1 && Math.abs(o0.y - expect0.y) < 1);
    }
    const ct = sc2.getObjects().find(o => o.type === 'calloutText');
    check('callout anchor/text handles', ct && ct.controls && ct.controls['anchor'] && ct.controls['text']);
    if (ct) {
      const oa = ct.oCoords && ct.oCoords['anchor'];
      const ot = ct.oCoords && ct.oCoords['text'];
      check('callout handle positions computed', oa && ot && oa.x > 0 && ot.x > 0);
      // 拖动锚点 → 文字原地不动；拖动文字 → 锚点原地不动
      const a0 = { x: ct.anchor.x, y: ct.anchor.y };
      const t0 = { x: ct.textPos.x, y: ct.textPos.y };
      const trA = { target: ct, ex: oa.x, ey: oa.y };
      ct.controls['anchor'].actionHandler({}, trA, oa.x + 20, oa.y + 15);
      check('callout drag anchor: text stays fixed',
        Math.abs(ct.anchor.x - (a0.x + 20)) < 2 && Math.abs(ct.anchor.y - (a0.y + 15)) < 2 &&
        Math.abs(ct.textPos.x - t0.x) < 0.001 && Math.abs(ct.textPos.y - t0.y) < 0.001);
      ct.setCoords();
      const ot2 = ct.oCoords && ct.oCoords['text'];
      const trT = { target: ct, ex: ot2.x, ey: ot2.y };
      ct.controls['text'].actionHandler({}, trT, ot2.x - 25, ot2.y + 10);
      check('callout drag text: anchor stays fixed',
        Math.abs(ct.textPos.x - (t0.x - 25)) < 2 && Math.abs(ct.textPos.y - (t0.y + 10)) < 2 &&
        Math.abs(ct.anchor.x - (a0.x + 20)) < 0.001 && Math.abs(ct.anchor.y - (a0.y + 15)) < 0.001);
      // 实时几何：拖动过程中引出线立即跟随新文字位置（无需等松手重算）
      check('callout leader follows text in realtime',
        Math.abs(ct.leaderY - (ct.textPos.y + ct.textH)) < 0.001 &&
        Math.abs(ct.x0 - (ct.textPos.x - ct.pad)) < 0.001);
    }
    console.log('integration fails:', fails);
    process.exit(fails ? 1 : 0);
  });
} catch (err) {
  console.log('INTEGRATION CRASH:', err && err.stack || err);
  process.exit(1);
}
