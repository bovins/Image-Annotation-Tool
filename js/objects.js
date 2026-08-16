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
  function arrowHeadPath(tip, dirX, dirY, len, half) {
    const nx = -dirY, ny = dirX;
    return {
      x1: tip.x - dirX * len + nx * half, y1: tip.y - dirY * len + ny * half,
      x2: tip.x - dirX * len - nx * half, y2: tip.y - dirY * len - ny * half
    };
  }

  /* ---------- 内容坐标布局辅助 ----------
     复合对象使用“内容坐标”：对象宽度/高度 = 内容包围盒；
     _offX/_offY = 内容区左上角（canvas 坐标），对象 left/top 与之对齐。 */
  function setContentSize(obj, w, h) {
    obj.contentW = w; obj.contentH = h;
    obj.width = w; obj.height = h;
  }
  function beginContent(ctx, obj) {
    ctx.save();
    ctx.translate(-(obj._offX || 0) - obj.contentW / 2, -(obj._offY || 0) - obj.contentH / 2);
  }
  function endContent(ctx) { ctx.restore(); }

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
      // 放大手柄命中区，便于抓取拖动
      this.cornerSize = 18;
      this.touchCornerSize = 26;
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
      const a = this.anchor, s = this.line, ly = this.leaderY;
      // 水平引出线（长度 = 文本长度 + 边距，文字放在线上方）
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        ctx.moveTo(this.x0, ly);
        ctx.lineTo(this.x1, ly);
        ctx.stroke();
      });
      // 引出箭头线：从水平线最近点直连锚点（拖动文字时长度随之变化，非固定直角）
      const px = clamp(a.x, this.x0, this.x1);
      const dx = a.x - px, dy = a.y - ly;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const hl = this.arrowLen + s.width * 2;
      if (L > hl + 1) {
        haloStroke(ctx, s, () => {
          ctx.beginPath();
          ctx.moveTo(px, ly);
          ctx.lineTo(a.x - ux * hl, a.y - uy * hl);
          ctx.stroke();
        });
      }
      // 箭头（tip 指向锚点，方向沿引出线，白色边框 + 实心）
      haloFill(ctx, s, () => {
        const tip = { x: a.x, y: a.y };
        const h = arrowHeadPath(tip, ux, uy, hl, this.arrowLen * 0.55);
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(h.x1, h.y1);
        ctx.lineTo(h.x2, h.y2);
        ctx.closePath();
      });
      // 文字（无方框，放在水平线上方）
      TX.draw(ctx, this.textContent, this.tx, this.textPos.x, this.textPos.y, 1e9);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line,
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
      cornerSize: 20, touchCornerSize: 30,
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
        const vt = obj.canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        const inv = F.util.invertTransform(F.util.multiplyTransformMatrices(vt, obj.calcTransformMatrix()));
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
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
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
      // 放大手柄命中区，便于抓取拖动
      this.cornerSize = 18;
      this.touchCornerSize = 26;
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
      const s = this.line, ly = this.leaderY;
      // 水平引出线（长度 = 文本长度 + 边距）
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        ctx.moveTo(this.x0, ly);
        ctx.lineTo(this.x1, ly);
        ctx.stroke();
      });
      // 每个锚点：从水平线最近点直连锚点（实心箭头 + 白色边框）
      const hl = this.arrowLen + s.width * 2;
      for (const a of this.anchors) {
        const px = clamp(a.x, this.x0, this.x1);
        const dx = a.x - px, dy = a.y - ly;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        if (L > hl + 1) {
          haloStroke(ctx, s, () => {
            ctx.beginPath();
            ctx.moveTo(px, ly);
            ctx.lineTo(a.x - ux * hl, a.y - uy * hl);
            ctx.stroke();
          });
        }
        haloFill(ctx, s, () => {
          const tip = { x: a.x, y: a.y };
          const h = arrowHeadPath(tip, ux, uy, hl, this.arrowLen * 0.55);
          ctx.beginPath();
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(h.x1, h.y1);
          ctx.lineTo(h.x2, h.y2);
          ctx.closePath();
        });
      }
      // 文字（无方框，放在水平线上方）
      TX.draw(ctx, this.textContent, this.tx, this.textPos.x, this.textPos.y, 1e9);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line,
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
      // 放大手柄命中区，便于抓取拖动
      this.cornerSize = 18;
      this.touchCornerSize = 26;
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
      const M = this.arrowhead === 'end' ? 22 : 8;
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
      const pts = this.points, s = this.line;
      if (pts.length >= 2) {
        const segs = F.util.parsePath(catmullRomPath(pts));
        haloStroke(ctx, s, () => {
          ctx.beginPath();
          for (const seg of segs) {
            if (seg[0] === 'M') ctx.moveTo(seg[1], seg[2]);
            else if (seg[0] === 'C') ctx.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
            else if (seg[0] === 'L') ctx.lineTo(seg[1], seg[2]);
          }
          ctx.stroke();
        });
        if (this.arrowhead === 'end') {
          const tip = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          const dx = tip.x - prev.x, dy = tip.y - prev.y;
          const L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L;
          const nx = -uy, ny = ux;
          const b1 = { x: tip.x - ux * this.arrowLen + nx * this.arrowHalf, y: tip.y - uy * this.arrowLen + ny * this.arrowHalf };
          const b2 = { x: tip.x - ux * this.arrowLen - nx * this.arrowHalf, y: tip.y - uy * this.arrowLen - ny * this.arrowHalf };
          haloFill(ctx, s, () => {
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(b1.x, b1.y);
            ctx.lineTo(b2.x, b2.y);
            ctx.closePath();
          });
        }
      }
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        points: this.points, arrowhead: this.arrowhead, line: this.line
      });
    }
  });

  /* ================= 引出区域 ================= */
  F.CalloutRegion = F.util.createClass(F.Object, {
    type: 'calloutRegion',
    initialize(opts) {
      opts = opts || {};
      this.textContent = opts.textContent || '区域';
      this.tx = Object.assign({}, DEF_TEXT, opts.tx || {});
      this.line = Object.assign({}, DEF_LINE, opts.line || {});
      this.bg = Object.assign({}, DEF_BG, opts.bg || {});
      this.shape = Object.assign({}, DEF_SHAPE, { fillColor: '#ffffff', fillOpacity: 0.35 }, opts.shape || {});
      this.ellipse = opts.ellipse || { x: 0, y: 0, rx: 60, ry: 40 };
      this.boxPos = opts.boxPos || { x: 80, y: -40 };
      this.boxW = opts.boxW || 80; this.boxH = opts.boxH || 32;
      this.pad = 8;
      this.callSuper('initialize', opts);
      this.relayout();
    },
    relayout() {
      const maxW = Math.max(40, this.boxW - this.pad * 2);
      const m = TX.measure(this.textContent, this.tx, maxW);
      this.boxW = Math.max(this.boxW, m.w + this.pad * 2);
      this.boxH = Math.max(this.boxH, m.h + this.pad * 2);
      const e = this.ellipse, b = this.boxPos;
      let left = Math.min(e.x - e.rx, b.x), top = Math.min(e.y - e.ry, b.y);
      let right = Math.max(e.x + e.rx, b.x + this.boxW), bottom = Math.max(e.y + e.ry, b.y + this.boxH);
      left -= 6; top -= 6; right += 6; bottom += 6;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const e = this.ellipse, s = this.line, b = this.boxPos, sh = this.shape;
      fillStyle(ctx, sh);
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, sh, () => {
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      const bx = clamp(b.x + this.boxW / 2, e.x - e.rx, e.x + e.rx);
      const by = clamp(b.y + this.boxH / 2, e.y - e.ry, e.y + e.ry);
      const ex = clamp(bx, e.x - e.rx, e.x + e.rx);
      const ey = clamp(by, e.y - e.ry, e.y + e.ry);
      haloStroke(ctx, s, () => {
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke();
      });
      const r = Math.min(this.bg.radius, this.boxW / 2, this.boxH / 2);
      ctx.fillStyle = this.bg.fill; ctx.globalAlpha = this.bg.opacity;
      ctx.beginPath();
      roundRectPath(ctx, b.x, b.y, this.boxW, this.boxH, r);
      ctx.fill();
      resetAlpha(ctx);
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        roundRectPath(ctx, b.x, b.y, this.boxW, this.boxH, r);
        ctx.stroke();
      });
      TX.draw(ctx, this.textContent, this.tx, b.x + this.pad, b.y + this.pad, this.boxW - this.pad * 2);
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        textContent: this.textContent, tx: this.tx, line: this.line, bg: this.bg,
        shape: this.shape, ellipse: this.ellipse, boxPos: this.boxPos,
        boxW: this.boxW, boxH: this.boxH
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
      img.onload = () => {
        this._img = img; this._imgReady = true;
        if (this.canvas) this.canvas.requestRenderAll();
      };
      img.src = src;
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
      this.relayout();
    },
    label() {
      const len = Math.hypot(this.p2.x - this.p1.x, this.p2.y - this.p1.y);
      if (this.scale && this.scale !== 1) {
        return (len / this.scale).toFixed(2) + (this.unit ? ' ' + this.unit : '');
      }
      return Math.round(len) + ' px';
    },
    relayout() {
      const M = this.offset + this.ext + 24;
      const left = Math.min(this.p1.x, this.p2.x) - M, top = Math.min(this.p1.y, this.p2.y) - M;
      const right = Math.max(this.p1.x, this.p2.x) + M, bottom = Math.max(this.p1.y, this.p2.y) + M;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const p1 = this.p1, p2 = this.p2;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const nx = -uy, ny = ux;
      const a1 = { x: p1.x + nx * this.offset, y: p1.y + ny * this.offset };
      const a2 = { x: p2.x + nx * this.offset, y: p2.y + ny * this.offset };
      const s = this.line;
      // 引出线 + 尺寸线
      haloStroke(ctx, s, () => {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(a1.x + nx * this.ext, a1.y + ny * this.ext);
        ctx.moveTo(p2.x, p2.y); ctx.lineTo(a2.x + nx * this.ext, a2.y + ny * this.ext);
        ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
        ctx.stroke();
      });
      // 双箭头（实心 + 白色边框）
      const hl = 9 + s.width, hh = 4 + s.width * 0.5;
      const h1 = arrowHeadPath(a1, -ux, -uy, hl, hh);
      const h2 = arrowHeadPath(a2, ux, uy, hl, hh);
      haloFill(ctx, s, () => {
        ctx.beginPath();
        ctx.moveTo(a1.x, a1.y); ctx.lineTo(h1.x1, h1.y1); ctx.lineTo(h1.x2, h1.y2); ctx.closePath();
        ctx.moveTo(a2.x, a2.y); ctx.lineTo(h2.x1, h2.y1); ctx.lineTo(h2.x2, h2.y2); ctx.closePath();
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
        line: this.line, tx: this.tx, scale: this.scale, unit: this.unit
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
      const ax = this.p1.x - this.v.x, ay = this.p1.y - this.v.y;
      const bx = this.p2.x - this.v.x, by = this.p2.y - this.v.y;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      let cos = (ax * bx + ay * by) / (la * lb);
      cos = clamp(cos, -1, 1);
      return Math.acos(cos) * 180 / Math.PI;
    },
    relayout() {
      const M = 34;
      const xs = [this.v.x, this.p1.x, this.p2.x], ys = [this.v.y, this.p1.y, this.p2.y];
      const left = Math.min.apply(null, xs) - M, top = Math.min.apply(null, ys) - M;
      const right = Math.max.apply(null, xs) + M, bottom = Math.max.apply(null, ys) + M;
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
      const a = this.area();
      if (this.scale && this.scale !== 1) {
        return (a / (this.scale * this.scale)).toFixed(2) + (this.unit ? ' ' + this.unit + '²' : '');
      }
      return Math.round(a) + ' px²';
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
      this._offX = 0; this._offY = 0;
      this.relayout();
      this.objectCaching = false;
    },
    relayout() {
      const pts = this.pts;
      if (!pts.length) { this._offX = 0; this._offY = 0; setContentSize(this, 10, 10); return; }
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const p of pts) {
        left = Math.min(left, p.x); top = Math.min(top, p.y);
        right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
      }
      const M = (this.arrowhead === 'end' ? this.arrowLen : 0) + (this.line.haloWidth || 0) * 2 + 6;
      left -= M; top -= M; right += M; bottom += M;
      this._offX = left; this._offY = top;
      setContentSize(this, right - left, bottom - top);
    },
    _render(ctx) {
      beginContent(ctx, this);
      const s = this.line, pts = this.pts;
      if (pts.length >= 2) {
        const isArrow = this.arrowhead === 'end';
        const tip = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        let end = tip, dir = null;
        if (isArrow) {
          const dx = tip.x - prev.x, dy = tip.y - prev.y;
          const L = Math.hypot(dx, dy) || 1;
          dir = { x: dx / L, y: dy / L };
          end = { x: tip.x - dir.x * this.arrowLen, y: tip.y - dir.y * this.arrowLen };
        }
        haloStroke(ctx, s, () => {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        });
        if (isArrow && dir) {
          const hl = this.arrowLen, hh = this.arrowHalf;
          const b1 = { x: tip.x - dir.x * hl + (-dir.y) * hh, y: tip.y - dir.y * hl + dir.x * hh };
          const b2 = { x: tip.x - dir.x * hl - (-dir.y) * hh, y: tip.y - dir.y * hl - dir.x * hh };
          haloFill(ctx, s, () => {
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(b1.x, b1.y);
            ctx.lineTo(b2.x, b2.y);
            ctx.closePath();
          });
        }
      }
      endContent(ctx);
    },
    toObject(props) {
      return F.util.object.extend(this.callSuper('toObject', props), {
        pts: this.pts, arrowhead: this.arrowhead, line: this.line,
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
      if (callback) callback(obj);
      return obj;
    };
  }
  [
    'AnnoText', 'MessageBox', 'StepNumber', 'CalloutText', 'MultiCallout',
    'CalloutRegion', 'CalloutImage', 'Dimension', 'AngleMeasure', 'AreaMeasure',
    'Magnifier', 'SquareMagnifier', 'SplinePath', 'AnnoLine', 'AnnoRect'
  ].forEach(n => addFromObject(F[n]));

  /* 暴露默认样式供 app 层使用 */
  window.DEF_TEXT = DEF_TEXT;
  window.DEF_SHAPE = DEF_SHAPE;
  window.DEF_LINE = DEF_LINE;
  window.DEF_BG = DEF_BG;
})();
