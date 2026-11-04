/* Editing workflows: preferences and compatible style transfer, no geometry copied. */
(function () {
  'use strict';
  const A = window.APP, C = window.CV, F = window.fabric;
  const copy = value => JSON.parse(JSON.stringify(value));
  const defaults = () => ({ textProps: copy(A.textProps), shapeProps: copy(A.shapeProps),
    lineProps: copy(A.lineProps), calloutBg: copy(A.calloutBg), shadow: A.annoShadowOn });
  const builtin = [
    { name: '机械尺寸', style: { textProps: { fontSize: 18, fontFamily: 'Arial', fill: '#222222' }, lineProps: { stroke: '#222222', width: 1, haloWidth: 0, dash: null }, shapeProps: { stroke: '#222222', strokeWidth: 1, haloWidth: 0 }, shadow: false } },
    { name: '问题反馈', style: { textProps: { fontSize: 26, fill: '#e53935', fontWeight: 'bold' }, lineProps: { stroke: '#e53935', width: 4, haloWidth: 2 }, shapeProps: { stroke: '#e53935', strokeWidth: 3 }, shadow: true } },
    { name: '论文插图', style: { textProps: { fontSize: 20, fontFamily: 'Arial', fill: '#222222', fontWeight: 'normal' }, lineProps: { stroke: '#222222', width: 2, haloWidth: 0, dash: null }, shapeProps: { stroke: '#222222', strokeWidth: 2, haloWidth: 0 }, shadow: false } }
  ];
  let userPresets = [], clipboard = null;
  function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { A.toast('浏览器偏好存储不可用，请导出预设 JSON 备份'); }
  }
  const prefs = load('anno-efficiency', {});
  A.continuous = prefs.continuous === true; A.snapEnabled = prefs.snapEnabled === true;
  const schema = { textProps: window.DEF_TEXT, shapeProps: window.DEF_SHAPE, lineProps: A.lineProps, calloutBg: window.DEF_BG };
  function validateStyle(style) {
    if (!style || typeof style !== 'object') throw new Error('样式结构无效');
    const result = {};
    Object.keys(schema).forEach(section => {
      if (!style[section]) return;
      result[section] = {};
      Object.keys(schema[section]).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(style[section], key)) return;
        const value = style[section][key], model = schema[section][key];
        if (typeof value === 'number') {
          if (!Number.isFinite(value) || Math.abs(value) > 4096 || value < 0) throw new Error('样式数值无效：' + key);
        } else if (typeof value === 'string') {
          if (value.length > 200 || /url\s*\(/i.test(value)) throw new Error('样式字符串无效');
        } else if (Array.isArray(value)) {
          if (value.length > 20 || value.some(n => !Number.isFinite(n) || n < 0 || n > 4096)) throw new Error('线形无效');
        } else if (typeof value !== 'boolean' && value !== null) throw new Error('样式字段类型无效');
        if (model !== null && typeof model !== typeof value) throw new Error('样式字段类型不匹配：' + key);
        result[section][key] = copy(value);
      });
    });
    if (typeof style.shadow === 'boolean') result.shadow = style.shadow;
    return result;
  }
  function validatePresets(data) {
    if (!data || data.app !== 'image-annotator-presets' || data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > 100) throw new Error('预设格式无效（最多 100 项）');
    const names = new Set();
    return data.presets.map(p => {
      if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || names.has(p.name)) throw new Error('预设名称为空、重复或过长');
      names.add(p.name); return { name: p.name.trim(), style: validateStyle(p.style) };
    });
  }
  try { userPresets = validatePresets({ app: 'image-annotator-presets', version: 1, presets: load('anno-presets', []) }); } catch (_) {}
  function applyDefaults(style) {
    const valid = validateStyle(style);
    Object.keys(schema).forEach(k => { if (valid[k]) Object.assign(A[k], copy(valid[k])); });
    if (valid.shadow != null) A.annoShadowOn = valid.shadow;
    A.savePreferences(); A.renderPanel(); A.toast('已设为新标注默认样式');
  }
  function applyStyle(style, targets) {
    const valid = validateStyle(style), objects = (targets || C.getActiveObjects()).slice();
    if (!objects.length) { A.toast('请先选择标注'); return; }
    A.flushHistory(); C.discardActiveObject();
    objects.forEach(o => {
      if (o.tx && valid.textProps) Object.assign(o.tx, copy(valid.textProps));
      if (o.shape && valid.shapeProps) Object.assign(o.shape, copy(valid.shapeProps));
      if (o.bg && valid.calloutBg) Object.assign(o.bg, copy(valid.calloutBg));
      if (o.line && valid.lineProps) {
        const p = valid.lineProps;
        if (p.stroke != null) o.line.color = p.stroke;
        ['width', 'dash', 'haloColor', 'haloWidth'].forEach(k => { if (k in p) o.line[k] = copy(p[k]); });
      }
      if (['line', 'path'].includes(o.type) && valid.lineProps) {
        const p = valid.lineProps;
        if (p.stroke != null) o.set('stroke', p.stroke);
        if (p.width != null) o.set('strokeWidth', p.width);
        if ('dash' in p) o.set('strokeDashArray', p.dash);
      }
      if (o.type === 'rect' && valid.shapeProps) {
        const p = valid.shapeProps;
        ['stroke', 'strokeWidth'].forEach(k => { if (k in p) o.set(k, p[k]); });
      }
      if (valid.shadow != null) o.set('shadow', valid.shadow ? new F.Shadow(A.annoShadow) : null);
      if (o.relayout) A.applyRelayout(o); else { o.set('dirty', true); o.setCoords(); }
    });
    C.setActiveObject(objects.length > 1 ? new F.ActiveSelection(objects, { canvas: C }) : objects[0]);
    C.requestRenderAll(); A.markSnap(); A.pushHistory(); A.renderPanel();
  }
  function copyStyle() {
    const o = C.getActiveObjects()[0];
    if (!o) { A.toast('请先选择标注'); return; }
    clipboard = {};
    if (o.tx) clipboard.textProps = copy(o.tx);
    if (o.shape) clipboard.shapeProps = copy(o.shape);
    if (o.bg) clipboard.calloutBg = copy(o.bg);
    if (o.line) clipboard.lineProps = { stroke: o.line.color, width: o.line.width, dash: o.line.dash, haloColor: o.line.haloColor, haloWidth: o.line.haloWidth };
    if (['line', 'path'].includes(o.type)) clipboard.lineProps = { stroke: o.stroke, width: o.strokeWidth, dash: o.strokeDashArray };
    if (o.type === 'rect') clipboard.shapeProps = { stroke: o.stroke, strokeWidth: o.strokeWidth };
    clipboard.shadow = !!o.shadow; A.toast('样式已复制（不含位置、内容和图片）');
  }
  function pasteStyle() { clipboard ? applyStyle(clipboard) : A.toast('请先复制样式'); }
  function button(text, action, title) {
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = text; b.title = title || text; b.onclick = action; return b;
  }
  function label(text, input) { const l = document.createElement('label'); l.className = 'workflow-label'; l.append(text, input); return l; }
  function toggle(text, key) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = A[key];
    input.onchange = () => { A[key] = input.checked; store('anno-efficiency', { continuous: A.continuous, snapEnabled: A.snapEnabled }); };
    return label(text, input);
  }
  function render() {
    const box = document.getElementById('efficiencyBox'), previous = box.querySelector('details');
    const expanded = !!(previous && previous.open); box.replaceChildren();
    box.append(toggle('保持当前工具（连续标注）', 'continuous'), toggle('吸附（7 屏幕像素）', 'snapEnabled'));
    box.append(button('两点比例标定', () => TOOLMGR.select('calibrate'), '点击已知长度的两端；Esc 取消；照片可能有透视误差'));
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '样式预设'; details.append(summary);
    details.open = expanded;
    const select = document.createElement('select'); select.id = 'presetSelect';
    builtin.concat(userPresets).forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name + (i < builtin.length ? '（内置）' : ''); select.append(o); });
    const selected = () => builtin.concat(userPresets)[Number(select.value)];
    details.append(select, button('设为默认', () => applyDefaults(selected().style)), button('应用到选中', () => applyStyle(selected().style)),
      button('新建预设', () => {
        const name = window.prompt('预设名称（保存当前默认样式）', '我的预设');
        if (!name || !name.trim()) return;
        if (name.length > 80 || builtin.concat(userPresets).some(p => p.name === name.trim()) || userPresets.length >= 100) { A.toast('名称重复、过长或预设过多'); return; }
        userPresets.push({ name: name.trim(), style: defaults() }); save();
      }), button('更新', () => {
        const p = selected(); if (Number(select.value) < builtin.length) { A.toast('内置预设请另存为用户预设'); return; }
        p.style = defaults(); save();
      }), button('删除', () => {
        const i = Number(select.value) - builtin.length;
        if (i < 0) { A.toast('内置预设不可删除'); return; }
        userPresets.splice(i, 1); save();
      }), button('复制样式', copyStyle), button('粘贴样式', pasteStyle),
      button('导出预设', () => A.downloadBlob(new Blob([JSON.stringify({ app: 'image-annotator-presets', version: 1, presets: userPresets }, null, 2)], { type: 'application/json' }), 'annotation-presets.json')));
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.hidden = true;
    input.onchange = async () => {
      try {
        const file = input.files[0]; if (!file) return;
        if (file.size > 262144) throw new Error('预设文件过大');
        const incoming = validatePresets(JSON.parse(await file.text()));
        const merged = userPresets.slice(); incoming.forEach(p => { const i = merged.findIndex(x => x.name === p.name); if (i >= 0) merged[i] = p; else merged.push(p); });
        if (merged.length > 100) throw new Error('预设总数超过 100'); userPresets = merged; save();
      } catch (err) { A.toast('预设导入失败：' + err.message); }
    };
    details.append(button('导入预设', () => input.click()), input); box.append(details);
  }
  function save() { store('anno-presets', userPresets); render(); }
  const layerTools = document.createElement('div'); layerTools.className = 'layer-tools';
  [['批量显隐', 'visible'], ['批量锁定', 'lock'], ['逻辑分组', 'group'], ['批量删除', 'delete']].forEach(([title, action]) => layerTools.append(button(title, () => A.batchLayers(action))));
  document.querySelector('.layers-box').insertBefore(layerTools, document.getElementById('layersList'));
  const menu = document.createElement('div'); menu.className = 'context-menu'; menu.hidden = true;
  function order(delta) {
    const objects = C.getActiveObjects().slice(); if (!objects.length) return;
    C.discardActiveObject();
    const ids = new Set(objects.map(o => o.layerId));
    const ordered = A.layers.filter(l => ids.has(l.id)); if (delta > 0) ordered.reverse();
    ordered.forEach(l => { const i = A.layers.indexOf(l), j = Math.max(0, Math.min(A.layers.length - 1, i - delta)); A.layers.splice(i, 1); A.layers.splice(j, 0, l); });
    A.applyLayerOrder(); A.renderLayers(); A.pushHistory();
  }
  [['复制对象', () => A.duplicateSelection()], ['删除', () => A.deleteSelection()], ['上移一层', () => order(1)], ['下移一层', () => order(-1)], ['复制样式', copyStyle], ['粘贴样式', pasteStyle]].forEach(([title, action]) => menu.append(button(title, () => { menu.hidden = true; action(); })));
  document.body.append(menu);
  document.getElementById('canvasWrap').addEventListener('contextmenu', e => {
    if (TOOLMGR.current !== 'select') return;
    const target = C.findTarget(e); if (target && target.selectable && target !== C._baseImage) C.setActiveObject(target);
    if (!C.getActiveObjects().length) return;
    menu.hidden = false; menu.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - 170)) + 'px'; menu.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - 240)) + 'px';
  });
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) menu.hidden = true; });
  window.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229 || e.target.closest('input,textarea,select,[contenteditable=true]')) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['c', 'v'].includes(e.key.toLowerCase())) { e.preventDefault(); e.key.toLowerCase() === 'c' ? copyStyle() : pasteStyle(); }
    if (e.key === 'Escape') menu.hidden = true;
  });
  Object.assign(A, { applyStyle, copyStyle, pasteStyle, applyPresetDefaults: applyDefaults, validatePresets });
  function snapObject(target) {
    if (!A.snapEnabled || !target || target._temp || A.restoring) return;
    const members = target.type === 'activeSelection' ? target.getObjects() : [target];
    const b = ExportRenderer.bounds(target, false), tolerance = 7 / (C.getZoom() || 1);
    const xs = [0, C._baseW / 2, C._baseW], ys = [0, C._baseH / 2, C._baseH];
    C.getObjects().filter(o => o !== C._baseImage && !o._temp && o.visible !== false && !members.includes(o) && o !== target).forEach(o => {
      const p = ExportRenderer.bounds(o, false); xs.push(p.left, (p.left + p.right) / 2, p.right); ys.push(p.top, (p.top + p.bottom) / 2, p.bottom);
    });
    function delta(anchors, candidates) {
      let best = Infinity; anchors.forEach(a => candidates.forEach(v => { if (Math.abs(v - a) < Math.abs(best)) best = v - a; }));
      return Math.abs(best) <= tolerance ? best : 0;
    }
    target.set({ left: target.left + delta([b.left, (b.left + b.right) / 2, b.right], xs),
      top: target.top + delta([b.top, (b.top + b.bottom) / 2, b.bottom], ys) }); target.setCoords();
  }
  A.snapObject = snapObject;
  C.on('object:moving', e => snapObject(e.target));
  render();
})();
