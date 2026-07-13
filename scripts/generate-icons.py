from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)


def get_font(size):
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_icon(filename, size, maskable=False):
    bg = (13, 13, 12)
    fg = (245, 244, 240)
    border = (216, 216, 210)
    muted = (154, 154, 148)
    image = Image.new("RGB", (size, size), bg)
    draw = ImageDraw.Draw(image)
    margin = max(18, int(size * (0.12 if maskable else 0.08)))
    draw.rectangle(
        [margin, margin, size - margin - 1, size - margin - 1],
        outline=border,
        width=max(1, size // 96),
    )

    main = "MTHD"
    main_font = get_font(max(22, int(size * 0.19)))
    main_box = draw.textbbox((0, 0), main, font=main_font)
    main_width = main_box[2] - main_box[0]
    main_height = main_box[3] - main_box[1]
    draw.text(
        ((size - main_width) / 2, (size - main_height) / 2 - int(size * 0.02)),
        main,
        font=main_font,
        fill=fg,
    )

    sub = "METHOD"
    sub_font = get_font(max(9, int(size * 0.055)))
    sub_box = draw.textbbox((0, 0), sub, font=sub_font)
    sub_width = sub_box[2] - sub_box[0]
    draw.text(
        ((size - sub_width) / 2, (size + main_height) / 2 + int(size * 0.03)),
        sub,
        font=sub_font,
        fill=muted,
    )
    image.save(ICON_DIR / filename)


draw_icon("icon-192.png", 192)
draw_icon("icon-512.png", 512)
draw_icon("maskable-512.png", 512, maskable=True)
draw_icon("apple-touch-icon.png", 180)
