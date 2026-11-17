"""Generates synthetic handwritten exam-script pages (PNG) for the Module 1 frontend demo.

Output: module1-frontend/public/samples/*.png and src/lib/sample-layout.json
The layout file records the vertical extent (percent of page) of every answer block so the
demo can seed realistic answer regions. Run:  python tools/make_samples.py
"""
import json
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "samples")
os.makedirs(OUT, exist_ok=True)

W, H = 1000, 1414
INK = (28, 48, 120)
FONT = "C:/Windows/Fonts/Inkfree.ttf"
PRINT_FONT = "C:/Windows/Fonts/arial.ttf"
LINE_H = 46
TOP = 260

random.seed(7)


def font(size, path=FONT):
    return ImageFont.truetype(path, size)


def blank_page(page_no, total, with_header):
    img = Image.new("RGB", (W, H), (250, 248, 240))
    d = ImageDraw.Draw(img)
    # ruled lines
    for y in range(TOP, H - 60, LINE_H):
        d.line([(60, y + 42), (W - 50, y + 42)], fill=(190, 205, 225), width=1)
    d.line([(110, 0), (110, H)], fill=(230, 160, 160), width=2)
    pf = font(20, PRINT_FONT)
    d.text((W - 230, H - 45), f"Page {page_no} of {total}", fill=(90, 90, 90), font=pf)
    if with_header:
        d.rectangle([60, 40, W - 50, 210], outline=(80, 80, 80), width=2)
        d.text((80, 55), "UNIVERSITY OF MORATUWA - CS2042 Operating Systems - Mid Semester", fill=(60, 60, 60), font=pf)
        d.text((80, 100), "Name:", fill=(60, 60, 60), font=pf)
        d.text((80, 150), "Index No:", fill=(60, 60, 60), font=pf)
        d.text((560, 150), "Signature:", fill=(60, 60, 60), font=pf)
    return img, d


def write_line(img, d, y, text, x=130, size=34, blur_word=None):
    f = font(size)
    cx = x + random.randint(-4, 4)
    for word in text.split(" "):
        wy = y + random.randint(-3, 3)
        if blur_word and word.strip(".,") == blur_word.strip(".,"):
            # render the word on its own layer, blur it and scribble over it (unclear handwriting)
            layer = Image.new("RGBA", (300, 70), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            ld.text((5, 5), word, fill=INK + (255,), font=f)
            layer = layer.filter(ImageFilter.GaussianBlur(3.2))
            img.paste(layer, (int(cx), int(wy)), layer)
            wlen = d.textlength(word, font=f)
            for k in range(3):
                d.line([(cx, wy + 22 + k * 6), (cx + wlen, wy + 14 + k * 7)], fill=INK, width=2)
            cx += wlen + 14
            continue
        d.text((cx, wy), word, fill=INK, font=f)
        cx += d.textlength(word + " ", font=f) + random.randint(-2, 3)


def page_with_blocks(name, page_no, total, header, blocks, header_info=None):
    """blocks: list of (key, [lines], options). Returns layout for each block."""
    img, d = blank_page(page_no, total, header)
    if header_info:
        write_line(img, d, 88, header_info[0], x=170, size=36)
        write_line(img, d, 138, header_info[1], x=200, size=36)
        write_line(img, d, 138, "J.Perera", x=680, size=36)
    y = TOP
    layout = []
    for key, lines, opts in blocks:
        start = y
        for i, ln in enumerate(lines):
            write_line(img, d, y, ln, blur_word=opts.get("blur"))
            y += LINE_H
        if opts.get("diagram"):
            # a small Gantt chart: unsupported content (diagram)
            gx, gy = 150, y + 10
            widths = [120, 180, 90, 160]
            labels = ["P1", "P2", "P3", "P1"]
            for wdt, lab in zip(widths, labels):
                d.rectangle([gx, gy, gx + wdt, gy + 60], outline=INK, width=3)
                d.text((gx + wdt / 2 - 14, gy + 12), lab, fill=INK, font=font(30))
                gx += wdt
            t = 0
            gx = 150
            for wdt in [0] + widths:
                gx += wdt
                t += wdt // 30
                d.text((gx - 8, gy + 66), str(t), fill=INK, font=font(24))
            y = gy + 120
        end = y
        layout.append({"key": key, "top": round(start / H * 100 - 1.2, 2), "height": round((end - start) / H * 100 + 1.5, 2)})
        y += LINE_H // 2
    img.save(os.path.join(OUT, name), "PNG", optimize=True)
    return layout


layout = {}

# ---------------- Script 1 (3 pages, Q2 continues onto page 2, unclear word in Q3, diagram in Q4)
layout["s1p1"] = page_with_blocks("script1_page1.png", 1, 3, True, [
    ("Q1", [
        "Q1. A process is a program in execution. It has its",
        "own address space, program counter and resources.",
        "A thread is a lightweight unit inside a process.",
        "Threads share memory of the process but each",
        "thread has its own stack and registers. Creating",
        "a thread is faster than creating a process.",
    ], {}),
    ("Q2a", [
        "Q2. A deadlock is a situation where a set of",
        "processes are blocked because each process is",
        "holding a resource and waiting for another resource",
        "held by some other process. The four conditions are",
        "1) Mutual exclusion  2) Hold and wait",
    ], {}),
], header_info=("Kasun Jayawardena", "245001K"))

layout["s1p2"] = page_with_blocks("script1_page2.png", 2, 3, False, [
    ("Q2b", [
        "(Q2 contd.) 3) No preemption  4) Circular wait.",
        "All four must hold at the same time for a deadlock.",
    ], {}),
    ("Q3", [
        "Q3. Virtual memory lets a process use more memory",
        "than the physical RAM. Pages that are not needed",
        "are kept on disk and loaded on demand, this is",
        "called paging. It gives each process isolation.",
    ], {"blur": "isolation."}),
], header_info=None)

layout["s1p3"] = page_with_blocks("script1_page3.png", 3, 3, False, [
    ("Q4", [
        "Q4. In preemptive scheduling the OS can stop a",
        "running process and give the CPU to another one,",
        "eg Round Robin. In non-preemptive scheduling the",
        "process keeps the CPU until it finishes or blocks,",
        "eg FCFS. See the Gantt chart below:",
    ], {"diagram": True}),
], header_info=None)

# ---------------- Script 2 (2 pages, Q3 left blank)
layout["s2p1"] = page_with_blocks("script2_page1.png", 1, 2, True, [
    ("Q1", [
        "Q1. Process is a running program. Thread is part",
        "of a process. Threads of the same process share",
        "the code and data, process does not share.",
    ], {}),
    ("Q2", [
        "Q2. Deadlock happens when two processes wait for",
        "each other forever. Conditions are mutual exclusion,",
        "hold and wait, no preemption and circular wait.",
    ], {}),
], header_info=("Nimali Fernando", "245017P"))

layout["s2p2"] = page_with_blocks("script2_page2.png", 2, 2, False, [
    ("Q3", ["Q3."], {}),
    ("Q4", [
        "Q4. Preemptive means the CPU can be taken away",
        "from a process. Non-preemptive means it cannot be",
        "taken until the process is done.",
    ], {}),
], header_info=None)

with open(os.path.join(ROOT, "src", "lib", "sample-layout.json"), "w") as fh:
    json.dump(layout, fh, indent=2)
print("ok", sorted(os.listdir(OUT)))
