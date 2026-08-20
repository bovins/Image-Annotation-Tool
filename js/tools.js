/* tools.js — 标注工具手势交互 */
(function () {
  const F = fabric;

  /* ---------- 点抽稀 / 锚点上限辅助 ---------- */
  // 曲线点抽稀：保留首尾与间隔足够远的点，供样条锚点编辑
  function decimate(pts, minDist) {
    if (pts.length <= 2) return pts.map(p => ({ x: p.x, y: p.y }));
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let last = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minDist) {
        out.push({ x: pts[i].x, y: pts[i].y });
        last = pts[i];
      }
    }
    const e = pts[pts.length - 1];
    if (Math.hypot(e.x - last.x, e.y - last.y) > 2) out.push({ x: e.x, y: e.y });
    return out;
  }
  // 锚点数量上限：均匀抽取（含首尾）
  function capPoints(pts, max) {
    if (pts.length <= max) return pts.map(p => ({ x: p.x, y: p.y }));
    const out = [];
    for (let i = 0; i < max; i++) {
      const idx = Math.round((pts.length - 1) * i / (max - 1));
      out.push({ x: pts[idx].x, y: pts[idx].y });
    }
    return out;
  }

  /* ---------- 马赛克图层辅助 ---------- */
  function ensureMosaicLayer(cv) {
    if (cv._mosaicLayer) return;
    const oc = document.createElement('canvas');
    oc.width = cv._baseW; oc.height = cv._baseH;
    const layer = new fabric.Image(oc, {
      left: 0, top: 0, originX: 'left', originY: 'top',
      selectable: false, evented: false, objectCaching: false,
      mosaicOverlay: true
    });
    window.APP.skipNextAdd = true;
    cv.add(layer);
    cv.sendToBack(cv._baseImage);
    cv._mosaicLayer = layer;
    cv._mosaicCtx = oc.getContext('2d');
  }
  function paintSegment(cv, a, b) {
    const layer = cv._mosaicLayer, ctx = cv._mosaicCtx, base = cv._baseImgEl;
    if (!layer || !ctx || !base) return;
    const A = window.APP.mosaic || {};
    const B = A.block || 10, R = A.brush || 36, eraser = !!A.eraser;
    const imgW = cv._baseW, imgH = cv._baseH;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(4, R * 0.35)));
    const tmp = document.createElement('canvas');
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps;
      const y = a.y + (b.y - a.y) * i / steps;
      if (eraser) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      const bx0 = Math.max(0, Math.floor((x - R) / B) * B);
      const by0 = Math.max(0, Math.floor((y - R) / B) * B);
      const bx1 = Math.min(imgW, Math.ceil((x + R) / B) * B);
      const by1 = Math.min(imgH, Math.ceil((y + R) / B) * B);
      if (bx1 <= bx0 || by1 <= by0) continue;
      const w = bx1 - bx0, h = by1 - by0;
      const sw = Math.max(1, Math.round(w / B)), sh = Math.max(1, Math.round(h / B));
      tmp.width = sw; tmp.height = sh;
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(base, bx0, by0, w, h, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(tmp, 0, 0, sw, sh, bx0, by0, w, h);
      ctx.restore();
    }
  }

  /* ---------- 工具管理器 ---------- */
  const M = window.TOOLMGR = {
    current: 'select',
    cv: null,
    state: {},
    temp: [],
    phaseHint: '',
    _savedSP: null,

    init(cv) {
      this.cv = cv;
      this.bind();
    },

    select(id) {
      if (this.current === id) return;
      this.cancelAction();
      // 工具级图形默认值：进入工具时套用该工具的默认填充，离开时还原
      const sp = window.APP ? window.APP.shapeProps : null;
      if (sp) {
        if (this._savedSP) {
          Object.assign(sp, this._savedSP);
          this._savedSP = null;
        }
        if (id === 'msgbox') {
          this._savedSP = { fillColor: sp.fillColor, fillOpacity: sp.fillOpacity, cornerRadius: sp.cornerRadius };
          sp.fillColor = '#ffffff'; sp.fillOpacity = 1; sp.cornerRadius = 8;
        } else if (id === 'step') {
          this._savedSP = { fillColor: sp.fillColor, fillOpacity: sp.fillOpacity };
          sp.fillColor = '#ffffff'; sp.fillOpacity = 1;
        } else if (id === 'area') {
          this._savedSP = { fillColor: sp.fillColor, fillOpacity: sp.fillOpacity };
          sp.fillColor = '#4c8dff'; sp.fillOpacity = 0.25;
        } else if (id === 'cregion') {
          this._savedSP = { fillColor: sp.fillColor, fillOpacity: sp.fillOpacity };
          sp.fillColor = '#ffffff'; sp.fillOpacity = 0.35;
        }
      }
      this.current = id;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
      const drawing = id !== 'select';
      this.cv.selection = !drawing;
      this.cv.skipTargetFind = drawing;
      this.cv.defaultCursor = drawing ? 'crosshair' : 'default';
      this.cv.discardActiveObject();
      this.cv.requestRenderAll();
      window.APP && APP.renderPanel();
      this.updateHint();
    },

    cancelAction() {
      this.removeTemp();
      this.state = {};
      this.phaseHint = '';
    },

    updateHint() {
      const hints = {
        select: '选择 / 移动：单击选中对象，拖动调整，可旋转缩放；Delete 删除，Ctrl+D 复制。滚轮缩放，空格/中键拖动平移画布。',
        text: '按下放置文字，按住拖动可同时调整文字大小；选中后可自由拖动与缩放。',
        rect: '按住拖动绘制矩形；样式在右侧面板调整。',
        msgbox: '按住拖动绘制消息框；双击框体后在右侧编辑文字。',
        line: '按住拖动绘制直线。',
        curve: '按住拖动绘制样条曲线；画完后选中曲线，可拖动蓝色圆点锚点调整形状。',
        freehand: '按住拖动手写绘制。',
        arrow: '按住拖动绘制箭头。',
        carrow: '按住拖动绘制曲线箭头；画完后选中曲线，可拖动蓝色圆点锚点调整形状。',
        step: '点击放置步骤序号（自动递增）；可在面板修改当前序号。',
        dim: '按住拖动测量两点间尺寸。',
        angle: '依次点击：顶点 → 第一条边上的点 → 第二条边上的点。',
        area: '依次点击多边形顶点，右键或按 Enter 结束（至少 3 个点）。',
        ctext: '按下设定箭头锚点，拖动到目标位置放置文字（文字可自由拖动，选中后可拖动蓝色圆点分别调整锚点与文字位置）。',
        cregion: '按住拖动圈出椭圆区域，松开后自动生成引出文字。',
        cimage: '第一步：按住拖动框选图片区域；第二步：点击放置放大图块。',
        cmulti: '依次点击多个引出锚点，按 Enter 或右键完成。',
        magnifier: '按下并拖动设定放大镜大小（放大倍数在面板调整）。',
        smagnifier: '按下并拖动设定方形放大镜大小。',
        sticker: '选择贴图表情后点击放置；也可上传自定义贴图。',
        mosaic: '按住涂抹马赛克；面板可切换橡皮擦、调整笔刷与块大小。'
      };
      const base = hints[this.current] || '';
      window.APP && APP.setHint(this.phaseHint ? base + '（' + this.phaseHint + '）' : base);
    },

    removeTemp() {
      this.temp.forEach(o => { if (o.canvas) this.cv.remove(o); });
      this.temp = [];
    },
    addTemp(o) {
      o._temp = true;
      o.selectable = false;
      o.evented = false;
      if (window.APP && window.APP.annoShadow && window.APP.annoShadowOn !== false) {
        o.shadow = window.APP.annoShadow;
      }
      this.cv.add(o);
      this.temp.push(o);
    },
    promote(o) {
      o._temp = false;
      o.selectable = true;
      o.evented = true;
      if (!o.layerId && window.APP && window.APP.assignAnnotationLayer) {
        window.APP.assignAnnotationLayer(o);
      }
      this.temp = this.temp.filter(t => t !== o);
      o.setCoords();
      this.cv.requestRenderAll();
    },
    // 完成一次标注：切回选择工具并选中新对象（便于立即调整样式）
    done(obj) {
      this.select('select');
      if (obj && obj.canvas) {
        this.cv.setActiveObject(obj);
        if (window.APP && APP.popIn) APP.popIn(obj);
        else this.cv.requestRenderAll();
      }
      window.APP && APP.renderPanel();
    },

    /* ---------- 事件绑定 ---------- */
    bind() {
      const cv = this.cv;
      cv.on('mouse:down', e => this.onDown(e));
      cv.on('mouse:move', e => this.onMove(e));
      cv.on('mouse:up', e => this.onUp(e));
      cv.on('dblclick', e => this.onDbl(e));
    },

    getP(e) {
      const p = this.cv.getPointer(e.e);
      return { x: p.x, y: p.y };
    },

    /* ---------- 属性来源 ---------- */
    props() { return window.APP || {}; },
    // 按图片大小缩放尺寸
    sz(v) {
      const s = (window.APP && window.APP.sizeScale) || 1;
      return Math.max(1, Math.round(v * s));
    },
    textP() { return Object.assign({}, this.props().textProps); },
    shapeP() {
      const s = this.props().shapeProps;
      const p = {
        stroke: s.stroke, strokeWidth: s.strokeWidth,
        dash: s.dash ? s.dash.slice() : null,
        cornerRadius: s.cornerRadius,
        fillColor: s.fillColor, fillOpacity: s.fillOpacity
      };
      if (s.haloColor) p.haloColor = s.haloColor;
      if (s.haloWidth != null) p.haloWidth = s.haloWidth;
      return p;
    },
    lineP() {
      const l = this.props().lineProps;
      const p = { color: l.stroke, width: l.width, dash: l.dash ? l.dash.slice() : null };
      if (l.haloColor) p.haloColor = l.haloColor;
      if (l.haloWidth != null) p.haloWidth = l.haloWidth;
      return p;
    },

    /* ---------- 鼠标事件分发 ---------- */
    onDown(e) {
      const id = this.current;
      if (id === 'select') return;
      if (!this.cv._baseImage) {
        window.APP && APP.toast('请先上传图片');
        return;
      }
      const p = this.getP(e);
      switch (id) {
        case 'text': return this.startText(p);
        case 'step': return this.placeStep(p);
        case 'sticker': return this.placeSticker(p);
        case 'rect': return this.startRect(p);
        case 'msgbox': return this.startMsgbox(p);
        case 'line': return this.startLine(p);
        case 'arrow': return this.startLine(p);
        case 'carrow': return this.startSpline(p);
        case 'curve': return this.startSpline(p);
        case 'freehand': return this.startPath(p);
        case 'dim': return this.startDim(p);
        case 'angle': return this.onAngleDown(p);
        case 'area': return this.onAreaDown(p);
        case 'ctext': return this.startCtext(p);
        case 'cregion': return this.startCregion(p);
        case 'cimage': return this.onCimageDown(p);
        case 'cmulti': return this.onCmultiDown(p);
        case 'magnifier': return this.startLens(p, 'magnifier');
        case 'smagnifier': return this.startLens(p, 'smagnifier');
        case 'mosaic': return this.startMosaic(p);
      }
    },

    onMove(e) {
      const id = this.current;
      if (id === 'select') return;
      const st = this.state[id];
      if (!st) return;
      const p = this.getP(e);
      switch (id) {
        case 'text': return this.moveText(st, p);
        case 'rect': return this.moveRect(st, p);
        case 'msgbox': return this.moveMsgbox(st, p);
        case 'line': case 'arrow': return this.moveLine(st, p, id);
        case 'carrow': case 'curve': return this.moveSpline(st, p);
        case 'freehand': return this.movePath(st, p, id);
        case 'dim': return this.moveDim(st, p);
        case 'angle': return this.moveAngle(st, p);
        case 'area': return this.moveArea(st, p);
        case 'ctext': return this.moveCtext(st, p);
        case 'cregion': return this.moveCregion(st, p);
        case 'cimage': return this.moveCimage(st, p);
        case 'magnifier': case 'smagnifier': return this.moveLens(st, p);
        case 'mosaic': return this.moveMosaic(st, p);
      }
    },

    onUp(e) {
      const id = this.current;
      if (id === 'select') return;
      const st = this.state[id];
      if (!st) return;
      switch (id) {
        case 'text': return this.finishText(st);
        case 'rect': return this.finishRect(st);
        case 'msgbox': return this.finishMsgbox(st);
        case 'line': return this.finishLine(st, 'line');
        case 'arrow': return this.finishLine(st, 'arrow');
        case 'carrow': return this.finishSpline(st);
        case 'curve': return this.finishSpline(st);
        case 'freehand': return this.finishPath(st, 'freehand');
        case 'dim': return this.finishDim(st);
        case 'ctext': return this.finishCtext(st);
        case 'cregion': return this.finishCregion(st);
        case 'cimage': return this.onUpCimage(st);
        case 'magnifier': case 'smagnifier': return this.finishLens(st);
        case 'mosaic': return this.finishMosaic(st);
      }
    },

    onDbl(e) {
      const id = this.current;
      if (id === 'area') {
        const st = this.state[id];
        if (st && st.pts && st.pts.length) {
          st.pts.pop(); st.pts.pop();
          return this.finishArea();
        }
      }
      if (id === 'cmulti' && this.state[id] && this.state[id].phase === 'anchors') {
        return this.finishCmulti();
      }
    },

    /* ---------- 布局辅助 ---------- */
    relayoutOnCanvas(obj) {
      obj.set('dirty', true);
      obj.relayout();
      obj.set({ left: obj._offX || obj.left, top: obj._offY || obj.top });
      obj.setCoords();
      this.cv.requestRenderAll();
    },

    /* ---------- 放置类工具 ---------- */
    // 文字：按下放置，按住拖动可同时调整大小（拖动距离决定字号），松开完成
    startText(p) {
      const obj = new F.AnnoText({
        left: p.x, top: p.y, originX: 'left', originY: 'top',
        textContent: '文字',
        tx: this.textP(),
        minScaleLimit: 0.1
      });
      this.addTemp(obj);
      this.state.text = { p0: p, obj };
      this.relayoutOnCanvas(obj);
    },
    moveText(st, p) {
      const obj = st.obj;
      const d = Math.hypot(p.x - st.p0.x, p.y - st.p0.y);
      const fs = Math.max(10, Math.round(d * 0.8));
      if (Math.abs(fs - (obj.tx.fontSize || 22)) > 1) {
        obj.tx.fontSize = fs;
        this.relayoutOnCanvas(obj);
      }
      this.cv.requestRenderAll();
    },
    finishText(st) {
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
      window.APP && APP.focusContent();
    },

    placeStep(p) {
      const n = window.APP.stepCounter;
      const obj = new F.StepNumber({
        left: p.x, top: p.y, originX: 'center', originY: 'center',
        number: n, radius: window.APP.stepRadius || 18,
        tx: this.textP(), shape: this.shapeP(),
        minScaleLimit: 0.2
      });
      this.cv.add(obj); obj.setCoords();
      window.APP.stepCounter++;
      window.APP && APP.pushHistory();
      this.done(obj);
    },

    placeSticker(p) {
      const obj = new F.AnnoText({
        left: p.x, top: p.y, originX: 'center', originY: 'center',
        textContent: window.APP.sticker,
        tx: Object.assign({}, this.textP(), { fontSize: window.APP.stickerSize || 64 }),
        minScaleLimit: 0.1
      });
      this.cv.add(obj); obj.setCoords();
      window.APP && APP.pushHistory();
      this.done(obj);
    },

    /* ---------- 矩形 / 消息框 ---------- */
    startRect(p) {
      const obj = new F.AnnoRect({
        left: 0, top: 0,
        rect: { x: p.x, y: p.y, w: 1, h: 1 },
        shape: this.shapeP(),
        minScaleLimit: 0.1
      });
      this.addTemp(obj);
      this.state.rect = { p0: p, obj };
      this.relayoutOnCanvas(obj);
    },
    moveRect(st, p) {
      st.obj.rect = {
        x: Math.min(st.p0.x, p.x), y: Math.min(st.p0.y, p.y),
        w: Math.abs(p.x - st.p0.x), h: Math.abs(p.y - st.p0.y)
      };
      this.relayoutOnCanvas(st.obj);
    },
    finishRect(st) {
      if (st.obj.rect.w < 5 || st.obj.rect.h < 5) { this.removeTemp(); return; }
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    startMsgbox(p) {
      const obj = new F.MessageBox({
        left: p.x, top: p.y, originX: 'left', originY: 'top',
        boxW: 1, boxH: 1,
        tx: this.textP(), shape: this.shapeP(),
        minScaleLimit: 0.2
      });
      this.addTemp(obj);
      this.state.msgbox = { p0: p, obj };
    },
    moveMsgbox(st, p) {
      const o = st.obj;
      o.boxW = Math.abs(p.x - st.p0.x);
      o.boxH = Math.abs(p.y - st.p0.y);
      o.set({ left: Math.min(st.p0.x, p.x), top: Math.min(st.p0.y, p.y) });
      this.relayoutOnCanvas(o);
    },
    finishMsgbox(st) {
      if (st.obj.boxW < 20 || st.obj.boxH < 16) { this.removeTemp(); return; }
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 直线 / 箭头 / 手写（AnnoLine：白色边框 + 实心箭头） ---------- */
    startLine(p) {
      const obj = new F.AnnoLine({
        left: 0, top: 0,
        pts: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }],
        arrowhead: this.current === 'arrow' ? 'end' : 'none',
        arrowLen: this.sz(14), arrowHalf: this.sz(6),
        line: this.lineP(),
        minScaleLimit: 0.1
      });
      this.addTemp(obj);
      this.state[this.current] = { p0: p, obj };
      this.relayoutOnCanvas(obj);
    },
    moveLine(st, p, id) {
      st.last = p;
      st.obj.pts = [st.p0, { x: p.x, y: p.y }];
      this.relayoutOnCanvas(st.obj);
    },
    finishLine(st, id) {
      const ok = st.last && Math.hypot(st.last.x - st.p0.x, st.last.y - st.p0.y) > 5;
      if (!ok) { this.removeTemp(); return; }
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 样条曲线 / 曲线箭头（锚点可拖动） ---------- */
    startSpline(p) {
      const obj = new F.SplinePath({
        left: 0, top: 0,
        points: [{ x: p.x, y: p.y }],
        arrowhead: this.current === 'carrow' ? 'end' : 'none',
        arrowLen: this.sz(14),
        arrowHalf: this.sz(6),
        line: this.lineP(),
        minScaleLimit: 0.1
      });
      this.addTemp(obj);
      this.state[this.current] = { pts: [{ x: p.x, y: p.y }], obj };
      this.relayoutOnCanvas(obj);
    },
    moveSpline(st, p) {
      const last = st.pts[st.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 4) return;
      st.pts.push(p);
      st.obj.points = decimate(st.pts, 16);
      this.relayoutOnCanvas(st.obj);
    },
    finishSpline(st) {
      if (!st.pts || st.pts.length < 2) { this.removeTemp(); return; }
      // 曲线箭头最多 4 个锚点，曲线最多 8 个
      const maxPts = this.current === 'carrow' ? 4 : 8;
      let pts = capPoints(decimate(st.pts, 28), maxPts);
      if (pts.length < 2) {
        pts = [{ x: st.pts[0].x, y: st.pts[0].y }, { x: st.pts[st.pts.length - 1].x, y: st.pts[st.pts.length - 1].y }];
      }
      st.obj.points = pts;
      st.obj.relayout();
      st.obj.set({ left: st.obj._offX, top: st.obj._offY });
      st.obj.setCoords();
      st.obj._rebuildControls();
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 手写（AnnoLine 折线） ---------- */
    startPath(p) {
      const obj = new F.AnnoLine({
        left: 0, top: 0,
        pts: [{ x: p.x, y: p.y }],
        arrowhead: 'none',
        line: this.lineP(),
        minScaleLimit: 0.1
      });
      this.addTemp(obj);
      this.state.freehand = { pts: [p], obj };
      this.relayoutOnCanvas(obj);
    },
    movePath(st, p, id) {
      const last = st.pts[st.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      st.pts.push(p);
      st.obj.pts = st.pts.slice();
      this.relayoutOnCanvas(st.obj);
    },
    finishPath(st) {
      if (!st.pts || st.pts.length < 2) { this.removeTemp(); return; }
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 尺寸 ---------- */
    startDim(p) {
      const obj = new F.Dimension({
        p1: p, p2: { x: p.x + 1, y: p.y }, left: 0, top: 0,
        offset: this.sz(26), ext: this.sz(10),
        line: this.lineP(), tx: this.textP(),
        scale: window.APP.scale.pxPerUnit, unit: window.APP.scale.unit,
        minScaleLimit: 0.2
      });
      this.addTemp(obj);
      this.state.dim = { p0: p, obj };
      this.relayoutOnCanvas(obj);
    },
    moveDim(st, p) {
      st.obj.p2 = { x: p.x, y: p.y };
      this.relayoutOnCanvas(st.obj);
    },
    finishDim(st) {
      const len = Math.hypot(st.obj.p2.x - st.obj.p1.x, st.obj.p2.y - st.obj.p1.y);
      if (len < 5) { this.removeTemp(); return; }
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 角度 ---------- */
    onAngleDown(p) {
      const st = this.state.angle = this.state.angle || { pts: [] };
      st.pts.push({ x: p.x, y: p.y });
      if (st.pts.length === 1) {
        const obj = new F.AngleMeasure({
          v: p, p1: p, p2: p, left: 0, top: 0,
          line: this.lineP(), tx: this.textP(),
          minScaleLimit: 0.2
        });
        this.addTemp(obj);
        st.obj = obj;
        this.phaseHint = '点击第一条边上的点';
        this.updateHint();
      } else if (st.pts.length === 2) {
        st.obj.p1 = { x: p.x, y: p.y };
        this.relayoutOnCanvas(st.obj);
        this.phaseHint = '点击第二条边上的点';
        this.updateHint();
      } else {
        st.obj.p2 = { x: p.x, y: p.y };
        this.relayoutOnCanvas(st.obj);
        this.promote(st.obj);
        this.state.angle = {};
        this.phaseHint = '';
        this.updateHint();
        window.APP && APP.pushHistory();
        this.done(st.obj);
      }
    },
    moveAngle(st, p) {
      if (!st.obj) return;
      if (st.pts.length === 1) st.obj.p1 = { x: p.x, y: p.y };
      else if (st.pts.length === 2) st.obj.p2 = { x: p.x, y: p.y };
      this.relayoutOnCanvas(st.obj);
    },

    /* ---------- 面积 ---------- */
    onAreaDown(p) {
      const st = this.state.area = this.state.area || {};
      if (!st.pts) {
        st.pts = [{ x: p.x, y: p.y }];
        const obj = new F.AreaMeasure({
          points: st.pts, left: 0, top: 0,
          shape: this.shapeP(), tx: this.textP(),
          scale: window.APP.scale.pxPerUnit, unit: window.APP.scale.unit,
          minScaleLimit: 0.2
        });
        this.addTemp(obj);
        st.obj = obj;
        this.phaseHint = '继续点击添加顶点，右键或 Enter 结束';
        this.updateHint();
      } else {
        st.pts.push({ x: p.x, y: p.y });
        this.updateAreaPreview(st, p);
      }
    },
    moveArea(st, p) {
      if (!st.pts) return;
      this.updateAreaPreview(st, p);
    },
    updateAreaPreview(st, p) {
      st.obj.points = st.pts.slice();
      if (st.pts.length >= 1) st.obj.points.push({ x: p.x, y: p.y });
      this.relayoutOnCanvas(st.obj);
    },
    finishArea() {
      const st = this.state.area;
      if (!st || !st.pts) return;
      if (st.pts.length < 3) {
        this.removeTemp();
        this.state.area = {};
        this.phaseHint = '';
        this.updateHint();
        return;
      }
      st.obj.points = st.pts.slice();
      this.relayoutOnCanvas(st.obj);
      this.promote(st.obj);
      this.state.area = {};
      this.phaseHint = '';
      this.updateHint();
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 文字引出（锚点 + 可自由拖动的文字，引出线自动连接） ---------- */
    startCtext(p) {
      const obj = new F.CalloutText({
        left: 0, top: 0,
        anchor: { x: p.x, y: p.y },
        textPos: { x: p.x + this.sz(24), y: p.y - this.sz(70) },
        textContent: window.APP.textDefault || '标注',
        tx: this.textP(), line: this.lineP(),
        minScaleLimit: 0.2
      });
      this.addTemp(obj);
      this.state.ctext = { p0: p, obj };
      this.relayoutOnCanvas(obj);
    },
    moveCtext(st, p) {
      // 拖动时文字跟随鼠标，引出线自动连接
      st.obj.textPos = { x: p.x, y: p.y };
      this.relayoutOnCanvas(st.obj);
    },
    finishCtext(st) {
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
      window.APP && APP.focusContent();
    },

    /* ---------- 引出区域（椭圆区域 → 引出线 → 水平线 → 线上文字） ---------- */
    startCregion(p) {
      const obj = new F.CalloutRegion({
        left: 0, top: 0,
        ellipse: { x: p.x, y: p.y, rx: 1, ry: 1 },
        textContent: '区域',
        tx: this.textP(), line: this.lineP(),
        shape: this.shapeP(),
        minScaleLimit: 0.2
      });
      this.addTemp(obj);
      this.state.cregion = { p0: p, obj };
      this.relayoutOnCanvas(obj);
    },
    moveCregion(st, p) {
      const cx = (st.p0.x + p.x) / 2, cy = (st.p0.y + p.y) / 2;
      st.obj.ellipse = { x: cx, y: cy, rx: Math.abs(p.x - st.p0.x) / 2, ry: Math.abs(p.y - st.p0.y) / 2 };
      // 文字放在区域右上方（水平线上方）
      st.obj.textPos = { x: cx + st.obj.ellipse.rx + 24, y: cy - st.obj.ellipse.ry - 60 };
      this.relayoutOnCanvas(st.obj);
    },
    finishCregion(st) {
      if (st.obj.ellipse.rx < 4 || st.obj.ellipse.ry < 4) { this.removeTemp(); return; }
      this.promote(st.obj);
      window.APP && APP.pushHistory();
      this.done(st.obj);
      window.APP && APP.focusContent();
    },

    /* ---------- 图引出 ---------- */
    onCimageDown(p) {
      const st = this.state.cimage = this.state.cimage || { phase: 'region' };
      if (st.phase === 'region') {
        const r = new F.Rect({
          left: p.x, top: p.y, width: 1, height: 1,
          fill: 'rgba(91,141,239,0.15)', stroke: '#5b8def', strokeWidth: 1.5,
          strokeDashArray: [6, 4]
        });
        this.addTemp(r);
        st.region = { p0: p, obj: r };
      } else if (st.phase === 'place') {
        this.finishCimage(p);
      }
    },
    moveCimage(st, p) {
      if (st.phase === 'region' && st.region) {
        const o = st.region.obj;
        o.set({
          left: Math.min(st.region.p0.x, p.x), top: Math.min(st.region.p0.y, p.y),
          width: Math.abs(p.x - st.region.p0.x), height: Math.abs(p.y - st.region.p0.y)
        });
        o.set('dirty', true);
        o.setCoords();
        this.cv.requestRenderAll();
      } else if (st.phase === 'place' && st.preview) {
        st.preview.boxPos = { x: p.x, y: p.y };
        this.relayoutOnCanvas(st.preview);
      }
    },
    onUpCimage(st) {
      if (st.phase !== 'region' || !st.region) return;
      const r = st.region.obj;
      if (r.width < 10 || r.height < 10) {
        this.removeTemp();
        delete st.region;
        return;
      }
      const reg = { x: r.left, y: r.top, w: r.width, h: r.height };
      const cut = document.createElement('canvas');
      cut.width = Math.max(1, Math.round(reg.w));
      cut.height = Math.max(1, Math.round(reg.h));
      const cctx = cut.getContext('2d');
      const base = this.cv._baseImgEl;
      cctx.drawImage(base, reg.x, reg.y, reg.w, reg.h, 0, 0, cut.width, cut.height);
      this.removeTemp();
      const obj = new F.CalloutImage({
        left: 0, top: 0,
        region: reg, boxPos: { x: reg.x + reg.w + 24, y: reg.y },
        imgSrc: cut.toDataURL(),
        textContent: '', tx: this.textP(), line: this.lineP(),
        minScaleLimit: 0.2
      });
      this.addTemp(obj);
      st.phase = 'place';
      st.preview = obj;
      this.phaseHint = '点击画布放置放大图块（Esc 取消）';
      this.updateHint();
      this.relayoutOnCanvas(obj);
    },
    finishCimage(p) {
      const st = this.state.cimage;
      if (!st || st.phase !== 'place' || !st.preview) return;
      const obj = st.preview;
      obj.boxPos = { x: p.x, y: p.y };
      this.relayoutOnCanvas(obj);
      this.promote(obj);
      delete st.preview;
      st.phase = 'region';
      this.phaseHint = '';
      this.updateHint();
      window.APP && APP.pushHistory();
      this.done(obj);
    },

    /* ---------- 多引出（多点汇聚到一条水平线） ---------- */
    onCmultiDown(p) {
      const st = this.state.cmulti = this.state.cmulti || {};
      if (!st.phase) {
        st.phase = 'anchors';
        st.anchors = [];
        const obj = new F.MultiCallout({
          left: 0, top: 0,
          anchors: [],
          textPos: { x: p.x + this.sz(24), y: p.y - this.sz(70) },
          textContent: window.APP.textDefault || '标注',
          tx: this.textP(), line: this.lineP(),
          minScaleLimit: 0.2
        });
        this.addTemp(obj);
        st.obj = obj;
        this.phaseHint = '点击添加引出锚点，按 Enter 或右键完成（完成后可拖动锚点与文字）';
        this.updateHint();
      }
      if (st.phase === 'anchors') {
        st.anchors.push({ x: p.x, y: p.y });
        st.obj.anchors = st.anchors.slice();
        st.obj._rebuildControls();
        this.relayoutOnCanvas(st.obj);
      }
    },
    finishCmulti() {
      const st = this.state.cmulti;
      if (!st || st.phase !== 'anchors') return;
      if (!st.anchors.length) {
        this.removeTemp();
        this.state.cmulti = {};
        this.phaseHint = '';
        this.updateHint();
        return;
      }
      this.promote(st.obj);
      this.state.cmulti = {};
      this.phaseHint = '';
      this.updateHint();
      window.APP && APP.pushHistory();
      this.done(st.obj);
    },

    /* ---------- 放大镜 ---------- */
    startLens(p, kind) {
      const l = window.APP.lens;
      const opts = {
        left: p.x, top: p.y, originX: 'center', originY: 'center',
        zoom: l.zoom, borderColor: l.borderColor, borderWidth: l.borderWidth
      };
      let obj;
      if (kind === 'magnifier') { opts.radius = 1; obj = new F.Magnifier(opts); }
      else { opts.side = 1; obj = new F.SquareMagnifier(opts); }
      obj._canvasRef = this.cv;
      this.addTemp(obj);
      this.state[kind] = { p0: p, obj };
    },
    moveLens(st, p) {
      const o = st.obj;
      const d = Math.hypot(p.x - st.p0.x, p.y - st.p0.y);
      if (o.type === 'magnifier') {
        const r = Math.max(20, d);
        o.set({ radius: r, width: r * 2, height: r * 2, contentW: r * 2, contentH: r * 2 });
      } else {
        const s = Math.max(30, d * 2);
        o.set({ side: s, width: s, height: s, contentW: s, contentH: s });
      }
      o.set('dirty', true);
      o.setCoords();
      this.cv.requestRenderAll();
    },
    finishLens(st) {
      const o = st.obj;
      const tiny = o.type === 'magnifier' ? o.radius < 20 : o.side < 30;
      if (tiny) { this.removeTemp(); return; }
      this.promote(o);
      window.APP && (APP.needsSnap = true);
      window.APP && APP.pushHistory();
      this.done(o);
    },

    /* ---------- 马赛克 ---------- */
    startMosaic(p) {
      ensureMosaicLayer(this.cv);
      const st = this.state.mosaic = { last: p };
      paintSegment(this.cv, p, p);
      this.cv.requestRenderAll();
    },
    moveMosaic(st, p) {
      if (Math.hypot(p.x - st.last.x, p.y - st.last.y) < 1) return;
      paintSegment(this.cv, st.last, p);
      st.last = p;
      window.APP && (APP.needsSnap = true);
      this.cv.requestRenderAll();
    },
    finishMosaic() {
      // 马赛克内容已变化：递增版本号，历史快照据此决定是否需要重新存储马赛克
      if (window.APP) APP.mosaicVersion++;
      window.APP && (APP.needsSnap = true);
      window.APP && APP.pushHistory();
    }
  };
})();
