(function () {
  'use strict';
  const A = window.APP, C = window.CV;
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('anno-ui')) || {}; } catch (_) {}
  function persist() { try { localStorage.setItem('anno-ui', JSON.stringify(prefs)); } catch (_) {} }
  function fold(side) {
    prefs[side] = !prefs[side]; document.body.classList.toggle(side + '-collapsed', prefs[side]);
    document.getElementById(side === 'left' ? 'btnSidebar' : 'btnPanel').setAttribute('aria-expanded', String(!prefs[side]));
    persist(); window.dispatchEvent(new Event('resize'));
  }
  document.getElementById('btnSidebar').onclick = () => fold('left');
  document.getElementById('btnPanel').onclick = () => fold('right');
  ['left', 'right'].forEach(side => {
    document.body.classList.toggle(side + '-collapsed', prefs[side] === true);
    document.getElementById(side === 'left' ? 'btnSidebar' : 'btnPanel').setAttribute('aria-expanded', String(prefs[side] !== true));
  });
  // Collapsible lower-frequency categories leave the basic tools in easy reach.
  document.querySelectorAll('.sidebar > .group').forEach((group, i) => {
    if (!i) return;
    const title = group.querySelector('.gtitle');
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = title.textContent; details.className = 'tool-category';
    details.open = prefs.categories && prefs.categories[summary.textContent] === true;
    const grid = document.createElement('div'); grid.className = 'tool-grid';
    Array.from(group.children).forEach(child => { if (child !== title) grid.append(child); });
    details.append(summary, grid); group.replaceWith(details);
    details.addEventListener('toggle', () => { prefs.categories = prefs.categories || {}; prefs.categories[summary.textContent] = details.open; persist(); });
  });
  // Keep the existing buttons/handlers; only decorate their presentation.
  const icons = window.UIIcons;
  const commands = {
    btnUpload: ['upload', '上传图片'], btnSave: ['save', '保存工程'], btnLoad: ['folder', '载入工程'],
    btnExport: ['download', 'PNG'], btnExportJpg: ['image', 'JPG'], btnCopy: ['copy', '复制 PNG', true],
    btnSaveWorkspace: ['save', '保存工作区'], btnLoadWorkspace: ['folder', '载入工作区'],
    btnUndo: ['undo', '撤销', true], btnRedo: ['redo', '重做', true], btnDel: ['trash', '删除选中', true],
    btnSidebar: ['leftPanel', '工具面板', true], btnPanel: ['rightPanel', '属性面板', true], btnHelp: ['help', '快捷键说明', true],
    btnZoomOut: ['minus', '缩小', true], btnZoomIn: ['plus', '放大', true], btnFit: ['fit', '适应窗口', true]
  };
  Object.keys(commands).forEach(id => icons.button(document.getElementById(id), ...commands[id]));
  document.getElementById('btnExport').setAttribute('aria-label', '导出 PNG');
  document.getElementById('btnExportJpg').setAttribute('aria-label', '导出 JPG');
  document.querySelector('.brand-mark').innerHTML = icons.svg('brand');
  document.querySelector('.empty-symbol').innerHTML = icons.svg('image');
  document.querySelectorAll('.tool-btn').forEach(b => { const icon = b.querySelector('.tico'); if (icon) icon.innerHTML = icons.svg(b.dataset.tool); });
  const workspace = document.getElementById('workspaceMenu');
  workspace.querySelector('summary').insertAdjacentHTML('afterbegin', icons.svg('mosaic'));
  workspace.addEventListener('click', e => { if (e.target.closest('.menu-items button')) workspace.open = false; });
  document.addEventListener('pointerdown', e => { if (!workspace.contains(e.target)) workspace.open = false; });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') workspace.open = false; });
  function themeIcon() {
    const light = document.body.classList.contains('light'), button = document.getElementById('btnTheme');
    const label = light ? '切换暗色主题' : '切换亮色主题'; button.title = label;
    icons.button(button, light ? 'moon' : 'sun', label, true);
  }
  themeIcon(); new MutationObserver(themeIcon).observe(document.getElementById('btnTheme'), { childList: true });
  function layerIcons() {
    document.querySelectorAll('.layer-row').forEach(row => {
      row.querySelectorAll('.layer-btn').forEach((b, i) => {
        const name = b.classList.contains('danger') ? 'trash' : i === 0 ? (b.title === '显示图层' ? 'eyeOff' : 'eye') : (b.title === '解锁图层' ? 'lock' : 'unlock');
        icons.button(b, name);
      });
    });
  }
  layerIcons(); new MutationObserver(layerIcons).observe(document.getElementById('layersList'), { childList: true, subtree: true });
  document.querySelectorAll('button').forEach(b => { if (!b.title) b.title = b.textContent.trim(); });
  const quick = document.createElement('div'); quick.className = 'quick-tools'; quick.hidden = true;
  quick.setAttribute('aria-label', '选中标注快捷操作');
  const title = document.createElement('span'); title.textContent = '选中标注';
  const color = document.createElement('input'); color.type = 'color'; color.title = '兼容对象的文字/线条/边框颜色'; color.setAttribute('aria-label', '标注颜色');
  const width = document.createElement('input'); width.type = 'number'; width.min = 0.1; width.max = 100; width.step = 0.5; width.title = '线宽'; width.setAttribute('aria-label', '线宽');
  color.onchange = () => A.applyStyle({ textProps: { fill: color.value }, lineProps: { stroke: color.value }, shapeProps: { stroke: color.value } });
  width.onchange = () => { const n = Number(width.value); if (n > 0 && n <= 100) A.applyStyle({ lineProps: { width: n }, shapeProps: { strokeWidth: n } }); };
  function button(text, action) { const b = document.createElement('button'); b.className = 'btn small'; b.textContent = text; b.onclick = action; b.title = text; return b; }
  quick.append(title, color, width, button('复制', () => A.duplicateSelection()), button('删除', () => A.deleteSelection()));
  const align = document.createElement('select'); align.setAttribute('aria-label', '对齐选中标注');
  [['多选对齐…', ''], ['左对齐', 'left'], ['水平居中', 'hcenter'], ['右对齐', 'right'], ['顶部对齐', 'top'], ['垂直居中', 'vcenter'], ['底部对齐', 'bottom']].forEach(([text, value]) => {
    const o = document.createElement('option'); o.textContent = text; o.value = value; align.append(o);
  });
  align.onchange = () => { if (align.value) A.alignSelection(align.value); align.value = ''; };
  quick.append(align);
  document.getElementById('canvasWrap').append(quick);
  function refresh() {
    const objects = C.getActiveObjects(), o = objects[0];
    quick.hidden = !o;
    if (o) {
      const candidate = o.tx && o.tx.fill || o.line && o.line.color || o.shape && o.shape.stroke || o.stroke;
      color.disabled = !candidate; if (/^#[a-f0-9]{6}$/i.test(candidate)) color.value = candidate;
      width.disabled = !(o.line || o.shape || ['rect', 'line', 'path'].includes(o.type));
      width.value = o.line && o.line.width || o.shape && o.shape.strokeWidth || o.strokeWidth || 1;
      align.disabled = objects.length < 2;
    }
  }
  C.on('selection:created', refresh); C.on('selection:updated', refresh); C.on('selection:cleared', refresh);
  const help = document.createElement('dialog'); help.className = 'help-dialog';
  help.innerHTML = '<h2>快捷键与操作</h2><p>Ctrl+Z 撤销 · Ctrl+Y / Ctrl+Shift+Z 重做</p><p>Ctrl+S 保存当前工程 · Ctrl+E 导出预览</p><p>Ctrl+D 复制 · Delete 删除 · 方向键微调（Shift 为 10px）</p><p>Ctrl+Shift+C / Ctrl+Shift+V 复制 / 粘贴兼容样式</p><p>V 选择 / 移动 · Esc 取消当前操作 · 空格或中键拖动平移</p><p>Shift 绘制：直线/箭头/尺寸锁定 45° 倍角；矩形/消息框约束为正方形</p><p>面积、多引出：Enter 或右键完成；右键选择对象可复制、删除或调整层级</p><p>图层：Ctrl/Shift 点击多选；双击图层或图片标签重命名</p><p>文字输入和中文输入法组合期间不拦截标注快捷键。</p>';
  help.append(button('关闭', () => help.close())); document.body.append(help);
  document.getElementById('btnHelp').onclick = () => help.showModal();
  window.dispatchEvent(new Event('resize'));
})();
