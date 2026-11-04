'use strict';
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');
const assert = require('assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('http**/*', route => route.abort());
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => window.APP && window.CV);
  const failures = [];
  async function test(name, fn) {
    try { await fn(); console.log('PASS:', name); }
    catch (error) { failures.push(name); console.error('FAIL:', name, error.message); }
  }
  async function upload(w = 400, h = 300, name = 'fixture.png') {
    const data = await page.evaluate(({ w, h }) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').fillRect(10, 10, 20, 20);
      return c.toDataURL().split(',')[1];
    }, { w, h });
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
    await page.waitForFunction(() => CV._baseImage && !APP.restoring);
  }
  await upload();
  await test('real HTMLImageElement project save', async () => {
    const download = page.waitForEvent('download', { timeout: 2500 });
    await page.evaluate(() => { window.showSaveFilePicker = undefined; document.getElementById('btnSave').click(); });
    await download;
  });
  await test('8000x6000 resamples pixel source and Fabric size', async () => {
    await upload(8000, 6000, 'large.png');
    assert.deepEqual(await page.evaluate(() => [CV._baseW, CV._baseH, CV._baseImage.width, CV._baseImage.height,
      CV._baseImgEl.naturalWidth || CV._baseImgEl.width]), [4096, 3072, 4096, 3072, 4096]);
  });
  await test('moved line style keeps world coordinates', async () => {
    const result = await page.evaluate(() => {
      const o = new fabric.AnnoLine({ pts: [{ x: 20, y: 30 }, { x: 160, y: 90 }] });
      o.set({ left: 250, top: -45, angle: 32, scaleX: 1.3, scaleY: 0.8 }); CV.add(o); CV.setActiveObject(o);
      const world = () => fabric.util.transformPoint(o.pointToLocal(o.pts[0]), o.calcTransformMatrix());
      const before = world();
      const color = document.querySelector('#panelContent input[type=color]'); color.value = '#123456'; color.dispatchEvent(new Event('input'));
      return { before, after: world() };
    });
    assert.ok(Math.hypot(result.before.x - result.after.x, result.before.y - result.after.y) < 0.01, JSON.stringify(result));
  });
  await test('measurement transformed length and unit at scale 1', async () => {
    assert.equal(await page.evaluate(() => new fabric.Dimension({ p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, scale: 1, unit: 'mm', scaleX: 2, scaleY: 2 }).label()), '20.00 mm');
  });
  await test('quick undo/redo flushes pending edits and cancels stale timer', async () => {
    await page.evaluate(() => {
      const o = new fabric.AnnoText({ textContent: 'before', left: 80, top: 60 }); CV.add(o);
      o.textContent = 'after'; APP.applyRelayout(o); APP.pushHistoryDebounced(); APP.undo();
    });
    await page.waitForFunction(() => !APP.restoring);
    assert.equal(await page.evaluate(() => CV.getObjects().find(o => o.type === 'annoText').textContent), 'before');
    await page.waitForTimeout(600);
    await page.evaluate(() => APP.redo());
    await page.waitForFunction(() => !APP.restoring);
    assert.equal(await page.evaluate(() => CV.getObjects().find(o => o.type === 'annoText').textContent), 'after');
  });
  await test('lens visibility survives snapshot/export and render failure', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const a = new fabric.Magnifier({ visible: false }), b = new fabric.SquareMagnifier({ visible: false });
      CV.add(a, b); APP.refreshSnaps(); APP.renderExportCanvas();
      const render = CV.toCanvasElement; CV.toCanvasElement = () => { throw new Error('injected'); };
      try { APP.refreshSnaps(); APP.renderExportCanvas(); } finally { CV.toCanvasElement = render; }
      return [a.visible, b.visible];
    }), [false, false]);
  });
  await test('multi-selection and image clone use world transforms and independent layers, one undo', async () => {
    const result = await page.evaluate(async () => {
      const a = new fabric.AnnoLine({ pts: [{ x: -10, y: 0 }, { x: 110, y: 45 }], left: -50, angle: 28 });
      const b = new fabric.Image(CV._baseImgEl, { left: 150, top: 120, scaleX: 0.05, scaleY: 0.05 });
      CV.add(a, b); CV.setActiveObject(new fabric.ActiveSelection([a, b], { canvas: CV }));
      const sel = CV.getActiveObject(); sel.set({ angle: 17, scaleX: 1.2, scaleY: 1.2 });
      const before = [a, b].map(o => o.calcTransformMatrix());
      await APP.duplicateSelection();
      const clones = CV.getActiveObjects();
      const after = clones.map(o => o.calcTransformMatrix());
      const independent = clones.every(o => ![a.layerId, b.layerId].includes(o.layerId)) && clones[0].layerId !== clones[1].layerId;
      const count = CV.getObjects().length; APP.undo();
      return { before, after, independent, count };
    });
    assert.ok(result.independent);
    result.before.forEach((m, i) => m.forEach((n, j) => assert.ok(Math.abs(result.after[i][j] - n - (j > 3 ? 16 : 0)) < 0.01)));
    await page.waitForFunction(() => !APP.restoring);
    assert.equal(await page.evaluate(() => CV.getObjects().length), result.count - 2);
  });
  await test('save/reload retains pixels, annotations, layers, mosaic, scale and viewport', async () => {
    const result = await page.evaluate(async () => {
      APP.scale = { pxPerUnit: 2, unit: 'mm' };
      CV.setViewportTransform([0.7, 0, 0, 0.7, -20, 30]);
      TOOLMGR.select('mosaic'); TOOLMGR.startMosaic({ x: 20, y: 20 }); TOOLMGR.moveMosaic(TOOLMGR.state.mosaic, { x: 35, y: 30 }); TOOLMGR.finishMosaic();
      const workspace = APP.workspaceProject(), original = workspace.tabs[workspace.active];
      await APP.importProject(original);
      const restored = APP.workspaceProject().tabs[APP.activeTabIndex];
      return { original, restored, dirty: APP.tabs[APP.activeTabIndex].dirty };
    });
    assert.equal(result.restored.base.src, result.original.base.src);
    assert.deepEqual(result.restored.objects, result.original.objects);
    assert.deepEqual(result.restored.layers, result.original.layers);
    assert.deepEqual(result.restored.settings.scale, result.original.settings.scale);
    assert.equal(result.restored.mosaic, result.original.mosaic);
    assert.deepEqual(result.restored.viewport, result.original.viewport);
    assert.equal(result.dirty, false);
  });
  await test('saved fingerprint, cancelled/failed save, and undo back to saved', async () => {
    const result = await page.evaluate(async () => {
      window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
      await APP.saveProject();
      const o = new fabric.AnnoText({ textContent: 'saved state' }); CV.add(o);
      await APP.saveProject(); o.textContent = 'changed'; APP.applyRelayout(o); APP.pushHistoryDebounced();
      const changed = APP.tabs[APP.activeTabIndex].dirty;
      window.showSaveFilePicker = async () => { throw new DOMException('cancel', 'AbortError'); };
      const cancel = await APP.saveProject(), dirtyAfterCancel = APP.tabs[APP.activeTabIndex].dirty;
      window.showSaveFilePicker = async () => ({ createWritable: async () => { throw new Error('disk failure'); } });
      const failure = await APP.saveProject(), dirtyAfterFailure = APP.tabs[APP.activeTabIndex].dirty;
      APP.undo();
      return { changed, cancel, failure, dirtyAfterCancel, dirtyAfterFailure };
    });
    assert.deepEqual(result, { changed: true, cancel: false, failure: false, dirtyAfterCancel: true, dirtyAfterFailure: true });
    await page.waitForFunction(() => !APP.restoring);
    const state = await page.evaluate(() => {
      APP.workspaceProject(); const tab = APP.tabs[APP.activeTabIndex];
      const saved = JSON.parse(tab.savedKey), now = JSON.parse(JSON.stringify(saved));
      now.json = tab.json; now.mosaic = tab.hist.undo[tab.hist.undo.length - 1].mosaic;
      return { dirty: tab.dirty, saved, now };
    });
    if (state.dirty) {
      const a = JSON.parse(state.saved.json).objects, b = JSON.parse(state.now.json).objects;
      console.log('saved-state differences:', JSON.stringify(a.map((o, i) => ({ type: o.type, keys: Object.keys(o).filter(k => JSON.stringify(o[k]) !== JSON.stringify(b[i] && b[i][k])).map(k => [k, o[k], b[i] && b[i][k]]) }))));
    }
    assert.equal(state.dirty, false);
  });
  await test('workspace appends all tabs, isolates pending history and per-image scale', async () => {
    const result = await page.evaluate(async () => {
      const o = CV.getObjects().find(o => o.type === 'annoText'); o.textContent = 'pending tab A'; APP.applyRelayout(o); APP.pushHistoryDebounced();
      const old = APP.activeTabIndex;
      await APP.activateTab(0); APP.undo(); await APP.activateTab(old);
      const value = CV.getObjects().find(o => o.type === 'annoText').textContent;
      const data = APP.workspaceProject(), count = APP.tabs.length;
      await APP.importProject(data);
      return { value, count, after: APP.tabs.length, scale: APP.scale, expected: data.tabs[data.active].settings.scale };
    });
    assert.equal(result.value, 'pending tab A'); assert.equal(result.after, result.count * 2);
    assert.deepEqual(result.scale, result.expected);
  });
  await test('invalid/newer project cannot mutate open tabs; unsupported objects report partial recovery', async () => {
    assert.deepEqual(await page.evaluate(async () => {
      const data = APP.workspaceProject().tabs[APP.activeTabIndex], before = APP.tabs.length;
      data.version = 999; let rejected = false;
      try { await APP.importProject(data); } catch (_) { rejected = true; }
      const unchanged = APP.tabs.length === before;
      data.version = 2; data.objects.objects.push({ type: 'future-object' });
      const prepared = await ProjectStore.prepare(data);
      return [rejected, unchanged, prepared.warnings.some(x => x.includes('future-object'))];
    }), [true, true, true]);
  });
  await test('IndexedDB file:// draft roundtrip and write failure fallback', async () => {
    assert.deepEqual(await page.evaluate(async () => {
      const workspace = APP.workspaceProject();
      await DraftStore.write({ savedAt: 123, workspace });
      const draft = await DraftStore.read();
      const before = APP.tabs.length;
      await APP.importProject(draft.workspace, true);
      const recovered = APP.tabs.length === before + workspace.tabs.length && APP.tabs[APP.activeTabIndex].dirty;
      const write = DraftStore.write; DraftStore.write = async () => { throw new Error('quota injected'); };
      await APP.writeDraft(); DraftStore.write = write;
      return [draft.savedAt, recovered, document.getElementById('draftStatus').textContent.includes('不可用')];
    }), [123, true, true]);
  });
  await test('calibration preview/cancel/recalibration updates measures as one undoable image setting', async () => {
    const result = await page.evaluate(() => {
      const previous = { ...APP.scale };
      const dim = new fabric.Dimension({ p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, scale: previous.pxPerUnit, unit: previous.unit });
      CV.add(dim); TOOLMGR.select('calibrate'); TOOLMGR.calibrationDown({ x: 0, y: 0 });
      const preview = TOOLMGR.temp.length === 1; TOOLMGR.select('select'); const cancelled = TOOLMGR.temp.length === 0;
      const prompt = window.prompt, answers = ['10', 'mm']; window.prompt = () => answers.shift();
      TOOLMGR.select('calibrate'); TOOLMGR.calibrationDown({ x: 0, y: 0 }); TOOLMGR.calibrationDown({ x: 100, y: 0 }); window.prompt = prompt;
      const scale = { ...APP.scale }, label = dim.label(); APP.undo();
      return { previous, preview, cancelled, scale, label };
    });
    assert.equal(result.preview && result.cancelled, true); assert.deepEqual(result.scale, { pxPerUnit: 10, unit: 'mm' }); assert.equal(result.label, '10.00 mm');
    await page.waitForFunction(() => !APP.restoring);
    assert.deepEqual(await page.evaluate(() => APP.scale), result.previous);
    assert.deepEqual(await page.evaluate(() => [APP.setMeasurementScale(0, 'mm'), APP.setMeasurementScale(-1, 'mm'), APP.setMeasurementScale(NaN, 'mm')]), [false, false, false]);
  });
  await test('continuous drawing keeps tool; complete annotations undo independently; Esc cancels', async () => {
    const result = await page.evaluate(() => {
      APP.continuous = true; TOOLMGR.select('arrow');
      const count = CV.getObjects().filter(o => o.type === 'annoLine').length;
      for (let i = 0; i < 2; i++) {
        TOOLMGR.startLine({ x: 20 + i * 30, y: 50 });
        TOOLMGR.moveLine(TOOLMGR.state.arrow, { x: 140 + i * 30, y: 90 }, 'arrow'); TOOLMGR.finishLine(TOOLMGR.state.arrow, 'arrow');
      }
      const same = TOOLMGR.current === 'arrow'; APP.undo(); return { count, same };
    });
    await page.waitForFunction(() => !APP.restoring);
    assert.equal(result.same, true); assert.equal(await page.evaluate(() => CV.getObjects().filter(o => o.type === 'annoLine').length), result.count + 1);
    await page.evaluate(() => TOOLMGR.startLine({ x: 0, y: 0 }));
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [TOOLMGR.current, TOOLMGR.temp.length]), ['select', 0]);
    await page.evaluate(() => { APP.continuous = false; });
  });
  await test('presets affect compatible style only and copy/paste does not copy geometry/text', async () => {
    const result = await page.evaluate(() => {
      const a = new fabric.AnnoText({ textContent: 'source', left: -90, top: 10, tx: { fill: '#654321', fontSize: 30 } });
      const b = new fabric.AnnoText({ textContent: 'target', left: 200, top: 80, angle: 25 }); CV.add(a, b);
      CV.setActiveObject(a); APP.copyStyle(); CV.setActiveObject(b);
      const before = fabric.AnnotationGeometry.contentOrigin(b); APP.pasteStyle();
      const after = fabric.AnnotationGeometry.contentOrigin(b);
      const pasted = b.tx.fill === '#654321' && b.textContent === 'target';
      document.getElementById('presetSelect').value = '0';
      document.querySelector('#efficiencyBox details button').click();
      return { before, after, pasted, defaults: APP.lineProps.width, font: APP.textProps.fontFamily };
    });
    assert.equal(result.pasted, true); assert.equal(result.defaults, 1); assert.equal(result.font, 'Arial');
    assert.ok(Math.hypot(result.before.x - result.after.x, result.before.y - result.after.y) < 0.01);
  });
  await test('batch import preserves file order and tab names', async () => {
    const names = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 30; c.height = 20;
      const blob = await new Promise(r => c.toBlob(r)); const count = APP.tabs.length;
      await APP.loadImageFiles([new File([blob], 'first.png', { type: 'image/png' }), new File([blob], 'second.png', { type: 'image/png' })]);
      return APP.tabs.slice(count).map(t => t.name);
    });
    assert.deepEqual(names, ['first.png', 'second.png']);
  });
  await test('layer selection, rename/group metadata, batch hide/lock/delete are undoable', async () => {
    const result = await page.evaluate(() => {
      const a = new fabric.AnnoText({ textContent: 'layer A' }), b = new fabric.AnnoText({ textContent: 'layer B', left: 70 }); CV.add(a, b);
      const click = id => document.querySelector('[data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      click(a.layerId); click(b.layerId); const selected = CV.getActiveObjects().length;
      APP.batchLayers('visible'); const hidden = !a.visible && !b.visible;
      APP.batchLayers('lock'); const locked = !a.selectable && !b.selectable;
      const prompt = window.prompt; window.prompt = () => '机械部件'; APP.batchLayers('group'); window.prompt = prompt;
      const groups = APP.layers.filter(l => [a.layerId, b.layerId].includes(l.id)).every(l => l.group === '机械部件');
      const count = CV.getObjects().length; APP.batchLayers('delete'); APP.undo(); return { selected, hidden, locked, groups, count };
    });
    assert.deepEqual([result.selected, result.hidden, result.locked, result.groups], [2, true, true, true]);
    await page.waitForFunction(() => !APP.restoring); assert.equal(await page.evaluate(() => CV.getObjects().length), result.count);
  });
  await test('Shift constraints, scale-independent snapping and input/IME shortcut isolation', async () => {
    const result = await page.evaluate(() => {
      TOOLMGR.select('line'); TOOLMGR.startLine({ x: 10, y: 10 });
      const get = TOOLMGR.getP; TOOLMGR.getP = () => ({ x: 150, y: 29 }); TOOLMGR.onMove({ e: { shiftKey: true } });
      const horizontal = TOOLMGR.state.line.obj.pts[1].y === 10; TOOLMGR.getP = get; TOOLMGR.select('select');
      const input = document.createElement('textarea'); document.body.append(input);
      const before = CV.getObjects().length;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', isComposing: true, bubbles: true })); input.remove();
      return [horizontal, CV.getObjects().length === before];
    });
    assert.deepEqual(result, [true, true]);
  });
  await test('isolated export renders pixels outside live viewport and preserves selection/state', async () => {
    const result = await page.evaluate(() => {
      const o = new fabric.Rect({ left: -300, top: -200, width: 40, height: 30, fill: '#ff0000', strokeWidth: 0, angle: 12, shadow: null }); CV.add(o); CV.setActiveObject(o);
      CV.setViewportTransform([2, 0, 0, 2, 1000, 800]);
      const before = [CV.width, CV.height, CV.viewportTransform.slice(), o.visible, CV.getActiveObject() === o];
      const options = { range: 'custom', crop: { x: -320, y: -220, w: 100, h: 100 }, scale: 1 };
      const c = ExportRenderer.render(CV, options, 'png'); const p = c.getContext('2d').getImageData(40, 40, 1, 1).data;
      const after = [CV.width, CV.height, CV.viewportTransform.slice(), o.visible, CV.getActiveObject() === o];
      const all = ExportRenderer.describe(CV, { range: 'all', scale: 2 }, 'png');
      const huge = ExportRenderer.describe(CV, { range: 'custom', crop: { x: 0, y: 0, w: 8000, h: 6000 }, scale: 2 }, 'png');
      return { before, after, pixel: Array.from(p), all, huge };
    });
    assert.deepEqual(result.before, result.after); assert.deepEqual(result.pixel, [255, 0, 0, 255]);
    assert.ok(result.all.left <= -300 && result.all.top <= -200); assert.ok(result.huge.width <= 8192 && result.huge.width * result.huge.height <= 32000000 && result.huge.limited);
  });
  await test('export preview final dimensions and JPG background match decoded download', async () => {
    await page.evaluate(() => { APP.exportOpts = { range: 'custom', crop: { x: 5000, y: 5000, w: 30, h: 20 }, scale: 2, background: 'white' }; ExportUI.open('jpg'); });
    await page.waitForFunction(() => document.querySelector('.export-preview canvas'));
    const expected = await page.locator('.export-preview canvas').evaluate(c => ({ w: c.width, h: c.height }));
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出当前图片', exact: true }).click();
    const file = await download, stream = await file.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const decoded = await page.evaluate(async data => {
      const img = await ImageResources.image('data:image/jpeg;base64,' + data); const c = ImageResources.canvas(img, img.naturalWidth, img.naturalHeight);
      return { w: c.width, h: c.height, pixel: Array.from(c.getContext('2d').getImageData(c.width - 1, c.height - 1, 1, 1).data) };
    }, Buffer.concat(chunks).toString('base64'));
    assert.equal(decoded.w, expected.w); assert.equal(decoded.h, expected.h); assert.deepEqual(decoded.pixel, [255, 255, 255, 255]);
    await page.getByRole('button', { name: '取消', exact: true }).click();
  });
  await test('1366x768 layout, folding updates canvas, keyboard focus, reduced motion', async () => {
    const before = await page.evaluate(() => CV.width);
    await page.locator('#btnSidebar').click(); await page.locator('#btnPanel').click();
    assert.ok(await page.evaluate(() => CV.width) > before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.locator('#btnHelp').click(); await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    await page.locator('#btnSidebar').click(); await page.locator('#btnPanel').click();
    await page.screenshot({ path: 'test-results/editor-1366.png' });
  });
  await test('nonuniform measurements: area determinant, rotated length, transformed angle, invalid ratio', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const d = new fabric.Dimension({ p1: { x: -10, y: 0 }, p2: { x: 0, y: 0 }, scale: 1, unit: 'mm', scaleX: 2, scaleY: 3, angle: 35 });
      const area = new fabric.AreaMeasure({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], scaleX: 2, scaleY: 3, scale: 1, unit: 'mm' });
      const angle = new fabric.AngleMeasure({ v: { x: 0, y: 0 }, p1: { x: 10, y: 0 }, p2: { x: 10, y: 10 }, scaleX: 2, scaleY: 1 });
      const invalid = new fabric.Dimension({ scale: -1 });
      return [d.label(), area.label(), Math.round(angle.getAngle() * 1000) / 1000, invalid.label()];
    }), ['20.00 mm', '600.00 mm²', 26.565, '比例无效']);
  });
  await test('relayout and scale baking preserve anchors at zero/negative coordinates with rotation', async () => {
    const results = await page.evaluate(() => {
      const results = [];
      for (const left of [0, -120, 240]) for (const angle of [0, 35, -90]) {
        const o = new fabric.AnnoLine({ pts: [{ x: 0, y: -30 }, { x: 100, y: 40 }], left, top: -30, angle, scaleX: 1.5, scaleY: 1.5 });
        const world = () => fabric.util.transformPoint(o.pointToLocal(o.pts[0]), o.calcTransformMatrix());
        const a = world(); o.line.width = 14; APP.applyRelayout(o); const b = world(); o.bakeScale(); const c = world();
        results.push(Math.hypot(a.x - b.x, a.y - b.y), Math.hypot(a.x - c.x, a.y - c.y));
      }
      return results;
    });
    assert.ok(results.every(d => d < 0.01), JSON.stringify(results));
  });
  await test('snap tolerance remains seven screen pixels when dragging at 1x and 2x', async () => {
    const result = await page.evaluate(() => {
      const ref = new fabric.Rect({ left: 40000, top: 40000, width: 100, height: 100, strokeWidth: 0 }); CV.add(ref); APP.snapEnabled = true;
      const o = new fabric.Rect({ left: 40106, top: 40300, width: 20, height: 20, strokeWidth: 0 });
      CV.setViewportTransform([1, 0, 0, 1, 0, 0]); APP.snapObject(o); const one = o.left;
      o.left = 40106; CV.setViewportTransform([2, 0, 0, 2, 0, 0]); APP.snapObject(o); const two = o.left;
      o.left = 40103; APP.snapObject(o); const near = o.left; APP.snapEnabled = false;
      return [one, two, near];
    });
    assert.deepEqual(result, [40100, 40106, 40100]);
  });
  await test('continuous text/rectangle/dimension/step each finish and retain tool', async () => {
    assert.deepEqual(await page.evaluate(() => {
      APP.continuous = true; const results = [];
      for (const id of ['text', 'rect', 'dim', 'step']) {
        TOOLMGR.select(id);
        if (id === 'text') { TOOLMGR.startText({ x: 60, y: 80 }); TOOLMGR.finishText(TOOLMGR.state.text); }
        if (id === 'rect') { TOOLMGR.startRect({ x: 40, y: 60 }); TOOLMGR.moveRect(TOOLMGR.state.rect, { x: 140, y: 160 }); TOOLMGR.finishRect(TOOLMGR.state.rect); }
        if (id === 'dim') { TOOLMGR.startDim({ x: 50, y: 100 }); TOOLMGR.moveDim(TOOLMGR.state.dim, { x: 160, y: 100 }); TOOLMGR.finishDim(TOOLMGR.state.dim); }
        if (id === 'step') TOOLMGR.placeStep({ x: 80, y: 80 });
        results.push(TOOLMGR.current === id && TOOLMGR.temp.length === 0);
      }
      APP.continuous = false; TOOLMGR.select('select'); return results;
    }), [true, true, true, true]);
  });
  await test('large resampled pixels, callout crop and mosaic sample share working coordinates/alpha', async () => {
    const result = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 8000; c.height = 6000;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(4000, 3000, 1000, 1000);
      const blob = await new Promise(r => c.toBlob(r)); await APP.loadImageFiles([new File([blob], 'sampling.png', { type: 'image/png' })]);
      const sample = Array.from(CV._baseImgEl.getContext('2d').getImageData(2200, 1700, 1, 1).data);
      TOOLMGR.select('cimage'); TOOLMGR.onCimageDown({ x: 2150, y: 1650 }); TOOLMGR.moveCimage(TOOLMGR.state.cimage, { x: 2250, y: 1750 }); TOOLMGR.onUpCimage(TOOLMGR.state.cimage);
      const cut = await ImageResources.image(TOOLMGR.state.cimage.preview.imgSrc);
      const crop = ImageResources.canvas(cut, cut.naturalWidth, cut.naturalHeight).getContext('2d').getImageData(50, 50, 1, 1).data;
      TOOLMGR.select('mosaic'); APP.mosaic.brush = 20; APP.mosaic.block = 10; TOOLMGR.startMosaic({ x: 2200, y: 1700 }); TOOLMGR.finishMosaic();
      const mosaic = CV._mosaicCtx.getImageData(2200, 1700, 1, 1).data;
      return [sample, Array.from(crop), Array.from(mosaic), CV._baseImgEl.getContext('2d').getImageData(0, 0, 1, 1).data[3]];
    });
    assert.deepEqual(result, [[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255], 0]);
  });
  await test('queued switch waits for async image/history restore; no mosaic or tab loss', async () => {
    const result = await page.evaluate(async () => {
      const index = APP.activeTabIndex;
      const o = new fabric.AnnoText({ textContent: 'restore queue' }); CV.add(o); o.textContent = 'edited'; APP.applyRelayout(o); APP.pushHistory();
      APP.undo(); await APP.activateTab(0); await APP.activateTab(index);
      return [CV.getObjects().find(o => o.type === 'annoText').textContent, !!CV._mosaicCtx];
    });
    assert.deepEqual(result, ['restore queue', true]);
  });
  await test('long image retains nonzero dimensions and old project migrates natural/logical mismatch', async () => {
    const result = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1; c.height = 8000;
      const prepared = ImageResources.prepare(c);
      const data = { app: 'image-annotator', version: 1, base: { src: c.toDataURL(), w: 1, h: 4096 }, objects: { objects: [] }, settings: { scale: { pxPerUnit: 1, unit: 'mm' } } };
      const legacy = await ProjectStore.prepare(data);
      return [prepared.w, prepared.h, legacy.base.width, legacy.base.height, legacy.warnings.length];
    });
    assert.deepEqual(result, [1, 4096, 1, 4096, 1]);
  });
  await test('preset CRUD and actual JSON export/import preserve compatible user styles', async () => {
    await page.locator('#efficiencyBox details').evaluate(e => { e.open = true; });
    await page.evaluate(() => { window._originalPrompt = window.prompt; window.prompt = () => 'Offline preset'; });
    await page.getByRole('button', { name: '新建预设', exact: true }).click();
    await page.selectOption('#presetSelect', { label: 'Offline preset' });
    await page.evaluate(() => { APP.textProps.fontSize = 42; });
    await page.getByRole('button', { name: '更新', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出预设', exact: true }).click();
    const file = await download, stream = await file.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(data.presets.find(p => p.name === 'Offline preset').style.textProps.fontSize, 42);
    await page.selectOption('#presetSelect', { label: 'Offline preset' });
    await page.locator('#efficiencyBox details').evaluate(e => { e.open = true; });
    await page.locator('#efficiencyBox').getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('#efficiencyBox input[type=file]').setInputFiles({ name: 'presets.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => Array.from(document.getElementById('presetSelect').options).some(o => o.textContent === 'Offline preset'));
    await page.locator('#efficiencyBox details').evaluate(e => { e.open = true; });
    await page.selectOption('#presetSelect', { label: 'Offline preset' }); await page.getByRole('button', { name: '设为默认', exact: true }).click();
    assert.equal(await page.evaluate(() => APP.textProps.fontSize), 42);
    await page.evaluate(() => { window.prompt = window._originalPrompt; });
  });
  await test('uploaded image sticker persists embedded pixels after blob URL revocation and cloning', async () => {
    const count = await page.evaluate(() => { TOOLMGR.select('sticker'); return CV.getObjects().filter(o => o.type === 'image').length; });
    const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 10, 10); return c.toDataURL().split(',')[1]; });
    await page.locator('#stickerFile').setInputFiles({ name: 'sticker.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
    await page.waitForFunction(count => CV.getObjects().filter(o => o.type === 'image').length === count + 1, count);
    const result = await page.evaluate(async () => {
      await APP.duplicateSelection(); const file = APP.workspaceProject().tabs[APP.activeTabIndex];
      const images = file.objects.objects.filter(o => o.type === 'image'); const embedded = images.every(o => o.src.startsWith('data:image/png'));
      await APP.importProject(file); return [embedded, CV.getObjects().filter(o => o.type === 'image' && o !== CV._baseImage && !o.mosaicOverlay).length === images.length];
    });
    assert.deepEqual(result, [true, true]);
  });
  await test('native unload reminder and startup draft restore/discard on file://', async () => {
    const context = await browser.newContext({ viewport: { width: 1093, height: 614 }, deviceScaleFactor: 1.25, acceptDownloads: true });
    const scratch = await context.newPage(), dialogs = [];
    scratch.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
    await scratch.goto(pathToFileURL(path.resolve('index.html')).href);
    await scratch.waitForFunction(() => document.getElementById('draftStatus').dataset.state === 'ready');
    await scratch.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 80; c.height = 60;
      const blob = await new Promise(r => c.toBlob(r)); await APP.loadImageFiles([new File([blob], 'draft.png', { type: 'image/png' })]);
      CV.add(new fabric.AnnoText({ textContent: 'recovered at startup' })); await APP.writeDraft();
    });
    await scratch.locator('#btnHelp').click(); await scratch.getByRole('button', { name: '关闭', exact: true }).click();
    await scratch.reload();
    await scratch.waitForFunction(() => APP.tabs.length === 1 && !APP.restoring);
    assert.equal(await scratch.evaluate(() => CV.getObjects().find(o => o.type === 'annoText').textContent), 'recovered at startup');
    assert.ok(dialogs.includes('beforeunload') && dialogs.includes('confirm'));
    assert.equal(await scratch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await scratch.screenshot({ path: 'test-results/editor-dsf125.png' });
    // Successful manual save clears dirty state and closing the internal tab needs no confirm.
    const before = dialogs.length;
    await scratch.evaluate(async () => {
      window._draftFixture = APP.workspaceProject();
      window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
      await APP.saveProject(); APP.closeTab(0); await DraftStore.clear();
    });
    assert.equal(dialogs.length, before); assert.equal(await scratch.evaluate(() => APP.tabs.length), 0);
    await scratch.evaluate(() => DraftStore.write({ savedAt: 456, workspace: window._draftFixture }));
    scratch.removeAllListeners('dialog'); scratch.on('dialog', d => d.dismiss());
    await scratch.reload(); await scratch.waitForFunction(() => document.getElementById('draftStatus').dataset.state === 'ready');
    assert.equal(await scratch.evaluate(() => APP.tabs.length), 0);
    assert.equal(await scratch.evaluate(async () => !!await DraftStore.read()), false);
    await context.close();
  });
  await test('corrupt/permission-denied drafts report failure without disabling manual project save', async () => {
    for (const denied of [false, true]) {
      const context = await browser.newContext();
      if (denied) await context.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: { open() { throw new DOMException('permission injected', 'SecurityError'); } } }); });
      const scratch = await context.newPage(); scratch.on('dialog', d => d.accept());
      await scratch.goto(pathToFileURL(path.resolve('index.html')).href);
      if (!denied) {
        await scratch.waitForFunction(() => document.getElementById('draftStatus').dataset.state === 'ready');
        await scratch.evaluate(() => DraftStore.write({ savedAt: 1, workspace: { app: 'broken' } })); await scratch.reload();
      }
      await scratch.waitForFunction(() => document.getElementById('draftStatus').textContent.includes('不可用'));
      assert.equal(await scratch.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 20; c.height = 20; const blob = await new Promise(r => c.toBlob(r));
        await APP.loadImageFiles([new File([blob], 'manual.png', { type: 'image/png' })]);
        window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
        return APP.saveProject();
      }), true);
      await context.close();
    }
  });
  await test('sequential batch export sanitizes/deduplicates names and restores active tab', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const scratch = await context.newPage(), names = []; scratch.on('download', d => names.push(d.suggestedFilename()));
    await scratch.goto(pathToFileURL(path.resolve('index.html')).href); await scratch.waitForFunction(() => window.ExportUI && window.APP);
    await scratch.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 20; c.height = 20;
      const blob = await new Promise(r => c.toBlob(r));
      await APP.loadImageFiles([new File([blob], 'part?.png', { type: 'image/png' }), new File([blob], 'part?.png', { type: 'image/png' })]);
      APP.exportOpts = { range: 'image', scale: 1 }; ExportUI.open('png');
    });
    await scratch.waitForFunction(() => document.querySelector('.export-preview canvas'));
    await scratch.evaluate(() => ExportUI.exportAll());
    assert.deepEqual(names, ['part_.png', 'part_ (2).png']); assert.equal(await scratch.evaluate(() => APP.activeTabIndex), 1);
    await context.close();
  });
  await test('no browser exceptions', () => assert.deepEqual(errors, []));
  await browser.close();
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
