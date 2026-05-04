import io
import os
import time
import shutil
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
# Clear the MaskPro user cache on each ComfyUI startup, then recreate it.
try:
    if CACHE_DIR.exists():
        shutil.rmtree(CACHE_DIR, ignore_errors=True)
except Exception:
    pass
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


    # 8) AI model browser: list immediate folders under ComfyUI /models
    MODEL_EXTS = {".safetensors", ".pth", ".pt", ".ckpt", ".onnx"}

    def _models_root() -> Path:
        root = getattr(folder_paths, "models_dir", None)
        if root:
            return Path(root)
        base = getattr(folder_paths, "base_path", None)
        if base:
            return Path(base) / "models"
        return ROOT_DIR.parent.parent / "models"

    def _safe_model_dir(rel_folder: str | None) -> tuple[Path, str]:
        root = _models_root().resolve()
        rel = (rel_folder or "BiRefNet").replace("\\", "/").strip().strip("/")
        if rel.lower().startswith("models/"):
            rel = rel[7:]
        clean_parts = [part for part in rel.split("/") if part and part not in {".", ".."}]
        target = (root.joinpath(*clean_parts) if clean_parts else root).resolve()
        try:
            target.relative_to(root)
        except Exception:
            target = (root / "BiRefNet").resolve()
            clean_parts = ["BiRefNet"]
        return target, "/".join(clean_parts)

    def _model_key_from_filename(filename: str) -> str:
        name = os.path.basename(filename or "")
        for ext in (".safetensors", ".pth", ".pt", ".ckpt", ".onnx"):
            if name.lower().endswith(ext):
                return name[: -len(ext)]
        return os.path.splitext(name)[0]

    async def ai_model_folders_api(request: web.Request):
        root = _models_root()
        folders = []
        try:
            if root.exists():
                for child in sorted(root.iterdir(), key=lambda x: x.name.lower()):
                    if child.is_dir() and not child.name.startswith("."):
                        value = child.name
                        folders.append({"value": value, "label": f"models\\{value}"})
            default = "BiRefNet" if any(f["value"] == "BiRefNet" for f in folders) else (folders[0]["value"] if folders else "BiRefNet")
            return web.json_response({"ok": True, "root": str(root), "default_folder": default, "folders": folders})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e), "folders": folders, "default_folder": "BiRefNet"}, status=500)

    async def ai_models_api(request: web.Request):
        folder = request.query.get("folder", "BiRefNet")
        model_dir, rel = _safe_model_dir(folder)
        models = []
        try:
            if model_dir.exists():
                for file in sorted(model_dir.rglob("*"), key=lambda x: str(x).lower()):
                    if file.is_file() and file.suffix.lower() in MODEL_EXTS:
                        try:
                            value = str(file.relative_to(model_dir)).replace("/", "\\")
                        except Exception:
                            value = file.name
                        models.append({"value": value, "label": value})
            def _priority(item):
                label = item["label"].lower()
                return (0 if "hr-matting" in label else 1, label)
            models.sort(key=_priority)
            default_model = models[0]["value"] if models else ""
            return web.json_response({"ok": True, "folder": rel, "default_model": default_model, "models": models})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e), "folder": rel, "models": []}, status=500)

    async def ai_cutout_api(request: web.Request):
        data = await request.post()
        node_id = str(data.get("node_id") or request.query.get("node_id") or "").strip()
        model_folder = str(data.get("model_folder") or request.query.get("model_folder") or "BiRefNet").strip()
        model_file = str(data.get("model_file") or request.query.get("model_file") or "").strip()
        keep_current_mask = str(data.get("keep_current_mask") or request.query.get("keep_current_mask") or "0").strip().lower() in {"1", "true", "yes", "on"}

        if not node_id:
            return web.json_response({"ok": False, "error": "missing node_id"}, status=400)

        slot = _slot(node_id)
        img_path = slot / "image.png"
        mask_path = slot / "mask.png"
        if not img_path.exists():
            return web.json_response({"ok": False, "error": "image.png missing"}, status=404)

        model_dir, rel_folder = _safe_model_dir(model_folder)
        if not model_file:
            candidates = sorted([p for p in model_dir.rglob("*") if p.is_file() and p.suffix.lower() in MODEL_EXTS], key=lambda x: x.name.lower())
            if not candidates:
                return web.json_response({"ok": False, "error": f"no model found in models\\{rel_folder}"}, status=404)
            model_file = candidates[0].name

        safe_model_rel = model_file.replace("\\", "/").strip().strip("/")
        if safe_model_rel.lower().startswith("models/"):
            safe_model_rel = "/".join(safe_model_rel.split("/")[1:])
        safe_parts = [part for part in safe_model_rel.split("/") if part and part not in {".", ".."}]
        selected_model_path = (model_dir.joinpath(*safe_parts) if safe_parts else model_dir / model_file).resolve()
        try:
            selected_model_path.relative_to(model_dir.resolve())
        except Exception:
            return web.json_response({"ok": False, "error": "invalid model path"}, status=400)
        if not selected_model_path.exists():
            return web.json_response({"ok": False, "error": f"model not found: {model_file}"}, status=404)

        try:
            from nodes import NODE_CLASS_MAPPINGS
            RMBG_Node_Class = NODE_CLASS_MAPPINGS.get("BiRefNetRMBG")
            if not RMBG_Node_Class:
                return web.json_response({"ok": False, "error": "BiRefNetRMBG node not found. Install/enable the BiRefNet RMBG node."}, status=500)

            model_key = _model_key_from_filename(selected_model_path.name)
            rmbg_node = RMBG_Node_Class()

            with Image.open(img_path).convert("RGB") as pil_img:
                arr = np.asarray(pil_img, dtype=np.float32) / 255.0
            input_tensor = torch.from_numpy(arr)[None, ...]

            with torch.inference_mode():
                out_images, out_masks, out_mask_images = rmbg_node.process_image(
                    image=input_tensor,
                    model=model_key,
                    mask_blur=0,
                    mask_offset=0,
                    invert_output=False,
                    refine_foreground=True,
                    background="Alpha",
                    background_color="#000000",
                )

            mt = out_masks.detach().cpu() if isinstance(out_masks, torch.Tensor) else torch.as_tensor(out_masks)
            if mt.ndim == 4:
                mt = mt[0]
                if mt.shape[-1] in (1, 3, 4):
                    mt = mt[..., 0]
                elif mt.shape[0] in (1, 3, 4):
                    mt = mt[0]
            elif mt.ndim == 3:
                if mt.shape[-1] in (1, 3, 4):
                    mt = mt[..., 0]
                else:
                    mt = mt[0]
            if mt.ndim != 2:
                return web.json_response({"ok": False, "error": f"unexpected mask shape: {tuple(out_masks.shape)}"}, status=500)

            mask_arr = np.clip(mt.numpy() * 255.0, 0, 255).astype(np.uint8)

            new_mask_img = Image.fromarray(mask_arr, mode="L")
            if keep_current_mask and mask_path.exists():
                try:
                    with Image.open(mask_path) as existing_im:
                        existing_im = existing_im.convert("L")
                        if existing_im.size != new_mask_img.size:
                            existing_im = existing_im.resize(new_mask_img.size, Image.BICUBIC)
                        existing_arr = np.asarray(existing_im, dtype=np.uint8)
                    merged_arr = np.maximum(existing_arr, mask_arr)
                    new_mask_img = Image.fromarray(merged_arr, mode="L")
                except Exception:
                    pass

            new_mask_img.save(mask_path, "PNG")
            return web.json_response({
                "ok": True,
                "folder": rel_folder,
                "model_file": str(selected_model_path.relative_to(model_dir)).replace("/", "\\"),
                "model": model_key,
                "keep_current_mask": keep_current_mask,
            })
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    app.router.add_get("/orion4d_maskpro/ai_model_folders", ai_model_folders_api)
    app.router.add_get("/orion4d_maskpro/ai_models", ai_models_api)
    app.router.add_post("/orion4d_maskpro/ai_cutout", ai_cutout_api)

    # 9) AI cutout with rembg → writes mask.png (grayscale, opaque)
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


