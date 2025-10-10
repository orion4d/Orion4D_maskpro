import io
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image

import torch
import torch.nn.functional as F

from aiohttp import web
from server import PromptServer
import folder_paths

# -------------------------------------------------------------
# Paths
# -------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"
BRUSH_DIR = WEB_DIR / "brushes"

USER_DIR = Path(folder_paths.get_user_directory())
CACHE_DIR = USER_DIR / "orion4d_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _slot(node_id: str) -> Path:
    """Directory for a given node_id."""
    p = CACHE_DIR / f"maskpro_{node_id}"
    p.mkdir(parents=True, exist_ok=True)
    return p


# -------------------------------------------------------------
# Image helpers
# -------------------------------------------------------------
def _pil_mask_to_tensor(pil: Image.Image, device="cpu") -> torch.Tensor:
    """Convert PIL mask (L/LA/RGBA/...) to [1,H,W] float tensor in 0..1 (using alpha if present)."""
    if pil.mode == "RGBA":
        a = pil.split()[3]
    elif pil.mode == "LA":
        a = pil.split()[1]
    elif pil.mode == "L":
        a = pil
    else:
        a = pil.convert("L")
    arr = (np.asarray(a, dtype=np.float32) / 255.0)
    return torch.from_numpy(arr).to(device=device).unsqueeze(0)


def tensor_mask_to_pil(tensor_mask: torch.Tensor) -> Image.Image:
    """[1,H,W] or [H,W] float in 0..1 -> PIL L 0..255"""
    if tensor_mask.ndim == 3:
        tensor_mask = tensor_mask.squeeze(0)
    arr = (tensor_mask.clamp(0, 1).cpu().numpy() * 255.0).astype(np.uint8)
    return Image.fromarray(arr, mode="L")


# -------------------------------------------------------------
# HTTP routes (aiohttp)
# -------------------------------------------------------------
_routes_registered = False


