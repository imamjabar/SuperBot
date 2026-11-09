#!/usr/bin/env python3
import sys
from typing import Any, Dict, List, Optional, Tuple, Union

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

SLIDE_WIDTH_INCHES = 13.333
SLIDE_HEIGHT_INCHES = 7.5


class Theme:
    def __init__(
        self,
        title_font: str = "Calibri",
        body_font: str = "Calibri",
        primary_color: Tuple[int, int, int] = (24, 43, 73),
        secondary_color: Tuple[int, int, int] = (70, 95, 133),
        accent_color: Tuple[int, int, int] = (220, 80, 50),
        bg_color: Tuple[int, int, int] = (255, 255, 255),
        card_bg: Tuple[int, int, int] = (245, 247, 250),
        text_dark: Tuple[int, int, int] = (33, 37, 41),
        text_muted: Tuple[int, int, int] = (108, 117, 125),
    ):
        self.title_font = title_font
        self.body_font = body_font
        self.primary = RGBColor(*primary_color)
        self.secondary = RGBColor(*secondary_color)
        self.accent = RGBColor(*accent_color)
        self.bg = RGBColor(*bg_color)
        self.card_bg = RGBColor(*card_bg)
        self.text_dark = RGBColor(*text_dark)
        self.text_muted = RGBColor(*text_muted)


