#!/usr/bin/env python3
"""Create raster source assets used by the PaperTrail demo-fixture PDFs.

The images are intentionally fictional and contain no personal or institutional
data. Keeping the scanned notice as a source PNG makes the image-only PDF case
reproducible and easy to inspect independently of PaperTrail.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "papertrail-fixtures" / "source-images"
OUT.mkdir(parents=True, exist_ok=True)

NAVY = "#0e2b52"
INK = "#14213d"
SLATE = "#526782"
MIST = "#eef4f8"
TEAL = "#0c8f86"
GOLD = "#c8891e"
WHITE = "#ffffff"


def font(size, *, bold=False, malayalam=False):
    if malayalam:
        path = "/usr/share/fonts/truetype/noto/NotoSansMalayalam-Regular.ttf"
    elif bold:
        path = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
    else:
        path = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
    return ImageFont.truetype(path, size)


def rounded(draw, bounds, fill, radius=24, outline=None, width=2):
    draw.rounded_rectangle(bounds, radius=radius, fill=fill, outline=outline, width=width)


def multiline(draw, xy, text, font_obj, fill, spacing=10):
    draw.multiline_text(xy, text, font=font_obj, fill=fill, spacing=spacing)


def make_scanned_notice():
    image = Image.new("RGB", (1600, 2200), "#faf7f0")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1600, 120), fill=NAVY)
    draw.rectangle((110, 210, 1490, 1950), fill="#fffdf8", outline="#d6c8ae", width=4)
    draw.ellipse((170, 285, 330, 445), fill="#e9d39d", outline=GOLD, width=6)
    draw.text((215, 327), "D", font=font(70, bold=True), fill=NAVY)
    draw.text((390, 285), "DEMO COMMUNITY OFFICE", font=font(46, bold=True), fill=NAVY)
    draw.text((390, 355), "Private appointment notice", font=font(28), fill=SLATE)
    draw.line((180, 500, 1420, 500), fill="#d6c8ae", width=3)
    draw.text((190, 565), "Notice for: Asha Thomas", font=font(36, bold=True), fill=INK)
    draw.text((190, 640), "Reference: PT-DEMO-2026-041", font=font(28), fill=SLATE)
    body = (
        "This fictional notice is supplied only as a PaperTrail OCR fixture.\n\n"
        "Please bring the documents listed in your private checklist to the\n"
        "demonstration appointment. This document is not an official notice,\n"
        "does not establish eligibility, and must not be submitted anywhere.\n\n"
        "Appointment window: 10:30 to 11:00\n"
        "Location: Demo Service Desk\n"
        "Requested items: identification copy, address evidence, and one form."
    )
    multiline(draw, (190, 760), body, font(34), INK, spacing=24)
    rounded(draw, (190, 1510, 1410, 1700), MIST, 18)
    draw.text((230, 1555), "Fixture behavior", font=font(28, bold=True), fill=NAVY)
    multiline(draw, (230, 1615), "This page is raster-only. PaperTrail should use the local OCR path\nand preserve the original image without treating extracted text as confirmed.", font(24), fill=SLATE, spacing=12)
    draw.line((180, 1820, 1420, 1820), fill="#d6c8ae", width=2)
    draw.text((190, 1870), "PaperTrail fictional test material - no real appointment or institution", font=font(22), fill=SLATE)
    # Downsample subtly so the fixture behaves like a clean office scan, not selectable text.
    image.save(OUT / "03-scanned-notice-source.png", optimize=True)


def make_showcase_flow():
    image = Image.new("RGB", (1800, 1000), "#f6f9fc")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1800, 120), fill=NAVY)
    draw.text((90, 35), "PAPERTRAIL", font=font(44, bold=True), fill=WHITE)
    draw.text((90, 190), "A private, review-first evidence workflow", font=font(54, bold=True), fill=INK)
    draw.text((90, 270), "Original documents remain private. Every generated item is review-only.", font=font(28), fill=SLATE)
    cards = [
        (90, "1", "Private intake", "Upload originals\ninto the owner vault", TEAL),
        (500, "2", "Owner review", "Confirm facts and\nmap fields explicitly", GOLD),
        (910, "3", "Safe preparation", "Create a separate\nreview copy", "#536f9b"),
        (1320, "4", "Human decision", "Review only - never\nclaim submission", "#7a5d91"),
    ]
    for index, (x, number, title, detail, accent) in enumerate(cards):
        rounded(draw, (x, 430, x + 330, 800), WHITE, 24, outline="#d8e1ea")
        draw.ellipse((x + 32, 465, x + 96, 529), fill=accent)
        draw.text((x + 53, 476), number, font=font(27, bold=True), fill=WHITE)
        draw.text((x + 32, 575), title, font=font(31, bold=True), fill=INK)
        multiline(draw, (x + 32, 640), detail, font(24), SLATE, spacing=12)
        if index < 3:
            draw.polygon([(x + 352, 597), (x + 382, 617), (x + 352, 637)], fill="#8da1b7")
    draw.text((90, 890), "Demonstration asset - fictional data only", font=font(22), fill=SLATE)
    image.save(OUT / "project-showcase-flow.png", optimize=True)


def make_malayalam_source_text():
    image = Image.new("RGBA", (1120, 150), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.text((0, 8), "മലയാളം മൂല്യത്തിന് സഹായിത പരിശോധന ആവശ്യമാണ്", font=font(38, malayalam=True), fill=INK)
    draw.text((2, 78), "Malayalam values are deliberately routed for assisted review.", font=font(24), fill=SLATE)
    image.save(OUT / "02-malayalam-source-text.png", optimize=True)


if __name__ == "__main__":
    make_scanned_notice()
    make_showcase_flow()
    make_malayalam_source_text()
