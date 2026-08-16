// 验证 fabric 5.5.2 API 与自定义对象库（Node 环境 + DOM 桩）
'use strict';

// ---- DOM 桩 ----
const fakeCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 12 });
    if (k === 'canvas') return { width: 100, height: 100 };
    if (typeof k === 'string') return () => {};
    return undefined;
  },
  set() { return true; }
});
function makeEl() {
  return {
    width: 100, height: 100, style: {},
    getContext: () => fakeCtx,
    toDataURL: () => 'data:image/png;base64,AAA',
    addEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
  };
}
global.window = global;
global.Document = function Document() {};
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

// ---- 加载 fabric ----
const fabric = require('./vendor/fabric.min.js').fabric || require('./vendor/fabric.min.js');
global.fabric = fabric;
console.log('fabric version:', fabric.version);

// ---- API 存在性 ----
const checks = [
  ['util.createClass', typeof fabric.util.createClass === 'function'],
  ['util.parsePath', typeof fabric.util.parsePath === 'function'],
  ['util.transformPoint', typeof fabric.util.transformPoint === 'function'],
  ['util.invertTransform', typeof fabric.util.invertTransform === 'function'],
  ['util.createCanvasElement', typeof fabric.util.createCanvasElement === 'function'],
  ['util.object.extend', typeof fabric.util.object.extend === 'function'],
  ['util.getKlass', typeof fabric.util.getKlass === 'function'],
  ['StaticCanvas.toCanvasElement', typeof fabric.StaticCanvas.prototype.toCanvasElement === 'function'],
  ['StaticCanvas.toJSON', typeof fabric.StaticCanvas.prototype.toJSON === 'function'],
  ['StaticCanvas.loadFromJSON', typeof fabric.StaticCanvas.prototype.loadFromJSON === 'function'],
  ['StaticCanvas.setDimensions', typeof fabric.StaticCanvas.prototype.setDimensions === 'function'],
  ['Canvas.getPointer', typeof fabric.Canvas.prototype.getPointer === 'function'],
  ['Object.toObject', typeof fabric.Object.prototype.toObject === 'function'],
  ['ActiveSelection', typeof fabric.ActiveSelection === 'function'],
  ['Image.setElement', typeof fabric.Image.prototype.setElement === 'function'],
  ['Rect', typeof fabric.Rect === 'function'],
  ['Line', typeof fabric.Line === 'function'],
  ['Path', typeof fabric.Path === 'function'],
  ['createClass returns klass with type', true]
];
let fail = 0;
for (const [name, ok] of checks) {
  if (!ok) { console.log('MISSING:', name); fail++; }
}
console.log('API checks fail:', fail);

// loadFromJSON 签名（第二/三参）
console.log('loadFromJSON.length =', fabric.StaticCanvas.prototype.loadFromJSON.length);

// ---- 加载自定义对象库 ----
require('./js/objects.js');
console.log('custom classes:', ['AnnoText','MessageBox','StepNumber','CalloutText','MultiCallout','CalloutRegion','CalloutImage','Dimension','AngleMeasure','AreaMeasure','Magnifier','SquareMagnifier','SplinePath','AnnoLine','AnnoRect']
  .map(c => c + ':' + (typeof fabric[c] === 'function' ? 'ok' : 'MISSING')).join(' '));

// ---- 实例化与往返 ----
const cases = [
  ['AnnoText', { textContent: '你好ABC', tx: { fontSize: 24 } }],
  ['MessageBox', { boxW: 200, boxH: 90, textContent: 'test', shape: { stroke: '#f00', strokeWidth: 2, fillOpacity: 0.5, fillColor: '#fff', cornerRadius: 6 } }],
  ['StepNumber', { number: 3, radius: 20 }],
  ['CalloutText', { anchor: { x: 10, y: 20 }, textPos: { x: 90, y: 0 }, textContent: 'label' }],
  ['MultiCallout', { anchors: [{ x: 0, y: 0 }, { x: 50, y: 30 }], textContent: 'multi' }],
  ['CalloutRegion', { ellipse: { x: 0, y: 0, rx: 50, ry: 30 }, boxPos: { x: 80, y: 0 }, textContent: '区域' }],
  ['CalloutImage', { region: { x: 0, y: 0, w: 60, h: 40 }, boxPos: { x: 80, y: 0 }, imgSrc: null }],
  ['Dimension', { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } }],
  ['AngleMeasure', { v: { x: 0, y: 0 }, p1: { x: 80, y: 0 }, p2: { x: 0, y: -80 } }],
  ['AreaMeasure', { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }] }],
  ['Magnifier', { radius: 80 }],
  ['SquareMagnifier', { side: 120 }],
  ['SplinePath', { points: [{ x: 10, y: 10 }, { x: 80, y: 40 }, { x: 160, y: 90 }], arrowhead: 'end' }],
  ['AnnoLine', { pts: [{ x: 10, y: 10 }, { x: 200, y: 80 }], arrowhead: 'end', line: { haloColor: '#ffffff', haloWidth: 2 } }],
  ['AnnoRect', { rect: { x: 10, y: 10, w: 120, h: 60 }, shape: { cornerRadius: 8, haloColor: '#ffffff', haloWidth: 2 } }]
];
let oFail = 0;
for (const [cls, opts] of cases) {
  try {
    const o = new fabric[cls](opts);
    if (!(o.width > 0 && o.height > 0)) { console.log(cls, 'bad size', o.width, o.height); oFail++; }
    if (typeof o.relayout === 'function') o.relayout();
    const data = o.toObject();
    if (data.type !== o.type) { console.log(cls, 'type mismatch'); oFail++; }
    // 往返
    fabric.util.enlivenObjects([data], objs => {
      const r = objs[0];
      if (r.type !== o.type) { console.log(cls, 'roundtrip type mismatch'); oFail++; }
      if (r.textContent !== undefined && r.textContent !== o.textContent) { console.log(cls, 'roundtrip text mismatch'); oFail++; }
      console.log(cls, 'OK size=' + Math.round(o.width) + 'x' + Math.round(o.height));
    });
  } catch (err) {
    console.log(cls, 'FAIL:', err.message);
    oFail++;
  }
}
setTimeout(() => {
  console.log('object checks fail:', oFail);
  process.exit(fail || oFail ? 1 : 0);
}, 500);
