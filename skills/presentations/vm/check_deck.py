#!/usr/bin/env python3
import os
import sys
from typing import List

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE


def check_presentation(pptx_path: str) -> List[str]:
    if not os.path.isfile(pptx_path):
        return [f"File not found: {pptx_path}"]

    try:
        prs = Presentation(pptx_path)
    except Exception as e:
        return [f"Cannot open PowerPoint file '{pptx_path}': {e}"]

    issues: List[str] = []
    slide_w = prs.slide_width
    slide_h = prs.slide_height
    bounds_margin = 50_000  # ~0.05 inches in EMU

    for slide_idx, slide in enumerate(prs.slides, start=1):
        # 1. Slide title check
        has_title = False
        if slide.shapes.title and slide.shapes.title.text.strip():
            has_title = True
        else:
            for s in slide.shapes:
                if not (s.has_text_frame and s.text_frame.text.strip()):
                    continue
                if s.name == "Title":
                    has_title = True
                    break
                if s.top < (slide_h * 0.35):
                    sizes = [p.font.size for p in s.text_frame.paragraphs] + [
                        r.font.size for p in s.text_frame.paragraphs for r in p.runs
                    ]
                    if any(size and size.pt >= 22.0 for size in sizes):
                        has_title = True
                        break

        if not has_title:
            issues.append(f"Slide {slide_idx}: Missing slide title")

        # 2. Shape checks: off-slide, empty placeholders, fonts, overflow, bullets, images
        for shape in slide.shapes:
            shape_name = shape.name or f"Shape_{shape.shape_id}"

            # Shape off-slide bounds
            s_left = shape.left
            s_top = shape.top
            s_right = shape.left + shape.width
            s_bottom = shape.top + shape.height
            if (
                s_left < -bounds_margin
                or s_top < -bounds_margin
                or s_right > (slide_w + bounds_margin)
                or s_bottom > (slide_h + bounds_margin)
            ):
                issues.append(
                    f"Slide {slide_idx}: Shape '{shape_name}' is off-slide bounds "
                    f"(left={s_left}, top={s_top}, right={s_right}, bottom={s_bottom}, "
                    f"slide={slide_w}x{slide_h})"
                )

            # Empty placeholders
            if getattr(shape, "is_placeholder", False):
                if shape.has_text_frame:
                    if not shape.text_frame.text.strip():
                        issues.append(
                            f"Slide {slide_idx}: Empty placeholder '{shape_name}'"
                        )
                elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                    try:
                        if not shape.image.blob:
                            issues.append(
                                f"Slide {slide_idx}: Empty image placeholder '{shape_name}'"
                            )
                    except Exception:
                        issues.append(
                            f"Slide {slide_idx}: Missing image in placeholder '{shape_name}'"
                        )

            # Missing images
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                try:
                    img = shape.image
                    if not img.blob or len(img.blob) == 0:
                        issues.append(
                            f"Slide {slide_idx}: Image missing or empty in '{shape_name}'"
                        )
                except Exception as ex:
                    issues.append(
                        f"Slide {slide_idx}: Image missing/unreadable in '{shape_name}': {ex}"
                    )

            # Text frame checks: font size < 12 pt, overflow, bullets > 6
            if shape.has_text_frame:
                tf = shape.text_frame
                text_content = tf.text.strip()

                if text_content:
                    # Check font sizes < 12 pt
                    for p in tf.paragraphs:
                        for r in p.runs:
                            if r.font.size is not None:
                                pt_size = r.font.size / 12700.0
                                if pt_size < 11.9:
                                    snippet = r.text.strip()[:24]
                                    issues.append(
                                        f"Slide {slide_idx}: Font size {pt_size:.1f}pt for '{snippet}' "
                                        f"is below minimum 12pt in shape '{shape_name}'"
                                    )

                    # Check bullets > 6
                    is_title_shape = (
                        shape == slide.shapes.title
                        or (shape.top < (slide_h * 0.35) and len(tf.paragraphs) <= 2)
                    )
                    if not is_title_shape:
                        bullet_candidates = [
                            p
                            for p in tf.paragraphs
                            if p.text.strip()
                            and (
                                p.level > 0
                                or p.text.strip().startswith(
                                    ("•", "-", "–", "*", "1.", "2.", "3.", "4.", "5.", "6.", "7.")
                                )
                            )
                        ]
                        non_empty_paras = [p for p in tf.paragraphs if p.text.strip()]
                        count = max(len(bullet_candidates), len(non_empty_paras))
                        if count > 6:
                            issues.append(
                                f"Slide {slide_idx}: Shape '{shape_name}' contains {count} bullets/items "
                                "(maximum recommended is 6 to avoid clutter)"
                            )

                    # Text overflow estimation
                    box_w_in = shape.width / 914400.0
                    box_h_in = shape.height / 914400.0
                    m_top = (tf.margin_top or 0) / 914400.0
                    m_bot = (tf.margin_bottom or 0) / 914400.0
                    m_l = (tf.margin_left or 0) / 914400.0
                    m_r = (tf.margin_right or 0) / 914400.0

                    usable_w = max(0.5, box_w_in - (m_l + m_r))
                    usable_h = max(0.5, box_h_in - (m_top + m_bot))

                    est_h = 0.0
                    for p in tf.paragraphs:
                        if not p.text.strip():
                            est_h += 0.1
                            continue

                        font_pt = 16.0
                        for r in p.runs:
                            if r.font.size:
                                font_pt = r.font.size / 12700.0
                                break

                        char_w_in = (font_pt * 0.52) / 72.0
                        chars_per_line = max(8, int(usable_w / char_w_in))
                        line_count = max(
                            1, (len(p.text.strip()) + chars_per_line - 1) // chars_per_line
                        )
                        line_h_in = (font_pt * 1.25) / 72.0
                        est_h += line_count * line_h_in

                    if est_h > (usable_h * 1.18):
                        issues.append(
                            f"Slide {slide_idx}: Estimated text height {est_h:.2f}in exceeds "
                            f"box height {usable_h:.2f}in in '{shape_name}' (potential overflow)"
                        )

    return issues


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <presentation.pptx>", file=sys.stderr)
        sys.exit(2)

    pptx_path = sys.argv[1]
    issues = check_presentation(pptx_path)

    if issues:
        print(f"CHECK FAILED: {len(issues)} issue(s) detected in '{pptx_path}':")
        for issue in issues:
            print(f"  - {issue}")
        sys.exit(1)
    else:
        print(f"CHECK PASSED: '{pptx_path}' satisfies all layout, font, and content checks.")
        sys.exit(0)


if __name__ == "__main__":
    main()