class DeckBuilder:
    def __init__(
        self,
        theme: Optional[Theme] = None,
        title: str = "Presentation",
        base_pptx: Optional[str] = None,
    ):
        self.theme = theme or Theme()
        self.deck_title = title
        if base_pptx:
            self.prs = Presentation(base_pptx)
        else:
            self.prs = Presentation()
            self.prs.slide_width = Inches(SLIDE_WIDTH_INCHES)
            self.prs.slide_height = Inches(SLIDE_HEIGHT_INCHES)
        self._blank_layout = self.prs.slide_layouts[6]

    def _create_slide(self):
        return self.prs.slides.add_slide(self._blank_layout)

    def _add_header(
        self,
        slide,
        title: str,
        kicker: Optional[str] = None,
        left=Inches(0.8),
        top=Inches(0.6),
        width=Inches(11.733),
        height=Inches(1.0),
    ):
        tb = slide.shapes.add_textbox(left, top, width, height)
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        first_para = True
        if kicker:
            kp = tf.paragraphs[0]
            first_para = False
            kp.text = kicker.upper()
            kp.font.name = self.theme.body_font
            kp.font.size = Pt(11)
            kp.font.bold = True
            kp.font.color.rgb = self.theme.accent
            kp.space_after = Pt(4)

        tp = tf.paragraphs[0] if first_para else tf.add_paragraph()
        tp.text = title
        tp.font.name = self.theme.title_font
        tp.font.size = Pt(26)
        tp.font.bold = True
        tp.font.color.rgb = self.theme.primary
        return tb

    def _add_footer(
        self,
        slide,
        slide_num: Optional[int] = None,
        footer_text: Optional[str] = None,
    ):
        tb = slide.shapes.add_textbox(
            Inches(0.8), Inches(6.9), Inches(11.733), Inches(0.4)
        )
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        text_parts = []
        if footer_text or self.deck_title:
            text_parts.append(footer_text or self.deck_title)
        if slide_num is not None:
            text_parts.append(str(slide_num))
        p.text = "   |   ".join(text_parts)
        p.font.name = self.theme.body_font
        p.font.size = Pt(10)
        p.font.color.rgb = self.theme.text_muted

    def set_speaker_notes(self, slide, notes: str):
        if not notes:
            return
        notes_slide = slide.notes_slide
        tf = notes_slide.notes_text_frame
        tf.text = notes.strip()

    def add_title_slide(
        self,
        title: str,
        subtitle: Optional[str] = None,
        kicker: Optional[str] = None,
        author: Optional[str] = None,
        date: Optional[str] = None,
        notes: Optional[str] = None,
    ):
        slide = self._create_slide()

        accent_bar = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.8), Inches(0.12), Inches(3.6)
        )
        accent_bar.fill.solid()
        accent_bar.fill.fore_color.rgb = self.theme.accent
        accent_bar.line.fill.background()

        tb = slide.shapes.add_textbox(
            Inches(1.2), Inches(1.8), Inches(11.3), Inches(3.8)
        )
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        first_para = True
        if kicker:
            kp = tf.paragraphs[0]
            first_para = False
            kp.text = kicker.upper()
            kp.font.name = self.theme.body_font
            kp.font.size = Pt(13)
            kp.font.bold = True
            kp.font.color.rgb = self.theme.accent
            kp.space_after = Pt(8)

        tp = tf.paragraphs[0] if first_para else tf.add_paragraph()
        tp.text = title
        tp.font.name = self.theme.title_font
        tp.font.size = Pt(40)
        tp.font.bold = True
        tp.font.color.rgb = self.theme.primary
        tp.space_after = Pt(14)

        if subtitle:
            sp = tf.add_paragraph()
            sp.text = subtitle
            sp.font.name = self.theme.body_font
            sp.font.size = Pt(20)
            sp.font.color.rgb = self.theme.secondary
            sp.space_after = Pt(16)

        meta_parts = [p for p in (author, date) if p]
        if meta_parts:
            mp = tf.add_paragraph()
            mp.text = "  ·  ".join(meta_parts)
            mp.font.name = self.theme.body_font
            mp.font.size = Pt(13)
            mp.font.color.rgb = self.theme.text_muted

        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_section_slide(
        self,
        title: str,
        subtitle: Optional[str] = None,
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
    ):
        slide = self._create_slide()

        card = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.5), Inches(11.733), Inches(4.5)
        )
        card.fill.solid()
        card.fill.fore_color.rgb = self.theme.card_bg
        card.line.color.rgb = self.theme.card_bg

        tb = slide.shapes.add_textbox(
            Inches(1.5), Inches(2.2), Inches(10.3), Inches(3.0)
        )
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        first_para = True
        if kicker:
            kp = tf.paragraphs[0]
            first_para = False
            kp.text = kicker.upper()
            kp.font.name = self.theme.body_font
            kp.font.size = Pt(12)
            kp.font.bold = True
            kp.font.color.rgb = self.theme.accent
            kp.space_after = Pt(6)

        tp = tf.paragraphs[0] if first_para else tf.add_paragraph()
        tp.text = title
        tp.font.name = self.theme.title_font
        tp.font.size = Pt(32)
        tp.font.bold = True
        tp.font.color.rgb = self.theme.primary
        tp.space_after = Pt(10)

        if subtitle:
            sp = tf.add_paragraph()
            sp.text = subtitle
            sp.font.name = self.theme.body_font
            sp.font.size = Pt(18)
            sp.font.color.rgb = self.theme.text_muted

        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_bullets_slide(
        self,
        title: str,
        bullets: List[Union[str, Tuple[str, str]]],
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
        slide_num: Optional[int] = None,
    ):
        slide = self._create_slide()
        self._add_header(slide, title, kicker=kicker)

        bullet_count = len(bullets)
        if bullet_count <= 3:
            font_size = 20
            spacing_after = 14
        elif bullet_count <= 5:
            font_size = 18
            spacing_after = 10
        else:
            font_size = 15
            spacing_after = 8

        total_chars = sum(
            len(b if isinstance(b, str) else f"{b[0]}: {b[1]}") for b in bullets
        )
        if total_chars > 600 and font_size > 14:
            font_size = 14
            spacing_after = 6

        tb = slide.shapes.add_textbox(
            Inches(0.8), Inches(1.8), Inches(11.733), Inches(4.8)
        )
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        for i, item in enumerate(bullets):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_after = Pt(spacing_after)

            if isinstance(item, tuple):
                lead, body = item
                r_lead = p.add_run()
                r_lead.text = f"{lead}: "
                r_lead.font.name = self.theme.body_font
                r_lead.font.size = Pt(font_size)
                r_lead.font.bold = True
                r_lead.font.color.rgb = self.theme.primary

                r_body = p.add_run()
                r_body.text = body
                r_body.font.name = self.theme.body_font
                r_body.font.size = Pt(font_size)
                r_body.font.bold = False
                r_body.font.color.rgb = self.theme.text_dark
            else:
                r = p.add_run()
                r.text = item
                r.font.name = self.theme.body_font
                r.font.size = Pt(font_size)
                r.font.color.rgb = self.theme.text_dark

        self._add_footer(slide, slide_num=slide_num)
        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_two_column_slide(
        self,
        title: str,
        left_content: List[Union[str, Tuple[str, str]]],
        right_content: List[Union[str, Tuple[str, str]]],
        left_title: Optional[str] = None,
        right_title: Optional[str] = None,
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
        slide_num: Optional[int] = None,
    ):
        slide = self._create_slide()
        self._add_header(slide, title, kicker=kicker)

        col_defs = [
            (Inches(0.8), Inches(5.6), left_title, left_content),
            (Inches(6.8), Inches(5.7), right_title, right_content),
        ]

        for left, width, col_title, items in col_defs:
            tb = slide.shapes.add_textbox(left, Inches(1.8), width, Inches(4.8))
            tf = tb.text_frame
            tf.word_wrap = True
            tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

            first_p = True
            if col_title:
                tp = tf.paragraphs[0]
                first_p = False
                tp.text = col_title
                tp.font.name = self.theme.title_font
                tp.font.size = Pt(20)
                tp.font.bold = True
                tp.font.color.rgb = self.theme.secondary
                tp.space_after = Pt(12)

            for item in items:
                p = tf.paragraphs[0] if first_p else tf.add_paragraph()
                first_p = False
                p.space_after = Pt(10)

                if isinstance(item, tuple):
                    lead, body = item
                    r_lead = p.add_run()
                    r_lead.text = f"{lead}: "
                    r_lead.font.name = self.theme.body_font
                    r_lead.font.size = Pt(15)
                    r_lead.font.bold = True
                    r_lead.font.color.rgb = self.theme.primary

                    r_body = p.add_run()
                    r_body.text = body
                    r_body.font.name = self.theme.body_font
                    r_body.font.size = Pt(15)
                    r_body.font.color.rgb = self.theme.text_dark
                else:
                    r = p.add_run()
                    r.text = item
                    r.font.name = self.theme.body_font
                    r.font.size = Pt(15)
                    r.font.color.rgb = self.theme.text_dark

        self._add_footer(slide, slide_num=slide_num)
        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_image_slide(
        self,
        title: str,
        image_path: str,
        caption: Optional[str] = None,
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
        slide_num: Optional[int] = None,
    ):
        slide = self._create_slide()
        self._add_header(slide, title, kicker=kicker)

        slide.shapes.add_picture(
            image_path, Inches(0.8), Inches(1.8), width=Inches(8.5)
        )

        if caption:
            tb = slide.shapes.add_textbox(
                Inches(9.6), Inches(1.8), Inches(2.9), Inches(4.5)
            )
            tf = tb.text_frame
            tf.word_wrap = True
            tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
            p = tf.paragraphs[0]
            p.text = caption
            p.font.name = self.theme.body_font
            p.font.size = Pt(14)
            p.font.color.rgb = self.theme.text_dark

        self._add_footer(slide, slide_num=slide_num)
        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_chart_slide(
        self,
        title: str,
        chart_type: str,
        categories: List[str],
        series_data: Union[Dict[str, List[float]], List[Tuple[str, List[float]]]],
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
        slide_num: Optional[int] = None,
    ):
        slide = self._create_slide()
        self._add_header(slide, title, kicker=kicker)

        chart_data = CategoryChartData()
        chart_data.categories = categories

        if isinstance(series_data, dict):
            for s_name, values in series_data.items():
                chart_data.add_series(s_name, tuple(values))
        else:
            for s_name, values in series_data:
                chart_data.add_series(s_name, tuple(values))

        type_map = {
            "bar": XL_CHART_TYPE.BAR_CLUSTERED,
            "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
            "line": XL_CHART_TYPE.LINE,
            "pie": XL_CHART_TYPE.PIE,
        }
        xl_type = type_map.get(chart_type.lower(), XL_CHART_TYPE.COLUMN_CLUSTERED)

        x, y, cx, cy = Inches(0.8), Inches(1.8), Inches(11.733), Inches(4.8)
        chart_shape = slide.shapes.add_chart(xl_type, x, y, cx, cy, chart_data)
        chart = chart_shape.chart
        chart.has_legend = True
        chart.legend.position = XL_LEGEND_POSITION.TOP
        chart.legend.include_in_layout = False

        self._add_footer(slide, slide_num=slide_num)
        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_table_slide(
        self,
        title: str,
        headers: List[str],
        rows: List[List[Any]],
        col_widths: Optional[List[float]] = None,
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
        slide_num: Optional[int] = None,
    ):
        slide = self._create_slide()
        self._add_header(slide, title, kicker=kicker)

        num_rows = len(rows) + 1
        num_cols = len(headers)
        x, y, cx, cy = Inches(0.8), Inches(1.8), Inches(11.733), Inches(4.8)
        table_shape = slide.shapes.add_table(num_rows, num_cols, x, y, cx, cy)
        table = table_shape.table

        if col_widths and len(col_widths) == num_cols:
            for i, w in enumerate(col_widths):
                table.columns[i].width = Inches(w)

        for j, header in enumerate(headers):
            cell = table.cell(0, j)
            cell.text = str(header)
            cell.fill.solid()
            cell.fill.fore_color.rgb = self.theme.primary
            for p in cell.text_frame.paragraphs:
                p.font.name = self.theme.title_font
                p.font.size = Pt(14)
                p.font.bold = True
                p.font.color.rgb = RGBColor(255, 255, 255)
                p.alignment = PP_ALIGN.LEFT

        for i, row in enumerate(rows):
            for j, val in enumerate(row):
                cell = table.cell(i + 1, j)
                cell.text = str(val)
                if i % 2 == 1:
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = self.theme.card_bg
                for p in cell.text_frame.paragraphs:
                    p.font.name = self.theme.body_font
                    p.font.size = Pt(13)
                    p.font.color.rgb = self.theme.text_dark
                    p.alignment = PP_ALIGN.LEFT

        self._add_footer(slide, slide_num=slide_num)
        self.set_speaker_notes(slide, notes or "")
        return slide

    def add_kpi_slide(
        self,
        title: str,
        cards: List[Dict[str, str]],
        kicker: Optional[str] = None,
        notes: Optional[str] = None,
        slide_num: Optional[int] = None,
    ):
        slide = self._create_slide()
        self._add_header(slide, title, kicker=kicker)

        count = min(len(cards), 4)
        total_width = 11.733
        gap = 0.3
        card_w = (total_width - (gap * (count - 1))) / count

        for i in range(count):
            card_info = cards[i]
            left = Inches(0.8 + i * (card_w + gap))
            top = Inches(2.2)
            w = Inches(card_w)
            h = Inches(3.8)

            bg = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, w, h)
            bg.fill.solid()
            bg.fill.fore_color.rgb = self.theme.card_bg
            bg.line.color.rgb = self.theme.card_bg

            tb = slide.shapes.add_textbox(
                left + Inches(0.2), top + Inches(0.3), w - Inches(0.4), h - Inches(0.6)
            )
            tf = tb.text_frame
            tf.word_wrap = True
            tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

            vp = tf.paragraphs[0]
            vp.text = str(card_info.get("value", ""))
            vp.font.name = self.theme.title_font
            vp.font.size = Pt(36)
            vp.font.bold = True
            vp.font.color.rgb = self.theme.accent
            vp.space_after = Pt(10)

            lp = tf.add_paragraph()
            lp.text = str(card_info.get("label", ""))
            lp.font.name = self.theme.body_font
            lp.font.size = Pt(16)
            lp.font.bold = True
            lp.font.color.rgb = self.theme.primary
            lp.space_after = Pt(6)

            note_text = card_info.get("note")
            if note_text:
                np = tf.add_paragraph()
                np.text = str(note_text)
                np.font.name = self.theme.body_font
                np.font.size = Pt(12)
                np.font.color.rgb = self.theme.text_muted

        self._add_footer(slide, slide_num=slide_num)
        self.set_speaker_notes(slide, notes or "")
        return slide

    def save(self, output_path: str):
        self.prs.save(output_path)
        return output_path


