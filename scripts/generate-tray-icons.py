"""Generate the menu bar templates from the Verba app icon. Requires Pillow."""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
TRAY_SIZE = 36  # Retina pixels for the 18 pt menu bar icon.
SUPERSAMPLE = 4


def main():
    with Image.open(ROOT / "img" / "app-icon.png") as icon:
        red, green, blue, alpha = icon.convert("RGBA").split()

    # The blue and mint mark is saturated. The tile and its border are neutral.
    brightest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    darkest = ImageChops.darker(ImageChops.darker(red, green), blue)
    chroma = ImageChops.subtract(brightest, darkest)
    coverage = chroma.point(lambda value: max(0, min(255, (value - 28) * 255 // 84)))
    mark = ImageChops.multiply(coverage, alpha)
    bounds = mark.getbbox()
    if bounds is None:
        raise ValueError("The app icon has no blue or mint mark.")

    size = TRAY_SIZE * SUPERSAMPLE
    mark = mark.crop(bounds)
    mark.thumbnail((30 * SUPERSAMPLE, 30 * SUPERSAMPLE), Image.Resampling.LANCZOS)
    base = Image.new("L", (size, size))
    base.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2))

    badge = (25 * SUPERSAMPLE, 3 * SUPERSAMPLE, 33 * SUPERSAMPLE - 1, 11 * SUPERSAMPLE - 1)
    for state in ("ready", "recording", "processing"):
        mask = base.copy()
        draw = ImageDraw.Draw(mask)
        if state == "recording":
            draw.ellipse(badge, fill=255)
        elif state == "processing":
            draw.ellipse(badge, outline=255, width=5 * SUPERSAMPLE // 2)
        template = Image.new("RGBA", (TRAY_SIZE, TRAY_SIZE))
        template.putalpha(mask.resize(template.size, Image.Resampling.LANCZOS))
        template.save(ROOT / "src-tauri" / "icons" / f"tray-{state}.png")


if __name__ == "__main__":
    main()