def register_routes():
    """Register all web routes once."""
    global _routes_registered
    if _routes_registered:
        return

    app = PromptServer.instance.app

    # 1) Static cache: /orion4d_maskpro/static/maskpro_<id>/{files}
    if not any(
        getattr(getattr(r, "resource", None), "canonical", None)
        == "/orion4d_maskpro/static/{path:.*}"
        for r in app.router.routes()
    ):
        app.router.add_static("/orion4d_maskpro/static", str(CACHE_DIR), name="orion4d_maskpro_static")

    # 2) Static brushes: /extensions/Orion4D_maskpro/brushes/*
    if not any(
        getattr(getattr(r, "resource", None), "canonical", None)
        == "/extensions/Orion4D_maskpro/brushes/{path:.*}"
        for r in app.router.routes()
    ):
        BRUSH_DIR.mkdir(parents=True, exist_ok=True)
        app.router.add_static("/extensions/Orion4D_maskpro/brushes", str(BRUSH_DIR), name="orion4d_brushes_static")

    # 3) Redirect to editor.html
    async def editor_page(request: web.Request):
        q = request.rel_url.query_string
        raise web.HTTPFound(location=f"/extensions/Orion4D_maskpro/editor.html?{q}")

    app.router.add_get("/orion4d_maskpro/editor", editor_page)

    # 4) Open: report existence + (optional) image size
    async def open_api(request: web.Request):
        node_id = request.query.get("node_id")
        if not node_id:
            return web.json_response({"error": "missing node_id"}, status=400)
        slot = _slot(node_id)
        img_p = slot / "image.png"
        mask_p = slot / "mask.png"
        w = h = None
        if img_p.exists():
            try:
                with Image.open(img_p) as im:
                    w, h = im.size
            except Exception:
                pass
        return web.json_response(
            {
                "ok": True,
                "node_id": node_id,
                "image_exists": img_p.exists(),
                "mask_exists": mask_p.exists(),
                "w": w,
                "h": h,
            }
        )

    app.router.add_get("/orion4d_maskpro/open", open_api)

    # 5) Save (multipart): accepts mask (required by editor), and optionally image
    async def save_api(request: web.Request):
        reader = await request.multipart()
        node_id = None
        image_bytes = None
        mask_bytes = None

        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "node_id":
                node_id = (await part.text()).strip()
            elif part.name == "image":
                image_bytes = await part.read()
            elif part.name == "mask":
                mask_bytes = await part.read()

        if not node_id:
            return web.json_response({"ok": False, "error": "missing node_id"}, status=400)

        slot = _slot(node_id)

        if image_bytes:
            try:
                Image.open(io.BytesIO(image_bytes)).save(slot / "image.png", "PNG")
            except Exception as e:
                return web.json_response({"ok": False, "error": f"save image failed: {e}"}, status=500)

        if mask_bytes:
            try:
                Image.open(io.BytesIO(mask_bytes)).save(slot / "mask.png", "PNG")
            except Exception as e:
                return web.json_response({"ok": False, "error": f"save mask failed: {e}"}, status=500)

        return web.json_response({"ok": True})

    app.router.add_post("/orion4d_maskpro/save", save_api)

    # 6) Clear: delete mask.png
    async def clear_api(request: web.Request):
        node_id = request.query.get("node_id")
        if not node_id:
            return web.json_response({"error": "missing node_id"}, status=400)
        m = (_slot(node_id) / "mask.png")
        if m.exists():
            try:
                m.unlink()
            except Exception:
                pass
        return web.json_response({"ok": True})

    app.router.add_get("/orion4d_maskpro/clear", clear_api)

    # 7) List brushes (used by editor grid/list)
    @PromptServer.instance.routes.get("/orion4d_maskpro/list_brushes")
    async def orion4d_list_brushes(request):
        try:
            BRUSH_DIR.mkdir(parents=True, exist_ok=True)
            files = [
                f
                for f in os.listdir(BRUSH_DIR)
                if os.path.isfile(os.path.join(BRUSH_DIR, f)) and f.lower().endswith(".png")
            ]
            files.sort(key=str.lower)
            return web.json_response({"files": files})
        except Exception as e:
            return web.json_response({"files": [], "error": str(e)}, status=500)

    # 8) AI cutout with rembg → writes mask.png (grayscale, opaque)
    async def rembg_api(request: web.Request):
        node_id = request.query.get("node_id")
        if not node_id:
            return web.json_response({"ok": False, "error": "missing node_id"}, status=400)

        try:
            from rembg import remove  # lazy import
        except Exception:
            return web.json_response({"ok": False, "error": "rembg not installed"}, status=500)

        slot = _slot(node_id)
        img_path = slot / "image.png"
        mask_path = slot / "mask.png"

        if not img_path.exists():
            return web.json_response({"ok": False, "error": "image.png missing"}, status=404)

        try:
            with Image.open(img_path).convert("RGBA") as im:
                out = remove(im)  # RGBA, alpha = foreground
                alpha = out.split()[-1]  # use alpha as mask
                # Save opaque grayscale PNG (no transparency channel)
                alpha.save(mask_path, "PNG")
            return web.json_response({"ok": True})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    app.router.add_post("/orion4d_maskpro/rembg", rembg_api)

    _routes_registered = True


# Register routes at import time (ComfyUI style)
register_routes()


