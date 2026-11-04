(function () {
  'use strict';
  const A = window.APP, C = window.CV;
  const dialog = document.createElement('dialog'); dialog.className = 'export-dialog';
  dialog.setAttribute('aria-labelledby', 'exportTitle');
  dialog.innerHTML = '<h2 id="exportTitle">导出预览</h2><div class="export-layout"><div class="export-controls"></div><div class="export-preview"></div></div><p class="export-info" role="status"></p><p class="fnote">请检查最终字号和线宽是否可读。提高导出倍率会放大现有像素，不能恢复原图细节。放大镜不参与导出。</p><div class="export-actions"></div>';
  document.body.append(dialog);
  const controls = dialog.querySelector('.export-controls'), preview = dialog.querySelector('.export-preview'), info = dialog.querySelector('.export-info'), actions = dialog.querySelector('.export-actions');
  let canvas = null, timer = null, owner = null, busy = false, generation = 0, format = 'png';
  function select(id, label, values, initial) {
    const l = document.createElement('label'); l.textContent = label;
    const s = document.createElement('select'); s.id = id;
    values.forEach(([text, value]) => { const o = document.createElement('option'); o.textContent = text; o.value = value; s.append(o); });
    s.value = initial; s.onchange = schedule; l.append(s); controls.append(l); return s;
  }
  function number(id, label, initial, min, max, step) {
    const l = document.createElement('label'); l.textContent = label;
    const n = document.createElement('input'); n.type = 'number'; n.id = id; n.value = initial; if (min != null) n.min = min; if (max != null) n.max = max; n.step = step || 'any'; n.oninput = schedule;
    l.append(n); controls.append(l); return n;
  }
  function button(text, fn) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = text; b.onclick = fn; actions.append(b); return b; }
  const fields = {};
  function options() {
    return { range: fields.range.value, scale: Number(fields.scale.value), jpegQuality: Number(fields.quality.value) / 100,
      background: fields.background.value, backgroundColor: fields.color.value,
      crop: { x: Number(fields.x.value), y: Number(fields.y.value), w: Number(fields.w.value), h: Number(fields.h.value) } };
  }
  function schedule() { clearTimeout(timer); exportButton.disabled = batchButton.disabled = true; timer = setTimeout(update, 180); }
  async function update() {
    const token = ++generation;
    try {
      await Promise.all(C.getObjects().map(o => o._ready).filter(Boolean));
      if (token !== generation || !dialog.open) return;
      format = fields.format.value;
      const next = ExportRenderer.render(C, options(), format);
      if (canvas) canvas.width = canvas.height = 1;
      canvas = next; preview.replaceChildren(canvas);
      const m = canvas.exportInfo;
      canvas.setAttribute('aria-label', '实际导出预览 ' + m.width + '×' + m.height);
      info.textContent = m.width + ' × ' + m.height + ' px · 实际倍率 ' + m.scale.toFixed(3) + '× · 范围 ' + m.range + ' (' + m.left + ', ' + m.top + ', ' + m.w + ', ' + m.h + ') · 背景 ' + (m.background || '透明') + ' · ' + format.toUpperCase() + (format === 'jpg' ? ' 质量 ' + Math.round(m.quality * 100) + '%' : '') + (m.limited ? '。超过安全限额，已等比限制至最大边 8192 / 总像素 3200 万。' : '');
      exportButton.disabled = batchButton.disabled = false;
      A.exportOpts = Object.assign(A.exportOpts, options()); A.savePreferences();
    } catch (err) { info.textContent = '无法预览：' + err.message; exportButton.disabled = batchButton.disabled = true; }
  }
  function blob(c, kind, quality) {
    return new Promise((resolve, reject) => {
      try { c.toBlob(result => result ? resolve(result) : reject(new Error('浏览器图片编码失败')), kind === 'jpg' ? 'image/jpeg' : 'image/png', quality); }
      catch (err) { reject(err); }
    });
  }
  async function downloadCurrent() {
    if (!canvas || busy) return;
    busy = true; exportButton.disabled = batchButton.disabled = true;
    try {
      const file = await blob(canvas, format, canvas.exportInfo.quality);
      A.downloadBlob(file, ImageResources.stem(owner.name) + '.' + format);
      A.toast('图片已导出；工程修改状态保持不变');
    } catch (err) { A.toast('导出失败：' + err.message); }
    finally { busy = false; exportButton.disabled = batchButton.disabled = false; }
  }
  async function exportAll() {
    if (busy) return;
    busy = true; exportButton.disabled = batchButton.disabled = true;
    const active = A.activeTabIndex, tabs = A.tabs.slice(), opts = options(), names = new Set();
    // Close the modal and block editing while the single reusable export pipeline
    // walks tabs. At most one full-size output canvas exists in this loop.
    dialog.close(); document.getElementById('exporting').classList.add('show');
    try {
      if (canvas) { canvas.width = canvas.height = 1; canvas = null; }
      for (const tab of tabs) {
        await A.activateTab(A.tabs.indexOf(tab));
        await Promise.all(C.getObjects().map(o => o._ready).filter(Boolean));
        let base = ImageResources.stem(tab.name), name = base, suffix = 2;
        while (names.has(name.toLowerCase())) name = base + ' (' + suffix++ + ')'; names.add(name.toLowerCase());
        const output = ExportRenderer.render(C, opts, format);
        try { A.downloadBlob(await blob(output, format, output.exportInfo.quality), name + '.' + format); }
        finally { output.width = output.height = 1; }
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      A.toast('已逐图导出 ' + tabs.length + ' 张；浏览器若拦截多个下载，请允许此页面下载多个文件');
    } catch (err) { A.toast('批量导出中止：' + err.message); }
    finally { await A.activateTab(active); document.getElementById('exporting').classList.remove('show'); busy = false; }
  }
  const exportButton = button('导出当前图片', downloadCurrent), batchButton = button('批量导出全部标签页', exportAll);
  button('取消', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; clearTimeout(timer); if (canvas && !busy) { canvas.width = canvas.height = 1; canvas = null; } });
  function open(kind) {
    if (!C._baseImage || A.restoring || busy) { A.toast('请先上传图片并等待载入'); return; }
    owner = A.tabs[A.activeTabIndex]; format = kind === 'jpg' ? 'jpg' : 'png';
    controls.replaceChildren(); const o = A.exportOpts || {};
    fields.format = select('exportFormat', '格式', [['PNG', 'png'], ['JPG', 'jpg']], format);
    fields.range = select('exportRange', '导出范围', [['原图范围', 'image'], ['全部可见标注', 'all'], ['自定义矩形', 'custom']], o.range || (o.includeOutside === false ? 'image' : 'all'));
    fields.scale = number('exportScale', '请求倍率', o.scale || 1, 0.01, 16, 0.1);
    fields.quality = number('exportQuality', 'JPG 质量 (%)', Math.round((o.jpegQuality || 0.92) * 100), 10, 100, 1);
    fields.background = select('exportBackground', '背景（JPG 透明按白色）', [['透明', 'transparent'], ['白色', 'white'], ['自选颜色', 'color']], o.background || 'transparent');
    const l = document.createElement('label'); l.textContent = '背景颜色'; fields.color = document.createElement('input'); fields.color.type = 'color'; fields.color.id = 'exportColor'; fields.color.value = o.backgroundColor || '#ffffff'; fields.color.oninput = schedule; l.append(fields.color); controls.append(l);
    const crop = o.crop || { x: 0, y: 0, w: C._baseW, h: C._baseH };
    ['x', 'y', 'w', 'h'].forEach(k => { fields[k] = number('exportCrop' + k.toUpperCase(), '裁剪 ' + k + '（工作图坐标）', crop[k], k === 'w' || k === 'h' ? 0.01 : null); });
    dialog.showModal(); update();
  }
  window.ExportUI = { open, update, exportAll };
})();
