// Replays the remaining defects on an isolated, instrumented baseline copy.
// Instrumentation only exposes private operations; repository source is untouched.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const assert = require('assert/strict');
(async () => {
  const root = path.resolve('test-results/baseline');
  for (const file of ['index.html', 'css/style.css', 'js/objects.js', 'js/tools.js', 'js/app.js', 'vendor/fabric.min.js']) {
    let content = execFileSync('git', ['show', '219fd39585e5c0b50b6a18c5c95ef70591504289:' + file]);
    if (file === 'js/app.js') content = Buffer.from(content.toString().replace('  APP.popIn = popIn;', '  APP.popIn = popIn; Object.assign(APP, { refreshSnaps, renderExportCanvas, duplicateSelection });'));
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage(); page.on('dialog', d => d.accept());
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 100; return c.toDataURL().split(',')[1]; });
  await page.locator('#fileInput').setInputFiles({ name: 'baseline.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.waitForFunction(() => CV._baseImage && !APP.restoring);
  const history = await page.evaluate(() => {
    const o = new fabric.AnnoText({ textContent: 'before' }); CV.add(o); o.textContent = 'after'; APP.pushHistoryDebounced(); APP.undo();
    return new Promise(resolve => setTimeout(() => resolve(CV.getObjects().some(x => x.type === 'annoText')), 20));
  });
  assert.equal(history, false); console.log('REPRODUCED: quick undo removes the annotation instead of undoing its edit');
  const lenses = await page.evaluate(() => {
    const a = new fabric.Magnifier({ visible: false }), b = new fabric.SquareMagnifier({ visible: false }); CV.add(a, b);
    APP.refreshSnaps(); const refresh = [a.visible, b.visible]; a.visible = b.visible = false; APP.renderExportCanvas();
    return { refresh, export: [a.visible, b.visible] };
  });
  assert.deepEqual(lenses, { refresh: [true, true], export: [true, true] }); console.log('REPRODUCED: hidden circular/square lenses become visible after refresh and export');
  const duplicate = await page.evaluate(() => {
    const o = new fabric.AnnoText({ textContent: 'clone' }); CV.add(o); CV.setActiveObject(o); APP.duplicateSelection();
    return o.layerId === CV.getActiveObject().layerId;
  });
  assert.equal(duplicate, true); console.log('REPRODUCED: a duplicate shares its original annotation layer');
  fs.writeFileSync('test-results/baseline.json', JSON.stringify({ commit: '219fd39', quickUndoAnnotationSurvives: history, lenses, duplicateSharesLayer: duplicate }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
