/* Local interface icons: inline SVG only, no fonts, images or network requests. */
(function () {
  'use strict';
  const paths = {
    brand: '<path d="M4 9V5a1 1 0 0 1 1-1h4m6 0h4a1 1 0 0 1 1 1v4m0 6v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><path d="m8 16 1-4 7-7 3 3-7 7-4 1Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    save: '<path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1M3 7h18l-2 12H5L3 7Z"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14" transform="translate(0 -2)"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H10a7 7 0 0 0 0 14" transform="translate(0 -2)"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    leftPanel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1m-1 4h1m-1 4h1"/>',
    rightPanel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m2.5-12h1m-1 4h1m-1 4h1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1 .8-1.8 1.3-1.8 2.8m0 3h.01"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14M12 5v14"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z"/>',
    select: '<path d="m5 3 14 9-7 1-3 7L5 3Z"/>',
    text: '<path d="M4 6V3h16v3M12 3v18m-4 0h8"/>',
    rect: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
    msgbox: '<path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 8h10M7 12h7"/>',
    line: '<path d="m4 20 16-16"/><circle cx="4" cy="20" r="1"/><circle cx="20" cy="4" r="1"/>',
    curve: '<path d="M3 18C6-5 18 29 21 6"/><circle cx="3" cy="18" r="1"/><circle cx="21" cy="6" r="1"/>',
    freehand: '<path d="m4 17 12-12 3 3L7 20l-4 1 1-4Zm10-10 3 3M13 21h8"/>',
    arrow: '<path d="M4 20 20 4M10 4h10v10"/>',
    carrow: '<path d="M3 19c0-10 15-1 16-14m-6 3 6-4 2 7"/>',
    step: '<circle cx="12" cy="12" r="9"/><path d="m10 9 2-2v10m-3 0h6"/>',
    dim: '<path d="M3 6v14M21 6v14M3 15h18m-14-4-4 4 4 4m10-8 4 4-4 4"/>',
    angle: '<path d="M4 3v17h17M4 20 17 4M4 12a8 8 0 0 1 6 3"/>',
    area: '<path d="m4 5 13-2 4 13-11 5-7-8 1-8Z"/><path d="m8 9 6-1m-7 5 9-1m-7 5 8-1"/>',
    ctext: '<path d="M4 4h16v10H9l-5 5V4ZM8 8h8"/>',
    cregion: '<ellipse cx="8" cy="15" rx="5" ry="4"/><path d="m11 12 6-6h4m-6-3 3 3-3 3"/>',
    cimage: '<rect x="2" y="11" width="8" height="8" rx="1"/><rect x="13" y="3" width="9" height="13" rx="1"/><path d="m10 11 3-4m1 6 3-4 4 4"/>',
    cmulti: '<path d="m3 4 8 8-8 8m8-8h10M3 12h18"/><circle cx="3" cy="4" r="1"/><circle cx="3" cy="20" r="1"/>',
    magnifier: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
    smagnifier: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="m16 16 5 5M6 9.5h7m-3.5-3.5v7"/>',
    sticker: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 9h.01M16 9h.01M8 14c2 3 6 3 8 0"/>',
    mosaic: '<path d="M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7 17 17 0 0 1-3 4M6 6a17 17 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0m-4 8v2"/>'
  };
  function svg(name) {
    return '<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (paths[name] || paths.image) + '</svg>';
  }
  function button(element, name, label, iconOnly) {
    if (!element || element.dataset.uiIcon === name && element.querySelector('svg')) return;
    element.dataset.uiIcon = name;
    element.innerHTML = svg(name);
    if (label) { const span = document.createElement('span'); span.className = 'button-label'; span.textContent = label; element.append(span); }
    if (iconOnly) element.classList.add('icon-button');
    if (label || element.title) element.setAttribute('aria-label', label || element.title);
  }
  window.UIIcons = { svg, button };
})();
