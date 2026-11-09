---
name: presentations
description: "Plan, build, validate, and edit PowerPoint (.pptx) slide decks with clean 16:9 layouts in the Private desktop. Use whenever asked for slides, a presentation, deck, pitch deck, PPT, PPTX, or presentasi."
---

# PowerPoint Decks & Presentations

Without vm_exec in this conversation, first call select_computer with surface "vm" to move to the Private desktop; SuperBot resumes you there.

Build clean, executive-ready 16:9 presentations using `python-pptx` inside the Local VM (`Private desktop`).
All deck generation and validation scripts are pre-installed in `/opt/superbot/skills/presentations/`.

## End-to-End Workflow

```
Plan Storyline ──> Build Script ──> Render PNGs ──> Visual QA ──> check_deck Gate ──> attach_file
```

1. **Plan the storyline first:**
   - Outline one key message per slide.
   - Write **action titles** (conclusions/claims), never generic topic labels (e.g. use *"Revenue Grew 42% Driven by Enterprise Subscriptions"* instead of *"Financial Overview"*).
   - Keep bullet points to maximum 4–6 per slide.

2. **Build the deck with python-pptx helper:**
   - Create a Python script in `/home/cua/workspace/build_deck.py`.
   - Import the helper:
     ```python
     import sys
     sys.path.insert(0, '/opt/superbot/skills/presentations')
     import deck
     from deck import DeckBuilder, Theme
     ```
   - Use built-in slide layouts:
     - `add_title_slide(title, subtitle, kicker, author, date)`
     - `add_section_slide(title, subtitle, kicker)`
     - `add_bullets_slide(title, bullets, kicker)` (auto-scales font to fit)
     - `add_two_column_slide(title, left_bullets, right_bullets, left_title, right_title)`
     - `add_kpi_slide(title, cards=[{"value": "...", "label": "...", "note": "..."}])`
     - `add_chart_slide(title, "column"|"bar"|"line"|"pie", categories, series_data)`
     - `add_table_slide(title, headers, rows, col_widths)`
     - `add_image_slide(title, image_path, caption)`
   - Set speaker notes with `set_speaker_notes(slide, notes_text)`.
   - Execute the builder via `vm_exec`:
     `python3 build_deck.py`

3. **Render slides to inspect layout:**
   - Run the render script in the VM:
     `/opt/superbot/skills/presentations/render.sh deck.pptx renders/`
   - This converts PPTX to PDF via LibreOffice headless, generates 1280px PNG images for each slide via `pdftoppm`, and creates a contact sheet image `renders/contact_sheet.png` via ImageMagick `montage`.

4. **Inspect quality and verify layout:**
   - Review script stdout and check the generated slide count and layout warnings.
   - Attach the contact sheet to chat with `attach_file` (`path: "/home/cua/workspace/renders/contact_sheet.png"`) so you and the user can visually inspect every slide.
   - Look for text overflows, cramped tables, awkward line breaks, or low contrast. Adjust font sizes or margins in `build_deck.py` and re-render if needed.

5. **Run the automated check gate:**
   - Run the validation gate:
     `python3 /opt/superbot/skills/presentations/check_deck.py deck.pptx`
   - `check_deck.py` verifies:
     - All slides have titles.
     - No empty or orphaned placeholders.
     - Shapes do not overflow slide boundaries.
     - All body fonts are >= 12 pt.
     - Bullet points do not exceed 6 items per frame.
     - Text estimated height does not overflow text frame bounds.
     - No broken or missing image references.
   - If `check_deck.py` exits non-zero, fix the reported issues in `build_deck.py` and rebuild.

6. **Deliver:**
   - Attach the final `.pptx` file to the chat with `attach_file`:
     `attach_file` with `path: "/home/cua/workspace/deck.pptx"`.
   - In your chat reply, summarize the slide deck structure, key takeaways, and slide count.

---

## Reading and Editing Existing Decks

- **Reading an existing deck:**
  - Call `read_file` with `path: "<attached_file_path>"`.
  - SuperBot extracts slide text, structure, tables, and notes directly.
- **Modifying an uploaded deck:**
  - Call `read_file` with `to_computer: true` to copy the file to `/home/cua/workspace/uploads/<filename>.pptx`.
  - Load the deck with `python-pptx`:
    ```python
    from pptx import Presentation
    prs = Presentation("/home/cua/workspace/uploads/input.pptx")
    # inspect slides, edit text frames, add or remove slides
    prs.save("/home/cua/workspace/output.pptx")
    ```
  - Re-run `/opt/superbot/skills/presentations/render.sh` and `check_deck.py` before delivering.

---

## Example: Building a Pitch Deck

```python
import sys
sys.path.insert(0, '/opt/superbot/skills/presentations')
from deck import DeckBuilder, Theme

theme = Theme(
    primary_color=(15, 23, 42),
    secondary_color=(51, 65, 85),
    accent_color=(14, 165, 233),
)
builder = DeckBuilder(theme=theme, title="Series A Pitch Deck")

builder.add_title_slide(
    title="Next-Generation Enterprise AI",
    subtitle="Scaling Autonomous Workflows Safely",
    kicker="Investor Presentation",
    author="Acme AI Team",
    date="Q4 2026",
    notes="Welcome investors and set the stage for our growth story."
)

builder.add_kpi_slide(
    title="Traction Highlights: 4x YoY Growth",
    cards=[
        {"value": "$4.8M", "label": "Annual Recurring Revenue", "note": "+310% YoY"},
        {"value": "142%", "label": "Net Dollar Retention", "note": "Enterprise tier"},
        {"value": "99.8%", "label": "Customer Satisfaction", "note": "NPS +74"},
    ],
    kicker="Key Metrics",
    slide_num=2,
    notes="Emphasize net retention and enterprise tier stickiness."
)

builder.add_two_column_slide(
    title="Market Opportunity & Competitive Advantage",
    left_title="Market Need",
    left_content=[
        ("Legacy Tools", "Siloed data and manual copy-pasting across apps."),
        ("Security Concerns", "Enterprises refuse unhardened cloud agents."),
        ("Compliance", "Audit trails required for every financial action."),
    ],
    right_title="Acme Solution",
    right_content=[
        ("Unified Desktop", "Hardened VM sandboxes with automated auditing."),
        ("Native Integration", "Zero setup required for enterprise SSO."),
        ("Local Execution", "Full privacy and strict boundary guarantees."),
    ],
    kicker="Why Now",
    slide_num=3
)

builder.save("/home/cua/workspace/pitch_deck.pptx")
```
