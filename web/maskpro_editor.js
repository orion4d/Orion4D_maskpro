import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const VER = "1.1-node2-dom-preview-aspect-safe";
const PREVIEW_MIN_HEIGHT = 220;
const PREVIEW_MAX_HEIGHT = 900;

function isMaskPro(nodeData) {
  return nodeData?.name === "MaskPro" || nodeData?.display_name === "MaskPro" || nodeData?.displayName === "MaskPro";
}

function viewUrlFromImageInfo(info) {
  if (!info) return null;
  if (typeof info === "string") return info;
  if (info.src) return info.src;
  if (info.url) return info.url;
  if (info.filename) {
    const params = new URLSearchParams({
      filename: info.filename,
      type: info.type || "output",
      subfolder: info.subfolder || "",
    });
    params.set("_maskpro_ts", Date.now().toString());
    return api.apiURL(`/view?${params.toString()}`);
  }
  return null;
}

function widgetUrlFromValue(v) {
  if (!v) return null;
  if (typeof v === "string") {
    return api.apiURL(`/view?filename=${encodeURIComponent(v)}&type=input&subfolder=`);
  }
  if (typeof v === "object" && v.filename) {
    const { filename, subfolder = "", type = "input" } = v;
    return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=${encodeURIComponent(subfolder)}`);
  }
  return null;
}

function urlFromNodePreview(node) {
  if (!node) return null;

  // Load Image and other file widgets, available before a Comfy run.
  for (const name of ["image", "mask", "images"]) {
    const w = node.widgets?.find((x) => x.name === name);
    const u = widgetUrlFromValue(w?.value);
    if (u) return u;
  }

  // Standard frontend previews after execution.
  if (Array.isArray(node.imgs) && node.imgs.length) {
    const idx = Number(node.imageIndex || 0);
    const u = viewUrlFromImageInfo(node.imgs[idx]) || viewUrlFromImageInfo(node.imgs[0]);
    if (u) return u;
  }

  // Newer / Node 2 fields seen in different ComfyUI frontend builds.
  for (const key of ["image", "preview", "previewImage", "thumbnail"]) {
    const u = viewUrlFromImageInfo(node[key]);
    if (u) return u;
  }

  // Executed output payloads sometimes remain attached to outputs.
  const imgs = node.outputs?.flatMap?.((o) => o?.images || []) || [];
  return imgs.length ? viewUrlFromImageInfo(imgs[0]) : null;
}

function upstreamNodeFromInput(node, inputName) {
  const input = node.inputs?.find((i) => i.name === inputName);
  const link = input?.link != null ? app.graph?.links?.[input.link] : null;
  return link ? app.graph?.getNodeById?.(link.origin_id) : null;
}

function upstreamWithPreview(link) {
  if (!link) return null;
  const first = app.graph?.getNodeById?.(link.origin_id);
  if (!first) return null;
  if (urlFromNodePreview(first)) return first;
  const anyIn = first.inputs?.find((i) => i?.link != null);
  const nextLink = anyIn ? app.graph?.links?.[anyIn.link] : null;
  return nextLink ? app.graph?.getNodeById?.(nextLink.origin_id) || first : first;
}

async function fetchBlob(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function imageSize(img) {
  return { w: img?.naturalWidth || img?.width || 0, h: img?.naturalHeight || img?.height || 0 };
}

app.registerExtension({
  name: "Orion4D.MaskPro.Node2Preview",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!isMaskPro(nodeData) || nodeType.__maskProNode2Patched) return;
    nodeType.__maskProNode2Patched = true;

    const original = {
      onNodeCreated: nodeType.prototype.onNodeCreated,
      onConnectionsChange: nodeType.prototype.onConnectionsChange,
      onExecuted: nodeType.prototype.onExecuted,
      onResize: nodeType.prototype.onResize,
    };

    nodeType.prototype.onNodeCreated = function () {
      original.onNodeCreated?.apply(this, arguments);
      requestAnimationFrame(() => setupMaskPro(this, original));
    };

    nodeType.prototype.onConnectionsChange = function () {
      const ret = original.onConnectionsChange?.apply(this, arguments);
      if (this.__maskProMethods) {
        setTimeout(() => this.__maskProMethods.refreshAll(true), 80);
      }
      return ret;
    };

    nodeType.prototype.onExecuted = function (message) {
      original.onExecuted?.apply(this, arguments);
      if (this.__maskProMethods) {
        this.__maskProMethods.applyExecutedImages(message);
        setTimeout(() => this.__maskProMethods.refreshAll(true), 120);
      }
      // Avoid the default preview stack showing mask/image/rgba all at once.
      if (message?.images?.length) message.images.length = 0;
    };

    nodeType.prototype.onResize = function (size) {
      const ret = original.onResize?.apply(this, arguments);
      this.__maskProMethods?.refreshLayout?.();
      return ret;
    };
  },
});

function setupMaskPro(node) {
  if (node.__maskProReady) return;
  node.__maskProReady = true;
  node.resizable = true;

  const markDirty = () => node.setDirtyCanvas?.(true, true);
  const findWidget = (name) => node.widgets?.find((w) => w.name === name || w.__maskProKey === name);

  node.__maskPro = {
    image: null,
    imageUrl: null,
    mask: null,
    maskUrl: null,
    rgbaCanvas: document.createElement("canvas"),
    invMaskCanvas: document.createElement("canvas"),
  };

  function ensureWidgets() {
    if (!findWidget("preview_mode")) {
      const w = node.addWidget("combo", "preview_mode", "image", () => { drawPreview(); markDirty(); }, { values: ["image", "mask", "rgba"] });
      w.__maskProKey = "preview_mode";
      w.serialize = true;
    }
    if (!findWidget("autorun_after_save")) {
      const w = node.addWidget("checkbox", "autorun_after_save", false);
      w.__maskProKey = "autorun_after_save";
      w.serialize = true;
    }

    const inv = findWidget("invert_mask");
    if (inv) inv.callback = () => { drawPreview(); markDirty(); };

    if (!findWidget("maskpro_edit")) {
      const w = node.addWidget("button", "Edit Mask", null, editMask);
      w.__maskProKey = "maskpro_edit";
      w.serialize = false;
    }
    if (!findWidget("maskpro_clear")) {
      const w = node.addWidget("button", "Clear Mask", null, clearMask);
      w.__maskProKey = "maskpro_clear";
      w.serialize = false;
    }
  }

  const previewCanvas = document.createElement("canvas");
  previewCanvas.style.cssText = "display:block;background:#181b20;border-radius:6px;max-width:100%;touch-action:none;";

  const previewWrapper = document.createElement("div");
  previewWrapper.style.cssText = `width:100%;height:${PREVIEW_MIN_HEIGHT}px;overflow:hidden;box-sizing:border-box;margin-top:8px;padding:0;contain:layout paint size;display:flex;align-items:flex-start;justify-content:center;`;
  previewWrapper.appendChild(previewCanvas);

  let previewWidget = findWidget("maskpro_preview");
  if (!previewWidget && typeof node.addDOMWidget === "function") {
    previewWidget = node.addDOMWidget("maskpro_preview", "preview", previewWrapper, {
      serialize: false,
      hideOnZoom: false,
    });
    previewWidget.__maskProKey = "maskpro_preview";
    previewWidget.serialize = false;
  }

  function refreshLayout() {
    if (!previewWidget) return;
    const nodeW = Math.max(300, Math.floor(node.size?.[0] || 420));
    const w = Math.max(260, nodeW - 24);
    const h = Math.max(PREVIEW_MIN_HEIGHT, Math.min(PREVIEW_MAX_HEIGHT, Math.floor(w * 0.72)));
    previewWrapper.style.width = `${w}px`;
    previewWrapper.style.height = `${h}px`;
    previewCanvas.style.width = `${w}px`;
    previewCanvas.style.height = `${h}px`;
    previewWidget.computeSize = () => [w, h + 16];
    drawPreview();
    markDirty();
  }

  async function refreshImage(force = false) {
    const srcNode = upstreamNodeFromInput(node, "image");
    let url = urlFromNodePreview(srcNode);

    // Cache fallback after Edit Mask or after backend has written image.png.
    if (!url || force) {
      try {
        const r = await fetch(`/orion4d_maskpro/open?node_id=${node.id}&ts=${Date.now()}`, { cache: "no-store" });
        const meta = r.ok ? await r.json() : null;
        if (meta?.image_exists && (!url || force)) {
          url = `/orion4d_maskpro/static/maskpro_${node.id}/image.png?ts=${Date.now()}`;
        }
      } catch {}
    }

    if (!url) {
      node.__maskPro.image = null;
      node.__maskPro.imageUrl = null;
      drawPreview();
      markDirty();
      return;
    }
    if (!force && node.__maskPro.imageUrl === url && node.__maskPro.image) return;
    const img = await loadImage(url);
    node.__maskPro.image = img;
    node.__maskPro.imageUrl = img ? url : null;
    drawPreview();
    markDirty();
  }

  async function refreshMask(force = false) {
    let url = null;
    try {
      const r = await fetch(`/orion4d_maskpro/open?node_id=${node.id}&ts=${Date.now()}`, { cache: "no-store" });
      const meta = r.ok ? await r.json() : null;
      if (meta?.mask_exists) url = `/orion4d_maskpro/static/maskpro_${node.id}/mask.png?ts=${Date.now()}`;
    } catch {}

    // Optional input-mask preview fallback if no edited cache exists.
    if (!url) {
      const inMask = node.inputs?.find((i) => i.name === "mask");
      const link = inMask?.link != null ? app.graph?.links?.[inMask.link] : null;
      const up = upstreamWithPreview(link);
      url = urlFromNodePreview(up);
    }

    if (!url) {
      node.__maskPro.mask = null;
      node.__maskPro.maskUrl = null;
      drawPreview();
      markDirty();
      return;
    }
    if (!force && node.__maskPro.maskUrl === url && node.__maskPro.mask) return;
    const img = await loadImage(url);
    node.__maskPro.mask = img;
    node.__maskPro.maskUrl = img ? url : null;
    drawPreview();
    markDirty();
  }

  async function refreshAll(force = false) {
    await refreshImage(force);
    await refreshMask(force);
    refreshLayout();
  }

  function getDisplayElement() {
    const mode = findWidget("preview_mode")?.value || "image";
    const inverted = Boolean(findWidget("invert_mask")?.value);
    const img = node.__maskPro.image;
    const mask = node.__maskPro.mask;

    if (mode === "mask") {
      if (!mask) return null;
      if (!inverted) return mask;
      const c = node.__maskPro.invMaskCanvas;
      const m = imageSize(mask);
      if (c.width !== m.w || c.height !== m.h) { c.width = m.w; c.height = m.h; }
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "difference";
      ctx.drawImage(mask, 0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
      return c;
    }

    if (mode === "rgba" && img && mask) {
      const s = imageSize(img);
      const c = node.__maskPro.rgbaCanvas;
      if (c.width !== s.w || c.height !== s.h) { c.width = s.w; c.height = s.h; }
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      ctx.globalCompositeOperation = inverted ? "destination-in" : "destination-out";
      ctx.drawImage(mask, 0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
      return c;
    }

    return img;
  }

  function drawPreview() {
    if (!previewCanvas.isConnected && !previewWidget) return;
    const rect = previewCanvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || parseFloat(previewCanvas.style.width) || (node.size?.[0] || 360) - 24));
    const cssH = Math.max(1, Math.round(rect.height || parseFloat(previewCanvas.style.height) || PREVIEW_MIN_HEIGHT));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (previewCanvas.width !== Math.round(cssW * dpr) || previewCanvas.height !== Math.round(cssH * dpr)) {
      previewCanvas.width = Math.round(cssW * dpr);
      previewCanvas.height = Math.round(cssH * dpr);
    }
    const ctx = previewCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#181b20";
    ctx.fillRect(0, 0, cssW, cssH);

    const elem = getDisplayElement();
    const s = imageSize(elem);
    if (!s.w || !s.h) {
      ctx.fillStyle = "#8b949e";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Prévisualisation indisponible", cssW / 2, cssH / 2);
      return;
    }

    const pad = 8;
    const scale = Math.max(0.001, Math.min(Math.max(1, cssW - pad * 2) / s.w, Math.max(1, cssH - pad * 2) / s.h));
    const dw = Math.max(1, Math.round(s.w * scale));
    const dh = Math.max(1, Math.round(s.h * scale));
    const dx = (cssW - dw) / 2;
    const dy = 8; // top aligned, horizontally centered

    ctx.fillStyle = "#0f1115";
    ctx.fillRect(dx, dy, dw, dh);
    ctx.drawImage(elem, dx, dy, dw, dh);
  }

  async function editMask() {
    const inImg = node.inputs?.find((i) => i.name === "image");
    if (!inImg?.link) { alert("Connecte une image d’entrée."); return; }

    const srcImg = upstreamNodeFromInput(node, "image");
    const urlImg = urlFromNodePreview(srcImg);
    if (!urlImg) { alert("Impossible de récupérer l’image source. Lance le workflow une fois ou utilise Load Image."); return; }
    const bImg = await fetchBlob(urlImg);
    if (!bImg) { alert("Échec lecture image."); return; }

    const fd1 = new FormData();
    fd1.append("node_id", String(node.id));
    fd1.append("image", bImg, "image.png");
    await fetch("/orion4d_maskpro/save", { method: "POST", body: fd1 });

    const inMask = node.inputs?.find((i) => i.name === "mask");
    if (inMask?.link) {
      const up = upstreamWithPreview(app.graph?.links?.[inMask.link]);
      const urlMask = urlFromNodePreview(up);
      const bMask = urlMask ? await fetchBlob(urlMask) : null;
      if (bMask) {
        const fd2 = new FormData();
        fd2.append("node_id", String(node.id));
        fd2.append("mask", bMask, "mask.png");
        await fetch("/orion4d_maskpro/save", { method: "POST", body: fd2 });
      }
    }

    await refreshAll(true);
    window.open(`/orion4d_maskpro/editor?node_id=${node.id}`, "_blank", "width=1400,height=900");
  }

  async function clearMask() {
    await fetch(`/orion4d_maskpro/clear?node_id=${node.id}&ts=${Date.now()}`);
    node.__maskPro.mask = null;
    node.__maskPro.maskUrl = null;
    drawPreview();
    markDirty();
  }

  function applyExecutedImages(message) {
    // Backend returns three previews in order: mask, image, image_rgba.
    const imgs = message?.images || message?.ui?.images || [];
    if (!Array.isArray(imgs) || !imgs.length) return;
    const imageUrl = viewUrlFromImageInfo(imgs[1] || imgs[0]);
    const maskUrl = viewUrlFromImageInfo(imgs[0]);
    if (imageUrl) loadImage(imageUrl).then((im) => { if (im) { node.__maskPro.image = im; node.__maskPro.imageUrl = imageUrl; drawPreview(); markDirty(); } });
    if (maskUrl) loadImage(maskUrl).then((im) => { if (im) { node.__maskPro.mask = im; node.__maskPro.maskUrl = maskUrl; drawPreview(); markDirty(); } });
  }

  ensureWidgets();
  refreshLayout();
  setTimeout(() => refreshAll(true), 100);
  setTimeout(() => refreshAll(false), 700);

  node.__maskProMethods = { refreshAll, refreshLayout, drawPreview, applyExecutedImages };

  window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || ev.data?.type !== "maskpro:saved" || String(ev.data.nodeId) !== String(node.id)) return;
    setTimeout(() => refreshAll(true), 120);
    const autoRun = findWidget("autorun_after_save");
    if (autoRun?.value && app?.queuePrompt) setTimeout(() => app.queuePrompt(), 160);
  });
}
