#!/usr/bin/env python3
"""프레임 → GIF·WebP 조립 (Pillow만 사용, ffmpeg 불필요).

    python3 scripts/guide-gif.py <프레임루트> <출력디렉터리> [--width 900]

각 클립 폴더에는 `NNNN.png` 프레임과 `timings.json`(프레임별 지속시간 ms)이 있다.
`guide-record.cjs`가 만든다.

GIF는 256색이라 UI 스크린샷에는 사실 잘 맞는다 — 사진과 달리 색이 몇 개 안 쓰인다.
문제는 **용량**이고, 줄이는 지렛대는 세 개다:

1. 폭 축소 (제곱으로 준다)
2. 같은 화면이 이어지면 **프레임을 합친다** — 정지 구간이 안내 자료의 대부분이다
3. 팔레트 고정 + `optimize` — 프레임마다 팔레트를 새로 만들면 색이 깜빡인다

같은 프레임 소스로 **애니메이션 WebP**도 함께 만든다. 화질이 낫고 용량은 1/3쯤이라
웹 페이지에는 WebP를 쓰고, GIF는 한글·메일에 붙여넣을 용도로 남긴다.
"""
import json
import sys
from pathlib import Path

from PIL import Image


def load_clip(d: Path):
    frames = sorted(d.glob("[0-9]*.png"))
    if not frames:
        return None, None
    timings = json.loads((d / "timings.json").read_text()) if (d / "timings.json").exists() else [80] * len(frames)
    return frames, timings[: len(frames)]


def dedupe(images, durations):
    """연속으로 똑같은 화면은 한 장으로 합치고 지속시간만 더한다.

    안내 GIF는 '멈춰서 보여주는' 구간이 길다. 그 구간을 프레임 수십 장으로 들고 있으면
    용량만 먹고 보이는 것은 같다."""
    out_i, out_d = [], []
    for im, dur in zip(images, durations):
        if out_i and im.tobytes() == out_i[-1].tobytes():
            out_d[-1] += dur
        else:
            out_i.append(im)
            out_d.append(dur)
    return out_i, out_d


def build(clip_dir: Path, out_dir: Path, width: int):
    frames, timings = load_clip(clip_dir)
    if not frames:
        return None
    images = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        if im.width != width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        images.append(im)

    images, durations = dedupe(images, timings)

    # 팔레트는 **전체 프레임을 이어 붙인 그림**에서 한 번만 뽑는다.
    # 프레임마다 뽑으면 같은 회색이 프레임마다 다른 색이 되어 화면이 깜빡인다.
    strip = Image.new("RGB", (images[0].width, images[0].height * len(images)))
    for i, im in enumerate(images):
        strip.paste(im, (0, i * images[0].height))
    base = strip.quantize(colors=200, method=Image.MEDIANCUT, dither=Image.NONE)

    # dither를 끄는 이유: UI는 평면 색이라 디더링이 도움이 안 되고, 점 패턴이
    # 프레임마다 달라져 GIF 프레임 간 차분 압축을 망친다 (용량이 몇 배로 뛴다)
    pal_frames = [im.quantize(palette=base, dither=Image.NONE) for im in images]

    out_dir.mkdir(parents=True, exist_ok=True)
    gif = out_dir / f"{clip_dir.name}.gif"
    webp = out_dir / f"{clip_dir.name}.webp"

    pal_frames[0].save(
        gif, save_all=True, append_images=pal_frames[1:], duration=durations,
        loop=0, optimize=True, disposal=2,
    )
    images[0].save(
        webp, save_all=True, append_images=images[1:], duration=durations,
        loop=0, quality=72, method=6,
    )
    total = sum(durations) / 1000
    return {
        "name": clip_dir.name, "frames": len(pal_frames), "seconds": round(total, 1),
        "gif_kb": round(gif.stat().st_size / 1024), "webp_kb": round(webp.stat().st_size / 1024),
        "size": f"{images[0].width}×{images[0].height}",
    }


def main():
    if len(sys.argv) < 3:
        print("사용법: guide-gif.py <프레임루트> <출력디렉터리> [--width 900]")
        sys.exit(1)
    root, out = Path(sys.argv[1]), Path(sys.argv[2])
    width = int(sys.argv[sys.argv.index("--width") + 1]) if "--width" in sys.argv else 900
    rows = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        r = build(d, out, width)
        if r:
            rows.append(r)
            print(f"  ✓ {r['name']:9s} {r['size']:9s} {r['frames']:3d}프레임 "
                  f"{r['seconds']:5.1f}초  GIF {r['gif_kb']:5d}KB · WebP {r['webp_kb']:4d}KB")
    if rows:
        print(f"\n  합계 GIF {sum(r['gif_kb'] for r in rows)}KB · WebP {sum(r['webp_kb'] for r in rows)}KB")


if __name__ == "__main__":
    main()
