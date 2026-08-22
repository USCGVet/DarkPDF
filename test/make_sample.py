"""Generate test/sample.pdf — a 4-page PDF exercising DarkPDF features:
text, colored vector graphics, a photo-like embedded image, and a
near-full-page image (which should NOT be color-preserved)."""
import math, zlib

objects = {}  # num -> bytes (full object body, without "N 0 obj"/"endobj")

def obj(num, body: bytes):
    objects[num] = body

def stream_obj(num, dict_extra: bytes, data: bytes):
    d = b"<< " + dict_extra + b" /Length " + str(len(data)).encode() + b" >>"
    obj(num, d + b"\nstream\n" + data + b"\nendstream")

W, H = 612, 792  # US Letter

def esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

def text(x, y, size, s, font="F1", gray=None, rgb=None):
    color = b""
    if gray is not None:
        color = f"{gray} g ".encode()
    if rgb is not None:
        color = f"{rgb[0]} {rgb[1]} {rgb[2]} rg ".encode()
    return color + f"BT /{font} {size} Tf {x} {y} Td ({esc(s)}) Tj ET\n".encode()

def rect(x, y, w, h, rgb):
    return f"{rgb[0]} {rgb[1]} {rgb[2]} rg {x} {y} {w} {h} re f\n".encode()

# ---------- photo-like images (raw RGB gradients) ----------
def sunset_image(w, h):
    """warm gradient with a sun disc — obviously wrong if inverted"""
    px = bytearray()
    for j in range(h):
        t = j / (h - 1)
        for i in range(w):
            r = int(250 - 130 * t)
            g = int(150 - 110 * t)
            b = int(90 + 30 * t)
            dx, dy = i - w * 0.7, j - h * 0.35
            if dx * dx + dy * dy < (min(w, h) * 0.16) ** 2:
                r, g, b = 255, 235, 150
            px += bytes((max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))))
    return bytes(px)

def scan_image(w, h):
    """white page with dark 'scanned text' lines — should stay dark-mode"""
    px = bytearray()
    for j in range(h):
        for i in range(w):
            v = 245
            if 8 < j % 14 < 11 and 6 < i < w - 6 and (i + j) % 37 > 3:
                v = 40
            px += bytes((v, v, v))
    return bytes(px)

IMG1_W, IMG1_H = 96, 64
IMG2_W, IMG2_H = 120, 160
img1 = sunset_image(IMG1_W, IMG1_H)
img2 = scan_image(IMG2_W, IMG2_H)

# ---------- object graph ----------
obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
obj(2, b"<< /Type /Pages /Kids [10 0 R 11 0 R 12 0 R 13 0 R] /Count 4 >>")
obj(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
obj(4, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

stream_obj(5, f"/Type /XObject /Subtype /Image /Width {IMG1_W} /Height {IMG1_H} "
              f"/ColorSpace /DeviceRGB /BitsPerComponent 8".encode(), img1)
stream_obj(6, f"/Type /XObject /Subtype /Image /Width {IMG2_W} /Height {IMG2_H} "
              f"/ColorSpace /DeviceRGB /BitsPerComponent 8".encode(), img2)

RES = b"<< /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R /Im2 6 0 R >> >>"

def page_obj(num, content_num):
    obj(num, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources "
             + RES + f" /Contents {content_num} 0 R >>".encode())

# ----- page 1: title + color swatches -----
c1 = b""
c1 += text(72, 700, 34, "DarkPDF Sample Document", font="F2")
c1 += text(72, 668, 14, "Page 1 - typography and color fidelity", gray=0.35)
swatches = [((0.85, 0.15, 0.15), "Red"), ((0.15, 0.65, 0.25), "Green"),
            ((0.15, 0.35, 0.85), "Blue"), ((0.95, 0.75, 0.10), "Yellow"),
            ((0.90, 0.45, 0.10), "Orange"), ((0.55, 0.20, 0.70), "Purple")]
x = 72
for rgb, name in swatches:
    c1 += rect(x, 560, 70, 46, rgb)
    c1 += text(x + 4, 544, 10, name, gray=0.2)
    x += 82
c1 += text(72, 480, 12, "The swatches above should keep roughly their hue in dark mode.")
c1 += text(72, 458, 12, "hue-rotate(180deg) after inversion restores red as red, blue as blue.")
for k in range(8):
    size = 22 - k * 2
    c1 += text(72, 400 - k * 34, size, f"{size}pt  The quick brown fox jumps over the lazy dog")
page_obj(10, 20); stream_obj(20, b"", c1)

# ----- page 2: dense body text -----
c2 = b""
c2 += text(72, 710, 20, "2. Reading comfort", font="F2")
lorem = ("Reading light text on a dark ground reverses the polarity your eyes expect "
         "on paper, and done badly it is worse than no dark mode at all. Pure white "
         "on pure black maximizes contrast, and for readers with astigmatism the "
         "bright strokes bloom into the dark surround - an effect called halation. "
         "The fix is to lower the luminance ceiling: an off-white around #E0 on a "
         "dark gray near #1A gives a contrast ratio around eleven to one, well above "
         "accessibility minimums but below the glare threshold. A slightly warm tint "
         "further reduces the blue component that dominates scatter inside the eye. "
         "This paragraph repeats to fill the page with realistic body text. ")
words = (lorem * 6).split()
y = 672
line = ""
while words and y > 80:
    while words and len(line) + len(words[0]) < 86:
        line += words.pop(0) + " "
    c2 += text(72, y, 11.5, line.strip())
    line = ""
    y -= 16
page_obj(11, 21); stream_obj(21, b"", c2)

# ----- page 3: photo passthrough -----
c3 = b""
c3 += text(72, 710, 20, "3. Photo passthrough", font="F2")
c3 += text(72, 682, 12, "The sunset below should keep its warm colors (not turn into a negative):")
c3 += b"q 288 0 0 192 72 460 cm /Im1 Do Q\n"
c3 += text(72, 430, 12, "Same image, smaller placements:")
c3 += b"q 144 0 0 96 72 310 cm /Im1 Do Q\n"
c3 += b"q 96 0 0 64 240 310 cm /Im1 Do Q\n"
c3 += text(72, 270, 12, "Text under the photos still inverts to light-on-dark as usual.")
c3 += rect(72, 180, 468, 3, (0.85, 0.15, 0.15))
c3 += text(72, 150, 12, "A red rule above stays red-ish; it is vector, not a photo.")
page_obj(12, 22); stream_obj(22, b"", c3)

# ----- page 4: near-full-page scan (should stay dark) -----
c4 = b""
c4 += text(72, 740, 20, "4. Scanned-page heuristic", font="F2")
c4 += b"q 576 0 0 716 18 18 cm /Im2 Do Q\n"
page_obj(13, 23); stream_obj(23, b"", c4)

# ---------- serialize with xref ----------
out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = {}
for num in sorted(objects):
    offsets[num] = len(out)
    out += f"{num} 0 obj\n".encode() + objects[num] + b"\nendobj\n"

maxnum = max(objects)
xref_pos = len(out)
out += f"xref\n0 {maxnum + 1}\n".encode()
out += b"0000000000 65535 f \n"
for n in range(1, maxnum + 1):
    if n in offsets:
        out += f"{offsets[n]:010d} 00000 n \n".encode()
    else:
        out += b"0000000000 65535 f \n"
out += (f"trailer\n<< /Size {maxnum + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n").encode()

with open("test/sample.pdf", "wb") as f:
    f.write(bytes(out))
print(f"wrote test/sample.pdf ({len(out)} bytes)")
