# Workflow Loader — ComfyUI custom node

Loads, merges, and runs **workflows** (JSON or PNG with metadata) directly from a selector integrated into ComfyUI.  
Designed for multiple venv installations and libraries shared on an external drive.

<img width="922" height="844" alt="image" src="https://github.com/user-attachments/assets/7f8bac34-936f-442c-936e-e3030faf68e7" />
<img width="895" height="1183" alt="image" src="https://github.com/user-attachments/assets/367e991f-d853-44f9-8f4d-d6b923a1687a" />

---

## Features

- **Workflow selector** (folder tree) with status.
- **Merge modes**:
  - `Add workflow`: inserts the workflow to the right of the node while keeping the current canvas (auto move of groups & nodes).
  - `new canvas`: replaces the current canvas with the loaded workflow.
- **Quick actions**: `Select Workflow…`, `Run workflow`, `Clear Canvas`.
---

## Installation

1. **Clone / copy** this repo into `ComfyUI/custom_nodes`:
   ```text
   ComfyUI/custom_nodes/orion4D_workflow_loader/
     ├─ __init__.py
     ├─ wf_loader.py
     ├─ web/           (JS/HTML/CSS for the selector)
     └─ workflows/     (target folder — see below: junctions)
   ```

2. **Restart ComfyUI.**  
   The node appears under **`Workflows`** as **“Workflow Loader by Orion4D”**.

---

## Usage tip: use a *junction* for the `workflows` folder

**Concept**  
- Keep `custom_nodes/orion4D_workflow_loader/workflows` as a **junction** pointing to `../ComfyUI/user/default/workflows`.
- And **that** `user/default/workflows` can itself be a **junction** to a folder on an **external drive** (shared between several ComfyUI venvs).

### Why?
- **Add/modify/delete workflows directly in ComfyUI.**
- **Single** workflow library to maintain.
- **Shareable** across multiple installations.
- **No duplication** or broken paths during updates.

### Windows (CMD, recommended)

> Open **Command Prompt as Administrator**.

1) Turn `ComfyUI\user\default\workflows` into a junction to an external folder (e.g. `E:\AI\SharedWorkflows`):

```bat
cd /d D:\ComfyUI_dev\ComfyUI\user\default
rmdir /s /q workflows  2>nul
mklink /J workflows E:\AI\SharedWorkflows
```

2) In the node, point `custom_nodes\orion4D_workflow_loader\workflows` to `user\default\workflows`:

```bat
cd /d D:\ComfyUI_dev\ComfyUI\custom_nodes\orion4D_workflow_loader
rmdir /s /q workflows  2>nul
mklink /J workflows D:\ComfyUI_dev\ComfyUI\user\default\workflows
```

> Repeat **step 2** in **each** ComfyUI installation (different venv) to share the same external library.

### PowerShell (equivalent)

```powershell
# Junction from user\default to the external drive
Remove-Item -Recurse -Force "D:\ComfyUI_dev\ComfyUI\user\default\workflows" -ErrorAction SilentlyContinue
New-Item -ItemType Junction -Path "D:\ComfyUI_dev\ComfyUI\user\default\workflows" -Target "E:\AI\SharedWorkflows"

# Junction from the custom node to user\default\workflows
Remove-Item -Recurse -Force "D:\ComfyUI_dev\ComfyUI\custom_nodes\orion4D_workflow_loader\workflows" -ErrorAction SilentlyContinue
New-Item -ItemType Junction -Path "D:\ComfyUI_dev\ComfyUI\custom_nodes\orion4D_workflow_loader\workflows" -Target "D:\ComfyUI_dev\ComfyUI\user\default\workflows"
```

### macOS / Linux (symlinks)

```bash
# Example: shared folder /Volumes/External/SharedWorkflows
rm -rf ~/ComfyUI/user/default/workflows
ln -s /Volumes/External/SharedWorkflows ~/ComfyUI/user/default/workflows

rm -rf ~/ComfyUI/custom_nodes/orion4D_workflow_loader/workflows
ln -s ~/ComfyUI/user/default/workflows ~/ComfyUI/custom_nodes/orion4D_workflow_loader/workflows
```

> macOS: if necessary, grant **Full Disk Access** to Terminal.

Bonus: a Windows .bat script is included to create folder junctions!

---

## Usage

1. Drop the **Workflow Loader (orion4D)** node onto the canvas.
2. Click **“Select Workflow…”** and pick a `.json` or `.png` (with `workflow`/`prompt` metadata).
3. Choose the **merge mode**:
   - `Add workflow` (default): inserts to the right of the node.
   - `new canvas`: replaces the canvas.
4. **Run workflow** to load/add it.
5. **Clear Canvas** to start fresh (the node is automatically re-injected).

---

## Compatibility

- Tested on **Windows 11** (Python 3.12.x, ComfyUI ≥ `v0.3.58`).  
- Works with **JSON** and **PNG** workflows exported by ComfyUI (metadata).

---

## Security & limitations

- The API blocks access outside `workflows/` (relative `..` paths are neutralized).
- If custom nodes are missing, ComfyUI will show “Unknown” types.
- In `Add workflow` mode, auto offset aligns the workflow **to the right** of the node.

---

## Recommended tree

```text
ComfyUI/
├─ user/
│  └─ default/
│     └─ workflows  → (junction) E:\AI\SharedWorkflows
└─ custom_nodes/
   └─ orion4D_workflow_loader/
      ├─ __init__.py
      ├─ wf_loader.py
      ├─ web/
      └─ workflows    → (junction) ..\..\user\default\workflows
```

---

## Troubleshooting

- **The “Select Workflow…” button shows nothing**  
  Check that `workflows/` exists and points to a valid folder with `.json`/`.png`.  
  On Windows, recreate the junction in an **admin prompt**.

- **“file_not_found” after selection**  
  The junction pointed to an unmounted drive (external disk unplugged).

- **The workflow doesn't connect to the rest**  
  That's expected: the tool **adds**/loads without wiring automatically. Connect as needed.

---

## Update / Contributions

1. Update from GitHub (or copy the files).
2. Restart ComfyUI.
---

<div align="center">

<h3>🌟 <strong>Show Your Support</strong></h3>

<p>If this project helped you, please consider giving it a ⭐ on GitHub!</p>

<p><strong>Made with ❤️ for the ComfyUI community</strong></p>

<p><strong>by Orion4D</strong></p>

<a href="https://ko-fi.com/orion4d">
<img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Buy Me A Coffee" height="41" width="174">
</a>

</div>
