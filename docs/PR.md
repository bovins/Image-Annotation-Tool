## Summary

修复离线工程保存失败、样式重排跳位、大图坐标不一致、快速撤销、测量读数、放大镜显隐与复制图层问题，补齐草稿/工作区、标定、连续标注、预设、图层批量操作和统一导出预览。统一明暗主题、本地线性图标、分组顶栏和面板层级，选中快捷条保持浮动，不挤动画布。

```text
工作图像素 → Fabric 标注 / 历史 / 标签状态
             ├─ 工程 v2 / 工作区 v1 → 校验 → 追加载入
             ├─ IndexedDB 草稿 → 启动恢复 / 丢弃
             └─ 导出范围与最终尺寸 → 隔离渲染 → 预览 / 编码 / 顺序批量导出
```

保持双击 index.html、纯前端离线、本地 Fabric.js、旧 v1 工程读取；没有新增运行时依赖。

## Evidence

- **Before:** 原四个 Node 模拟测试通过，但真实 Edge 保存抛 `CV._baseImgEl.toDataURL is not a function`；8000×6000 的 Fabric 图像仍为自然尺寸；移动旋转后改样式跳位；比例 1/mm 仍显示 px。隔离基线回放另确认快速撤销删除对象、隐藏圆/方放大镜复现和复制共用图层。
  **After:** 四项 Node 测试通过；36 组真实 Edge 156.0.4314.58 file:// 浏览器检查通过，涵盖图片资源、历史、工程/草稿/工作区、效率、实际导出像素及新界面菜单/缩放/快捷条。Image 模拟已去掉不存在的 Canvas 方法。
- `npm test`、`npm run test:browser`、`node tests/baseline.js`、`node tests/screenshots.js`、`git diff --check`。
- [编辑界面](editor-current.png)、[导出预览](export-preview.png)、[完整复现/验证/限制](修复与验证.md)。截图使用测试绘制示意图。

## Merge Danger

**Door:** two-way for code; v2 files need this version to load, retain original v1 files before resaving.

**Blast Radius:** editor

涉及标注变换、历史、保存/草稿、图层和导出。主分支不自动合并。Chrome 109、Edge 109、Firefox 115 ESR、真实 Windows 125% 缩放、真实系统另存为与写盘、长期多窗口并发仍需人工验收；设备像素比模拟不代替旧版/系统测试。草稿不可代替手动工程备份。
