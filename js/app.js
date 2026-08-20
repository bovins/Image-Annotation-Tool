/* app.js — 应用主逻辑：画布初始化 / 属性面板 / 历史记录 / 导出 / 工程存取 */
(function () {
  const F = fabric;

  /* ---------- 默认属性 ---------- */
  function deepCopy(o) {
    if (Array.isArray(o)) return o.map(deepCopy);
    if (o && typeof o === 'object') {
      const r = {};
      for (const k in o) r[k] = deepCopy(o[k]);
      return r;
    }
    return o;
  }

  const APP = {
    textProps: deepCopy(window.DEF_TEXT),
    shapeProps: deepCopy(window.DEF_SHAPE),
    lineProps: { stroke: '#ff5252', width: 3, dash: null, haloColor: '#ffffff', haloWidth: 2 },
    calloutBg: deepCopy(window.DEF_BG),
    lens: { zoom: 2, radius: 90, side: 140, borderColor: '#ff5252', borderWidth: 3 },
    mosaic: { brush: 36, block: 10, eraser: false },
    sticker: '⚠️',
    stickerSize: 64,
    stepCounter: 1,
    stepRadius: 18,
    scale: { pxPerUnit: 1, unit: '' },
    textDefault: '标注',
    needsSnap: false,
    restoring: false,
    skipNextAdd: false,
    batch: 0,
    sizeScale: 1,
    annotCounter: 0,
    mosaicVersion: 0,
    restoreToken: 0,
    // 导出选项
    exportOpts: { scale: 1, jpegQuality: 0.92, includeOutside: true },
    // 多图标签页
    tabs: [],
    activeTabIndex: -1,
    // 标注统一阴影：避免与图片颜色融合导致看不清（可在面板关闭）
    annoShadow: { color: 'rgba(0,0,0,0.4)', blur: 3, offsetX: 1.5, offsetY: 1.5 },
    annoShadowOn: true,
    layers: [{ id: 'L1', name: '图层 1', visible: true, locked: false, active: true }],
    getActiveLayer() {
      return this.layers.find(l => l.active) || this.layers[0];
    },
    // 每个标注自动创建一个新图层（自动命名、置于最顶层）
    assignAnnotationLayer(obj) {
      const l = {
        id: layerUid(),
        name: '标注 ' + (++this.annotCounter),
        visible: true, locked: false, active: true
      };
      this.layers.unshift(l);
      obj.layerId = l.id;
      renderLayers();
      return l;
    }
  };
  window.APP = APP;

  /* ---------- 画布（无限画布：固定视口 + 平移缩放） ---------- */
  const CV = window.CV = new F.Canvas(document.getElementById('c'), {
    enableRetinaScaling: false,
    selection: true,
    preserveObjectStacking: true,
    uniScaleTransform: true,
    backgroundColor: null,
    selectionColor: 'rgba(91,141,239,0.25)',
    selectionBorderColor: '#5b8def',
    selectionLineWidth: 1,
    cornerColor: '#5b8def',
    cornerStrokeColor: '#ffffff',
    cornerSize: 10,
    cornerStyle: 'rect',
    transparentCorners: false
  });

  function resizeCanvas() {
    const wrap = document.getElementById('canvasWrap');
    const r = wrap.getBoundingClientRect();
    CV.setDimensions({ width: Math.max(120, r.width), height: Math.max(120, r.height) });
    CV.requestRenderAll();
  }

  // 屏幕外的对象跳过渲染（大量标注时提升交互性能）
  CV.skipOffscreen = true;

  /* ---------- 放大镜快照刷新 ---------- */
  function markSnap() { APP.needsSnap = true; }
  let snapTimer = null;
  function scheduleSnap() {
    if (snapTimer) return;
    snapTimer = setTimeout(() => { snapTimer = null; refreshSnaps(); }, 120);
  }
  function refreshSnaps() {
    const mags = CV.getObjects().filter(o => o.type === 'magnifier' || o.type === 'squareMagnifier');
    if (!mags.length) { APP.needsSnap = false; return; }
    mags.forEach(m => { m.visible = false; });
    let snap = null;
    try { snap = CV.toCanvasElement(1); } catch (err) { snap = null; }
    mags.forEach(m => {
      m.visible = true;
      if (snap) { m._snap = snap; m.set('dirty', true); }
    });
    APP.needsSnap = false;
    CV.requestRenderAll();
  }

  /* ---------- 历史记录 ---------- */
  const EXTRA = ['mosaicOverlay', 'fillColor', 'fillOpacity', 'cornerRadius', 'lockScalingX', 'lockScalingY', 'minScaleLimit', 'layerId'];
  const hist = { undo: [], redo: [], max: 25 };
  let histTimer = null;

  // 历史快照 = { objs, mosaic, layers }：
  // - objs   标注对象 JSON（不含马赛克层，大幅减小体积）
  // - mosaic 马赛克层 dataURL（仅在马赛克变化时重新生成，否则复用上一条）
  // - layers 图层列表（图层操作也可撤销）
  function historyJSON() {
    const json = CV.toJSON(EXTRA);
    json.objects = json.objects.filter(o => !o.mosaicOverlay);
    return json;
  }
  function serializeLayers() {
    return APP.layers.map(l => ({
      id: l.id, name: l.name, visible: l.visible, locked: l.locked, active: l.active
    }));
  }
  function makeEntry() {
    const last = hist.undo[hist.undo.length - 1];
    let mosaicSrc = null;
    if (APP.mosaicVersion !== hist.lastMosaicVersion && CV._mosaicCtx) {
      try { mosaicSrc = CV._mosaicCtx.canvas.toDataURL('image/png'); } catch (e) { mosaicSrc = null; }
    }
    hist.lastMosaicVersion = APP.mosaicVersion;
    return {
      objs: JSON.stringify(historyJSON()),
      mosaic: mosaicSrc || (last ? last.mosaic : null),
      layers: serializeLayers()
    };
  }
  function pushHistory() {
    if (APP.restoring || APP.batch) return;
    if (!CV._baseImage) return;
    let entry;
    try { entry = makeEntry(); } catch (e) { return; }
    const last = hist.undo[hist.undo.length - 1];
    if (last && last.objs === entry.objs && last.mosaic === entry.mosaic &&
        JSON.stringify(last.layers) === JSON.stringify(entry.layers)) return;
    hist.undo.push(entry);
    if (hist.undo.length > hist.max) hist.undo.shift();
    hist.redo.length = 0;
    updateHistButtons();
  }
  function pushHistoryDebounced() {
    clearTimeout(histTimer);
    histTimer = setTimeout(pushHistory, 500);
  }
  function undo() {
    if (hist.undo.length < 2) return;
    hist.redo.push(hist.undo.pop());
    restore(hist.undo[hist.undo.length - 1]);
  }
  function redo() {
    if (!hist.redo.length) return;
    const e = hist.redo.pop();
    hist.undo.push(e);
    restore(e);
  }
  function restore(entry) {
    APP.restoring = true;
    const token = ++APP.restoreToken;
    TOOLMGR.cancelAction();
    const base = CV._baseImage;
    CV.clear();
    CV.loadFromJSON(JSON.parse(entry.objs), () => {
      if (APP.restoreToken !== token) return;
      afterRestore(base);
      // 恢复图层列表并应用（图层操作可撤销）
      APP.layers = (entry.layers || []).map(l => ({
        id: l.id, name: l.name || '图层', visible: l.visible !== false, locked: !!l.locked, active: !!l.active
      }));
      if (!APP.layers.some(l => l.active) && APP.layers[0]) APP.layers[0].active = true;
      reconcileLayers();
      applyLayerOrder();
      // 恢复马赛克层（快照中的 dataURL，异步重建）
      recreateMosaicFromSrc(entry.mosaic || null, token);
      renderLayers();
      renderPanel();
      APP.restoring = false;
      updateHistButtons();
    });
  }
  // 从 dataURL 重建马赛克层（token 用于防止异步回调串台）
  function recreateMosaicFromSrc(src, token) {
    if (!src) { CV._mosaicLayer = null; CV._mosaicCtx = null; return; }
    const img = new Image();
    img.onload = () => {
      if (APP.restoreToken !== token || !CV._baseImage) return;
      const oc = document.createElement('canvas');
      oc.width = CV._baseW; oc.height = CV._baseH;
      const ctx = oc.getContext('2d');
      ctx.drawImage(img, 0, 0, CV._baseW, CV._baseH);
      const layer = new fabric.Image(oc, {
        left: 0, top: 0, originX: 'left', originY: 'top',
        selectable: false, evented: false, objectCaching: false, mosaicOverlay: true
      });
      APP.skipNextAdd = true;
      CV.add(layer);
      CV.sendToBack(CV._baseImage);
      CV._mosaicLayer = layer;
      CV._mosaicCtx = ctx;
      markSnap();
      CV.requestRenderAll();
    };
    img.src = src;
  }
  function afterRestore(base) {
    if (base && CV.getObjects().indexOf(base) === -1) {
      CV.add(base);
      CV.sendToBack(base);
    }
    let layer = null;
    CV.getObjects().forEach(o => { if (o.mosaicOverlay) layer = o; });
    if (layer) {
      const el = layer.getElement();
      if (!(el instanceof HTMLCanvasElement)) {
        const c = document.createElement('canvas');
        c.width = CV._baseW; c.height = CV._baseH;
        c.getContext('2d').drawImage(el, 0, 0);
        layer.setElement(c);
        layer.set({ width: CV._baseW, height: CV._baseH, objectCaching: false });
      }
      CV._mosaicLayer = layer;
      CV._mosaicCtx = layer.getElement().getContext('2d');
    }
    reconcileLayers();
    CV.getObjects().forEach(o => {
      if (o.type === 'magnifier' || o.type === 'squareMagnifier') {
        o._canvasRef = CV;
        o._snap = null;
        o.set('dirty', true);
      }
      if (o.type === 'calloutImage' && o.imgSrc && !o._img) o._loadImg(o.imgSrc);
    });
    markSnap();
    CV.requestRenderAll();
    renderPanel();
    renderLayers();
  }

  /* ---------- 图层系统 ---------- */
  function layerUid() {
    return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function isPinned(o) {
    return o === CV._baseImage || !!o.mosaicOverlay;
  }
  function layerObjectIds() {
    return new Set(APP.layers.map(l => l.id));
  }
  // 恢复后：孤儿对象归入激活图层，并应用各图层的显隐/锁定状态
  function reconcileLayers() {
    const ids = layerObjectIds();
    CV.getObjects().forEach(o => {
      if (isPinned(o)) return;
      if (!o.layerId || !ids.has(o.layerId)) o.layerId = APP.getActiveLayer().id;
    });
    APP.layers.forEach(l => {
      CV.getObjects().forEach(o => {
        if (o.layerId === l.id) {
          o.set('visible', l.visible);
          o.selectable = !l.locked;
          o.evented = !l.locked;
        }
      });
    });
  }
  function setActiveLayer(id) {
    APP.layers.forEach(l => { l.active = l.id === id; });
    renderLayers();
    renderPanel();
  }
  function addLayer() {
    const l = {
      id: layerUid(),
      name: '图层 ' + (APP.layers.length + 1),
      visible: true, locked: false, active: false
    };
    APP.layers.push(l);
    setActiveLayer(l.id);
    pushHistory();
    toast('已新建「' + l.name + '」');
  }
  function removeLayer(id) {
    if (APP.layers.length <= 1) { toast('至少保留一个图层'); return; }
    APP.batch++;
    CV.getObjects().forEach(o => { if (o.layerId === id) CV.remove(o); });
    APP.batch--;
    APP.layers = APP.layers.filter(l => l.id !== id);
    if (!APP.layers.some(l => l.active)) APP.layers[0].active = true;
    if (CV._activeObject && CV._activeObject.layerId === id) CV.discardActiveObject();
    pushHistory();
    renderLayers();
    renderPanel();
    CV.requestRenderAll();
    toast('已删除图层');
  }
  function toggleLayerVisible(id) {
    const l = APP.layers.find(x => x.id === id);
    if (!l) return;
    l.visible = !l.visible;
    CV.getObjects().forEach(o => { if (o.layerId === id) o.set('visible', l.visible); });
    CV.requestRenderAll();
    renderLayers();
    markSnap();
    pushHistory();
  }
  function toggleLayerLock(id) {
    const l = APP.layers.find(x => x.id === id);
    if (!l) return;
    l.locked = !l.locked;
    CV.getObjects().forEach(o => {
      if (o.layerId === id) {
        o.selectable = !l.locked;
        o.evented = !l.locked;
        o.set('dirty', true);
      }
    });
    if (l.locked && CV._activeObject && CV._activeObject.layerId === id) {
      CV.discardActiveObject();
      renderPanel();
    }
    CV.requestRenderAll();
    renderLayers();
    pushHistory();
  }
  function moveLayerTo(id, toIndex) {
    const from = APP.layers.findIndex(l => l.id === id);
    if (from < 0 || from === toIndex) return;
    const item = APP.layers.splice(from, 1)[0];
    APP.layers.splice(toIndex, 0, item);
    applyLayerOrder();
    renderLayers();
    pushHistory();
  }
  // 按图层顺序重建画布对象层级（layers[0] 为最顶层）
  function applyLayerOrder() {
    const pinned = CV.getObjects().filter(isPinned);
    const others = CV.getObjects().filter(o => !isPinned(o));
    const byLayer = {};
    others.forEach(o => { (byLayer[o.layerId] = byLayer[o.layerId] || []).push(o); });
    const ordered = [];
    for (let i = APP.layers.length - 1; i >= 0; i--) {
      const arr = byLayer[APP.layers[i].id] || [];
      for (const o of arr) ordered.push(o);
    }
    CV._objects = pinned.concat(ordered);
    CV.discardActiveObject();
    CV.requestRenderAll();
    markSnap();
  }
  function renderLayers() {
    const list = document.getElementById('layersList');
    if (!list) return;
    list.innerHTML = '';
    APP.layers.forEach((l, idx) => {
      const row = el('div', 'layer-row' + (l.active ? ' active' : '') + (l.locked ? ' locked' : ''));
      row.draggable = true;
      row.dataset.id = l.id;
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', l.id);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id && id !== l.id) moveLayerTo(id, idx);
      });
      const grip = el('span', 'layer-grip', '≡');
      const vis = el('button', 'layer-btn', l.visible ? '👁' : '🚫');
      vis.title = l.visible ? '隐藏图层' : '显示图层';
      vis.onclick = e => { e.stopPropagation(); toggleLayerVisible(l.id); };
      const name = el('span', 'layer-name', l.name + (l.active ? '（当前）' : ''));
      const lock = el('button', 'layer-btn', l.locked ? '🔒' : '🔓');
      lock.title = l.locked ? '解锁图层' : '锁定图层';
      lock.onclick = e => { e.stopPropagation(); toggleLayerLock(l.id); };
      const del = el('button', 'layer-btn danger', '🗑');
      del.title = '删除图层及其内容';
      del.onclick = e => { e.stopPropagation(); removeLayer(l.id); };
      row.appendChild(grip);
      row.appendChild(vis);
      row.appendChild(name);
      row.appendChild(lock);
      row.appendChild(del);
      row.addEventListener('click', () => setActiveLayer(l.id));
      list.appendChild(row);
    });
  }

  /* ---------- 图片载入 / 多图标签页 ---------- */
  function loadImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); openNewTab(img); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('图片加载失败'); };
    img.src = url;
  }
  function defaultLayers() {
    return [{ id: 'L1', name: '图层 1', visible: true, locked: false, active: true }];
  }
  function emptyObjectsJSON() {
    return JSON.stringify({ version: fabric.version, objects: [] });
  }
  function openNewTab(imgEl) {
    saveCurrentTab();
    let w = imgEl.naturalWidth || imgEl.width, h = imgEl.naturalHeight || imgEl.height;
    const MAXD = 4096;
    const sc = Math.min(1, MAXD / Math.max(w, h));
    w = Math.round(w * sc); h = Math.round(h * sc);
    imgEl.width = w; imgEl.height = h;
    const tab = {
      id: 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: '图片 ' + (APP.tabs.length + 1),
      imgEl: imgEl, w: w, h: h,
      json: emptyObjectsJSON(),
      mosaicEl: null,
      layers: defaultLayers(),
      viewport: null,
      hist: { undo: [], redo: [] },
      lastMosaicVersion: 0,
      mosaicVersion: 0,
      stepCounter: 1,
      annotCounter: 0,
      sizeScale: 1
    };
    APP.tabs.push(tab);
    activateTab(APP.tabs.length - 1);
  }
  // 保存当前标签页状态（切换前调用）
  function saveCurrentTab() {
    if (APP.activeTabIndex < 0 || !CV._baseImage) return;
    const tab = APP.tabs[APP.activeTabIndex];
    if (!tab) return;
    try { tab.json = JSON.stringify(historyJSON()); } catch (e) { /* 保留旧值 */ }
    tab.mosaicEl = CV._mosaicCtx ? CV._mosaicCtx.canvas : null;
    tab.viewport = CV.viewportTransform.slice();
    tab.layers = serializeLayers();
    tab.hist = { undo: hist.undo.slice(), redo: hist.redo.slice() };
    tab.lastMosaicVersion = hist.lastMosaicVersion;
    tab.mosaicVersion = APP.mosaicVersion;
    tab.stepCounter = APP.stepCounter;
    tab.annotCounter = APP.annotCounter;
    tab.sizeScale = APP.sizeScale;
  }
  function activateTab(i, skipSave) {
    if (i < 0 || i >= APP.tabs.length) return;
    if (!skipSave) saveCurrentTab();
    APP.activeTabIndex = i;
    const tab = APP.tabs[i];
    const token = ++APP.restoreToken;
    APP.layers = tab.layers.map(l => ({
      id: l.id, name: l.name || '图层', visible: l.visible !== false, locked: !!l.locked, active: !!l.active
    }));
    hist.undo = tab.hist.undo.slice();
    hist.redo = tab.hist.redo.slice();
    hist.lastMosaicVersion = tab.lastMosaicVersion;
    APP.mosaicVersion = tab.mosaicVersion;
    APP.stepCounter = tab.stepCounter || 1;
    APP.annotCounter = tab.annotCounter || 0;
    APP.sizeScale = tab.sizeScale || 1;
    APP.restoring = true;
    CV.clear();
    CV.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const base = new F.Image(tab.imgEl, {
      left: 0, top: 0, originX: 'left', originY: 'top',
      selectable: false, evented: false, excludeFromExport: true
    });
    CV._baseImage = base;
    CV._baseImgEl = tab.imgEl;
    CV._baseW = tab.w; CV._baseH = tab.h;
    CV._mosaicLayer = null; CV._mosaicCtx = null;
    CV.add(base);
    CV.sendToBack(base);
    CV.discardActiveObject();
    CV.loadFromJSON(JSON.parse(tab.json), () => {
      if (APP.restoreToken !== token) return;
      afterRestore(base);
      // 恢复马赛克层（保留的 canvas 元素，同步）
      if (tab.mosaicEl) {
        const layer = new fabric.Image(tab.mosaicEl, {
          left: 0, top: 0, originX: 'left', originY: 'top',
          selectable: false, evented: false, objectCaching: false, mosaicOverlay: true
        });
        APP.skipNextAdd = true;
        CV.add(layer);
        CV.sendToBack(CV._baseImage);
        CV._mosaicLayer = layer;
        CV._mosaicCtx = tab.mosaicEl.getContext('2d');
      }
      reconcileLayers();
      applyLayerOrder();
      if (tab.viewport) CV.setViewportTransform(tab.viewport);
      else fitZoom();
      // 新标签页的初始快照
      if (!hist.undo.length) {
        hist.undo = [makeEntry()];
        hist.lastMosaicVersion = APP.mosaicVersion;
      }
      APP.restoring = false;
      hideDropTip();
      resizeCanvas();
      updateHistButtons();
      renderTabs();
      renderLayers();
      renderPanel();
      CV.requestRenderAll();
      toast('已打开「' + tab.name + '」');
    });
  }
  function closeTab(i) {
    if (i < 0 || i >= APP.tabs.length) return;
    // 关闭的是当前标签页时，模块状态仍属于被关闭页：
    // 需跳过 activateTab 里的 saveCurrentTab，避免用被关闭页的内容覆盖目标标签页
    const wasActive = i === APP.activeTabIndex;
    APP.tabs.splice(i, 1);
    if (i < APP.activeTabIndex) APP.activeTabIndex--;
    if (APP.activeTabIndex >= APP.tabs.length) APP.activeTabIndex = APP.tabs.length - 1;
    if (APP.tabs.length === 0) {
      APP.activeTabIndex = -1;
      APP.restoring = true;
      CV.clear();
      CV._baseImage = null; CV._baseImgEl = null; CV._baseW = 0; CV._baseH = 0;
      CV._mosaicLayer = null; CV._mosaicCtx = null;
      APP.restoring = false;
      hist.undo = []; hist.redo = [];
      APP.layers = defaultLayers();
      CV.setViewportTransform([1, 0, 0, 1, 0, 0]);
      resizeCanvas();
      updateHistButtons();
      renderTabs();
      renderPanel();
      renderLayers();
      const tip = document.getElementById('dropTip');
      if (tip) tip.style.display = 'flex';
      CV.requestRenderAll();
    } else {
      activateTab(Math.max(0, Math.min(APP.activeTabIndex, APP.tabs.length - 1)), wasActive);
    }
  }
  function renderTabs() {
    const bar = document.getElementById('tabbar');
    if (!bar) return;
    bar.innerHTML = '';
    const addBtn = el('button', 'tab add', '＋ 新图');
    addBtn.title = '打开新图片（新标签页）';
    addBtn.onclick = () => document.getElementById('fileInput').click();
    bar.appendChild(addBtn);
    APP.tabs.forEach((t, i) => {
      const tab = el('div', 'tab' + (i === APP.activeTabIndex ? ' active' : ''), t.name);
      tab.title = '切换到「' + t.name + '」';
      const close = el('span', 'tab-close', '✕');
      close.title = '关闭';
      close.onclick = e => { e.stopPropagation(); closeTab(i); };
      tab.appendChild(close);
      tab.onclick = () => activateTab(i);
      bar.appendChild(tab);
    });
  }

  /* ---------- 缩放（无限画布） ---------- */
  function updateZoomLabel() {
    const pct = document.getElementById('btnZoomPct');
    pct.textContent = Math.round((CV.getZoom() || 1) * 100) + '%';
  }
  /* ---------- 动效工具（rAF 补间，尊重减少动态效果） ---------- */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function prefersReducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function animateValue(from, to, duration, easing, onChange, onDone) {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      onChange(from + (to - from) * (easing ? easing(t) : t));
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  }
  // 视口平滑过渡（缩放按钮 / 适应窗口用）
  let vtAnimId = null;
  function cancelViewportAnim() {
    if (vtAnimId) { cancelAnimationFrame(vtAnimId); vtAnimId = null; }
  }
  function animateViewport(start, target, duration) {
    cancelViewportAnim();
    if (prefersReducedMotion()) {
      CV.setViewportTransform(target);
      CV.requestRenderAll();
      return;
    }
    const step = (now) => {
      const t = Math.min(1, (now - startT) / duration);
      const vt = start.map((v, i) => v + (target[i] - v) * easeOutCubic(t));
      CV.setViewportTransform(vt);
      CV.requestRenderAll();
      if (t < 1) vtAnimId = requestAnimationFrame(step);
      else vtAnimId = null;
    };
    const startT = performance.now();
    vtAnimId = requestAnimationFrame(step);
  }
  // 新标注放置淡入
  function popIn(obj) {
    if (!obj || !obj.canvas || prefersReducedMotion()) return;
    obj.set('opacity', 0.2);
    obj.canvas.requestRenderAll();
    animateValue(0.2, 1, 220, easeOutCubic, v => {
      obj.set('opacity', v);
      obj.canvas && obj.canvas.requestRenderAll();
    });
  }
  function fitZoom() {
    if (!CV._baseImage) return;
    const vw = CV.getWidth(), vh = CV.getHeight();
    const z = Math.max(0.02, Math.min((vw - 80) / CV._baseW, (vh - 80) / CV._baseH, 1));
    const target = [z, 0, 0, z, (vw - CV._baseW * z) / 2, (vh - CV._baseH * z) / 2];
    animateViewport(CV.viewportTransform.slice(), target, 220);
    updateZoomLabel();
  }
  function applyZoom(z) {
    if (!CV._baseImage) return;
    z = Math.max(0.02, Math.min(20, z));
    const start = CV.viewportTransform.slice();
    CV.zoomToPoint(new fabric.Point(CV.getWidth() / 2, CV.getHeight() / 2), z);
    const target = CV.viewportTransform.slice();
    animateViewport(start, target, 200);
    updateZoomLabel();
  }

  /* ---------- 导出 / 工程 ---------- */
  function download(dataUrl, name) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 200);
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  // 对象在逻辑画布坐标中的包围盒（不含视口变换）
  function objectLogicalBounds(o) {
    if (!o || o.visible === false) return null;
    try {
      o.setCoords();
      const c = o.aCoords;
      if (!c) return null;
      const xs = [c.tl.x, c.tr.x, c.bl.x, c.br.x];
      const ys = [c.tl.y, c.tr.y, c.bl.y, c.br.y];
      return {
        left: Math.min.apply(null, xs),
        top: Math.min.apply(null, ys),
        right: Math.max.apply(null, xs),
        bottom: Math.max.apply(null, ys)
      };
    } catch (err) { return null; }
  }
  // 导出：边界 = 图片 ∪ 所有标注（放大镜除外）；图片之外为透明；异步编码不卡界面
  function showExporting(on) {
    const el0 = document.getElementById('exporting');
    if (el0) el0.classList.toggle('show', !!on);
  }
  // 渲染导出画布（边界 = 图片 ∪ 所有标注，放大镜除外），返回离屏 canvas
  function renderExportCanvas() {
    if (!CV._baseImage) return null;
    const opt = APP.exportOpts || {};
    const scale = opt.scale || 1;
    let left = 0, top = 0, right = CV._baseW, bottom = CV._baseH;
    if (opt.includeOutside !== false) {
      CV.getObjects().forEach(o => {
        if (o.type === 'magnifier' || o.type === 'squareMagnifier') return;
        const b = objectLogicalBounds(o);
        if (!b) return;
        left = Math.min(left, b.left); top = Math.min(top, b.top);
        right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
      });
    }
    const W = Math.max(1, Math.round(right - left));
    const H = Math.max(1, Math.round(bottom - top));
    // 极大导出（标注拖到很远处）时等比限制尺寸
    const MAXD = 8192;
    const baseZoom = Math.max(W, H) > MAXD ? MAXD / Math.max(W, H) : 1;
    const zoom = baseZoom * scale;
    const outW = Math.max(1, Math.round(W * zoom));
    const outH = Math.max(1, Math.round(H * zoom));
    const savedZT = CV.viewportTransform.slice();
    const savedW = CV.getWidth(), savedH = CV.getHeight();
    const mags = CV.getObjects().filter(o => o.type === 'magnifier' || o.type === 'squareMagnifier');
    mags.forEach(m => { m.visible = false; });
    CV.setViewportTransform([zoom, 0, 0, zoom, -left * zoom, -top * zoom]);
    CV.setDimensions({ width: outW, height: outH });
    let canvas = null;
    try { canvas = CV.toCanvasElement(1); } catch (e) { canvas = null; }
    CV.setViewportTransform(savedZT);
    CV.setDimensions({ width: savedW, height: savedH });
    mags.forEach(m => { m.visible = true; });
    CV.requestRenderAll();
    return canvas;
  }
  function exportImage(format) {
    if (!CV._baseImage) { toast('请先上传图片'); return; }
    showExporting(true);
    const isPng = format === 'png';
    const renderCanvas = renderExportCanvas();
    if (!renderCanvas) { showExporting(false); toast('导出失败'); return; }
    toast('正在导出…');
    const finish = (blob) => {
      showExporting(false);
      if (!blob) { toast('导出失败'); return; }
      downloadBlob(blob, isPng ? 'annotation.png' : 'annotation.jpg');
      toast('已导出 ' + (isPng ? 'PNG' : 'JPG') + '（' + Math.round(blob.size / 1024) + ' KB）');
    };
    if (isPng) {
      // PNG：无损 + 透明背景（异步编码，不卡界面）
      renderCanvas.toBlob(finish, 'image/png');
    } else {
      // JPG：体积小、速度快；透明区域以白色填充；质量可调
      const q = (APP.exportOpts && APP.exportOpts.jpegQuality) || 0.92;
      const jc = document.createElement('canvas');
      jc.width = renderCanvas.width; jc.height = renderCanvas.height;
      const jctx = jc.getContext('2d');
      jctx.fillStyle = '#ffffff';
      jctx.fillRect(0, 0, jc.width, jc.height);
      jctx.drawImage(renderCanvas, 0, 0);
      jc.toBlob(finish, 'image/jpeg', q);
    }
  }
  // 一键复制 PNG 到剪贴板
  function copyPngToClipboard() {
    if (!CV._baseImage) { toast('请先上传图片'); return; }
    showExporting(true);
    const renderCanvas = renderExportCanvas();
    if (!renderCanvas) { showExporting(false); toast('复制失败'); return; }
    renderCanvas.toBlob((blob) => {
      showExporting(false);
      if (!blob) { toast('复制失败'); return; }
      const doCopy = async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            toast('已复制 PNG 到剪贴板，可直接粘贴到聊天/文档/画图');
            return;
          }
          throw new Error('unsupported');
        } catch (err) {
          // 降级：复制 dataURL 文本
          try {
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result);
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(
                  () => toast('当前浏览器不支持复制图片，已复制图片数据（文本）'),
                  () => toast('复制失败，请使用「导出 PNG」')
                );
              } else {
                toast('当前浏览器不支持复制图片，请使用「导出 PNG」');
              }
            };
            reader.readAsDataURL(blob);
          } catch (e2) {
            toast('复制失败，请使用「导出 PNG」');
          }
        }
      };
      doCopy();
    }, 'image/png');
  }
  async function saveProject() {
    if (!CV._baseImage) { toast('请先上传图片'); return; }
    const data = {
      app: 'image-annotator',
      version: 1,
      base: { src: CV._baseImgEl.toDataURL('image/png'), w: CV._baseW, h: CV._baseH },
      settings: {
        scale: APP.scale, textProps: APP.textProps, shapeProps: APP.shapeProps,
        lineProps: APP.lineProps, calloutBg: APP.calloutBg,
        stepCounter: APP.stepCounter, stepRadius: APP.stepRadius,
        annotCounter: APP.annotCounter
      },
      layers: APP.layers,
      objects: CV.toJSON(EXTRA)
    };
    const json = JSON.stringify(data);
    // 优先弹出「另存为」对话框让用户选择存放位置（Chrome/Edge 支持 File System Access API）
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'annotation-project.json',
          types: [{ description: 'JSON 工程文件', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        toast('工程已保存');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // 用户取消
        // 其它异常（权限、旧浏览器等）降级为直接下载
      }
    }
    downloadBlob(new Blob([json], { type: 'application/json' }), 'annotation-project.json');
    toast('工程已保存');
  }
  function loadProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.base || !data.objects) throw new Error('文件格式不正确');
        const img = new Image();
        img.onload = () => {
          img.width = data.base.w; img.height = data.base.h;
          // 工程作为一个新标签页载入
          saveCurrentTab();
          let layers = defaultLayers();
          if (Array.isArray(data.layers) && data.layers.length) {
            layers = data.layers.map(l => ({
              id: l.id || 'L1',
              name: l.name || '图层',
              visible: l.visible !== false,
              locked: !!l.locked,
              active: !!l.active
            }));
          }
          if (!layers.some(l => l.active)) layers[0].active = true;
          let annotCounter = (data.settings && data.settings.annotCounter) || 0;
          if (!annotCounter) {
            annotCounter = layers.reduce((m, l) => {
              const n = parseInt(String(l.name || '').replace(/.*?(\d+).*/, '$1'), 10);
              return Number.isFinite(n) ? Math.max(m, n) : m;
            }, 0);
          }
          if (data.settings) {
            Object.assign(APP.scale, data.settings.scale || {});
            Object.assign(APP.textProps, data.settings.textProps || {});
            Object.assign(APP.shapeProps, data.settings.shapeProps || {});
            Object.assign(APP.lineProps, data.settings.lineProps || {});
            Object.assign(APP.calloutBg, data.settings.calloutBg || {});
            APP.stepRadius = data.settings.stepRadius || 18;
            APP.stepCounter = data.settings.stepCounter || 1;
          }
          const tab = {
            id: 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: '工程 ' + (APP.tabs.length + 1),
            imgEl: img, w: data.base.w, h: data.base.h,
            json: JSON.stringify(data.objects),
            mosaicEl: null,
            layers: layers,
            viewport: null,
            hist: { undo: [], redo: [] },
            lastMosaicVersion: 0,
            mosaicVersion: 0,
            stepCounter: APP.stepCounter,
            annotCounter: annotCounter,
            sizeScale: Math.max(0.5, Math.min(3, Math.min(data.base.w, data.base.h) / 900))
          };
          APP.tabs.push(tab);
          activateTab(APP.tabs.length - 1);
        };
        img.src = data.base.src;
      } catch (err) {
        APP.restoring = false;
        toast('工程载入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ---------- 选中对象操作 ---------- */
  function deleteSelection() {
    const objs = CV.getActiveObjects();
    if (!objs.length) return;
    objs.forEach(o => CV.remove(o));
    CV.discardActiveObject();
    CV.requestRenderAll();
    pushHistory();
    renderPanel();
  }
  function duplicateSelection() {
    const objs = CV.getActiveObjects();
    if (!objs.length) return;
    const clones = [];
    objs.forEach(o => {
      try {
        const data = o.toObject(EXTRA);
        const klass = F.util.getKlass(o.type);
        const c = new klass(data);
        c.set({ left: (o.left || 0) + 16, top: (o.top || 0) + 16 });
        CV.add(c);
        clones.push(c);
      } catch (err) { /* 忽略无法复制的对象 */ }
    });
    if (clones.length) {
      CV.setActiveObject(clones.length > 1 ? new F.ActiveSelection(clones, { canvas: CV }) : clones[0]);
      CV.requestRenderAll();
      pushHistory();
      renderPanel();
    }
  }

  /* ---------- 多选对齐（左/水平居中/右/顶部/垂直居中/底部） ---------- */
  function alignSelection(align) {
    const objs = CV.getActiveObjects();
    if (objs.length < 2) { toast('请至少选中两个对象'); return; }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    objs.forEach(o => {
      const b = objectLogicalBounds(o);
      if (b) {
        left = Math.min(left, b.left); top = Math.min(top, b.top);
        right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
      }
    });
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    objs.forEach(o => {
      const b = objectLogicalBounds(o);
      if (!b) return;
      let dx = 0, dy = 0;
      if (align === 'left') dx = left - b.left;
      else if (align === 'hcenter') dx = cx - (b.left + b.right) / 2;
      else if (align === 'right') dx = right - b.right;
      else if (align === 'top') dy = top - b.top;
      else if (align === 'vcenter') dy = cy - (b.top + b.bottom) / 2;
      else if (align === 'bottom') dy = bottom - b.bottom;
      if (dx || dy) {
        o.set({ left: (o.left || 0) + dx, top: (o.top || 0) + dy });
        o.setCoords();
      }
    });
    CV.requestRenderAll();
    pushHistory();
    renderPanel();
  }

  /* ---------- 面板 ---------- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sec(title) {
    const s = el('div', 'sec');
    s.appendChild(el('div', 'sec-title', title));
    return s;
  }
  function row(label, ctrl) {
    const r = el('div', 'frow');
    r.appendChild(el('label', 'flabel', label));
    r.appendChild(ctrl);
    return r;
  }
  function colorField(value, onChange) {
    const i = el('input', 'icolor');
    i.type = 'color';
    i.value = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#ff5252';
    i.addEventListener('input', () => onChange(i.value));
    return i;
  }
  function numField(value, opts, onChange) {
    const i = el('input', 'inum');
    i.type = 'number';
    i.min = opts.min != null ? opts.min : 0;
    i.max = opts.max != null ? opts.max : 9999;
    i.step = opts.step != null ? opts.step : 1;
    i.value = value;
    const fire = () => onChange(parseFloat(i.value) || 0);
    i.addEventListener('input', fire);
    i.addEventListener('change', fire);
    return i;
  }
  function rangeField(value, opts, onChange) {
    const wrap = el('div', 'frange');
    const i = el('input', 'irange');
    i.type = 'range';
    i.min = opts.min; i.max = opts.max; i.step = opts.step || 1;
    i.value = value;
    const out = el('span', 'rval', String(value));
    i.addEventListener('input', () => {
      out.textContent = i.value;
      onChange(parseFloat(i.value));
    });
    wrap.appendChild(i);
    wrap.appendChild(out);
    return wrap;
  }
  function selectField(pairs, value, onChange) {
    const s = el('select', 'iselect');
    const cur = JSON.stringify(value);
    for (const [label, v] of pairs) {
      const o = el('option', null, label);
      o.value = JSON.stringify(v);
      if (JSON.stringify(v) === cur) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => {
      try { onChange(JSON.parse(s.value)); } catch (e) { onChange(s.value); }
    });
    return s;
  }
  function checkField(label, checked, onChange) {
    const l = el('label', 'fcheck');
    const i = el('input');
    i.type = 'checkbox';
    i.checked = !!checked;
    i.addEventListener('change', () => onChange(i.checked));
    l.appendChild(i);
    l.appendChild(el('span', null, label));
    return l;
  }

  const FONTS = [
    'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New',
    'Impact', 'Comic Sans MS', 'Microsoft YaHei', 'SimHei', 'SimSun',
    'KaiTi', 'FangSong', 'STKaiti', 'STSong'
  ];
  const DASH_OPTS = [['实线', null], ['虚线', [8, 6]], ['点线', [2, 5]], ['点划线', [8, 4, 2, 4]]];

  function textSection(props, apply) {
    const s = sec('文字样式');
    s.appendChild(row('字体', selectField(FONTS.map(f => [f, f]), props.fontFamily, v => apply('fontFamily', v))));
    s.appendChild(row('字号', numField(props.fontSize, { min: 6, max: 400, step: 1 }, v => apply('fontSize', v))));
    s.appendChild(row('字距', rangeField(props.letterSpacing, { min: 0, max: 40, step: 1 }, v => apply('letterSpacing', v))));
    s.appendChild(row('颜色', colorField(props.fill, v => apply('fill', v))));
    s.appendChild(row('轮廓颜色', colorField(props.outlineColor, v => apply('outlineColor', v))));
    s.appendChild(row('轮廓粗细', numField(props.outlineWidth, { min: 0, max: 30, step: 1 }, v => apply('outlineWidth', v))));
    const toggles = el('div', 'ftoggles');
    toggles.appendChild(checkField('粗体', props.fontWeight === 'bold', v => apply('fontWeight', v ? 'bold' : 'normal')));
    toggles.appendChild(checkField('斜体', props.fontStyle === 'italic', v => apply('fontStyle', v ? 'italic' : 'normal')));
    toggles.appendChild(checkField('下划线', !!props.underline, v => apply('underline', v)));
    s.appendChild(toggles);
    return s;
  }
  function shapeSection(target, apply) {
    const s = sec('图形样式');
    s.appendChild(row('边框色', colorField(target.stroke, v => apply('stroke', v))));
    s.appendChild(row('线宽', numField(target.strokeWidth, { min: 0, max: 60, step: 1 }, v => apply('strokeWidth', v))));
    s.appendChild(row('线形', selectField(DASH_OPTS, target.dash || null, v => apply('dash', v))));
    s.appendChild(row('圆角', numField(target.cornerRadius, { min: 0, max: 300, step: 1 }, v => apply('cornerRadius', v))));
    s.appendChild(row('填充透明', rangeField(Math.round((1 - (target.fillOpacity || 0)) * 100), { min: 0, max: 100, step: 1 }, v => apply('fillOpacity', Math.round(100 - v) / 100))));
    s.appendChild(row('填充颜色', colorField(target.fillColor, v => apply('fillColor', v))));
    s.appendChild(row('描边色', colorField(target.haloColor, v => apply('haloColor', v))));
    s.appendChild(row('描边粗细', numField(target.haloWidth, { min: 0, max: 20, step: 1 }, v => apply('haloWidth', v))));
    return s;
  }
  function lineSection(target, apply) {
    const s = sec('线条样式');
    s.appendChild(row('颜色', colorField(target.color, v => apply('color', v))));
    s.appendChild(row('线宽', numField(target.width, { min: 0, max: 60, step: 1 }, v => apply('width', v))));
    s.appendChild(row('线形', selectField(DASH_OPTS, target.dash || null, v => apply('dash', v))));
    s.appendChild(row('描边色', colorField(target.haloColor, v => apply('haloColor', v))));
    s.appendChild(row('描边粗细', numField(target.haloWidth, { min: 0, max: 20, step: 1 }, v => apply('haloWidth', v))));
    return s;
  }
  function contentSection(obj) {
    const s = sec('文字内容');
    const ta = el('textarea', 'ftextarea');
    ta.id = 'contentInput';
    ta.rows = 3;
    ta.value = obj.textContent || '';
    ta.addEventListener('input', () => {
      obj.textContent = ta.value;
      applyRelayout(obj);
      pushHistoryDebounced();
    });
    s.appendChild(ta);
    s.appendChild(el('p', 'fnote', '双击画布上的对象可快速聚焦此输入框'));
    return s;
  }

  function applyRelayout(obj) {
    obj.set('dirty', true);
    if (typeof obj.relayout === 'function') {
      obj.relayout();
      obj.set({ left: obj._offX || obj.left, top: obj._offY || obj.top });
      obj.setCoords();
    }
    CV.requestRenderAll();
    markSnap();
  }
  function objTextApply(obj) {
    return (k, v) => { obj.tx[k] = v; applyRelayout(obj); pushHistoryDebounced(); };
  }
  function objShapeApply(obj) {
    return (k, v) => { obj.shape[k] = v; applyRelayout(obj); pushHistoryDebounced(); };
  }
  function objLineApply(obj) {
    return (k, v) => { obj.line[k] = v; applyRelayout(obj); pushHistoryDebounced(); };
  }
  function objBgApply(obj) {
    return (k, v) => { obj.bg[k] = v; applyRelayout(obj); pushHistoryDebounced(); };
  }
  function bgSection(obj) {
    const s = sec('文字框背景');
    s.appendChild(row('背景色', colorField(obj.bg.fill, v => objBgApply(obj)('fill', v))));
    s.appendChild(row('背景透明', rangeField(Math.round((1 - obj.bg.opacity) * 100), { min: 0, max: 100, step: 1 }, v => objBgApply(obj)('opacity', Math.round(100 - v) / 100))));
    s.appendChild(row('圆角', numField(obj.bg.radius, { min: 0, max: 60, step: 1 }, v => objBgApply(obj)('radius', v))));
    return s;
  }
  function lensSection(obj) {
    const s = sec('放大镜设置');
    s.appendChild(row('放大倍数', numField(obj.zoom, { min: 1.2, max: 8, step: 0.1 }, v => {
      obj.zoom = v; obj.set('dirty', true); CV.requestRenderAll(); pushHistoryDebounced();
    })));
    if (obj.type === 'magnifier') {
      s.appendChild(row('直径', numField(Math.round(obj.radius * 2), { min: 40, max: 600, step: 1 }, v => {
        obj.radius = v / 2;
        obj.set({ width: v, height: v, contentW: v, contentH: v });
        obj.set('dirty', true);
        obj.setCoords(); CV.requestRenderAll(); pushHistoryDebounced();
      })));
    } else {
      s.appendChild(row('边长', numField(Math.round(obj.side), { min: 40, max: 600, step: 1 }, v => {
        obj.side = v;
        obj.set({ width: v, height: v, contentW: v, contentH: v });
        obj.set('dirty', true);
        obj.setCoords(); CV.requestRenderAll(); pushHistoryDebounced();
      })));
    }
    s.appendChild(row('边框色', colorField(obj.borderColor, v => {
      obj.borderColor = v; obj.set('dirty', true); CV.requestRenderAll(); pushHistoryDebounced();
    })));
    s.appendChild(row('边框宽', numField(obj.borderWidth, { min: 1, max: 16, step: 1 }, v => {
      obj.borderWidth = v; obj.set('dirty', true); CV.requestRenderAll(); pushHistoryDebounced();
    })));
    return s;
  }

  function fabricShapeApply(obj) {
    return (k, v) => {
      if (k === 'stroke') obj.set({ stroke: v });
      else if (k === 'strokeWidth') obj.set({ strokeWidth: v });
      else if (k === 'dash') obj.set({ strokeDashArray: v ? v.slice() : null });
      else if (k === 'cornerRadius') { obj.set({ rx: v, ry: v, cornerRadius: v }); obj.setCoords(); }
      else if (k === 'fillColor') { obj.fillColor = v; obj.set({ fill: obj.fillOpacity > 0 ? v : 'transparent' }); }
      else if (k === 'fillOpacity') { obj.fillOpacity = v; obj.set({ fill: v > 0 ? obj.fillColor : 'transparent' }); }
      obj.set('dirty', true);
      CV.requestRenderAll();
      pushHistoryDebounced();
    };
  }
  function fabricLineApply(obj) {
    return (k, v) => {
      if (k === 'color') obj.set({ stroke: v });
      else if (k === 'width') obj.set({ strokeWidth: v });
      else if (k === 'dash') obj.set({ strokeDashArray: v ? v.slice() : null });
      obj.set('dirty', true);
      CV.requestRenderAll();
      pushHistoryDebounced();
    };
  }

  const OBJ_NAMES = {
    annoText: '文字',
    messageBox: '消息框',
    stepNumber: '步骤序号',
    calloutText: '文字引出',
    multiCallout: '多引出',
    calloutRegion: '引出区域',
    calloutImage: '图引出',
    dimension: '尺寸标注',
    angleMeasure: '角度测量',
    areaMeasure: '面积测量',
    magnifier: '放大镜',
    squareMagnifier: '方形放大镜',
    splinePath: '曲线',
    annoLine: '线条',
    annoRect: '矩形',
    rect: '矩形',
    line: '直线',
    path: '路径',
    image: '贴图'
  };

  // 通用外观：阴影开关（所有标注对象）
  function appearanceSection(obj) {
    const s = sec('外观');
    s.appendChild(checkField('阴影', !!obj.shadow, v => {
      obj.shadow = v ? APP.annoShadow : null;
      obj.set('dirty', true);
      CV.requestRenderAll();
      pushHistoryDebounced();
    }));
    return s;
  }

  function renderObjectPanel(p, obj) {
    const head = el('div', 'objhead');
    head.appendChild(el('div', 'objname', OBJ_NAMES[obj.type] || obj.type));
    const acts = el('div', 'objacts');
    const bDup = el('button', 'btn small', '复制');
    bDup.onclick = duplicateSelection;
    const bDel = el('button', 'btn small danger', '删除');
    bDel.onclick = deleteSelection;
    acts.appendChild(bDup);
    acts.appendChild(bDel);
    head.appendChild(acts);
    p.appendChild(head);

    if (obj.type === 'activeSelection') {
      p.appendChild(el('p', 'fnote', '已多选 ' + obj.getObjects().length + ' 个对象，可整体移动 / 缩放 / 旋转；按 Delete 删除，方向键微调。'));
      const s = sec('对齐');
      const rowEl = el('div', 'align-row');
      const makeAlignBtn = (label, align) => {
        const b = el('button', 'btn small', label);
        b.onclick = () => alignSelection(align);
        return b;
      };
      rowEl.appendChild(makeAlignBtn('⬅ 左对齐', 'left'));
      rowEl.appendChild(makeAlignBtn('↔ 水平居中', 'hcenter'));
      rowEl.appendChild(makeAlignBtn('➡ 右对齐', 'right'));
      rowEl.appendChild(makeAlignBtn('⬆ 顶部对齐', 'top'));
      rowEl.appendChild(makeAlignBtn('↕ 垂直居中', 'vcenter'));
      rowEl.appendChild(makeAlignBtn('⬇ 底部对齐', 'bottom'));
      s.appendChild(rowEl);
      p.appendChild(s);
      return;
    }

    p.appendChild(appearanceSection(obj));
    const t = obj.type;
    if (t === 'annoText') {
      p.appendChild(contentSection(obj));
      p.appendChild(textSection(obj.tx, objTextApply(obj)));
    } else if (t === 'annoLine') {
      p.appendChild(lineSection(obj.line, objLineApply(obj)));
      if (obj.arrowhead === 'end') p.appendChild(el('p', 'fnote', '箭头样式：实心箭头 + 白色描边'));
      if (obj.pts && obj.pts.length >= 2 && obj.pts.length <= 6) {
        p.appendChild(el('p', 'fnote', '选中后拖动蓝色圆点端点即可调整直线/箭头位置与方向。'));
      }
    } else if (t === 'annoRect') {
      p.appendChild(shapeSection(obj.shape, objShapeApply(obj)));
    } else if (t === 'messageBox') {
      p.appendChild(contentSection(obj));
      p.appendChild(textSection(obj.tx, objTextApply(obj)));
      p.appendChild(shapeSection(obj.shape, objShapeApply(obj)));
    } else if (t === 'stepNumber') {
      const s = sec('步骤序号');
      s.appendChild(row('序号', numField(obj.number, { min: 1, max: 999, step: 1 }, v => {
        obj.number = Math.round(v);
        obj.set('dirty', true);
        CV.requestRenderAll();
        pushHistoryDebounced();
      })));
      s.appendChild(row('形状', selectField([['圆形', 'circle'], ['圆角方形', 'round']], obj.stepShape, v => {
        obj.stepShape = v;
        obj.set('dirty', true);
        CV.requestRenderAll();
        pushHistoryDebounced();
      })));
      s.appendChild(row('半径', numField(obj.radius, { min: 8, max: 120, step: 1 }, v => {
        obj.radius = v;
        applyRelayout(obj);
        pushHistoryDebounced();
      })));
      p.appendChild(s);
      p.appendChild(shapeSection(obj.shape, objShapeApply(obj)));
    } else if (t === 'calloutText' || t === 'multiCallout' || t === 'calloutRegion') {
      p.appendChild(contentSection(obj));
      p.appendChild(textSection(obj.tx, objTextApply(obj)));
      p.appendChild(lineSection(obj.line, objLineApply(obj)));
      if (t === 'calloutText') {
        p.appendChild(el('p', 'fnote', '选中后拖动蓝色圆点：箭头处为「锚点」手柄，文字中心为「文字」手柄，可分别调整位置；拖动引出线可整体移动。'));
      }
      if (t === 'multiCallout') {
        p.appendChild(el('p', 'fnote', '选中后拖动蓝色圆点：每个箭头为「锚点」手柄，文字中心为「文字」手柄，可分别调整位置；水平线长度只取决于文本长度。'));
      }
      if (t === 'calloutRegion') {
        p.appendChild(shapeSection(obj.shape, objShapeApply(obj)));
        p.appendChild(el('p', 'fnote', '选中后拖动蓝色圆点：椭圆中心为「区域」手柄，文字中心为「文字」手柄，可分别调整位置；引出线自动连接。'));
      }
    } else if (t === 'splinePath') {
      p.appendChild(lineSection(obj.line, objLineApply(obj)));
      p.appendChild(el('p', 'fnote', '选中曲线后，拖动蓝色圆点锚点即可调整曲线形状。'));
    } else if (t === 'calloutImage') {
      p.appendChild(contentSection(obj));
      p.appendChild(textSection(obj.tx, objTextApply(obj)));
      p.appendChild(lineSection(obj.line, objLineApply(obj)));
    } else if (t === 'dimension' || t === 'angleMeasure' || t === 'areaMeasure') {
      if (t === 'dimension' || t === 'areaMeasure') {
        const s = sec('测量比例');
        s.appendChild(row('比例(px/单位)', numField(obj.scale, { min: 0.01, max: 1000, step: 1 }, v => {
          obj.scale = v;
          applyRelayout(obj);
          pushHistoryDebounced();
        })));
        const u = el('input', 'itext');
        u.value = obj.unit;
        u.addEventListener('input', () => { obj.unit = u.value; applyRelayout(obj); });
        s.appendChild(row('单位名称', u));
        p.appendChild(s);
      }
      p.appendChild(textSection(obj.tx, objTextApply(obj)));
      p.appendChild(lineSection(obj.line, objLineApply(obj)));
      if (t === 'areaMeasure') p.appendChild(shapeSection(obj.shape, objShapeApply(obj)));
    } else if (t === 'magnifier' || t === 'squareMagnifier') {
      p.appendChild(lensSection(obj));
    } else if (t === 'rect') {
      p.appendChild(shapeSection({
        stroke: obj.stroke, strokeWidth: obj.strokeWidth,
        dash: obj.strokeDashArray, cornerRadius: obj.rx || 0,
        fillColor: obj.fillColor || '#ffd166', fillOpacity: obj.fillOpacity || 0
      }, fabricShapeApply(obj)));
    } else if (t === 'line' || t === 'path') {
      p.appendChild(lineSection({
        color: obj.stroke, width: obj.strokeWidth, dash: obj.strokeDashArray
      }, fabricLineApply(obj)));
    } else if (t === 'image') {
      p.appendChild(el('p', 'fnote', '自定义贴图：拖动调整位置与大小。'));
      const s = sec('贴图');
      s.appendChild(row('不透明度', rangeField(Math.round((obj.opacity || 1) * 100), { min: 0, max: 100, step: 1 }, v => {
        obj.set({ opacity: v / 100 });
        CV.requestRenderAll();
        pushHistoryDebounced();
      })));
      p.appendChild(s);
    } else {
      p.appendChild(el('p', 'fnote', '该对象暂无更多可调属性。'));
    }
  }

  function measureSection() {
    const s = sec('测量比例');
    s.appendChild(row('比例(px/单位)', numField(APP.scale.pxPerUnit, { min: 0.01, max: 1000, step: 1 }, v => {
      APP.scale.pxPerUnit = v;
      saveUserData();
    })));
    const u = el('input', 'itext');
    u.value = APP.scale.unit;
    u.addEventListener('input', () => { APP.scale.unit = u.value; saveUserData(); });
    s.appendChild(row('单位名称', u));
    s.appendChild(el('p', 'fnote', '比例为 1 时按像素显示；设置比例后按「单位」显示。'));
    return s;
  }
  function calloutBgSection() {
    const s = sec('文字框背景');
    s.appendChild(row('背景色', colorField(APP.calloutBg.fill, v => { APP.calloutBg.fill = v; saveUserData(); })));
    s.appendChild(row('背景透明', rangeField(Math.round((1 - APP.calloutBg.opacity) * 100), { min: 0, max: 100, step: 1 }, v => {
      APP.calloutBg.opacity = Math.round(100 - v) / 100;
      saveUserData();
    })));
    s.appendChild(row('圆角', numField(APP.calloutBg.radius, { min: 0, max: 60, step: 1 }, v => {
      APP.calloutBg.radius = v;
      saveUserData();
    })));
    return s;
  }
  function lensDefaultsSection() {
    const s = sec('放大镜默认');
    s.appendChild(row('放大倍数', numField(APP.lens.zoom, { min: 1.2, max: 8, step: 0.1 }, v => {
      APP.lens.zoom = v;
      saveUserData();
    })));
    s.appendChild(row('边框色', colorField(APP.lens.borderColor, v => { APP.lens.borderColor = v; saveUserData(); })));
    s.appendChild(row('边框宽', numField(APP.lens.borderWidth, { min: 1, max: 16, step: 1 }, v => {
      APP.lens.borderWidth = v;
      saveUserData();
    })));
    return s;
  }

  const STICKERS = [
    '⚠️', '❌', '✅', '⭐', '❤️', '📌', '🚩', '🔍', '🔴', '🟠', '🟡', '🟢',
    '🔵', '🟣', '🟤', '⚫', '⚪', '⬆️', '⬇️', '⬅️', '➡️', '↗️', '↘️', '↙️',
    '↖️', '➕', '➖', '✖️', '💡', '🔥', '👍', '👎', '🎯', '🏷️', '📎', '✏️',
    '☑️', '❗', '❓', '🔺', '🔻', '🔶', '🔷', '🆗', '🆕', '⏫', '⏬', '🔁'
  ];
  function stickerSection() {
    const s = sec('贴图表情');
    const grid = el('div', 'stickergrid');
    STICKERS.forEach(st => {
      const b = el('button', 'sticker' + (st === APP.sticker ? ' sel' : ''), st);
      b.onclick = () => { APP.sticker = st; saveUserData(); renderPanel(); };
      grid.appendChild(b);
    });
    s.appendChild(grid);
    s.appendChild(row('大小', rangeField(APP.stickerSize, { min: 16, max: 200, step: 1 }, v => {
      APP.stickerSize = v;
      saveUserData();
    })));
    const up = el('button', 'btn full', '📁 上传自定义贴图');
    up.onclick = () => document.getElementById('stickerFile').click();
    s.appendChild(up);
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = 'image/*';
    fi.style.display = 'none';
    fi.id = 'stickerFile';
    fi.addEventListener('change', () => {
      const f = fi.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const obj = new F.Image(img, { left: 0, top: 0, originX: 'left', originY: 'top' });
        CV.add(obj);
        obj.setCoords();
        CV.requestRenderAll();
        pushHistory();
        toast('自定义贴图已添加，可拖动位置');
        TOOLMGR.select('select');
        CV.setActiveObject(obj);
        renderPanel();
      };
      img.src = url;
    });
    s.appendChild(fi);
    return s;
  }
  function mosaicSection() {
    const s = sec('马赛克');
    s.appendChild(row('笔刷大小', rangeField(APP.mosaic.brush, { min: 8, max: 200, step: 1 }, v => {
      APP.mosaic.brush = v;
      saveUserData();
    })));
    s.appendChild(row('块大小', rangeField(APP.mosaic.block, { min: 4, max: 40, step: 1 }, v => {
      APP.mosaic.block = v;
      saveUserData();
    })));
    const er = el('div', 'ftoggles');
    er.appendChild(checkField('橡皮擦（擦除马赛克）', !!APP.mosaic.eraser, v => {
      APP.mosaic.eraser = v;
      saveUserData();
    }));
    s.appendChild(er);
    const clear = el('button', 'btn danger full', '🧹 清除全部马赛克');
    clear.onclick = () => {
      const layer = CV._mosaicLayer;
      if (layer) {
        layer.getElement().getContext('2d').clearRect(0, 0, CV._baseW, CV._baseH);
        APP.mosaicVersion++;
        CV.requestRenderAll();
        markSnap();
        pushHistory();
      }
    };
    s.appendChild(clear);
    return s;
  }

  function renderToolPanel(p, id) {
    const tp = APP.textProps, sp = APP.shapeProps, lp = APP.lineProps;
    const applyT = (k, v) => { tp[k] = v; saveUserData(); };
    const applyS = (k, v) => { sp[k] = v; saveUserData(); };
    const applyL = (k, v) => { lp[k === 'color' ? 'stroke' : k] = v; saveUserData(); };
    const lineTarget = () => ({ color: lp.stroke, width: lp.width, dash: lp.dash, haloColor: lp.haloColor, haloWidth: lp.haloWidth });
    switch (id) {
      case 'text':
        p.appendChild(textSection(tp, applyT));
        break;
      case 'rect':
        p.appendChild(shapeSection({
          stroke: sp.stroke, strokeWidth: sp.strokeWidth, dash: sp.dash,
          cornerRadius: sp.cornerRadius, fillColor: sp.fillColor, fillOpacity: sp.fillOpacity,
          haloColor: sp.haloColor, haloWidth: sp.haloWidth
        }, applyS));
        break;
      case 'msgbox':
        p.appendChild(textSection(tp, applyT));
        p.appendChild(shapeSection({
          stroke: sp.stroke, strokeWidth: sp.strokeWidth, dash: sp.dash,
          cornerRadius: sp.cornerRadius, fillColor: sp.fillColor, fillOpacity: sp.fillOpacity,
          haloColor: sp.haloColor, haloWidth: sp.haloWidth
        }, applyS));
        break;
      case 'step': {
        const s = sec('步骤序号');
        s.appendChild(row('当前序号', numField(APP.stepCounter, { min: 1, max: 999, step: 1 }, v => {
          APP.stepCounter = Math.round(v);
        })));
        s.appendChild(row('半径', numField(APP.stepRadius, { min: 8, max: 120, step: 1 }, v => {
          APP.stepRadius = v;
        })));
        p.appendChild(s);
        p.appendChild(textSection(tp, applyT));
        p.appendChild(shapeSection({
          stroke: sp.stroke, strokeWidth: sp.strokeWidth, dash: sp.dash,
          cornerRadius: sp.cornerRadius, fillColor: sp.fillColor, fillOpacity: sp.fillOpacity,
          haloColor: sp.haloColor, haloWidth: sp.haloWidth
        }, applyS));
        break;
      }
      case 'line': case 'arrow':
        p.appendChild(lineSection(lineTarget(), applyL));
        p.appendChild(el('p', 'fnote', '画完后选中直线/箭头，拖动蓝色圆点端点可调整位置与方向。'));
        break;
      case 'freehand':
        p.appendChild(lineSection(lineTarget(), applyL));
        break;
      case 'carrow': case 'curve':
        p.appendChild(lineSection(lineTarget(), applyL));
        p.appendChild(el('p', 'fnote', '画完后选中曲线，拖动蓝色圆点锚点可调整曲线形状。'));
        break;
      case 'dim':
        p.appendChild(measureSection());
        p.appendChild(textSection(tp, applyT));
        p.appendChild(lineSection(lineTarget(), applyL));
        break;
      case 'angle':
        p.appendChild(textSection(tp, applyT));
        p.appendChild(lineSection(lineTarget(), applyL));
        break;
      case 'area':
        p.appendChild(measureSection());
        p.appendChild(textSection(tp, applyT));
        p.appendChild(shapeSection({
          stroke: sp.stroke, strokeWidth: sp.strokeWidth, dash: sp.dash,
          cornerRadius: sp.cornerRadius, fillColor: sp.fillColor, fillOpacity: sp.fillOpacity,
          haloColor: sp.haloColor, haloWidth: sp.haloWidth
        }, applyS));
        break;
      case 'ctext': case 'cmulti':
        p.appendChild(textSection(tp, applyT));
        p.appendChild(lineSection(lineTarget(), applyL));
        break;
      case 'cregion':
        p.appendChild(textSection(tp, applyT));
        p.appendChild(lineSection(lineTarget(), applyL));
        p.appendChild(shapeSection({
          stroke: sp.stroke, strokeWidth: sp.strokeWidth, dash: sp.dash,
          cornerRadius: sp.cornerRadius, fillColor: sp.fillColor, fillOpacity: sp.fillOpacity,
          haloColor: sp.haloColor, haloWidth: sp.haloWidth
        }, applyS));
        break;
      case 'cimage':
        p.appendChild(lineSection(lineTarget(), applyL));
        break;
      case 'magnifier': case 'smagnifier':
        p.appendChild(lensDefaultsSection());
        break;
      case 'sticker':
        p.appendChild(stickerSection());
        break;
      case 'mosaic':
        p.appendChild(mosaicSection());
        break;
    }
  }

  function renderCanvasPanel(p) {
    p.appendChild(el('h3', 'pnl-title', '画布'));
    p.appendChild(measureSection());
    const exp = sec('导出选项');
    exp.appendChild(row('分辨率', selectField([['1× 原尺寸', 1], ['0.5× 缩小', 0.5], ['2× 放大', 2]], APP.exportOpts.scale, v => {
      APP.exportOpts.scale = v;
      saveUserData();
    })));
    exp.appendChild(row('JPG 质量', rangeField(Math.round((APP.exportOpts.jpegQuality || 0.92) * 100), { min: 50, max: 100, step: 1 }, v => {
      APP.exportOpts.jpegQuality = v / 100;
      saveUserData();
    })));
    const etg = el('div', 'ftoggles');
    etg.appendChild(checkField('包含图片外的标注', APP.exportOpts.includeOutside !== false, v => {
      APP.exportOpts.includeOutside = v;
      saveUserData();
    }));
    exp.appendChild(etg);
    p.appendChild(exp);
    const sh = sec('标注显示');
    const tg = el('div', 'ftoggles');
    tg.appendChild(checkField('新标注默认带阴影', APP.annoShadowOn, v => { APP.annoShadowOn = v; saveUserData(); }));
    tg.appendChild(checkField('新标注默认白色描边', true, () => { toast('可在对应工具的样式面板中调整描边'); }));
    sh.appendChild(tg);
    p.appendChild(sh);
    const s = sec('操作提示');
    s.appendChild(el('p', 'fnote',
      '• 上传图片后选择左侧工具进行标注\n' +
      '• 选中对象后可在右侧调整样式（含阴影开关、白色描边）\n' +
      '• 双击文字对象可快速编辑内容\n' +
      '• Ctrl+Z 撤销 / Ctrl+Y 重做\n' +
      '• Delete 删除选中 / Ctrl+D 复制\n' +
      '• Esc 取消当前工具 / V 回到选择'));
    p.appendChild(s);
    if (!CV._baseImage) {
      const up = el('button', 'btn primary full', '📤 上传图片开始标注');
      up.onclick = () => document.getElementById('fileInput').click();
      p.appendChild(up);
    }
  }

  function renderPanel() {
    const p = document.getElementById('panelContent');
    p.innerHTML = '';
    const sel = CV.getActiveObject();
    if (sel) { renderObjectPanel(p, sel); renderGlobalStyle(); return; }
    if (TOOLMGR.current && TOOLMGR.current !== 'select') { renderToolPanel(p, TOOLMGR.current); renderGlobalStyle(); return; }
    renderCanvasPanel(p);
    renderGlobalStyle();
  }

  /* ---------- 提示 / Toast ---------- */
  function setHint(t) { document.getElementById('hint').textContent = t || ''; }
  function focusContent() {
    const ta = document.getElementById('contentInput');
    if (ta) { ta.focus(); ta.select(); }
  }
  let toastTimer = null;
  function toast(msg) {
    const el0 = document.getElementById('toast');
    el0.textContent = msg;
    el0.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el0.classList.remove('show'), 2200);
  }

  /* ---------- 暴露给 tools.js ---------- */
  APP.pushHistory = pushHistory;
  APP.pushHistoryDebounced = pushHistoryDebounced;
  APP.undo = undo;
  APP.redo = redo;
  APP.renderPanel = renderPanel;
  APP.setHint = setHint;
  APP.focusContent = focusContent;
  APP.markSnap = markSnap;
  APP.toast = toast;
  APP.popIn = popIn;
  APP.__hist = hist; // 测试/调试钩子：暴露撤销栈

  /* ---------- 画布事件 ---------- */
  CV.on('object:added', e => {
    if (APP.restoring) return;
    if (e.target && e.target._temp) return;
    if (APP.skipNextAdd) { APP.skipNextAdd = false; return; }
    const o = e.target;
    if (o && !isPinned(o)) {
      if (!o.shadow && APP.annoShadowOn) o.shadow = APP.annoShadow;
      if (!o.layerId) APP.assignAnnotationLayer(o);
    }
    if (!APP.batch) pushHistory();
    markSnap();
  });
  CV.on('object:removed', e => {
    if (APP.restoring) return;
    if (e.target && e.target._temp) return;
    if (!APP.batch) pushHistory();
    markSnap();
  });
  CV.on('object:modified', e => {
    if (APP.restoring) return;
    const o = e.target;
    // 拖动结束：恢复拖动期间临时移除的阴影
    if (o && o.__dragShadow) {
      o.shadow = o.__dragShadow;
      o.__dragShadow = null;
      o.set('dirty', true);
    }
    // 点拖拽结束：重算包围盒，让选择框覆盖拖到的位置（拖动期间保持冻结）
    if (o && o.__ptDrag) {
      o.__ptDrag = false;
      if (typeof o.relayout === 'function') {
        o.relayout();
        o.set({ left: o._offX || o.left, top: o._offY || o.top });
        o.setCoords();
      }
      o.set('dirty', true);
    }
    // 文字缩放后把比例合并进字号，保证面板字号与实际显示一致
    if (o && o.type === 'annoText' && o.tx) {
      const s = (o.scaleX + o.scaleY) / 2;
      if (Math.abs(s - 1) > 0.001) {
        o.tx.fontSize = Math.max(6, Math.round(o.tx.fontSize * s));
        o.set({ scaleX: 1, scaleY: 1 });
        o.relayout();
        o.set({ left: o._offX || o.left, top: o._offY || o.top });
        o.setCoords();
        o.set('dirty', true);
        if (CV._activeObject === o) renderPanel();
      }
    }
    // 引出类/曲线类对象：角点缩放后把比例合并进内容坐标（否则拖动控制点松手后整体偏移）
    if (o && typeof o.bakeScale === 'function') o.bakeScale();
    if (!APP.batch) pushHistory();
    markSnap();
  });
  const onSelectionChange = () => renderPanel();
  CV.on('selection:created', onSelectionChange);
  CV.on('selection:updated', onSelectionChange);
  CV.on('selection:cleared', onSelectionChange);
  // 指针捕获：拖动对象/手柄时鼠标移出画布也持续跟手（fabric 的 mousemove 只绑在画布元素上）
  CV.on('mouse:down', e => {
    const t = e.target;
    if (t && e.e && e.e.pointerId != null) {
      try { CV.upperCanvasEl.setPointerCapture(e.e.pointerId); } catch (err) { /* 忽略 */ }
    }
  });
  CV.on('after:render', () => { if (APP.needsSnap) scheduleSnap(); });
  CV.on('dblclick', e => {
    const t = e.target;
    if (t && t.textContent != null && t.tx) {
      CV.setActiveObject(t);
      renderPanel();
      focusContent();
    }
  });

  /* ---------- 工具栏绑定 ---------- */
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.addEventListener('click', () => TOOLMGR.select(b.dataset.tool));
  });

  /* ---------- 顶栏按钮 ---------- */
  document.getElementById('btnUpload').onclick = () => document.getElementById('fileInput').click();
  document.getElementById('fileInput').addEventListener('change', e => {
    loadImageFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btnExport').onclick = () => exportImage('png');
  document.getElementById('btnExportJpg').onclick = () => exportImage('jpg');
  document.getElementById('btnCopy').onclick = copyPngToClipboard;
  document.getElementById('btnSave').onclick = saveProject;
  document.getElementById('btnLoad').onclick = () => document.getElementById('projectInput').click();
  document.getElementById('projectInput').addEventListener('change', e => {
    loadProject(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btnUndo').onclick = undo;
  document.getElementById('btnRedo').onclick = redo;
  document.getElementById('btnDel').onclick = deleteSelection;
  document.getElementById('btnZoomIn').onclick = () => applyZoom((CV.viewportTransform[0] || 1) * 1.2);
  document.getElementById('btnZoomOut').onclick = () => applyZoom((CV.viewportTransform[0] || 1) / 1.2);
  document.getElementById('btnZoomPct').onclick = () => applyZoom(1);
  document.getElementById('btnFit').onclick = fitZoom;
  document.getElementById('btnTheme').onclick = () => applyTheme(!document.body.classList.contains('light'));

  /* ---------- 键盘 ---------- */
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'e') { e.preventDefault(); exportImage('png'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Escape') { TOOLMGR.select('select'); return; }
    if (k === 'v') { TOOLMGR.select('select'); return; }
    // 方向键微调选中对象（Shift 为 10px）
    if (e.key.startsWith('Arrow')) {
      const objs = CV.getActiveObjects();
      if (objs.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -d;
        else if (e.key === 'ArrowRight') dx = d;
        else if (e.key === 'ArrowUp') dy = -d;
        else if (e.key === 'ArrowDown') dy = d;
        objs.forEach(o => {
          o.set({ left: (o.left || 0) + dx, top: (o.top || 0) + dy });
          o.setCoords();
        });
        CV.requestRenderAll();
        pushHistoryDebounced();
        return;
      }
    }
    if (e.key === 'Enter') {
      if (TOOLMGR.current === 'area') { TOOLMGR.finishArea(); return; }
      if (TOOLMGR.current === 'cmulti' && TOOLMGR.state.cmulti && TOOLMGR.state.cmulti.phase === 'anchors') {
        TOOLMGR.finishCmulti();
        return;
      }
    }
  });

  /* ---------- 拖拽 / 粘贴 / 右键 ---------- */
  const wrap = document.getElementById('canvasWrap');
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('dragging'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('dragging'));
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    wrap.classList.remove('dragging');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type && f.type.startsWith('image/')) loadImageFile(f);
  });
  wrap.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (TOOLMGR.current === 'area') { TOOLMGR.finishArea(); return; }
    if (TOOLMGR.current === 'cmulti' && TOOLMGR.state.cmulti && TOOLMGR.state.cmulti.phase === 'anchors') {
      TOOLMGR.finishCmulti();
    }
  });
  window.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) { loadImageFile(f); return; }
      }
    }
  });

  /* ---------- 主题切换（亮/暗，记忆选择） ---------- */
  function applyTheme(light) {
    document.body.classList.toggle('light', !!light);
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = light ? '☀️' : '🌙';
    try { localStorage.setItem('anno-theme', light ? 'light' : 'dark'); } catch (e) { /* 忽略 */ }
  }
  function initTheme() {
    let light = false;
    try { light = localStorage.getItem('anno-theme') === 'light'; } catch (e) { /* 忽略 */ }
    applyTheme(light);
  }

  /* ---------- 用户样式数据记忆（localStorage） ---------- */
  const USER_DATA_KEY = 'anno-userdata';
  function saveUserData() {
    try {
      const data = {
        textProps: APP.textProps,
        shapeProps: APP.shapeProps,
        lineProps: APP.lineProps,
        calloutBg: APP.calloutBg,
        annoShadowOn: APP.annoShadowOn,
        scale: APP.scale,
        sticker: APP.sticker,
        stickerSize: APP.stickerSize,
        stepRadius: APP.stepRadius,
        lens: APP.lens,
        mosaic: APP.mosaic,
        exportOpts: APP.exportOpts
      };
      localStorage.setItem(USER_DATA_KEY, JSON.stringify(data));
      APP.userDataLoaded = true;
    } catch (e) { /* 忽略 */ }
  }
  function loadUserData() {
    try {
      const raw = localStorage.getItem(USER_DATA_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.textProps) Object.assign(APP.textProps, d.textProps);
      if (d.shapeProps) Object.assign(APP.shapeProps, d.shapeProps);
      if (d.lineProps) Object.assign(APP.lineProps, d.lineProps);
      if (d.calloutBg) Object.assign(APP.calloutBg, d.calloutBg);
      if (typeof d.annoShadowOn === 'boolean') APP.annoShadowOn = d.annoShadowOn;
      if (d.scale) Object.assign(APP.scale, d.scale);
      if (d.sticker) APP.sticker = d.sticker;
      if (d.stickerSize) APP.stickerSize = d.stickerSize;
      if (d.stepRadius) APP.stepRadius = d.stepRadius;
      if (d.lens) Object.assign(APP.lens, d.lens);
      if (d.mosaic) Object.assign(APP.mosaic, d.mosaic);
      if (d.exportOpts) Object.assign(APP.exportOpts, d.exportOpts);
      APP.userDataLoaded = true;
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 侧边栏：全局样式（默认样式 + 应用到已有标注） ---------- */
  function applyGlobalToAll() {
    const objs = CV.getObjects().filter(o => !isPinned(o));
    let count = 0;
    objs.forEach(o => {
      let changed = false;
      if (o.tx) {
        Object.assign(o.tx, deepCopy(APP.textProps));
        changed = true;
      }
      if (o.line) {
        o.line.color = APP.lineProps.stroke;
        o.line.width = APP.lineProps.width;
        o.line.dash = APP.lineProps.dash ? APP.lineProps.dash.slice() : null;
        o.line.haloColor = APP.lineProps.haloColor;
        o.line.haloWidth = APP.lineProps.haloWidth;
        changed = true;
      }
      if (o.shape) {
        o.shape.stroke = APP.shapeProps.stroke;
        o.shape.strokeWidth = APP.shapeProps.strokeWidth;
        o.shape.dash = APP.shapeProps.dash ? APP.shapeProps.dash.slice() : null;
        o.shape.haloColor = APP.shapeProps.haloColor;
        o.shape.haloWidth = APP.shapeProps.haloWidth;
        changed = true;
      }
      if (o.type === 'rect') {
        o.set({
          stroke: APP.shapeProps.stroke,
          strokeWidth: APP.shapeProps.strokeWidth,
          strokeDashArray: APP.shapeProps.dash ? APP.shapeProps.dash.slice() : null
        });
        changed = true;
      }
      if (o.type === 'line' || o.type === 'path') {
        o.set({
          stroke: APP.lineProps.stroke,
          strokeWidth: APP.lineProps.width,
          strokeDashArray: APP.lineProps.dash ? APP.lineProps.dash.slice() : null
        });
        changed = true;
      }
      if (APP.annoShadowOn) { if (!o.shadow) o.shadow = APP.annoShadow; changed = true; }
      else if (o.shadow) { o.shadow = null; changed = true; }
      if (changed) {
        o.set('dirty', true);
        if (typeof o.relayout === 'function') {
          o.relayout();
          o.set({ left: o._offX || o.left, top: o._offY || o.top });
          o.setCoords();
        }
        count++;
      }
    });
    if (count) {
      CV.requestRenderAll();
      markSnap();
      pushHistory();
      toast('已将全局样式应用到 ' + count + ' 个标注');
    } else {
      toast('当前没有可应用的标注');
    }
  }

  function renderGlobalStyle() {
    const box = document.getElementById('globalStyleBox');
    if (!box) return;
    box.innerHTML = '';
    const tp = APP.textProps, sp = APP.shapeProps, lp = APP.lineProps;
    const save = () => saveUserData();
    const applyT = (k, v) => { tp[k] = v; save(); };
    const applyS = (k, v) => { sp[k] = v; save(); };
    // lineSection 的颜色字段使用键 'color'，而全局线条颜色存储在 lineProps.stroke 上
    // （对象上才是 line.color），这里统一映射，否则改颜色不生效
    const applyL = (k, v) => { lp[k === 'color' ? 'stroke' : k] = v; save(); };
    box.appendChild(lineSection({
      color: lp.stroke, width: lp.width, dash: lp.dash,
      haloColor: lp.haloColor, haloWidth: lp.haloWidth
    }, applyL));
    box.appendChild(textSection(tp, applyT));
    box.appendChild(shapeSection({
      stroke: sp.stroke, strokeWidth: sp.strokeWidth, dash: sp.dash,
      cornerRadius: sp.cornerRadius, fillColor: sp.fillColor, fillOpacity: sp.fillOpacity,
      haloColor: sp.haloColor, haloWidth: sp.haloWidth
    }, applyS));
    const sh = sec('阴影');
    const tg = el('div', 'ftoggles');
    tg.appendChild(checkField('新标注默认带阴影', APP.annoShadowOn, v => { APP.annoShadowOn = v; save(); }));
    sh.appendChild(tg);
    box.appendChild(sh);
    const applyBtn = el('button', 'btn full', '🔄 应用到已有标注');
    applyBtn.title = '将上方全局样式套用到画布上所有已有标注';
    applyBtn.onclick = applyGlobalToAll;
    box.appendChild(applyBtn);
  }

  /* ---------- 无限画布：滚轮缩放 / 空格·中键平移 ---------- */
  CV.on('mouse:wheel', e => {
    e.e.preventDefault();
    if (!CV._baseImage) return;
    cancelViewportAnim();
    const pt = CV.getPointer(e.e);
    const z = Math.max(0.02, Math.min(20, CV.getZoom() * (e.e.deltaY > 0 ? 0.9 : 1.1)));
    CV.zoomToPoint(pt, z);
    updateZoomLabel();
  });
  let spaceDown = false;
  let panState = null;
  const canvasEl = CV.upperCanvasEl;
  // 指针捕获：按下即捕获，把控制点拖出画布/窗口后 mousemove/mouseup 仍持续送达画布。
  // 否则在窗口外松手时 mouseup 会丢失，fabric 的变换悬挂不结束，下一次鼠标移动会
  // 用巨大的增量继续旧变换，表现为"把控制点拖出画布后标注乱跳"。
  canvasEl.addEventListener('pointerdown', e => {
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { /* 旧浏览器不支持时忽略 */ }
  });
  canvasEl.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      e.stopPropagation();
      cancelViewportAnim();
      panState = { sx: e.clientX, sy: e.clientY, vt: CV.viewportTransform.slice() };
      canvasEl.style.cursor = 'grabbing';
    }
  }, true);
  window.addEventListener('mousemove', e => {
    if (!panState) return;
    const vt = panState.vt;
    CV.setViewportTransform([vt[0], 0, 0, vt[3], vt[4] + e.clientX - panState.sx, vt[5] + e.clientY - panState.sy]);
    CV.requestRenderAll();
  });
  window.addEventListener('mouseup', () => {
    if (panState) {
      panState = null;
      canvasEl.style.cursor = spaceDown ? 'grab' : '';
    }
  });
  const isTypingTarget = e => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat && !isTypingTarget(e)) {
      spaceDown = true;
      canvasEl.style.cursor = 'grab';
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      spaceDown = false;
      if (!panState) canvasEl.style.cursor = '';
    }
  });

  /* ---------- 图层按钮 / 画布尺寸 ---------- */
  document.getElementById('btnAddLayer').onclick = addLayer;
  window.addEventListener('resize', resizeCanvas);

  function hideDropTip() { document.getElementById('dropTip').style.display = 'none'; }
  function updateHistButtons() {
    document.getElementById('btnUndo').disabled = hist.undo.length < 2;
    document.getElementById('btnRedo').disabled = !hist.redo.length;
  }

  /* ---------- 启动 ---------- */
  loadUserData();
  initTheme();
  TOOLMGR.init(CV);
  resizeCanvas();
  TOOLMGR.select('select');
  renderPanel();
  renderLayers();
  renderTabs();
  updateHistButtons();
})();
