from __future__ import annotations

import asyncio
import logging
import shutil
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn.functional as F
from aiohttp import web
from PIL import Image, ImageOps
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, io, ui
from server import PromptServer

logger = logging.getLogger(__name__)

WEB_DIRECTORY = "./web"

_PACKAGE_DIR = Path(__file__).resolve().parent
_COMFY_ROOT = _PACKAGE_DIR.parent.parent
_FRONTEND_BRUSH_DIR = _COMFY_ROOT / "web" / "extensions" / "Orion4D_maskpro" / "brushes"
_LOCAL_BRUSH_DIR = _PACKAGE_DIR / "web" / "brushes"
_BRUSH_DIRS = tuple(path for path in (_LOCAL_BRUSH_DIR, _FRONTEND_BRUSH_DIR) if path.exists())

_CACHE_ROOT = Path(folder_paths.get_user_directory()) / "orion4d_cache"
_CACHE_ROOT.mkdir(parents=True, exist_ok=True)


def _sanitize_node_id(raw: Optional[str]) -> str:
    if raw is None:
        raise ValueError("node_id is required")
    try:
        node_int = int(raw)
    except (TypeError, ValueError) as err:
        raise ValueError("invalid node_id") from err
    if node_int < 0:
        raise ValueError("invalid node_id")
    return str(node_int)


def _cache_dir(node_id: str) -> Path:
    directory = _CACHE_ROOT / f"maskpro_{node_id}"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _load_saved_image(path: Path) -> Optional[torch.Tensor]:
    if not path.exists():
        return None
    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            rgba = img.convert("RGBA")
            arr = np.array(rgba, dtype=np.float32) / 255.0
            rgb = arr[..., :3]
            tensor = torch.from_numpy(rgb).unsqueeze(0)
            return tensor
    except Exception:
        logger.exception("MaskPro failed to load image from %s", path)
        return None


def _load_saved_mask(path: Path) -> Optional[torch.Tensor]:
    if not path.exists():
        return None
    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode == "I":
                img = img.point(lambda i: i * (1 / 255))
            rgba = img.convert("RGBA")
            alpha = np.array(rgba.getchannel("A"), dtype=np.float32) / 255.0

            # Detect if alpha is informative; otherwise fall back to luminance heuristics.
            if float(alpha.max()) - float(alpha.min()) < 1e-6:
                luminance = np.array(rgba.convert("L"), dtype=np.float32) / 255.0
                whites = np.count_nonzero(luminance > (200 / 255))
                blacks = np.count_nonzero(luminance < (55 / 255))
                invert = whites > blacks * 2
                mask_arr = (1.0 - luminance) if invert else luminance
            else:
                mask_arr = 1.0 - alpha

            mask_arr = np.clip(mask_arr, 0.0, 1.0)
            tensor = torch.from_numpy(mask_arr).unsqueeze(0)
            return tensor
    except Exception:
        logger.exception("MaskPro failed to load mask from %s", path)
        return None


def _resize_mask(mask: torch.Tensor, width: int, height: int) -> torch.Tensor:
    if mask.dim() == 2:
        mask = mask.unsqueeze(0)
    if mask.dim() == 3:
        mask = mask.unsqueeze(1)
    resized = F.interpolate(mask, size=(height, width), mode="bilinear", align_corners=False)
    return resized.squeeze(1)


def _ensure_static_route(prompt_server: PromptServer) -> None:
    static_prefix = "/orion4d_maskpro/static"
    try:
        prompt_server.app.router.add_static(static_prefix, str(_CACHE_ROOT), show_index=False)
    except RuntimeError:
        # Route probably already registered; ignore.
        pass


