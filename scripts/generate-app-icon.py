from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "HttpToolLogo.png"
OUTPUT = ROOT / "electron" / "assets" / "app-icon.png"
SIZE = 1024
CORNER_RADIUS = 220


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    scale = max(SIZE / source.width, SIZE / source.height)
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - SIZE) // 2
    top = (resized.height - SIZE) // 2
    canvas = resized.crop((left, top, left + SIZE, top + SIZE)).convert("RGBA")

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, SIZE - 1, SIZE - 1),
        radius=CORNER_RADIUS,
        fill=255,
    )
    canvas.putalpha(mask)
    canvas.save(OUTPUT, "PNG", optimize=True)


if __name__ == "__main__":
    main()
