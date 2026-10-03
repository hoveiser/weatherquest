#!/usr/bin/env python3
"""Dependency-free rasterizer for the WeatherQuest logo.

Renders the vector mark (rounded glass tile + neon "W" + lightning bolt +
shield outline) to PNG using only the Python standard library (zlib/struct),
then box-downsamples to the requested smaller sizes. Run from repo root:

    python tools/render_logo.py
"""
import struct
import zlib
import os

S = 512  # master canvas size
OUT_DIR = os.path.join("frontend", "public")


def lerp(a, b, t):
	return a + (b - a) * t


def hexc(h):
	h = h.lstrip("#")
	return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


ORANGE = hexc("FF6B35")
PURPLE = hexc("6B46C1")
GOLD = hexc("FDE68A")
TOP_TILE = hexc("1A1F3A")
BOT_TILE = hexc("0A0E27")
STROKE = hexc("FF6B35")
BOLT_EDGE = hexc("FFF3D6")

# Geometry mirrors frontend/public/logo.svg (viewBox 0 0 512 512).
W_POLY = [(138, 168), (196, 168), (232, 300), (256, 214), (280, 300),
          (316, 168), (374, 168), (312, 372), (272, 372), (256, 320),
          (240, 372), (200, 372)]
BOLT_POLY = [(272, 120), (214, 268), (252, 268), (226, 392), (306, 232), (264, 232)]

# Rounded tile: x, y, w, h, r
TILE = (16, 16, 480, 480, 112)


def point_in_poly(x, y, poly):
	inside = False
	n = len(poly)
	j = n - 1
	for i in range(n):
		xi, yi = poly[i]
		xj, yj = poly[j]
		if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi):
			inside = not inside
		j = i
	return inside


def in_rounded_rect(x, y, rect):
	rx, ry, rw, rh, r = rect
	if not (rx <= x <= rx + rw and ry <= y <= ry + rh):
		return False
	cx = min(max(x, rx + r), rx + rw - r)
	cy = min(max(y, ry + r), ry + rh - r)
	if (x < rx + r or x > rx + rw - r) and (y < ry + r or y > ry + rh - r):
		return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
	return True


def dist_seg(px, py, ax, ay, bx, by):
	dx, dy = bx - ax, by - ay
	l2 = dx * dx + dy * dy
	if l2 == 0:
		return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
	t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
	return ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5


def shield_path():
	return [(256, 84), (404, 132), (404, 262), (340, 410), (256, 436),
	        (172, 410), (108, 262), (108, 132)]


def render():
	# RGBA buffer
	img = [(0, 0, 0, 0)] * (S * S)

	def setpx(x, y, rgba):
		if 0 <= x < S and 0 <= y < S:
			img[y * S + x] = rgba

	def blend(x, y, rgb, alpha):
		if not (0 <= x < S and 0 <= y < S):
			return
		br, bg, bb, ba = img[y * S + x]
		a = alpha / 255.0
		r = int(rgb[0] * a + br * (1 - a))
		g = int(rgb[1] * a + bg * (1 - a))
		b = int(rgb[2] * a + bb * (1 - a))
		nalpha = int(alpha + ba * (1 - a))
		img[y * S + x] = (r, g, b, min(255, nalpha))

	shield = shield_path()

	for y in range(S):
		for x in range(S):
			if not in_rounded_rect(x, y, TILE):
				continue
			# base tile diagonal gradient
			t = (x + y) / (2 * S)
			r = int(lerp(TOP_TILE[0], BOT_TILE[0], t))
			g = int(lerp(TOP_TILE[1], BOT_TILE[1], t))
			b = int(lerp(TOP_TILE[2], BOT_TILE[2], t))
			# frosted top highlight
			if y < S * 0.5:
				hi = int(18 * (1 - y / (S * 0.5)))
				r = min(255, r + hi); g = min(255, g + hi); b = min(255, b + hi)
			setpx(x, y, (r, g, b, 255))

			# tile border ring
			if in_rounded_rect(x, y, (24, 24, 464, 464, 104)) and not in_rounded_rect(x, y, (30, 30, 452, 452, 100)):
				setpx(x, y, (ORANGE[0], ORANGE[1], ORANGE[2], 230))

			# shield outline (thin glowing stroke)
			sp = shield
			on_ring = False
			for i in range(len(sp)):
				ax, ay = sp[i]
				bx, by = sp[(i + 1) % len(sp)]
				if dist_seg(x, y, ax, ay, bx, by) <= 5:
					on_ring = True
					break
			if on_ring:
				blend(x, y, PURPLE, 150)

			# neon W (gradient fill)
			if point_in_poly(x, y, W_POLY):
				tt = (x + y) / (2 * S)
				cr = int(lerp(ORANGE[0], PURPLE[0], tt))
				cg = int(lerp(ORANGE[1], PURPLE[1], tt))
				cb = int(lerp(ORANGE[2], PURPLE[2], tt))
				setpx(x, y, (cr, cg, cb, 255))

			# lightning bolt on top
			if point_in_poly(x, y, BOLT_POLY):
				tt = (y - 120) / 272.0
				tt = max(0.0, min(1.0, tt))
				cr = int(lerp(GOLD[0], ORANGE[0], tt))
				cg = int(lerp(GOLD[1], ORANGE[1], tt))
				cb = int(lerp(GOLD[2], ORANGE[2], tt))
				setpx(x, y, (cr, cg, cb, 255))
			else:
				# faint bolt edge glow
				for i in range(len(BOLT_POLY)):
					ax, ay = BOLT_POLY[i]
					bx, by = BOLT_POLY[(i + 1) % len(BOLT_POLY)]
					if dist_seg(x, y, ax, ay, bx, by) <= 3:
						blend(x, y, BOLT_EDGE, 90)
						break

	return img


def downsample(img, src, dst):
	factor = src / dst
	out = []
	for oy in range(dst):
		for ox in range(dst):
			x0 = int(ox * factor); x1 = max(x0 + 1, int((ox + 1) * factor))
			y0 = int(oy * factor); y1 = max(y0 + 1, int((oy + 1) * factor))
			rs = gs = bs = asum = cnt = 0
			for yy in range(y0, min(y1, src)):
				for xx in range(x0, min(x1, src)):
					r, g, b, a = img[yy * src + xx]
					rs += r; gs += g; bs += b; asum += a; cnt += 1
			if cnt == 0:
				out.append((0, 0, 0, 0))
			else:
				out.append((rs // cnt, gs // cnt, bs // cnt, asum // cnt))
	return out


def write_png(path, size, img):
	raw = bytearray()
	for y in range(size):
		raw.append(0)  # filter type 0
		for x in range(size):
			r, g, b, a = img[y * size + x]
			raw += bytes((r, g, b, a))

	def chunk(tag, data):
		c = struct.pack(">I", len(data)) + tag + data
		c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
		return c

	png = b"\x89PNG\r\n\x1a\n"
	png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
	png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
	png += chunk(b"IEND", b"")
	with open(path, "wb") as f:
		f.write(png)
	print(f"  wrote {path} ({size}x{size})")


def main():
	os.makedirs(OUT_DIR, exist_ok=True)
	img = render()
	write_png(os.path.join(OUT_DIR, "logo.png"), S, img)
	write_png(os.path.join(OUT_DIR, "logo-128.png"), 128, downsample(img, S, 128))
	write_png(os.path.join(OUT_DIR, "favicon.png"), 64, downsample(img, S, 64))


if __name__ == "__main__":
	main()