def _register_routes() -> None:
    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is None:
        logger.warning("MaskPro backend routes not registered: PromptServer unavailable")
        return

    routes = prompt_server.routes
    _ensure_static_route(prompt_server)

    @_safe_route(routes.get, "/orion4d_maskpro/editor")
    async def maskpro_editor_page(request: web.Request) -> web.StreamResponse:
        node_id = request.rel_url.query.get("node_id")
        if node_id is None:
            return web.Response(text="Missing node_id parameter.", status=400)
        # Redirect to the frontend static editor so it can load its assets
        target = f"/extensions/Orion4D_maskpro/editor.html?node_id={node_id}"
        raise web.HTTPFound(target)

    @_safe_route(routes.get, "/orion4d_maskpro/open")
    async def maskpro_open(request: web.Request) -> web.Response:
        try:
            node_id = _sanitize_node_id(request.rel_url.query.get("node_id"))
        except ValueError as err:
            return web.json_response({"ok": False, "error": str(err)}, status=400)

        cache_dir = _cache_dir(node_id)
        image_path = cache_dir / "image.png"
        mask_path = cache_dir / "mask.png"

        width: int = 0
        height: int = 0
        source: Optional[Path] = None
        if image_path.exists():
            source = image_path
        elif mask_path.exists():
            source = mask_path

        if source is not None:
            try:
                with Image.open(source) as img:
                    width, height = img.size
            except Exception:
                logger.exception("MaskPro failed to read dimensions from %s", source)

        payload = {
            "ok": True,
            "node_id": node_id,
            "image_exists": image_path.exists(),
            "mask_exists": mask_path.exists(),
            "w": width,
            "h": height,
        }
        return web.json_response(payload)

    @_safe_route(routes.post, "/orion4d_maskpro/save")
    async def maskpro_save(request: web.Request) -> web.Response:
        try:
            post = await request.post()
            node_id = _sanitize_node_id(post.get("node_id"))
        except ValueError as err:
            return web.json_response({"ok": False, "error": str(err)}, status=400)

        cache_dir = _cache_dir(node_id)
        image_path = cache_dir / "image.png"
        mask_path = cache_dir / "mask.png"

        image_saved = False
        mask_saved = False
        width: int = 0
        height: int = 0

        image_field = post.get("image")
        if getattr(image_field, "file", None):
            with open(image_path, "wb") as dst:
                shutil.copyfileobj(image_field.file, dst)
            image_saved = True
            try:
                with Image.open(image_path) as img:
                    width, height = img.size
            except Exception:
                logger.exception("MaskPro failed to inspect saved image %s", image_path)

        mask_field = post.get("mask")
        if getattr(mask_field, "file", None):
            with open(mask_path, "wb") as dst:
                shutil.copyfileobj(mask_field.file, dst)
            mask_saved = True
            if width == 0 or height == 0:
                try:
                    with Image.open(mask_path) as img:
                        width, height = img.size
                except Exception:
                    logger.exception("MaskPro failed to inspect saved mask %s", mask_path)

        return web.json_response({
            "ok": True,
            "node_id": node_id,
            "image_saved": image_saved,
            "mask_saved": mask_saved,
            "w": width,
            "h": height,
        })

    @_safe_route(routes.get, "/orion4d_maskpro/clear")
    async def maskpro_clear(request: web.Request) -> web.Response:
        try:
            node_id = _sanitize_node_id(request.rel_url.query.get("node_id"))
        except ValueError as err:
            return web.json_response({"ok": False, "error": str(err)}, status=400)

        cache_dir = _cache_dir(node_id)
        mask_path = cache_dir / "mask.png"
        if mask_path.exists():
            try:
                mask_path.unlink()
            except OSError:
                logger.exception("MaskPro failed to delete %s", mask_path)
                return web.json_response({"ok": False, "error": "Failed to delete mask"}, status=500)
        return web.json_response({"ok": True, "node_id": node_id})

    @_safe_route(routes.get, "/orion4d_maskpro/list_brushes")
    async def maskpro_list_brushes(request: web.Request) -> web.Response:
        files: set[str] = set()
        for directory in _BRUSH_DIRS:
            for file in directory.glob("*"):
                if file.is_file() and file.suffix.lower() in {".png", ".webp"}:
                    files.add(file.name)
        return web.json_response({"files": sorted(files)})

    @_safe_route(routes.post, "/orion4d_maskpro/rembg")
    async def maskpro_rembg(request: web.Request) -> web.Response:
        try:
            post = await request.post()
            node_id = _sanitize_node_id(post.get("node_id"))
        except ValueError as err:
            return web.json_response({"ok": False, "error": str(err)}, status=400)

        cache_dir = _cache_dir(node_id)
        image_path = cache_dir / "image.png"
        mask_path = cache_dir / "mask.png"

        if not image_path.exists():
            return web.json_response({"ok": False, "error": "image.png missing"}, status=404)

        try:
            from rembg import remove  # type: ignore
        except ImportError:
            return web.json_response({"ok": False, "error": "rembg is not installed"}, status=500)

        image_bytes = image_path.read_bytes()
        try:
            result_bytes = await asyncio.to_thread(remove, image_bytes)
            with Image.open(BytesIO(result_bytes)) as cut:
                alpha = cut.convert("RGBA").getchannel("A")
                mask_img = alpha.convert("L") if alpha.mode != "L" else alpha
                mask_img.save(mask_path)
                width, height = mask_img.size
        except Exception as err:
            logger.exception("MaskPro rembg failure for node %s", node_id)
            return web.json_response({"ok": False, "error": str(err)}, status=500)

        return web.json_response({"ok": True, "mask_saved": True, "w": width, "h": height})


