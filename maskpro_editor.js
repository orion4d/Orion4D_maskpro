import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const VER = "0.8-stable";

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
function urlFromNodePreview(n) {
  if (!n) return null;
  // 1) widgets classiques
  const w = n.widgets || [];
  for (const name of ["mask","image","images"]) {
    const ww = w.find(_ => _.name === name);
    if (ww) {
      const u = widgetUrlFromValue(ww.value);
      if (u) return u;
    }
  }
  // 2) vignette rendue
  if (n.imgs?.length) return n.imgs[0].src;
  return null;
}
function upstreamWithPreview(link) {
  if (!link) return null;
  const first = app.graph.getNodeById(link.origin_id);
  if (!first) return null;
  if (urlFromNodePreview(first)) return first;
  const anyIn = first.inputs?.find(Boolean);
  if (anyIn?.link) return app.graph.getNodeById(app.graph.links[anyIn.link].origin_id) || first;
  return first;
}
async function blob(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.blob();
  } catch { return null; }
}

app.registerExtension({
  name: "Orion4D.MaskPro.UI",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MaskPro") return;

    const prevDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      prevDraw?.apply(this, arguments);
      if (this.flags.collapsed) return;

      const M = 12;
      const W = this.size[0] - M*2;
      const Y = (this.widgets?.length ? (this.widgets[this.widgets.length-1].last_y || 0) : 0) + 28;
      const modeW = this.widgets?.find(w => w.name === "preview_mode");
      const invertW = this.widgets?.find(w => w.name === "invert_mask");
      const mode = modeW?.value || "image";
      const inverted = !!(invertW?.value);

      let elem = this.backgroundImageElement;
      if (mode === "mask" && this.maskImageElement) {
        if (inverted) {
          if (!this._maskInvCanvas) this._maskInvCanvas = document.createElement("canvas");
          const c = this._maskInvCanvas, m = this.maskImageElement;
          if (c.width !== m.naturalWidth || c.height !== m.naturalHeight) { c.width = m.naturalWidth; c.height = m.naturalHeight; }
          const x = c.getContext("2d");
          x.clearRect(0,0,c.width,c.height);
          x.fillStyle = "#fff"; x.fillRect(0,0,c.width,c.height);
          x.globalCompositeOperation = "destination-out";
          x.drawImage(m,0,0);
          x.globalCompositeOperation = "source-over";
          elem = c;
        } else elem = this.maskImageElement;
      } else if (mode === "rgba" && this.backgroundImageElement && this.maskImageElement) {
        if (!this._rgbaCanvas) this._rgbaCanvas = document.createElement("canvas");
        const c = this._rgbaCanvas, base = this.backgroundImageElement, m = this.maskImageElement;
        if(c.width !== base.naturalWidth || c.height !== base.naturalHeight) { c.width = base.naturalWidth; c.height = base.naturalHeight; }
        const x = c.getContext("2d");
        x.clearRect(0,0,c.width,c.height);
        x.drawImage(base,0,0);
        x.globalCompositeOperation = inverted ? "destination-in" : "destination-out";
        x.drawImage(m,0,0);
        x.globalCompositeOperation = "source-over";
        elem = c;
      }

      if (elem?.width > 0) {
        const H = (elem.height/elem.width)*W;
        this._extraH = H+40;
        ctx.drawImage(elem, M, Y, W, H);
      } else {
        this._extraH = 160;
        ctx.fillStyle = "#222"; ctx.fillRect(M,Y,W,120);
        ctx.fillStyle = "#888"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("Prévisualisation…", this.size[0]/2, Y+60);
      }
    };

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onCreated?.apply(this, arguments);
      const node = this;

      node.backgroundImageElement = null;
      node.maskImageElement = null;
      node._rgbaCanvas = null;
      node._maskInvCanvas = null;
      node._extraH = 180;
      
      const loadImagePreviewFromUpstream = async ()=>{
        const inImg = node.inputs?.find(i=>i.name==="image");
        if (!inImg?.link) { node.backgroundImageElement=null; node.setDirtyCanvas(true,true); return; }
        const src = app.graph.getNodeById(app.graph.links[inImg.link].origin_id);
        const u = urlFromNodePreview(src);
        if (!u || (node.backgroundImageElement && u === node.backgroundImageElement.src)) return;
        const im = new Image(); im.crossOrigin="anonymous";
        im.onload = ()=>{ node.backgroundImageElement = im; node.setDirtyCanvas(true,true); };
        im.src = u;
      };
      
      const loadMaskPreviewFromFile = async ()=>{
        try {
          const r = await fetch(`/orion4d_maskpro/open?node_id=${node.id}`);
          if (!r.ok) return;
          const meta = await r.json();
          if (!meta.mask_exists) { node.maskImageElement = null; node.setDirtyCanvas(true,true); return; }
          const u = `/orion4d_maskpro/static/maskpro_${node.id}/mask.png?ts=${Date.now()}`;
          const im = new Image(); im.crossOrigin="anonymous";
          im.onload = ()=>{ node.maskImageElement = im; node.setDirtyCanvas(true,true); };
          im.src = u;
        } catch {}
      };

      node.addWidget("combo", "preview_mode", "image", ()=>node.setDirtyCanvas(true,true), { values:["image","mask","rgba"] });
      const autoRun = node.addWidget("checkbox", "autorun_after_save", false);
      const inv = node.widgets?.find(w=>w.name==="invert_mask");
      inv && (inv.callback = ()=>node.setDirtyCanvas(true,true));

      node.addWidget("button", "Edit Mask", null, async ()=>{
        const inImg = node.inputs?.find(i=>i.name==="image");
        if (!inImg?.link) { alert("Connecte une image d’entrée."); return; }
        const srcImg = app.graph.getNodeById(app.graph.links[inImg.link].origin_id);
        const urlImg = urlFromNodePreview(srcImg);
        if (!urlImg) { alert("Impossible de récupérer l’image (widget/preview manquant)."); return; }
        const bImg = await blob(urlImg);
        if (!bImg) { alert("Échec lecture image."); return; }
        const fd1 = new FormData();
        fd1.append("node_id", String(node.id));
        fd1.append("image", bImg, "image.png");
        await fetch("/orion4d_maskpro/save", { method:"POST", body: fd1 });
        const inMask = node.inputs?.find(i=>i.name==="mask");
        if (inMask?.link) {
          const up = upstreamWithPreview(app.graph.links[inMask.link]);
          const urlMask = urlFromNodePreview(up);
          if (urlMask) {
            const bMask = await blob(urlMask);
            if (bMask) {
              const fd2 = new FormData();
              fd2.append("node_id", String(node.id));
              fd2.append("mask", bMask, "mask.png");
              await fetch("/orion4d_maskpro/save", { method:"POST", body: fd2 });
            }
          }
        }
        window.open(`/orion4d_maskpro/editor?node_id=${node.id}`, "_blank", "width=1200,height=800");
      });

      node.addWidget("button", "Clear Mask", null, async ()=>{
        await fetch(`/orion4d_maskpro/clear?node_id=${node.id}`);
        node.maskImageElement = null;
        node.setDirtyCanvas(true,true);
      });

      nodeType.prototype.onGetExtraSpace = function() {
        if (this.flags.collapsed) return 0;
        return this._extraH || 180;
      };

      const onConn = node.onConnectionsChange;
      node.onConnectionsChange = function() {
        onConn?.apply(this, arguments);
        setTimeout(loadImagePreviewFromUpstream, 50);
      };
      
      setTimeout(loadImagePreviewFromUpstream, 80);
      setTimeout(loadMaskPreviewFromFile, 160);

      window.addEventListener("message", async (ev)=>{
        if (ev.origin !== location.origin || ev.data?.type !== "maskpro:saved" || String(ev.data.nodeId) !== String(node.id)) return;
        setTimeout(loadMaskPreviewFromFile, 80);
        if (autoRun?.value && app?.queuePrompt) setTimeout(()=>app.queuePrompt(), 100);
      });
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function(message) {
      onExecuted?.apply(this, arguments);

      // We expect the backend to send previews for [mask, image, rgba].
      // We only want to update our background image from the 'image' output.
      if (message?.images && message.images.length > 1) {
        
        // The second preview (index 1) is the 'image' output.
        const imagePreviewInfo = message.images[1];
        
        const imageUrl = api.apiURL(`/view?filename=${encodeURIComponent(imagePreviewInfo.filename)}&type=${imagePreviewInfo.type}&subfolder=${encodeURIComponent(imagePreviewInfo.subfolder)}`);
        
        // Avoid reloading if the image is the same
        if (!this.backgroundImageElement || this.backgroundImageElement.src !== imageUrl) {
          const newBgImage = new Image();
          newBgImage.crossOrigin = "anonymous";
          newBgImage.onload = () => {
            this.backgroundImageElement = newBgImage;
            this.setDirtyCanvas(true, true);
          };
          newBgImage.src = imageUrl;
        }

        // IMPORTANT: Prevent the default ComfyUI previewer from drawing all 3 images.
        // We clear the array so it has nothing to draw.
        message.images.length = 0;
      }
    };
  },
});