def build_sample_deck(output_path: str = "sample_deck.pptx"):
    builder = DeckBuilder(title="SuperBot Sample Deck")

    builder.add_title_slide(
        title="Modern Slide Decks with SuperBot",
        subtitle="16:9 Presentation Builder & Validator",
        kicker="Design System",
        author="SuperBot Assistant",
        date="2026",
        notes="Introduce the presentation architecture and automated verification.",
    )

    builder.add_bullets_slide(
        title="Key Principles for Effective Slides",
        bullets=[
            ("Action Titles", "Lead with conclusions, not generic topic nouns."),
            ("Single Focus", "One key takeaway per slide to maintain audience attention."),
            ("Auto-Fit Scaling", "Typography dynamically scales to prevent text box overflow."),
            ("Clean Contrast", "Strict adherence to dark-on-light theme contrast ratios."),
        ],
        kicker="Core Strategy",
        slide_num=2,
    )

    builder.add_kpi_slide(
        title="Performance Highlights",
        cards=[
            {"value": "99.4%", "label": "On-Time Delivery", "note": "+4.2% YoY"},
            {"value": "3.8x", "label": "Speed Multiplier", "note": "Automated workflow"},
            {"value": "0", "label": "Overflow Errors", "note": "Verified by check script"},
        ],
        kicker="Metrics",
        slide_num=3,
    )

    builder.save(output_path)
    print(f"Sample deck built successfully: {output_path}")


if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 else "output.pptx"
    build_sample_deck(out_file)