# -------------------------------------------------------------
# The ComfyUI Node
# -------------------------------------------------------------
class MaskPro:
    """
    Node outputs:
      - mask:  [H,W] float 0..1 (white = keep)
      - image: pass-through (or empty if none)
      - image_rgba: input image with alpha = output mask
    Behavior:
      1. Use edited mask from cache if present (mask.png)
      2. Else use input mask (and cache it for editing, converting to "paint" convention then back)
      3. If none, start with empty mask
      4. If sizes differ, center-crop/pad mask to image size
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("MASK", "IMAGE", "IMAGE")
    RETURN_NAMES = ("mask", "image", "image_rgba")
    FUNCTION = "apply"
    CATEGORY = "Orion4D_maskpro"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # force re-run to pick up new cache writes from editor
        return time.time()

    def apply(self, image=None, mask=None, invert_mask=False, unique_id=None, **_):
        device = image.device if isinstance(image, torch.Tensor) else "cpu"
        node_id = str(unique_id) if unique_id else "temp"
        slot = _slot(node_id)
        mpath = slot / "mask.png"

        active_mask = None  # [1,H,W] 0..1, "paint" convention (white = masked/painted)

        # Priority 1: edited mask (disk)
        if mpath.exists():
            try:
                with open(mpath, "rb") as f:
                    pil = Image.open(io.BytesIO(f.read()))
                    active_mask = _pil_mask_to_tensor(pil, device=device)
            except Exception as e:
                print(f"[MaskPro] Error loading edited mask: {e}")

        # Priority 2: input mask (if no edited mask). Cache it for editor.
        if active_mask is None and mask is not None:
            # Convert input (white = keep) -> paint (white = masked out)
            pmask = 1.0 - mask.clone().to(device)
            if pmask.ndim == 2:
                pmask = pmask.unsqueeze(0)
            active_mask = pmask
            # Save to disk so the editor can open it
            try:
                tensor_mask_to_pil(active_mask).save(mpath, "PNG")
                print(f"[MaskPro] Input mask cached to {mpath}")
            except Exception as e:
                print(f"[MaskPro] Failed to cache input mask: {e}")

        # Priority 3: empty mask
        if active_mask is None:
            if image is not None:
                h, w = image.shape[1], image.shape[2]  # CHW
            else:
                h = w = 512
            active_mask = torch.zeros((1, h, w), dtype=torch.float32, device=device)

        # Align to image size by centered crop/pad (if image provided)
        if image is not None:
            h_img, w_img = image.shape[1], image.shape[2]
            h_mask, w_mask = active_mask.shape[-2], active_mask.shape[-1]
            if (h_mask, w_mask) != (h_img, w_img):
                new_mask = torch.zeros((1, h_img, w_img), dtype=active_mask.dtype, device=active_mask.device)
                copy_h, copy_w = min(h_mask, h_img), min(w_mask, w_img)
                src_y = (h_mask - copy_h) // 2
                src_x = (w_mask - copy_w) // 2
                dst_y = (h_img - copy_h) // 2
                dst_x = (w_img - copy_w) // 2
                new_mask[0, dst_y:dst_y + copy_h, dst_x:dst_x + copy_w] = active_mask[0, src_y:src_y + copy_h, src_x:src_x + copy_w]
                active_mask = new_mask

        # Convert back to output convention (white = keep)
        # active_mask (paint white) means "remove", so keep = 1 - active_mask
        final_mask = 1.0 - active_mask.clamp(0, 1)
        if invert_mask:
            final_mask = 1.0 - final_mask

        # Output tensors
        mask_out = final_mask[0].to(dtype=torch.float32, device="cpu").contiguous()

        if image is not None:
            img = image
            if img.ndim == 3:  # CHW -> BCHW
                img = img.unsqueeze(0)
            if img.shape[-1] not in (3, 4):  # BCHW -> BHWC
                img = img.permute(0, 2, 3, 1)
            rgb = img[..., :3]
            a = final_mask.to(device=rgb.device).unsqueeze(-1)
            if rgb.shape[0] != a.shape[0]:
                a = a.repeat(rgb.shape[0], 1, 1, 1)
            rgba = torch.cat((rgb, a), dim=-1)
            image_out = img
            rgba_out = rgba
        else:
            h, w = final_mask.shape[-2:]
            image_out = torch.zeros((1, h, w, 3), dtype=torch.float32, device="cpu")
            a = final_mask.to(device="cpu").unsqueeze(-1)
            rgba_out = torch.cat((image_out, a), dim=-1)

        return (mask_out, image_out, rgba_out)
