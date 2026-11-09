/* objects.js — 自定义标注对象（基于 Fabric.js 自定义类渲染） */
(function () {
  const F = fabric;

  /* ---------- 默认样式 ---------- */
  const DEF_TEXT = {
    fontFamily: 'Microsoft YaHei',
    fontSize: 22,
    fontStyle: 'normal',
    fontWeight: 'normal',
    underline: false,
    letterSpacing: 0,
    fill: '#ff5252',
    outlineColor: '#ffffff',
    outlineWidth: 0
  };
  const DEF_SHAPE = {
    stroke: '#ff5252',
    strokeWidth: 3,
    dash: null,
    cornerRadius: 0,
    fillColor: '#ffd166',
    fillOpacity: 0,
    haloColor: '#ffffff',
    haloWidth: 2
  };
  const DEF_LINE = { color: '#ff5252', width: 3, dash: null, haloColor: '#ffffff', haloWidth: 2 };
  const DEF_BG = { fill: '#ffffff', opacity: 0.9, radius: 4 };

  /* ---------- 文本渲染工具 ---------- */
  let _mctx = null;
  function mctx() {
    if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
    return _mctx;
  }

  const TX = {
    fontString(p) {
      const parts = [];
      if (p.fontStyle === 'italic') parts.push('italic');
      if (p.fontWeight === 'bold') parts.push('bold');
      parts.push((p.fontSize || 20) + 'px');
      parts.push(p.fontFamily || 'Arial');
      return parts.join(' ');
    },
    wrapLines(ctx, text, maxWidth) {
      const lines = [];
      const paras = String(text == null ? '' : text).split('\n');
      for (const para of paras) {
        if (para === '') { lines.push(''); continue; }
        let line = '';
        for (const ch of para) {
          const test = line + ch;
          if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = ch; }
          else line = test;
        }
        lines.push(line);
      }
      return lines;
    },
    measureWidth(ctx, line, p) {
      return ctx.measureText(line).width + (line.length - 1) * (p.letterSpacing || 0);
    },
    measureLines(ctx, lines, p) {
      let w = 0;
      for (const ln of lines) w = Math.max(w, TX.measureWidth(ctx, ln, p));
      const lh = (p.fontSize || 20) * 1.3;
      return { w, h: lines.length * lh, lh };
    },
    measure(text, p, maxWidth) {
      const ctx = mctx();
      ctx.font = TX.fontString(p);
      const lines = TX.wrapLines(ctx, text, maxWidth);
      return TX.measureLines(ctx, lines, p);
    },
    // 在 (x,y) 为左上角处绘制换行文本（支持全部文字样式），返回 {w,h}
    draw(ctx, text, p, x, y, maxWidth) {
      ctx.save();
      ctx.font = TX.fontString(p);
      ctx.fillStyle = p.fill || '#000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const lines = TX.wrapLines(ctx, text, maxWidth);
      const lh = (p.fontSize || 20) * 1.3;
      let ty = y;
      for (const ln of lines) {
        const base = ty + p.fontSize * 0.85;
        if (p.underline) {
          const tw = TX.measureWidth(ctx, ln, p);
          ctx.strokeStyle = p.fill;
          ctx.lineWidth = Math.max(1, p.fontSize * 0.07);
          ctx.beginPath();
          ctx.moveTo(x, ty + lh * 0.8);
          ctx.lineTo(x + tw, ty + lh * 0.8);
          ctx.stroke();
        }
        if (p.outlineWidth > 0) {
          ctx.strokeStyle = p.outlineColor || '#fff';
          ctx.lineWidth = p.outlineWidth;
          ctx.lineJoin = 'round';
        }
        let cx = x;
        for (const ch of ln) {
          if (p.outlineWidth > 0) ctx.strokeText(ch, cx, base);
          ctx.fillText(ch, cx, base);
          cx += ctx.measureText(ch).width + (p.letterSpacing || 0);
        }
        ty += lh;
      }
      ctx.restore();
      return TX.measure(text, p, maxWidth);
    }
  };
  window.TX = TX;

  /* ---------- 通用绘制辅助 ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shapeStyle(ctx, s) {
    ctx.strokeStyle = s.stroke || 'transparent';
    ctx.lineWidth = s.strokeWidth || 0;
    ctx.setLineDash(s.dash || []);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }
  // 线条双重描边：先画白色边框（halo），再画彩色主线
  function haloStroke(ctx, s, drawFn) {
    const color = s.color || s.stroke;
    const width = s.width || s.strokeWidth || 0;
    const dash = s.dash || [];
    const haloColor = s.haloColor;
    const haloWidth = s.haloWidth || 0;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (haloWidth > 0 && haloColor) {
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = width + haloWidth * 2;
      ctx.setLineDash(dash);
      drawFn();
    }
    ctx.strokeStyle = color || 'transparent';
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    drawFn();
    ctx.restore();
  }
  // 填充图形双重描边：白色边框 + 彩色填充（用于箭头、圆点等实心图形）
  function haloFill(ctx, s, drawFn) {
    const color = s.color || s.stroke;
    const haloColor = s.haloColor;
    const haloWidth = s.haloWidth || 0;
    ctx.save();
    ctx.lineJoin = 'round';
    if (haloWidth > 0 && haloColor) {
      ctx.fillStyle = haloColor;
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = haloWidth * 2;
      drawFn();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = color || 'transparent';
    drawFn();
    ctx.fill();
    ctx.restore();
  }
  function fillStyle(ctx, s) {
    const o = s.fillOpacity || 0;
    if (o > 0) { ctx.fillStyle = s.fillColor || '#fff'; ctx.globalAlpha = clamp(o, 0, 1); }
    else ctx.globalAlpha = 0;
  }
  function resetAlpha(ctx) { ctx.globalAlpha = 1; }
  function fillStroke(ctx) { ctx.fill(); ctx.stroke(); resetAlpha(ctx); }
  function dot(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  F.ArrowStyles = Object.freeze(['solid', 'hollow', 'open', 'diamond']);
  const alwaysHasArrowheads = new Set(['calloutText', 'calloutRegion', 'multiCallout', 'dimension']);
  F.hasArrowheads = obj => obj.arrowhead === 'end' || alwaysHasArrowheads.has(obj.type);
  function arrowStyle(value) {
    return F.ArrowStyles.includes(value) ? value : 'solid';
  }
  function makeArrowHead(style, tip, ux, uy, len, half) {
    const base = { x: tip.x - ux * len, y: tip.y - uy * len };
    const diamond = style === 'diamond', wingOffset = diamond ? len / 2 : len;
    const x = tip.x - ux * wingOffset, y = tip.y - uy * wingOffset;
    return {
      base,
      path(ctx) {
        ctx.moveTo(x - uy * half, y + ux * half);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(x + uy * half, y - ux * half);
        if (diamond) ctx.lineTo(base.x, base.y);
        if (style !== 'open') ctx.closePath();
      }
    };
  }
  function arrowMetrics(width, fullLength, fullHalf, distance) {
    const len = Math.min(fullLength, distance * 0.56);
    const shaftWidth = Math.min(width, distance * 0.26);
    const half = Math.max(shaftWidth * 0.85, fullHalf * len / fullLength);
    return { len, half, shaftWidth };
  }
  function drawArrowLine(ctx, obj, heads, shaft) {
    const s = obj.line;
    if (!heads.length) { haloStroke(ctx, s, shaft); return; }
    const traceHeads = () => heads.forEach(head => head.path(ctx));
    const drawHeads = () => { ctx.beginPath(); traceHeads(); };
    const strokeHeads = () => { drawHeads(); ctx.stroke(); };
    if (obj.arrowStyle === 'hollow') {
      ctx.save();
      clipOutsideHeads(ctx, traceHeads);
      haloStroke(ctx, s, shaft);
      haloStroke(ctx, { ...s, dash: null }, strokeHeads);
      ctx.restore();
      haloStroke(ctx, { ...s, dash: null, haloWidth: 0 }, strokeHeads);
    } else {
      haloStroke(ctx, s, shaft);
      if (obj.arrowStyle === 'open') {
        haloStroke(ctx, { ...s, dash: null }, strokeHeads);
      } else {
        haloFill(ctx, s, drawHeads);
      }
    }
  }
  function clipOutsideHeads(ctx, traceHeads) {
    // Anchors can move outside the object's bounds while dragging.
    ctx.beginPath();
    ctx.save();
    ctx.resetTransform();
    ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    traceHeads();
    ctx.clip('evenodd');
  }
  function drawLeaders(ctx, obj, tips, sourceX) {
    const s = obj.line, y = obj.leaderY;
    const style = obj.arrowStyle;
    const width = Math.max(0, s.width || 0);
    const fullLength = obj.arrowLen + width * 2;
    const groups = new Map([[width, [ctx => {
      ctx.moveTo(obj.x0, y);
      ctx.lineTo(obj.x1, y);
    }]]]);
    const heads = [];
    for (const tip of tips) {
      const x = sourceX ?? clamp(tip.x, obj.x0, obj.x1);
      const dx = tip.x - x, dy = tip.y - y, distance = Math.hypot(dx, dy);
      if (!distance) continue;
      const ux = dx / distance, uy = dy / distance;
      const { len, half, shaftWidth } = arrowMetrics(width, fullLength, obj.arrowLen * 0.55, distance);
      const head = makeArrowHead(style, tip, ux, uy, len, half);
      const end = style === 'open' ? tip : head.base;
      const overlap = style === 'diamond' ? len / 4 : 0;
      if (!groups.has(shaftWidth)) groups.set(shaftWidth, []);
      groups.get(shaftWidth).push(ctx => {
        ctx.moveTo(x, y);
        ctx.lineTo(end.x + ux * overlap, end.y + uy * overlap);
      });
      heads.push({ path: head.path, width: shaftWidth });
    }
    paintArrowPaths(ctx, s, style, groups, heads);
  }

  function paintArrowPaths(ctx, s, style, groups, heads) {
    const dash = s.dash || [];
    const filled = style === 'solid' || style === 'diamond';
    if (style === 'open' && !dash.length) {
      for (const head of heads) groups.get(head.width).push(head.path);
      heads = [];
    }
    function paintLines(color, halo) {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      groups.forEach((segments, width) => {
        if (width + halo * 2 <= 0) return;
        ctx.lineWidth = width + halo * 2;
        ctx.beginPath();
        segments.forEach(trace => trace(ctx));
        ctx.stroke();
      });
    }
    function paintHeads(color, halo) {
      ctx.fillStyle = ctx.strokeStyle = color;
      ctx.setLineDash([]);
      for (const head of heads) {
        ctx.beginPath();
        head.path(ctx);
        if (filled) ctx.fill();
        const weight = (filled ? 0 : head.width) + halo * 2;
        if (weight > 0) {
          ctx.lineWidth = weight;
          ctx.stroke();
        }
      }
    }
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    const ink = s.color || 'transparent';
    if (style === 'hollow') {
      ctx.save();
      for (const head of heads) clipOutsideHeads(ctx, () => head.path(ctx));
    }
    if (s.haloWidth > 0 && s.haloColor) {
      paintLines(s.haloColor, s.haloWidth);
      paintHeads(s.haloColor, s.haloWidth);
    }
    // Paint every outer edge before any foreground so adjacent parts share one outline.
    paintLines(ink, 0);
    if (style === 'hollow') ctx.restore();
    paintHeads(ink, 0);
    ctx.restore();
  }
  function drawBasicArrow(ctx, obj, head, width, traceShaft) {
    if (!head) {
      haloStroke(ctx, obj.line, () => {
        ctx.beginPath(); traceShaft(ctx); ctx.stroke();
      });
      return;
    }
    const groups = new Map([[width, [traceShaft]]]);
    paintArrowPaths(ctx, obj.line, obj.arrowStyle, groups, [{ path: head.path, width }]);
  }

  /* ---------- 内容坐标布局辅助 ----------
     复合对象使用“内容坐标”：对象宽度/高度 = 内容包围盒；
     _offX/_offY 是内容包围盒的左上角（内容坐标），不是对象的画布位置。
     渲染先减去内容中心，再经对象/父组矩阵得到世界坐标，最后经视口得到屏幕坐标。 */
  function setContentSize(obj, w, h) {
    obj.contentW = w; obj.contentH = h;
    obj.width = w; obj.height = h;
  }
  function beginContent(ctx, obj) {
    ctx.save();
    ctx.translate(-(obj._offX || 0) - obj.contentW / 2, -(obj._offY || 0) - obj.contentH / 2);
  }
  function endContent(ctx) { ctx.restore(); }

  // Content p -> centered object local p -> parent/world -> viewport/screen.
  // Keep the content origin fixed, compensating the changed bounding box through
  // the full affine matrix. left/top alone are not a geometric anchor.
  function contentOrigin(obj) {
    return F.util.transformPoint({ x: -(obj._offX || 0) - obj.contentW / 2,
      y: -(obj._offY || 0) - obj.contentH / 2 }, obj.calcOwnMatrix());
  }
  function placeContentOrigin(obj, origin) {
    const m = obj.calcOwnMatrix();
    const x = (obj._offX || 0) + obj.contentW / 2, y = (obj._offY || 0) + obj.contentH / 2;
    obj.setPositionByOrigin(new F.Point(origin.x + m[0] * x + m[2] * y,
      origin.y + m[1] * x + m[3] * y), 'center', 'center');
    obj.setCoords(); obj.set('dirty', true);
  }
  F.AnnotationGeometry = {
    contentOrigin, placeContentOrigin,
    relayout(obj, change) {
      const origin = contentOrigin(obj);
      if (change) change();
      obj.relayout(); placeContentOrigin(obj, origin);
    },
    vector(obj, x, y) {
      const m = obj.calcTransformMatrix();
      return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y };
    }
  };

  /* ================= 文字 ================= */
  F.AnnoText = F.util.createClass(F.Object, {
    type: 'annoText',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent != null ? opts.textContent : '文字';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.padding = opts.padding || 6;
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      this.relayout();
    },
    relayout() {
      const m = TX.measure(this.textContent, this.tx, 1e9);
      setContentSize(this, Math.max(10, m.w + this.padding * 2), Math.max(10, m.h + this.padding * 2));
    },
    _render(ctx) {
      beginContent(ctx, this);
      TX.draw(ctx, this.textContent, this.tx, this.padding, this.padding, this.contentW - this.padding * 2);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, padding: this.padding
      });
    }
  });

  /* ================= 消息框 ================= */
  F.MessageBox = F.util.createClass(F.Object, {
    type: 'messageBox',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent || '';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.shape = Object.assign({}, DEF_SHAPE, opts.shape || {});
      this.boxW = opts.boxW || 180;
      this.boxH = opts.boxH || 80;
      this.tailW = 26; this.tailH = 15;
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      this.relayout();
    },
    relayout() {
      const maxW = Math.max(40, this.boxW - 16);
      const m = TX.measure(this.textContent, this.tx, maxW);
      this.boxW = Math.max(this.boxW, m.w + 16);
      this.boxH = Math.max(this.boxH, m.h + 16);
      setContentSize(this, this.boxW, this.boxH + this.tailH);
    },
    _render(ctx) {
      const s = this.shape;
      beginContent(ctx, this);
      const cx = this.boxW / 2, cy = this.boxH;
      // 尾部三角
      fillStyle(ctx, s);
      ctx.beginPath();
      ctx.moveTo(cx - this.tailW / 2, cy - 1);
      ctx.lineTo(cx, cy + this.tailH);
      ctx.lineTo(cx + this.tailW / 2, cy - 1);
      ctx.closePath();
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        ctx.moveTo(cx - this.tailW / 2, cy - 1);
        ctx.lineTo(cx, cy + this.tailH);
        ctx.lineTo(cx + this.tailW / 2, cy - 1);
        ctx.closePath();
        ctx.stroke();
      });
      // 圆角矩形主体
      const r = Math.min(s.cornerRadius || 0, this.boxW / 2, this.boxH / 2);
      fillStyle(ctx, s);
      ctx.beginPath();
      roundRectPath(ctx, 0, 0, this.boxW, this.boxH, r);
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        roundRectPath(ctx, 0, 0, this.boxW, this.boxH, r);
        ctx.stroke();
      });
      TX.draw(ctx, this.textContent, this.tx, 8, 6, this.boxW - 16);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, shape: this.shape,
        boxW: this.boxW, boxH: this.boxH
      });
    }
  });

  /* ================= 步骤序号 ================= */
  F.StepNumber = F.util.createClass(F.Object, {
    type: 'stepNumber',
    initialize(opts) {
      opts = opts || {};
      this.number = opts.number != null ? opts.number : 1;
      this.radius = opts.radius || 18;
      this.stepShape = opts.stepShape || 'circle';
      this.shape = Object.assign({}, DEF_SHAPE, { fillColor: '#ffffff', fillOpacity: 1 }, opts.shape || {});
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      this.relayout();
    },
    relayout() { setContentSize(this, this.radius * 2, this.radius * 2); },
    _render(ctx) {
      const s = this.shape, r = this.radius;
      fillStyle(ctx, s);
      ctx.beginPath();
      if (this.stepShape === 'round') {
        const rr = Math.min(s.cornerRadius || r * 0.3, r);
        roundRectPath(ctx, -r, -r, r * 2, r * 2, rr);
      } else ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        if (this.stepShape === 'round') {
          const rr = Math.min(s.cornerRadius || r * 0.3, r);
          roundRectPath(ctx, -r, -r, r * 2, r * 2, rr);
        } else ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      const p = Object.assign({}, this.tx, { fontSize: Math.max(10, r * 1.05) });
      const str = String(this.number);
      const m = TX.measure(str, p, 1e9);
      TX.draw(ctx, str, p, -m.w / 2, -m.h / 2, 1e9);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        number: this.number, radius: this.radius, stepShape: this.stepShape,
        shape: this.shape, tx: this.tx
      });
    }
  });

  /* ================= 文字引出（锚点 + 可自由拖动的文字，引出线自动连接，无方框） ================= */
  F.CalloutText = F.util.createClass(F.Object, {
    type: 'calloutText',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent || '标注';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.anchor = opts.anchor || { x: 0, y: 0 };
      // 旧工程没有 textPos 时，从锚点推导一个初始位置
      this.textPos = opts.textPos || { x: this.anchor.x + 24, y: this.anchor.y - 70 };
      this.pad = 8;
      this.arrowLen = 12;
      this.callSuper('initialize', opts);
      this.arrowStyle = arrowStyle(opts.arrowStyle);
      this.relayout();
      this._rebuildControls();
      this.objectCaching = false;
    },
    // 几何计算（拖动期间调用：只更新引出线/文字布局，不动包围盒，保持实时渲染）
    computeGeometry() {
      const m = TX.measure(this.textContent, this.tx, 1e9);
      this.textW = m.w;
      this.textH = m.h;
      const tp = this.textPos;
      // 水平引出线：长度只取决于文本长度（文字放在线上方）
      this.leaderY = tp.y + this.textH;
      this.x0 = tp.x - this.pad;
      this.x1 = tp.x + this.textW + this.pad;
    },
    relayout() {
      this.computeGeometry();
      const a = this.anchor, tp = this.textPos;
      const left = Math.min(this.x0, tp.x, a.x) - 8;
      const top = Math.min(this.leaderY, tp.y, a.y) - 8;
      const right = Math.max(this.x1, tp.x + this.textW, a.x) + 8;
      const bottom = Math.max(this.leaderY, tp.y, a.y) + 8;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    pointToLocal(p) {
      return { x: p.x - this._offX - this.contentW / 2, y: p.y - this._offY - this.contentH / 2 };
    },
    pointFromLocal(l) {
      return { x: l.x + this._offX + this.contentW / 2, y: l.y + this._offY + this.contentH / 2 };
    },
    _rebuildControls() {
      const controls = Object.assign({}, F.Object.prototype.controls);
      // 锚点手柄（箭头目标点，可拖动）
      controls.anchor = makeDraggableControl(o => o.anchor, (o, p) => { o.anchor = p; });
      // 文字手柄（文字中心，可拖动）
      controls.text = makeDraggableControl(
        o => ({ x: o.textPos.x + o.textW / 2, y: o.textPos.y + o.textH / 2 }),
        (o, p) => { o.textPos = { x: p.x - o.textW / 2, y: p.y - o.textH / 2 }; }
      );
      this.controls = controls;
    },
    _render(ctx) {
      beginContent(ctx, this);
      drawLeaders(ctx, this, [this.anchor]);
      // 文字（无方框，放在水平线上方）
      TX.draw(ctx, this.textContent, this.tx, this.textPos.x, this.textPos.y, 1e9);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line, arrowStyle: this.arrowStyle,
        anchor: this.anchor, textPos: this.textPos
      });
    }
  });

  /* ================= 多引出（多个可拖动锚点 + 可自由拖动的文字，引出线自动连接） ================= */
  // 共享的可拖动手柄控件（锚点 / 文字）
  // 拖动期间临时去掉阴影，降低每帧渲染负担（松开后恢复），让锚点跟手
  function suppressDragShadow(obj) {
    if (obj.shadow && !obj.__dragShadow) {
      obj.__dragShadow = obj.shadow;
      obj.shadow = null;
      obj.set('dirty', true);
    }
  }
  function makeDraggableControl(getPoint, setPoint) {
    return new F.Control({
      x: 0, y: 0, offsetX: 0, offsetY: 0,
      sizeX: 14, sizeY: 14, touchSizeX: 26, touchSizeY: 26,
      cursorStyleHandler: () => 'move',
      // 增量式拖动：只按鼠标位移增量换算叠加；拖动期间冻结包围盒，其它点原地不动
      actionHandler: function (eventData, transform, x, y) {
        const obj = transform.target;
        if (!obj.canvas) return false;
        suppressDragShadow(obj);
        obj.__ptDrag = true;
        const t = transform;
        if (t.__lx === undefined) {
          t.__lx = t.ex != null ? t.ex : x;
          t.__ly = t.ey != null ? t.ey : y;
        }
        // fabric 5.5.2 传入 actionHandler 的 x/y 是画布逻辑坐标（getPointer 默认已做
        // restorePointerVpt 逆视口变换），因此这里只需反变换对象矩阵。
        // 若再乘 viewportTransform 会重复除以缩放：缩放≠1 时控制点以 1/缩放 速度跟手，
        // 松开鼠标后标注位置与实际落点偏差（表现为"整个标注乱跑"）。
        const inv = F.util.invertTransform(obj.calcTransformMatrix());
        const p1 = F.util.transformPoint({ x: x, y: y }, inv);
        const p0 = F.util.transformPoint({ x: t.__lx, y: t.__ly }, inv);
        t.__lx = x; t.__ly = y;
        const cur = getPoint(obj);
        setPoint(obj, { x: cur.x + (p1.x - p0.x), y: cur.y + (p1.y - p0.y) });
        // 拖动期间只重算几何（引出线/文字布局实时更新），包围盒保持冻结，其它点原地不动
        if (typeof obj.computeGeometry === 'function') obj.computeGeometry();
        obj.set('dirty', true);
        obj.setCoords();
        obj.canvas.requestRenderAll();
        return true;
      },
      positionHandler: function (dim, finalMatrix, obj) {
        if (!obj.canvas) return { x: 0, y: 0 };
        const vt = obj.canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        const full = F.util.multiplyTransformMatrices(vt, obj.calcTransformMatrix());
        return F.util.transformPoint(obj.pointToLocal(getPoint(obj)), full);
      },
      render: function (ctx, x, y) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#5b8def';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  F.MultiCallout = F.util.createClass(F.Object, {
    type: 'multiCallout',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent || '标注';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.anchors = (opts.anchors || []).map(p => ({ x: p.x, y: p.y }));
      // 旧工程没有 textPos 时从锚点推导初始位置
      this.textPos = opts.textPos || { x: 60, y: -70 };
      this.pad = 8;
      this.arrowLen = 12;
      this.callSuper('initialize', opts);
      this.arrowStyle = arrowStyle(opts.arrowStyle);
      this.relayout();
      this._rebuildControls();
      this.objectCaching = false;
    },
    // 几何计算（拖动期间调用：只更新水平线/文字布局，不动包围盒，保持实时渲染）
    computeGeometry() {
      const m = TX.measure(this.textContent, this.tx, 1e9);
      this.textW = m.w; this.textH = m.h;
      // 水平线长度只取决于文本长度（文字放在线上方）
      this.leaderY = this.textPos.y + this.textH;
      this.x0 = this.textPos.x - this.pad;
      this.x1 = this.textPos.x + this.textW + this.pad;
    },
    relayout() {
      this.computeGeometry();
      const as = this.anchors;
      let left = Math.min(this.x0, this.textPos.x), top = Math.min(this.leaderY, this.textPos.y);
      let right = Math.max(this.x1, this.textPos.x + this.textW), bottom = Math.max(this.leaderY, this.textPos.y);
      for (const a of as) {
        left = Math.min(left, a.x); top = Math.min(top, a.y);
        right = Math.max(right, a.x); bottom = Math.max(bottom, a.y);
      }
      left -= 10; top -= 10; right += 10; bottom += 10;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    pointToLocal(p) {
      return { x: p.x - this._offX - this.contentW / 2, y: p.y - this._offY - this.contentH / 2 };
    },
    pointFromLocal(l) {
      return { x: l.x + this._offX + this.contentW / 2, y: l.y + this._offY + this.contentH / 2 };
    },
    _rebuildControls() {
      const controls = Object.assign({}, F.Object.prototype.controls);
      this.anchors.forEach((a, i) => {
        controls['pt' + i] = makeDraggableControl(
          o => o.anchors[i],
          (o, p) => { o.anchors[i] = p; }
        );
      });
      controls.text = makeDraggableControl(
        o => ({ x: o.textPos.x + o.textW / 2, y: o.textPos.y + o.textH / 2 }),
        (o, p) => { o.textPos = { x: p.x - o.textW / 2, y: p.y - o.textH / 2 }; }
      );
      this.controls = controls;
    },
    _render(ctx) {
      beginContent(ctx, this);
      drawLeaders(ctx, this, this.anchors);
      // 文字（无方框，放在水平线上方）
      TX.draw(ctx, this.textContent, this.tx, this.textPos.x, this.textPos.y, 1e9);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line, arrowStyle: this.arrowStyle,
        anchors: this.anchors, textPos: this.textPos
      });
    }
  });

  /* ================= 样条曲线（Catmull-Rom，锚点可拖动） ================= */
  function catmullRomPath(pts) {
    let d = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + p2.x + ' ' + p2.y;
    }
    return d;
  }

  function leftCubicAxis(a, b, c, d, t) {
    const ab = a + (b - a) * t, bc = b + (c - b) * t, cd = c + (d - c) * t;
    const abc = ab + (bc - ab) * t, bcd = bc + (cd - bc) * t;
    return [ab, abc, abc + (bcd - abc) * t];
  }
  function trimSplineTail(segs, index, start, tip, length) {
    const [, c1x, c1y, c2x, c2y, endX, endY] = segs[index + 1];
    let low = 0, high = 1;
    const left = t => {
      const x = leftCubicAxis(start.x, c1x, c2x, endX, t);
      const y = leftCubicAxis(start.y, c1y, c2y, endY, t);
      return ['C', x[0], y[0], x[1], y[1], x[2], y[2]];
    };
    // Split the original curve at the head base so the shaft keeps its shape up to the join.
    for (let i = 0; i < 16; i++) {
      const t = (low + high) / 2, part = left(t);
      if (Math.hypot(tip.x - part[5], tip.y - part[6]) > length) low = t;
      else high = t;
    }
    const part = left((low + high) / 2);
    segs.splice(index + 1, segs.length - index - 1, part);
    return { x: part[5], y: part[6] };
  }
  function splineArrow(obj, pts, segs) {
    if (obj.arrowhead !== 'end') return {};
    const tip = pts[pts.length - 1];
    const distances = pts.map(p => Math.hypot(tip.x - p.x, tip.y - p.y));
    const reach = distances.reduce((max, value) => Math.max(max, value), 0);
    if (!reach) return {};
    const style = obj.arrowStyle, open = style === 'open';
    const { len, half, shaftWidth } = arrowMetrics(Math.max(0, obj.line.width || 0), obj.arrowLen, obj.arrowHalf, reach);
    let index = pts.length - 2;
    while (open ? distances[index] === 0 : distances[index] < len) index--;
    const from = open ? pts[index] : trimSplineTail(segs, index, pts[index], tip, len);
    const distance = Math.hypot(tip.x - from.x, tip.y - from.y);
    const ux = (tip.x - from.x) / distance, uy = (tip.y - from.y) / distance;
    const head = makeArrowHead(style, tip, ux, uy, open ? len : distance, half);
    if (style === 'diamond') segs.push(['L', from.x + ux * distance / 4, from.y + uy * distance / 4]);
    return { head, shaftWidth };
  }

  F.SplinePath = F.util.createClass(F.Object, {
    type: 'splinePath',
    initialize(opts) {
      opts = opts || {};
      this.points = (opts.points || []).map(p => ({ x: p.x, y: p.y }));
      this.arrowhead = opts.arrowhead || 'none'; // 'none' | 'end'
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.arrowLen = opts.arrowLen || 14;
      this.arrowHalf = opts.arrowHalf || 6;
      this.callSuper('initialize', opts);
      this.arrowStyle = arrowStyle(opts.arrowStyle);
      this._offX = 0; this._offY = 0;
      this.relayout();
      this._rebuildControls();
      this.objectCaching = false;
    },
    relayout() {
      const pts = this.points;
      if (!pts.length) { this._offX = 0; this._offY = 0; setContentSize(this, 10, 10); return; }
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const p of pts) {
        left = Math.min(left, p.x); top = Math.min(top, p.y);
        right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
      }
      const M = this.arrowhead === 'end' ? Math.max(22, this.arrowLen, this.arrowHalf) : 8;
      left -= M; top -= M; right += M; bottom += M;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    pointToLocal(p) {
      return { x: p.x - this._offX - this.contentW / 2, y: p.y - this._offY - this.contentH / 2 };
    },
    pointFromLocal(l) {
      return { x: l.x + this._offX + this.contentW / 2, y: l.y + this._offY + this.contentH / 2 };
    },
    _rebuildControls() {
      const controls = Object.assign({}, F.Object.prototype.controls);
      this.points.forEach((p, i) => {
        controls['pt' + i] = makeDraggableControl(
          o => o.points[i],
          (o, p) => { o.points[i] = p; }
        );
      });
      this.controls = controls;
    },
    _render(ctx) {
      beginContent(ctx, this);
      const pts = this.points;
      if (pts.length >= 2) {
        const segs = F.util.parsePath(catmullRomPath(pts));
        const { head, shaftWidth } = splineArrow(this, pts, segs);
        drawBasicArrow(ctx, this, head, shaftWidth, ctx => {
          for (const seg of segs) {
            if (seg[0] === 'M') ctx.moveTo(seg[1], seg[2]);
            else if (seg[0] === 'C') ctx.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
            else if (seg[0] === 'L') ctx.lineTo(seg[1], seg[2]);
          }
        });
      }
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        points: this.points, arrowhead: this.arrowhead, line: this.line,
        arrowStyle: this.arrowhead === 'end' ? this.arrowStyle : undefined,
        arrowLen: this.arrowLen, arrowHalf: this.arrowHalf
      });
    }
  });

  /* ---------- 角点缩放比例合并（供含可拖动手柄的类使用） ----------
     对象被角点缩放后 scaleX/Y ≠ 1，而内容坐标（anchor/textPos/points）不带比例；
     若直接用「冻结包围盒 + relayout」逻辑，松手后整体位置会偏移。
     这里把比例写回内容坐标并复位 scale=1，使之后拖动控制点不再跳位。
     把比例写入内容坐标，同时固定经原对象矩阵映射的内容原点。
     用新的包围盒中心补偿位置，因此旋转、翻转和合法的零坐标不会丢失。 */
  function bakeContentScale() {
    const sx = this.scaleX, sy = this.scaleY;
    if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
    // Retain nonuniform/skew transforms rather than distorting text or applying
    // the affine transform twice. Point controls already invert the full matrix.
    if (Math.abs(sx - sy) > 0.001 || this.skewX || this.skewY) return;
    const origin = contentOrigin(this);
    const k = (sx + sy) / 2;
    const sp = p => ({
      x: sx * p.x,
      y: sy * p.y
    });
    if (this.anchor) this.anchor = sp(this.anchor);
    if (this.textPos) this.textPos = sp(this.textPos);
    if (Array.isArray(this.anchors)) this.anchors = this.anchors.map(sp);
    if (Array.isArray(this.points)) this.points = this.points.map(sp);
    if (Array.isArray(this.pts)) this.pts = this.pts.map(sp);
    if (this.ellipse) {
      this.ellipse = {
        x: sx * this.ellipse.x,
        y: sy * this.ellipse.y,
        rx: Math.max(1, this.ellipse.rx * sx),
        ry: Math.max(1, this.ellipse.ry * sy)
      };
    }
    if (this.tx && this.tx.fontSize) this.tx.fontSize = Math.max(6, Math.round(this.tx.fontSize * k));
    if (this.arrowLen) this.arrowLen = Math.max(4, this.arrowLen * k);
    if (this.arrowHalf) this.arrowHalf = Math.max(2, this.arrowHalf * k);
    this.set({ scaleX: 1, scaleY: 1 });
    if (typeof this.relayout === 'function') {
      this.relayout();
      placeContentOrigin(this, origin);
    }
    this.set('dirty', true);
  }
  // 注册 bakeScale（置于文件末尾统一注册，类需先定义）

  /* ================= 引出区域（椭圆区域 → 引出箭头线 → 水平线 → 线上文字，无方框） ================= */
  // 椭圆上近似最近点（沿方向归一化，视觉足够精确）
  function nearestEllipsePoint(e, tx, ty) {
    const nx = (tx - e.x) / (e.rx || 1), ny = (ty - e.y) / (e.ry || 1);
    const d = Math.hypot(nx, ny) || 1;
    return { x: e.x + (nx / d) * e.rx, y: e.y + (ny / d) * e.ry };
  }
  F.CalloutRegion = F.util.createClass(F.Object, {
    type: 'calloutRegion',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent || '区域';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.shape = Object.assign({}, DEF_SHAPE, { fillColor: '#ffffff', fillOpacity: 0.35 }, opts.shape || {});
      this.ellipse = opts.ellipse || { x: 0, y: 0, rx: 60, ry: 40 };
      // 旧工程兼容：boxPos → textPos（旧版是文字放在方框里）
      if (opts.textPos) this.textPos = { x: opts.textPos.x, y: opts.textPos.y };
      else if (opts.boxPos) this.textPos = { x: opts.boxPos.x, y: opts.boxPos.y };
      else this.textPos = { x: this.ellipse.x + this.ellipse.rx + 30, y: this.ellipse.y - this.ellipse.ry - 70 };
      this.pad = 8;
      this.arrowLen = 12;
      this.callSuper('initialize', opts);
      this.arrowStyle = arrowStyle(opts.arrowStyle);
      this.relayout();
      this._rebuildControls();
      this.objectCaching = false;
    },
    // 几何计算（拖动期间调用：只更新水平线/文字布局，不动包围盒，保持实时渲染）
    computeGeometry() {
      const m = TX.measure(this.textContent, this.tx, 1e9);
      this.textW = m.w;
      this.textH = m.h;
      const tp = this.textPos;
      // 水平引出线：长度只取决于文本长度（文字放在线上方）
      this.leaderY = tp.y + this.textH;
      this.x0 = tp.x - this.pad;
      this.x1 = tp.x + this.textW + this.pad;
    },
    relayout() {
      this.computeGeometry();
      const e = this.ellipse, tp = this.textPos;
      const left = Math.min(e.x - e.rx, this.x0, tp.x) - 8;
      const top = Math.min(e.y - e.ry, this.leaderY, tp.y) - 8;
      const right = Math.max(e.x + e.rx, this.x1, tp.x + this.textW) + 8;
      const bottom = Math.max(e.y + e.ry, this.leaderY, tp.y) + 8;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    pointToLocal(p) {
      return { x: p.x - this._offX - this.contentW / 2, y: p.y - this._offY - this.contentH / 2 };
    },
    pointFromLocal(l) {
      return { x: l.x + this._offX + this.contentW / 2, y: l.y + this._offY + this.contentH / 2 };
    },
    _rebuildControls() {
      const controls = Object.assign({}, F.Object.prototype.controls);
      // 区域手柄（椭圆中心，可拖动）
      controls.region = makeDraggableControl(
        o => ({ x: o.ellipse.x, y: o.ellipse.y }),
        (o, p) => { o.ellipse = { x: p.x, y: p.y, rx: o.ellipse.rx, ry: o.ellipse.ry }; }
      );
      // 文字手柄（文字中心，可拖动）
      controls.text = makeDraggableControl(
        o => ({ x: o.textPos.x + o.textW / 2, y: o.textPos.y + o.textH / 2 }),
        (o, p) => { o.textPos = { x: p.x - o.textW / 2, y: p.y - o.textH / 2 }; }
      );
      this.controls = controls;
    },
    _render(ctx) {
      beginContent(ctx, this);
      const e = this.ellipse, tp = this.textPos, sh = this.shape, ly = this.leaderY;
      // 区域（椭圆，半透明填充 + 描边）
      fillStyle(ctx, sh);
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, sh, () => {
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      // 引出箭头线：从椭圆最近点直连水平线（拖动文字/区域时自动伸缩）
      const px = clamp(e.x, this.x0, this.x1);
      drawLeaders(ctx, this, [nearestEllipsePoint(e, px, ly)], px);
      // 文字（无方框，放在水平线上方）
      TX.draw(ctx, this.textContent, this.tx, tp.x, tp.y, 1e9);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line, arrowStyle: this.arrowStyle,
        shape: this.shape, ellipse: this.ellipse, textPos: this.textPos
      });
    }
  });

  /* ================= 图引出 ================= */
  F.CalloutImage = F.util.createClass(F.Object, {
    type: 'calloutImage',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent || '';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.region = opts.region || { x: 0, y: 0, w: 80, h: 80 };
      this.boxPos = opts.boxPos || { x: 100, y: 0 };
      this.imgSrc = opts.imgSrc || null;
      this._img = null; this._imgReady = false;
      if (this.imgSrc) this._loadImg(this.imgSrc);
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      this.relayout();
      this.objectCaching = false;
    },
    _loadImg(src) {
      const img = new Image();
      this._ready = new Promise(resolve => {
      img.onload = () => {
        this._img = img; this._imgReady = true;
        if (this.canvas) this.canvas.requestRenderAll();
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = src;
      });
    },
    relayout() {
      const b = this.boxPos, r = this.region;
      let left = Math.min(r.x, b.x), top = Math.min(r.y, b.y);
      let right = Math.max(r.x + r.w, b.x + r.w), bottom = Math.max(r.y + r.h, b.y + r.h);
      if (this.textContent) {
        const m = TX.measure(this.textContent, this.tx, r.w);
        bottom += m.h + 6;
      }
      left -= 4; top -= 4; right += 4; bottom += 4;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const b = this.boxPos, r = this.region, s = this.line;
      // 源区域虚线框
      ctx.save();
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1, s.width * 0.7);
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
      const rcx = r.x + r.w / 2, rcy = r.y + r.h / 2;
      const bcx = b.x + r.w / 2, bcy = b.y + r.h / 2;
      haloStroke(ctx, s, () => {
        ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(bcx, bcy); ctx.stroke();
      });
      if (this._imgReady) {
        ctx.save();
        ctx.beginPath(); ctx.rect(b.x, b.y, r.w, r.h); ctx.clip();
        ctx.drawImage(this._img, 0, 0, this._img.width, this._img.height, b.x, b.y, r.w, r.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#dfe2e8';
        ctx.fillRect(b.x, b.y, r.w, r.h);
      }
      haloStroke(ctx, s, () => {
        ctx.strokeRect(b.x, b.y, r.w, r.h);
      });
      if (this.textContent) {
        TX.draw(ctx, this.textContent, this.tx, b.x, b.y + r.h + 4, r.w);
      }
      endContent(ctx);
    },
    toObject(props) {
      const src = this.imgSrc || (this._img ? this._img.src : null);
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line,
        region: this.region, boxPos: this.boxPos, imgSrc: src
      });
    }
  });

  /* ================= 尺寸标注 ================= */
  F.Dimension = F.util.createClass(F.Object, {
    type: 'dimension',
    initialize(opts) {
      opts = opts || {};
      this.p1 = opts.p1 || { x: 0, y: 0 };
      this.p2 = opts.p2 || { x: 100, y: 0 };
      this.offset = opts.offset || 26;
      this.ext = opts.ext || 10;
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.scale = opts.scale != null ? opts.scale : 1;
      this.unit = opts.unit || '';
      this.callSuper('initialize', opts);
      this.arrowStyle = arrowStyle(opts.arrowStyle);
      this.relayout();
    },
    label() {
      const v = F.AnnotationGeometry.vector(this, this.p2.x - this.p1.x, this.p2.y - this.p1.y);
      const len = Math.hypot(v.x, v.y);
      if (!(this.scale > 0 && Number.isFinite(this.scale))) return '比例无效';
      if (this.scale === 1 && !this.unit) return Math.round(len) + ' px';
      return (len / this.scale).toFixed(2) + ' ' + (this.unit || 'px');
    },
    relayout() {
      const M = this.offset + this.ext + 24;
      let left = Math.min(this.p1.x, this.p2.x) - M, top = Math.min(this.p1.y, this.p2.y) - M;
      let right = Math.max(this.p1.x, this.p2.x) + M, bottom = Math.max(this.p1.y, this.p2.y) + M;
      const dx = this.p2.x - this.p1.x, dy = this.p2.y - this.p1.y, length = Math.hypot(dx, dy) || 1;
      const x = (this.p1.x + this.p2.x) / 2 - dy / length * (this.offset + 4);
      const y = (this.p1.y + this.p2.y) / 2 + dx / length * (this.offset + 4);
      const text = TX.measure(this.label(), this.tx, 400);
      left = Math.min(left, x - text.w / 2); right = Math.max(right, x + text.w / 2);
      top = Math.min(top, y - text.h / 2); bottom = Math.max(bottom, y + text.h / 2);
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const p1 = this.p1, p2 = this.p2;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const L = Math.hypot(dx, dy);
      const ux = dx / (L || 1), uy = dy / (L || 1);
      const nx = -uy, ny = ux;
      const a1 = { x: p1.x + nx * this.offset, y: p1.y + ny * this.offset };
      const a2 = { x: p2.x + nx * this.offset, y: p2.y + ny * this.offset };
      const s = this.line;
      const fullLength = 9 + (s.width || 0), style = this.arrowStyle;
      // Leave room between the two heads on short dimensions.
      const len = style === 'solid' ? fullLength : Math.min(fullLength, L * 0.45);
      const half = (4 + (s.width || 0) * 0.5) * len / fullLength;
      const heads = L ? [
        makeArrowHead(style, a1, -ux, -uy, len, half),
        makeArrowHead(style, a2, ux, uy, len, half)
      ] : [];
      drawArrowLine(ctx, this, heads, () => {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(a1.x + nx * this.ext, a1.y + ny * this.ext);
        ctx.moveTo(p2.x, p2.y); ctx.lineTo(a2.x + nx * this.ext, a2.y + ny * this.ext);
        ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
        ctx.stroke();
      });
      const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
      const lp = { x: mid.x + nx * 4, y: mid.y + ny * 4 };
      const m = TX.measure(this.label(), this.tx, 400);
      TX.draw(ctx, this.label(), this.tx, lp.x - m.w / 2, lp.y - m.h / 2, 400);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        p1: this.p1, p2: this.p2, offset: this.offset, ext: this.ext,
        line: this.line, tx: this.tx, scale: this.scale, unit: this.unit, arrowStyle: this.arrowStyle
      });
    }
  });

  /* ================= 角度测量 ================= */
  F.AngleMeasure = F.util.createClass(F.Object, {
    type: 'angleMeasure',
    initialize(opts) {
      opts = opts || {};
      this.v = opts.v || { x: 0, y: 0 };
      this.p1 = opts.p1 || { x: 80, y: 0 };
      this.p2 = opts.p2 || { x: 0, y: -80 };
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.callSuper('initialize', opts);
      this.relayout();
    },
    getAngle() {
      const a = F.AnnotationGeometry.vector(this, this.p1.x - this.v.x, this.p1.y - this.v.y);
      const b = F.AnnotationGeometry.vector(this, this.p2.x - this.v.x, this.p2.y - this.v.y);
      const ax = a.x, ay = a.y, bx = b.x, by = b.y;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      let cos = (ax * bx + ay * by) / (la * lb);
      cos = clamp(cos, -1, 1);
      return Math.acos(cos) * 180 / Math.PI;
    },
    relayout() {
      const M = 34;
      const xs = [this.v.x, this.p1.x, this.p2.x], ys = [this.v.y, this.p1.y, this.p2.y];
      let left = Math.min.apply(null, xs) - M, top = Math.min.apply(null, ys) - M;
      let right = Math.max.apply(null, xs) + M, bottom = Math.max.apply(null, ys) + M;
      const start = Math.atan2(this.p1.y - this.v.y, this.p1.x - this.v.x);
      let sweep = Math.atan2(this.p2.y - this.v.y, this.p2.x - this.v.x) - start;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      const x = this.v.x + Math.cos(start + sweep / 2) * 30, y = this.v.y + Math.sin(start + sweep / 2) * 30;
      const text = TX.measure(this.getAngle().toFixed(1) + '°', this.tx, 200);
      left = Math.min(left, x - text.w / 2); right = Math.max(right, x + text.w / 2);
      top = Math.min(top, y - text.h / 2); bottom = Math.max(bottom, y + text.h / 2);
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const v = this.v, s = this.line;
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        ctx.moveTo(v.x, v.y); ctx.lineTo(this.p1.x, this.p1.y);
        ctx.moveTo(v.x, v.y); ctx.lineTo(this.p2.x, this.p2.y);
        ctx.stroke();
      });
      const ax = this.p1.x - v.x, ay = this.p1.y - v.y;
      const start = Math.atan2(ay, ax);
      const bx = this.p2.x - v.x, by = this.p2.y - v.y;
      let end = Math.atan2(by, bx);
      let sweep = end - start;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      const R = 18;
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        ctx.arc(v.x, v.y, R, start, start + sweep, sweep < 0);
        ctx.stroke();
      });
      dot(ctx, v.x, v.y, 4, s.color);
      const midA = start + sweep / 2;
      const lp = { x: v.x + Math.cos(midA) * (R + 12), y: v.y + Math.sin(midA) * (R + 12) };
      const txt = this.getAngle().toFixed(1) + '°';
      const m = TX.measure(txt, this.tx, 200);
      TX.draw(ctx, txt, this.tx, lp.x - m.w / 2, lp.y - m.h / 2, 200);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        v: this.v, p1: this.p1, p2: this.p2, line: this.line, tx: this.tx
      });
    }
  });

  /* ================= 面积测量 ================= */
  F.AreaMeasure = F.util.createClass(F.Object, {
    type: 'areaMeasure',
    initialize(opts) {
      opts = opts || {};
      this.points = (opts.points || []).map(p => ({ x: p.x, y: p.y }));
      this.shape = Object.assign({}, DEF_SHAPE, { fillColor: '#4c8dff', fillOpacity: 0.25 }, opts.shape || {});
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.scale = opts.scale != null ? opts.scale : 1;
      this.unit = opts.unit || '';
      this.callSuper('initialize', opts);
      this.relayout();
    },
    area() {
      const pts = this.points;
      let s = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        s += a.x * b.y - b.x * a.y;
      }
      return Math.abs(s) / 2;
    },
    label() {
      const m = this.calcTransformMatrix();
      const a = this.area() * Math.abs(m[0] * m[3] - m[1] * m[2]);
      if (!(this.scale > 0 && Number.isFinite(this.scale))) return '比例无效';
      return (a / (this.scale * this.scale)).toFixed(2) + ' ' + (this.unit || 'px') + '²';
    },
    relayout() {
      const pts = this.points;
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const p of pts) {
        left = Math.min(left, p.x); top = Math.min(top, p.y);
        right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
      }
      if (!isFinite(left)) { left = 0; top = 0; right = 1; bottom = 1; }
      const M = 30;
      left -= M; top -= M; right += M; bottom += M;
      if (pts.length) {
        const x = pts.reduce((n, p) => n + p.x, 0) / pts.length, y = pts.reduce((n, p) => n + p.y, 0) / pts.length;
        const text = TX.measure('S = ' + this.label(), this.tx, 300);
        left = Math.min(left, x - text.w / 2); right = Math.max(right, x + text.w / 2);
        top = Math.min(top, y - text.h / 2); bottom = Math.max(bottom, y + text.h / 2);
      }
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const pts = this.points, sh = this.shape;
      if (pts.length >= 2) {
        fillStyle(ctx, sh);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
        resetAlpha(ctx);
        haloStroke(ctx, sh, () => {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.stroke();
        });
      }
      for (const p of pts) dot(ctx, p.x, p.y, 3.5, sh.stroke);
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= pts.length; cy /= pts.length;
      const txt = 'S = ' + this.label();
      const m = TX.measure(txt, this.tx, 300);
      TX.draw(ctx, txt, this.tx, cx - m.w / 2, cy - m.h / 2, 300);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        points: this.points, shape: this.shape, tx: this.tx,
        scale: this.scale, unit: this.unit
      });
    }
  });

  /* ================= 圆形放大镜 ================= */
  F.Magnifier = F.util.createClass(F.Object, {
    type: 'magnifier',
    initialize(opts) {
      opts = opts || {};
      this.radius = opts.radius || 90;
      this.zoom = opts.zoom != null ? opts.zoom : 2;
      this.borderColor = opts.borderColor || '#ff5252';
      this.borderWidth = opts.borderWidth || 3;
      this._snap = null; this._canvasRef = null;
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      setContentSize(this, this.radius * 2, this.radius * 2);
      this.objectCaching = false;
    },
    _render(ctx) {
      const r = this.radius;
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
      if (this._snap && this._canvasRef) {
        const c = this._canvasRef;
        const vt = c.viewportTransform;
        const center = F.util.transformPoint(this.getCenterPoint(), vt);
        const z = vt[0] || 1;
        const srcR = (r / this.zoom) * z;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this._snap, center.x - srcR, center.y - srcR, srcR * 2, srcR * 2, -r, -r, r * 2, r * 2);
      } else {
        ctx.fillStyle = 'rgba(120,120,120,0.35)';
        ctx.fillRect(-r, -r, r * 2, r * 2);
      }
      ctx.restore();
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWidth;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = this.borderColor;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-r * 0.32, r - this.borderWidth - 4, r * 0.64, this.borderWidth + 4, 3);
      else ctx.rect(-r * 0.32, r - this.borderWidth - 4, r * 0.64, this.borderWidth + 4);
      ctx.fill();
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        radius: this.radius, zoom: this.zoom,
        borderColor: this.borderColor, borderWidth: this.borderWidth
      });
    }
  });

  /* ================= 方形放大镜 ================= */
  F.SquareMagnifier = F.util.createClass(F.Object, {
    type: 'squareMagnifier',
    initialize(opts) {
      opts = opts || {};
      this.side = opts.side || 140;
      this.cornerRadius = opts.cornerRadius != null ? opts.cornerRadius : 16;
      this.zoom = opts.zoom != null ? opts.zoom : 2;
      this.borderColor = opts.borderColor || '#ff5252';
      this.borderWidth = opts.borderWidth || 3;
      this._snap = null; this._canvasRef = null;
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      setContentSize(this, this.side, this.side);
      this.objectCaching = false;
    },
    _render(ctx) {
      const s = this.side, cr = Math.min(this.cornerRadius, s / 2);
      ctx.save();
      ctx.beginPath();
      roundRectPath(ctx, -s / 2, -s / 2, s, s, cr);
      ctx.clip();
      if (this._snap && this._canvasRef) {
        const c = this._canvasRef;
        const vt = c.viewportTransform;
        const center = F.util.transformPoint(this.getCenterPoint(), vt);
        const z = vt[0] || 1;
        const half = ((s / 2) / this.zoom) * z;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this._snap, center.x - half, center.y - half, half * 2, half * 2, -s / 2, -s / 2, s, s);
      } else {
        ctx.fillStyle = 'rgba(120,120,120,0.35)';
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWidth;
      ctx.beginPath();
      roundRectPath(ctx, -s / 2, -s / 2, s, s, cr);
      ctx.stroke();
      ctx.fillStyle = this.borderColor;
      ctx.fillRect(-s * 0.28, s / 2 - this.borderWidth - 3, s * 0.56, this.borderWidth + 3);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        side: this.side, cornerRadius: this.cornerRadius, zoom: this.zoom,
        borderColor: this.borderColor, borderWidth: this.borderWidth
      });
    }
  });

  /* ================= 线条（直线 / 箭头 / 手写：白色边框 + 实心箭头） ================= */
  F.AnnoLine = F.util.createClass(F.Object, {
    type: 'annoLine',
    initialize(opts) {
      opts = opts || {};
      this.pts = (opts.pts || []).map(p => ({ x: p.x, y: p.y }));
      this.arrowhead = opts.arrowhead || 'none'; // 'none' | 'end'
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.arrowLen = opts.arrowLen || 14;
      this.arrowHalf = opts.arrowHalf || 6;
      this.callSuper('initialize', opts);
      this.arrowStyle = arrowStyle(opts.arrowStyle);
      this._offX = 0; this._offY = 0;
      this.relayout();
      // 直线/箭头等少量端点可拖动修改；手写（大量点）不生成手柄
      if (this.pts.length >= 2 && this.pts.length <= 6) this._rebuildControls();
      this.objectCaching = false;
    },
    // 拖动期间无需额外几何（渲染直接使用 pts），保留接口与其它类一致
    computeGeometry() {},
    pointToLocal(p) {
      return { x: p.x - this._offX - this.contentW / 2, y: p.y - this._offY - this.contentH / 2 };
    },
    pointFromLocal(l) {
      return { x: l.x + this._offX + this.contentW / 2, y: l.y + this._offY + this.contentH / 2 };
    },
    _rebuildControls() {
      const controls = Object.assign({}, F.Object.prototype.controls);
      this.pts.forEach((p, i) => {
        controls['pt' + i] = makeDraggableControl(
          o => o.pts[i],
          (o, p) => { o.pts[i] = p; }
        );
      });
      this.controls = controls;
    },
    relayout() {
      const pts = this.pts;
      if (!pts.length) { this._offX = 0; this._offY = 0; setContentSize(this, 10, 10); return; }
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const p of pts) {
        left = Math.min(left, p.x); top = Math.min(top, p.y);
        right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
      }
      const M = (this.arrowhead === 'end' ? Math.max(this.arrowLen, this.arrowHalf) : 0) + (this.line.haloWidth || 0) * 2 + 6;
      left -= M; top -= M; right += M; bottom += M;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const pts = this.pts;
      if (pts.length >= 2) {
        const tip = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        let head, width, end = tip;
        if (this.arrowhead === 'end') {
          const dx = tip.x - prev.x, dy = tip.y - prev.y, distance = Math.hypot(dx, dy);
          if (distance) {
            const { len, half, shaftWidth } = arrowMetrics(Math.max(0, this.line.width || 0), this.arrowLen, this.arrowHalf, distance);
            const ux = dx / distance, uy = dy / distance, style = this.arrowStyle;
            head = makeArrowHead(style, tip, ux, uy, len, half);
            width = shaftWidth;
            if (style === 'diamond') end = { x: tip.x - ux * len * 0.75, y: tip.y - uy * len * 0.75 };
            else if (style !== 'open') end = head.base;
          }
        }
        drawBasicArrow(ctx, this, head, width, ctx => {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.lineTo(end.x, end.y);
        });
      }
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        pts: this.pts, arrowhead: this.arrowhead, line: this.line,
        arrowStyle: this.arrowhead === 'end' ? this.arrowStyle : undefined,
        arrowLen: this.arrowLen, arrowHalf: this.arrowHalf
      });
    }
  });

  /* ================= 矩形（白色边框 + 彩色边框 + 填充） ================= */
  F.AnnoRect = F.util.createClass(F.Object, {
    type: 'annoRect',
    initialize(opts) {
      opts = opts || {};
      this.rect = opts.rect || { x: 0, y: 0, w: 10, h: 10 };
      this.shape = Object.assign({}, DEF_SHAPE, opts.shape || {});
      this.callSuper('initialize', opts);
      this._offX = 0; this._offY = 0;
      this.relayout();
    },
    relayout() {
      const r = this.rect;
      const M = (this.shape.strokeWidth || 0) + (this.shape.haloWidth || 0) * 2 + 4;
      this._offX = r.x - M; this._offY = r.y - M;
      setContentSize(this, r.w + M * 2, r.h + M * 2);
    },
    _render(ctx) {
      const s = this.shape, r = this.rect;
      beginContent(ctx, this);
      const rr = Math.min(s.cornerRadius || 0, r.w / 2, r.h / 2);
      fillStyle(ctx, s);
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
        ctx.stroke();
      });
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        rect: this.rect, shape: this.shape
      });
    }
  });

  /* ---------- 静态 fromObject（fabric 5.x 反序列化必需） ---------- */
  function addFromObject(klass) {
    klass.fromObject = function (options, callback) {
      const obj = new klass(options);
      if (callback) {
        if (obj._ready) obj._ready.then(() => callback(obj)); else callback(obj);
      }
      return obj;
    };
  }
  [
    'AnnoText', 'MessageBox', 'StepNumber', 'CalloutText', 'MultiCallout',
    'CalloutRegion', 'CalloutImage', 'Dimension', 'AngleMeasure', 'AreaMeasure',
    'Magnifier', 'SquareMagnifier', 'SplinePath', 'AnnoLine', 'AnnoRect'
  ].forEach(n => addFromObject(F[n]));

  /* ---------- 角点缩放合并注册（类已全部定义） ---------- */
  F.CalloutText.prototype.bakeScale = bakeContentScale;
  F.MultiCallout.prototype.bakeScale = bakeContentScale;
  F.SplinePath.prototype.bakeScale = bakeContentScale;
  F.CalloutRegion.prototype.bakeScale = bakeContentScale;
  F.AnnoLine.prototype.bakeScale = bakeContentScale;


  /* 暴露默认样式供 app 层使用 */
  window.DEF_TEXT = DEF_TEXT;
  window.DEF_SHAPE = DEF_SHAPE;
  window.DEF_LINE = DEF_LINE;
  window.DEF_BG = DEF_BG;
})();
