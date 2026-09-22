from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "HttpToolLogo.png"
OUTPUT = ROOT / "electron" / "assets" / "app-icon.png"
SIZE = 1024
CORNER_RADIUS = 220
# macOS Big Sur+ app icons inset their visible glyph within a transparent
# margin instead of filling the canvas edge-to-edge (that's why our old
# full-bleed export looked noticeably bigger than sibling Dock icons at the
# same slot size). ~82% content width with a symmetric margin matches that
# convention.
SAFE_ZONE_SCALE = 0.82
CONTENT_SIZE = round(SIZE * SAFE_ZONE_SCALE)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    scale = max(CONTENT_SIZE / source.width, CONTENT_SIZE / source.height)
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - CONTENT_SIZE) // 2
    top = (resized.height - CONTENT_SIZE) // 2
    content = resized.crop((left, top, left + CONTENT_SIZE, top + CONTENT_SIZE)).convert("RGBA")

    mask = Image.new("L", (CONTENT_SIZE, CONTENT_SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CONTENT_SIZE - 1, CONTENT_SIZE - 1),
        radius=round(CORNER_RADIUS * SAFE_ZONE_SCALE),
        fill=255,
    )
    content.putalpha(mask)

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    offset = ((SIZE - CONTENT_SIZE) // 2, (SIZE - CONTENT_SIZE) // 2)
    canvas.paste(content, offset, content)
    canvas.save(OUTPUT, "PNG", optimize=True)


if __name__ == "__main__":
    main()
