🇬🇧 English version (default)  
🇫🇷 [Lire la version française](README_FR.md)

# Orion4D MaskPro
***Advanced mask editor for ComfyUI, non-destructive editing with professional selection tools, custom PNG brushes, embedded preview, and fullscreen editor.***

<img width="1541" height="903" alt="image" src="https://github.com/user-attachments/assets/620e654b-7823-4321-8df1-424bf40fbe24" />

---

## ✨ Overview

`Orion4D_maskpro` brings a comprehensive mask editor to ComfyUI with:

<img width="2546" height="1283" alt="image" src="https://github.com/user-attachments/assets/248722b5-03f6-4557-96a9-182a8fa10c0d" />
<img width="1824" height="1020" alt="image" src="https://github.com/user-attachments/assets/234794d6-5cc9-4cb6-ba28-285e267ab615" />

- **Professional tools**: brush, lasso, polygon, rectangle, ellipse, gradient, magic wand.
- **Brushes up to 2048 px**: transparent PNG support, rotation, and path smoothing.
- **Full history**: Unlimited Undo/Redo (**Ctrl+Z** / **Ctrl+Y**).
- **Smooth navigation**: cursor-centered zoom, hand tool (pan).
- **Global processing**: edge blur, dilation/erosion, thresholding, AI cutout.
- **Native integration**: real-time preview in the node (Image / Mask / RGBA modes) and dedicated editor.

---

## 🚀 Features

### Interactive Editing
- **New:** Dynamic preview in the node with aspect ratio support.
- On-the-fly mask inversion.
- Animated selections (marching ants).
- **Auto-run** option: automatically launches the workflow after "Save & Close".

### Advanced Selection Tools
- **Brush**: custom shapes, hardness, spacing, rotation, and **smoothing**.
- **Lasso**: freehand or polygonal.
- **Geometric shapes**: rectangle (with rounded corners), ellipse with constraints (**Ctrl** for perfect circle/square).
- **Gradients**: linear or radial with opacity control.
- **Magic wand**: tolerance, neighborhood average (Average), and edge smoothing.

### Smart Processing (AI)
- **BiRefNet Integration**: Built-in support for cutout via BiRefNet models.
- **AI Cutout**: Automatic subject detection. Option to merge the result with the existing mask.
- **Rembg Support**: Classic support via `rembg`.
- **Morphology**: dilation, erosion, global smoothing.

---

## 📦 Installation

```bash
cd ComfyUI/custom_nodes
git clone [https://github.com/orion4d/Orion4D_maskpro.git](https://github.com/orion4d/Orion4D_maskpro.git)
# Restart ComfyUI
```

**Dependencies:**
- For BiRefNet: Ensure you have the models in `models/BiRefNet`. (default folder, you can change the location in models)
- BiRefNet License: https://raw.githubusercontent.com/fal-ai/realtime-birefnet/refs/heads/main/LICENCE.txt
- Download (safetensors): https://huggingface.co/1038lab/BiRefNet/tree/main

---

## 🔌 Inputs / Outputs

### Inputs
- `image` — IMAGE (optional): reference image.
- `mask` — MASK (optional): initial mask to edit.
- `invert_mask` — BOOLEAN: output mask inversion.

### Outputs
- `mask` — MASK: (0..1, **white = kept area**).
- `image` — IMAGE: Passthrough of the original image.
- `image_rgba` — IMAGE: Image with the mask applied in the alpha channel.

---

## ⌨️ Keyboard Shortcuts

### Navigation & Selection
| Key | Action |
|--------|--------|
| **Mouse Wheel** | Zoom centered on cursor |
| **Z** | Zoom Tool (Alt = zoom out) |
| **H** (hold) | Temporary Hand Tool (pan) |
| **Space** | Pan |
| **Q** (hold) | Move active selection to cursor |
| **Esc** | Clear selection / Cancel polygon |

### Tools
| Key | Action |
|--------|--------|
| **B** | Brush |
| **L** | Freehand Lasso |
| **K** | Polygonal Lasso |
| **W** | Magic Wand |
| **G** | Gradient |
| **X** | Toggle Erase mode |
| **A** | Fill selection |
| **I** | Invert mask |

---

## 🎨 Brush Library

The editor now includes a **Brush Grid**:
1. Click on **Open brush grid** in the brush settings.
2. View and select your PNG brushes instantly.
3. Add your own files in `web/brushes/`.

---

## 🔧 Technical Structure

The node uses a local cache system to ensure persistence:
- `ComfyUI/user/orion4d_cache/maskpro_<NODE_ID>/`
- `image.png`: Working reference.
- `mask.png`: High-precision mask (L 8-bit).

---

<div align="center">

### 🌟 **Support the project**
If you find this tool useful, feel free to leave a ⭐ on GitHub!

**Developed with ❤️ for the ComfyUI community by Orion4D**

<a href="https://ko-fi.com/orion4d">
<img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Buy Me A Coffee" height="41" width="174">
</a>

</div>
