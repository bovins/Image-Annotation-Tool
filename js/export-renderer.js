/* One range/size calculation powers preview, clipboard, single and batch export. */
(function () {
  'use strict';
  const F = window.fabric;
  const excluded = o => o._temp || o.visible === false || o.type === 'magnifier' || o.type === 'squareMagnifier';
  function bounds(o, effects) {
    const sw = o.strokeWidth || 0;
    const hx = (o.width + sw) / 2, hy = (o.height + sw) / 2, m = o.calcTransformMatrix();
    const points = [[-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy]].map(([x, y]) => F.util.transformPoint({ x, y }, m));
    let padding = effects === false ? 0 : 1;
    if (o.line) padding += (o.line.width || 0) + (o.line.haloWidth || 0);
    if (o.shape) padding += (o.shape.strokeWidth || 0) + (o.shape.haloWidth || 0);
    const magnification = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
    padding *= magnification;
    if (effects === false) padding = 0;
    const shadow = effects === false ? null : o.shadow;
    const blur = shadow ? (shadow.blur || 0) * 2 * (shadow.nonScaling ? 1 : magnification) : 0;
    const sx = shadow ? (shadow.offsetX || 0) * magnification : 0, sy = shadow ? (shadow.offsetY || 0) * magnification : 0;
    return { left: Math.min(...points.map(p => p.x)) - padding - blur + Math.min(0, sx),
      top: Math.min(...points.map(p => p.y)) - padding - blur + Math.min(0, sy),
      right: Math.max(...points.map(p => p.x)) + padding + blur + Math.max(0, sx),
      bottom: Math.max(...points.map(p => p.y)) + padding + blur + Math.max(0, sy) };
  }
  function describe(cv, options, format) {
    const opt = options || {}, range = opt.range || (opt.includeOutside === false ? 'image' : 'all');
    let left = 0, top = 0, right = cv._baseW, bottom = cv._baseH;
    if (range === 'all') cv.getObjects().filter(o => !excluded(o) && o !== cv._baseImage).forEach(o => {
      const b = bounds(o); left = Math.min(left, b.left); top = Math.min(top, b.top); right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
    });
    if (range === 'custom') {
      const crop = opt.crop || {};
      if (![crop.x, crop.y, crop.w, crop.h].every(Number.isFinite) || crop.w <= 0 || crop.h <= 0) throw new Error('裁剪宽高必须为正数，坐标必须有效');
      left = crop.x; top = crop.y; right = left + crop.w; bottom = top + crop.h;
    }
    left = Math.floor(left); top = Math.floor(top); right = Math.ceil(right); bottom = Math.ceil(bottom);
    const w = right - left, h = bottom - top, requested = Number(opt.scale == null ? 1 : opt.scale);
    if (!(w > 0 && h > 0 && requested > 0 && Number.isFinite(requested)) || Math.max(Math.abs(left), Math.abs(top), w, h) > 1e8) throw new Error('导出尺寸或倍率无效');
    const scale = Math.min(requested, 8192 / w, 8192 / h, Math.sqrt(32000000 / (w * h)));
    const width = Math.max(1, Math.floor(w * scale)), height = Math.max(1, Math.floor(h * scale));
    const background = opt.background === 'color' ? opt.backgroundColor || '#ffffff' : opt.background === 'white' || format === 'jpg' ? '#ffffff' : null;
    return { left, top, w, h, width, height, scale, requested, limited: scale < requested - 1e-9, range, background, format: format || 'png', quality: Math.max(0.1, Math.min(1, Number(opt.jpegQuality) || 0.92)) };
  }
  function render(cv, options, format) {
    if (!cv._baseImage) throw new Error('请先上传图片');
    const info = describe(cv, options, format), canvas = document.createElement('canvas');
    const scene = new F.StaticCanvas(canvas, { width: info.width, height: info.height,
      enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false, backgroundColor: info.background });
    scene.viewportTransform = [info.scale, 0, 0, info.scale, -info.left * info.scale, -info.top * info.scale];
    const objects = cv.getObjects().filter(o => !excluded(o));
    const owners = objects.map(o => o.canvas);
    try {
      // Synchronous isolated rendering. The live view, selection and visibility
      // never change; only the renderer queried by object caches is scoped here.
      objects.forEach(o => { o.canvas = scene; });
      scene.renderCanvas(scene.contextContainer, objects);
    } finally {
      objects.forEach((o, i) => { o.canvas = owners[i]; });
      // StaticCanvas has no DOM event bindings. dispose() would clear the output
      // pixels; cancel its render request and let this isolated renderer be GC'd.
      scene.cancelRequestedRender();
    }
    canvas.exportInfo = info;
    return canvas;
  }
  window.ExportRenderer = { describe, render, bounds };
})();