def _safe_route(registrar, path: str):
    """Decorator factory to guard against duplicate route registration."""

    def decorator(handler):
        try:
            registrar(path)(handler)
        except RuntimeError:
            logger.debug("MaskPro route %s already registered", path)
        return handler

    return decorator


_register_routes()


def _save_tensor_image_png(path: Path, image_tensor: torch.Tensor) -> None:
    """Save a float tensor [1,H,W,3] or [H,W,3] in 0..1 to an RGB PNG."""
    try:
        if image_tensor is None:
            return
        tensor = image_tensor
        if tensor.dim() == 4 and tensor.shape[0] == 1:
            tensor = tensor.squeeze(0)
        if tensor.dim() != 3 or tensor.shape[-1] not in (3, 4):
            return
        tensor = tensor.clamp(0.0, 1.0).detach().cpu()
        np_img = (tensor[..., :3].numpy() * 255.0).astype(np.uint8)
        img = Image.fromarray(np_img, mode="RGB")
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
    except Exception:
        logger.exception("MaskPro failed to save image tensor to %s", path)


class MaskPro(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MaskPro",
            display_name="MaskPro Editor",
            category="mask/edit",
            description="Advanced mask editor with non-destructive workflow and AI cutout integration.",
            inputs=[
                io.Image.Input("image", optional=True, tooltip="Optional base image to forward and preview."),
                io.Mask.Input("mask", optional=True, tooltip="Optional fallback mask if no edited mask exists."),
                io.Boolean.Input("invert_mask", default=False, label_on="Invert", label_off="Normal"),
            ],
            outputs=[
                io.Mask.Output("out_mask", display_name="Mask"),
                io.Image.Output("out_image", display_name="Image"),
                io.Image.Output("out_image_rgba", display_name="Image RGBA"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, image=None, mask=None, invert_mask=False) -> io.NodeOutput:
        node_id = cls.hidden.unique_id or ""
        cache_dir = _cache_dir(node_id) if node_id else None
        saved_image = _load_saved_image(cache_dir / "image.png") if cache_dir else None
        saved_mask = _load_saved_mask(cache_dir / "mask.png") if cache_dir else None

        image_tensor = None
        if image is not None:
            image_tensor = image.detach().cpu()
        elif saved_image is not None:
            image_tensor = saved_image

        mask_tensor: Optional[torch.Tensor] = None
        if saved_mask is not None:
            mask_tensor = saved_mask
        elif mask is not None:
            mask_tensor = mask.detach().cpu()

        if image_tensor is None and saved_image is not None:
            image_tensor = saved_image

        if image_tensor is not None and mask_tensor is not None:
            h, w = image_tensor.shape[1:3]
            if mask_tensor.shape[-2:] != (h, w):
                mask_tensor = _resize_mask(mask_tensor, w, h)

        if mask_tensor is None:
            if image_tensor is not None:
                h, w = image_tensor.shape[1:3]
            else:
                h = w = 512
            mask_tensor = torch.zeros((1, h, w), dtype=torch.float32)

        mask_tensor = mask_tensor.clamp(0.0, 1.0)
        if invert_mask:
            mask_tensor = 1.0 - mask_tensor

        if image_tensor is None:
            h, w = mask_tensor.shape[1:3]
            image_tensor = torch.zeros((1, h, w, 3), dtype=torch.float32)

        # Persist current image to cache so the editor can open it immediately.
        if cache_dir is not None and image_tensor is not None:
            try:
                _save_tensor_image_png(cache_dir / "image.png", image_tensor)
            except Exception:
                logger.exception("MaskPro failed to persist image for node %s", node_id)

        alpha_channel = 1.0 - mask_tensor
        image_rgba = torch.cat((image_tensor, alpha_channel.unsqueeze(-1)), dim=-1)

        ui_payload = None
        try:
            previews: list = []
            previews.extend(ui.PreviewMask(mask_tensor).values)
            previews.extend(ui.PreviewImage(image_tensor).values)
            previews.extend(ui.PreviewImage(image_rgba).values)
            ui_payload = {"images": previews}
        except Exception:
            logger.exception("MaskPro failed to build previews for node %s", node_id)

        return io.NodeOutput(mask_tensor, image_tensor, image_rgba, ui=ui_payload)


class MaskProExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [MaskPro]


async def comfy_entrypoint() -> MaskProExtension:
    return MaskProExtension()