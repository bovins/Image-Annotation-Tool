/* Versioned files and IndexedDB drafts. No application state is mutated here. */
(function () {
  'use strict';
  const raster = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,[a-z0-9+/=\s]+$/i;
  const supported = new Set(['annoText', 'messageBox', 'stepNumber', 'calloutText', 'multiCallout',
    'calloutRegion', 'calloutImage', 'dimension', 'angleMeasure', 'areaMeasure', 'magnifier',
    'squareMagnifier', 'splinePath', 'annoLine', 'annoRect', 'rect', 'line', 'path', 'image', 'circle', 'ellipse', 'triangle', 'polygon', 'polyline', 'text', 'i-text', 'textbox']);
  function positive(n, label) { if (!Number.isFinite(n) || n <= 0) throw new Error(label + '必须为有限正数'); }
  function dimensions(w, h) {
    positive(w, '图片宽度'); positive(h, '图片高度');
    if (!Number.isInteger(w) || !Number.isInteger(h) || Math.max(w, h) > 16384 || w * h > 64000000) throw new Error('图片尺寸超过安全限制');
  }
  function inspect(value, depth) {
    if (depth > 40) throw new Error('工程嵌套过深');
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e8)) throw new Error('数值无效或过大');
    if (Array.isArray(value) && value.length > 100000) throw new Error('数组过大');
    if (value && typeof value === 'object') Object.keys(value).forEach(k => {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('工程包含不安全字段');
      inspect(value[k], depth + 1);
    });
  }
  async function resource(src, label) {
    if (typeof src !== 'string' || !raster.test(src)) throw new Error(label + '须为内嵌图片数据（不接受在线或已失效的 blob 资源）');
    return ImageResources.image(src);
  }
  const P = window.ProjectStore = {
    version: 2, dimensions,
    async prepare(input) {
      inspect(input, 0);
      if (!input || input.app !== 'image-annotator') throw new Error('不是单图工程');
      if (![1, 2].includes(input.version)) throw new Error('不支持的工程版本 ' + input.version + '，请使用相应版本的工具');
      if (!input.base || !input.objects || !Array.isArray(input.objects.objects)) throw new Error('缺少底图或标注列表');
      const data = JSON.parse(JSON.stringify(input));
      dimensions(data.base.w, data.base.h);
      data.settings = data.settings || {};
      const styleSchema = { textProps: window.DEF_TEXT, shapeProps: window.DEF_SHAPE,
        lineProps: { stroke: '#ff5252', width: 3, dash: null, haloColor: '#ffffff', haloWidth: 2, arrowStyle: 'solid' }, calloutBg: window.DEF_BG };
      for (const section of Object.keys(styleSchema)) {
        if (data.settings[section] == null) continue;
        const values = data.settings[section];
        if (typeof values !== 'object' || Array.isArray(values)) throw new Error('默认样式字段无效：' + section);
        const clean = {};
        for (const key of Object.keys(styleSchema[section])) {
          if (!(key in values)) continue;
          const value = values[key], model = styleSchema[section][key];
          if (model === null) {
            if (value !== null && (!Array.isArray(value) || value.length > 20 || value.some(n => !Number.isFinite(n) || n < 0 || n > 4096))) throw new Error('默认线形无效');
          } else if (typeof value !== typeof model || typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 4096) || typeof value === 'string' && (value.length > 200 || /url\s*\(/i.test(value))) throw new Error('默认样式无效：' + key);
          clean[key] = key === 'arrowStyle' && !window.fabric.ArrowStyles.includes(value) ? 'solid' : value;
        }
        data.settings[section] = clean;
      }
      data.settings.scale = data.settings.scale || { pxPerUnit: 1, unit: '' };
      positive(data.settings.scale.pxPerUnit, '测量比例');
      if (typeof data.settings.scale.unit !== 'string' || data.settings.scale.unit.length > 32) throw new Error('单位名称无效');
      if (data.viewport && (!Array.isArray(data.viewport) || data.viewport.length !== 6 || !data.viewport.every(Number.isFinite) || data.viewport[0] <= 0 || data.viewport[3] <= 0)) throw new Error('视口数据无效');
      if (data.objects.objects.length > 10000) throw new Error('标注数超过 10000');
      const warnings = [], objects = [];
      for (const o of data.objects.objects) {
        if (!o || !supported.has(o.type)) { warnings.push('不支持的对象：' + (o && o.type)); continue; }
        for (const key of ['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'opacity', 'radius']) {
          if (o[key] != null && (!Number.isFinite(o[key]) || ['width', 'height', 'radius'].includes(key) && o[key] < 0)) throw new Error(o.type + ' 数值字段无效：' + key);
        }
        if (o.clipPath || o.fill && typeof o.fill === 'object' || o.stroke && typeof o.stroke === 'object') throw new Error('不支持嵌套裁剪或外部图案资源');
        if (['dimension', 'areaMeasure'].includes(o.type)) positive(o.scale == null ? 1 : o.scale, '对象测量比例');
        for (const key of ['p1', 'p2', 'v', 'anchor', 'textPos', 'boxPos']) {
          if (o[key] && (!Number.isFinite(o[key].x) || !Number.isFinite(o[key].y))) throw new Error(o.type + ' 坐标无效：' + key);
        }
        for (const key of ['pts', 'points', 'anchors']) {
          if (o[key] && (!Array.isArray(o[key]) || o[key].some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error(o.type + ' 点列表无效');
        }
        if (o.type === 'image' || o.imgSrc) {
          try { await resource(o.type === 'image' ? o.src : o.imgSrc, o.type); }
          catch (err) { warnings.push(o.type + ' 未恢复：' + err.message); continue; }
        }
        if (o.mosaicOverlay) { data.mosaic = o.src; continue; }
        objects.push(o);
      }
      data.objects.objects = objects;
      if (data.layers != null && !Array.isArray(data.layers)) throw new Error('图层列表无效');
      const ids = new Set();
      (data.layers || []).forEach(l => {
        if (!l || typeof l.id !== 'string' || !l.id || ids.has(l.id) || typeof l.name !== 'string') throw new Error('图层名称或 ID 无效/重复');
        if (l.automatic != null && typeof l.automatic !== 'boolean') throw new Error('图层来源标记无效');
        ids.add(l.id);
      });
      const baseImage = await resource(data.base.src, '底图');
      // v1 saved logical dimensions could disagree with image natural pixels.
      const base = ImageResources.prepare(baseImage, data.base);
      if ((baseImage.naturalWidth || baseImage.width) !== data.base.w || (baseImage.naturalHeight || baseImage.height) !== data.base.h) warnings.push('旧工程底图已按逻辑尺寸重采样，请核对图引出和比例');
      let mosaic = null;
      if (data.mosaic) {
        try { mosaic = ImageResources.canvas(await resource(data.mosaic, '马赛克'), data.base.w, data.base.h); }
        catch (err) { warnings.push('马赛克未恢复：' + err.message); }
      }
      // Validate deserializers on detached objects before changing the open workspace.
      await new Promise((resolve, reject) => {
        try { fabric.util.enlivenObjects(objects, restored => restored.length === objects.length ? resolve() : reject(new Error('部分标注反序列化失败'))); }
        catch (err) { reject(err); }
      });
      return { data, base: base.element, mosaic, warnings };
    },
    async prepareWorkspace(data) {
      if (!data || data.app !== 'image-annotator-workspace' || data.version !== 1 || !Array.isArray(data.tabs) || !data.tabs.length || data.tabs.length > 100) throw new Error('工作区格式或版本无效（最多 100 个标签页）');
      const tabs = [];
      for (const tab of data.tabs) tabs.push(await P.prepare(tab));
      return { tabs, active: Math.max(0, Math.min(data.tabs.length - 1, Number.isInteger(data.active) ? data.active : 0)) };
    }
  };

  // One serialized writer; a pending generation never overwrites a newer draft.
  let dbPromise;
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
      let req;
      try { req = indexedDB.open('image-annotator-drafts', 1); } catch (err) { reject(err); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('drafts');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('草稿数据库无法打开'));
      req.onblocked = () => reject(new Error('草稿数据库被其他窗口占用'));
    });
    return dbPromise;
  }
  async function transaction(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode), store = tx.objectStore('drafts');
      const request = action(store);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('草稿存储失败，可能空间不足或权限受限'));
    });
  }
  window.DraftStore = {
    read: () => transaction('readonly', store => store.get('workspace')),
    write: value => transaction('readwrite', store => store.put(value, 'workspace')),
    clear: () => transaction('readwrite', store => store.delete('workspace'))
  };
})();
