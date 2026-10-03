"""Pack favicon-16/32/48.png into apps/web/public/favicon.ico (PNG-compressed ICO)."""
from pathlib import Path
from PIL import Image

pub = Path(__file__).resolve().parent.parent / "apps" / "web" / "public"
images = [Image.open(pub / f"favicon-{s}.png").convert("RGBA") for s in (16, 32, 48)]
images[2].save(pub / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=images[:2])
print("wrote favicon.ico")
