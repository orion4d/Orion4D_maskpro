# custom_nodes/Orion4D_maskpro/__init__.py
import os
from .maskpro import MaskPro, register_routes

NODE_CLASS_MAPPINGS = {
    "MaskPro": MaskPro,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MaskPro": "MaskPro (Editor Gateway)",
}

# Define the web directory for the editor's HTML/JS files
WEB_DIRECTORY = "web"

# Mount the aiohttp routes (editor + open/save + static)
register_routes()