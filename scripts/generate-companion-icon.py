"""Generates the Android companion app's adaptive launcher icon foreground
from the shared HttpToolLogo.png source, so it matches the Mac desktop app's
Dock icon glyph.

The source logo is a solid-background artwork (dark navy background with the
two-tone arrow glyph). Android's adaptive icon system draws its own
background layer (a plain color, see ic_launcher_background.xml) beneath a
separate transparent foreground layer, so this script chroma-keys out the
logo's near-uniform background to leave just the glyph, then places it
within Android's foreground "safe zone" (the inner ~66dp of a 108dp
viewport; content outside that circle/rounded-square may be clipped by some
launcher icon masks).
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "HttpToolLogo.png"
OUTPUT = ROOT / "android-companion/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png"

# Adaptive icons are authored on a 108dp viewport; content should stay within
# the inner ~66dp "safe zone" so it isn't clipped by circular/squircle/rounded
# masks applied by different launchers. Exporting at 4x (xxxhdpi) => 432px.
VIEWPORT_PX = 432
SAFE_ZONE_SCALE = 66 / 108

# Background color sampled from the source artwork's corners (near-uniform
# dark navy) — pixels within this distance are treated as background and
# made transparent, with a soft-edged falloff to avoid a hard cutout edge.
BG_SAMPLE_POINTS = [(10, 10), (10, -10), (-10, 10), (-10, -10)]
CHROMA_THRESHOLD = 40
CHROMA_FEATHER = 25


def sample_background_color(img: Image.Image) -> tuple[int, int, int]:
    w, h = img.size
    samples = []
    for dx, dy in BG_SAMPLE_POINTS:
        x = dx if dx >= 0 else w + dx
        y = dy if dy >= 0 else h + dy
        samples.append(img.getpixel((x, y)))
    r = sum(s[0] for s in samples) / len(samples)
    g = sum(s[1] for s in samples) / len(samples)
    b = sum(s[2] for s in samples) / len(samples)
    return (round(r), round(g), round(b))


def chroma_key(img: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    br, bg_, bb = bg
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            dist = ((r - br) ** 2 + (g - bg_) ** 2 + (b - bb) ** 2) ** 0.5
            if dist <= CHROMA_THRESHOLD:
                alpha = 0
            elif dist >= CHROMA_THRESHOLD + CHROMA_FEATHER:
                alpha = 255
            else:
                alpha = round(255 * (dist - CHROMA_THRESHOLD) / CHROMA_FEATHER)
            pixels[x, y] = (r, g, b, alpha)
    return img


def content_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    alpha = img.split()[3]
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("Chroma-keyed glyph has no visible content")
    return bbox


def main() -> None:
    source = Image.open(SOURCE)
    bg_color = sample_background_color(source.convert("RGB"))
    keyed = chroma_key(source, bg_color)

    left, top, right, bottom = content_bbox(keyed)
    glyph = keyed.crop((left, top, right, bottom))

    safe_zone_px = round(VIEWPORT_PX * SAFE_ZONE_SCALE)
    scale = min(safe_zone_px / glyph.width, safe_zone_px / glyph.height)
    resized = glyph.resize(
        (round(glyph.width * scale), round(glyph.height * scale)),
        Image.Resampling.LANCZOS,
    )

    canvas = Image.new("RGBA", (VIEWPORT_PX, VIEWPORT_PX), (0, 0, 0, 0))
    offset = (
        (VIEWPORT_PX - resized.width) // 2,
        (VIEWPORT_PX - resized.height) // 2,
    )
    canvas.paste(resized, offset, resized)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, "PNG", optimize=True)
    print(f"Background sampled as rgb{bg_color}")
    print(f"Wrote {OUTPUT} ({canvas.size[0]}x{canvas.size[1]})")


if __name__ == "__main__":
    main()
