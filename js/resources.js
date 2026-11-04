/* Pixel resources use working-image coordinates; no live blob URLs enter files. */
(function () {
  'use strict';
  const R = window.ImageResources = {
    canvas(source, w, h) {
      if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) throw new Error('图片尺寸无效');
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('无法创建图片画布');
      ctx.drawImage(source, 0, 0, w, h);
      return c;
    },
    prepare(source, dimensions) {
      const ow = source.naturalWidth || source.width, oh = source.naturalHeight || source.height;
      const ratio = Math.min(1, 4096 / Math.max(ow, oh));
      const w = dimensions ? dimensions.w : Math.max(1, Math.round(ow * ratio));
      const h = dimensions ? dimensions.h : Math.max(1, Math.round(oh * ratio));
      return { element: R.canvas(source, w, h), w, h, original: { w: ow, h: oh } };
    },
    data(source, w, h) { return R.canvas(source, w, h).toDataURL('image/png'); },
    image(src) {
      return new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('图片资源损坏，无法解码'));
        image.src = src;
      });
    },
    filename(name) {
      let result = String(name || 'annotation').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'annotation';
      if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(result)) result = '_' + result;
      return result;
    },
    stem(name) { return R.filename(String(name || '').replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '')); }
  };
})();