def _normalize_image_tensor_to_bhwc(img: torch.Tensor) -> torch.Tensor:
    """Accept HWC, CHW, BHWC or BCHW and return BHWC without changing aspect."""
    if img.ndim == 3:
        if img.shape[-1] in (1, 3, 4):
            img = img.unsqueeze(0)
        elif img.shape[0] in (1, 3, 4):
            img = img.permute(1, 2, 0).unsqueeze(0)
        else:
            img = img.unsqueeze(0)
    elif img.ndim == 4:
        if img.shape[-1] in (1, 3, 4):
            pass
        elif img.shape[1] in (1, 3, 4):
            img = img.permute(0, 2, 3, 1)
    return img.contiguous()


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
            img = _normalize_image_tensor_to_bhwc(image)
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

        # --- Start of new preview generation code ---
        previews = []
        output_dir = folder_paths.get_temp_directory()

        # Handle mask preview (2D tensor: H, W)
        mask_np = np.clip(mask_out.cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
        mask_img = Image.fromarray(mask_np, mode="L")
        filename_mask = f"maskpro_preview_{unique_id}_0_{time.time()}.png"
        mask_img.save(os.path.join(output_dir, filename_mask))
        previews.append({"filename": filename_mask, "subfolder": "", "type": "temp"})

        # Handle image and rgba previews (4D tensors: B, H, W, C)
        for i, batch_tensor in enumerate([image_out, rgba_out], 1):
            if batch_tensor is not None and len(batch_tensor) > 0:
                # We only preview the first image of the batch
                img_tensor = batch_tensor[0]
                img_np = np.clip(img_tensor.cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
                mode = "RGBA" if img_np.shape[-1] == 4 else "RGB"
                img = Image.fromarray(img_np, mode=mode)
                
                filename_img = f"maskpro_preview_{unique_id}_{i}_{time.time()}.png"
                img.save(os.path.join(output_dir, filename_img))
                previews.append({"filename": filename_img, "subfolder": "", "type": "temp"})

        return {"ui": {"images": previews}, "result": (mask_out, image_out, rgba_out)}
        # --- End of new preview generation code ---