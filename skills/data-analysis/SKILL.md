---
name: data-analysis
description: "Analyze datasets, spreadsheets, CSVs, and statistical models, generate clean charts, and automate data cleaning. Use when asked to analyze, analysis, analisis, analisa, dataset, csv, excel, xlsx, spreadsheet, pivot, statistik, statistics, regression, forecast, or data cleaning."
---

# Data Analysis & Profiling

For Python, OCR or files work without vm_exec in this conversation, first call select_computer with surface "vm" to move to the Private desktop; SuperBot resumes you there.

Perform exploratory data analysis, statistical modeling, data cleaning, and chart visualization.
Execute analysis either through built-in chat data tools or inside the Local VM (`Private desktop`) with Python.

## Tool Selection Matrix

| Scenario | Recommended Toolchain |
|---|---|
| **Quick query or chat chart** (< 100K rows, 1 table) | Built-in Data tools: `data_load` ──> `data_sql` ──> `data_show` ──> `data_export`. |
| **Heavy statistics, multiple tables, machine learning** | `read_file` (`to_computer: true`) ──> Python in VM (`pandas`, `scipy`, `numpy`, `statsmodels`). |
| **Messy spreadsheets, multi-sheet Excel (.xlsx)** | Copy to VM ──> `/opt/superbot/skills/data-analysis/profile.py` ──> Python cleaning script. |
| **Scanned documents, paper tables, PDF scans** | `pdftoppm -png -r 300` ──> OCR via `tesseract -l eng+ind` ──> Parse structured text with Python. |

---

## Standard Analysis Workflow

```
Profile Columns ──> State Assumptions ──> Clean with Logged Script ──> Analyze ──> Chart ──> Deliver
```

### 1. Ingest and Profile
Copy files into the VM workspace via `read_file` (`to_computer: true`), which places them at `/home/cua/workspace/uploads/<filename>`.

Run the dataset profiler via `vm_exec`:
```bash
python3 /opt/superbot/skills/data-analysis/profile.py /home/cua/workspace/uploads/sales.csv
```
For Excel files with multiple sheets:
```bash
python3 /opt/superbot/skills/data-analysis/profile.py /home/cua/workspace/uploads/financials.xlsx --sheet "Q3_Report"
```
The profiler prints:
- Total rows and column counts.
- Column data types and null counts (% missing).
- Unique value cardinality.
- Min, 25%, median, mean, 75%, max, and standard deviation for numeric columns.
- Detected date ranges (earliest, latest).
- Top frequent values for categorical columns.

### 2. State Assumptions
Before applying transformations, explicitly state data hygiene rules:
- How missing values are handled (dropped, imputed via median/mode, forward-filled).
- Identified outliers and whether they represent measurement errors or extreme events.
- Unit conversions (e.g. converting strings like `"$1.2M"` to numeric `1200000.0`, timezone normalization).

### 3. Clean with a Logged Script
Write a reproducible Python script in `/home/cua/workspace/clean_data.py`. Log every row count change:
```python
import pandas as pd

df = pd.read_csv("uploads/raw_data.csv")
initial_len = len(df)
df = df.dropna(subset=["transaction_id", "amount"])
df = df[df["amount"] > 0]
print(f"Cleaned data: {len(df)} rows retained ({len(df) - initial_len} dropped)")
df.to_csv("cleaned_data.csv", index=False)
```

### 4. Statistical Analysis & Modeling
Compute aggregations, pivots, growth rates, regressions, or statistical distributions:
- Always compute both the absolute count and the relative proportion (denominator).
- When reporting changes, provide baseline, final value, and percentage delta.

### 5. Publication-Ready Charts (Matplotlib & Seaborn)
Save high-resolution charts for attachment:
```python
import matplotlib.pyplot as plt
import seaborn as sns

plt.figure(figsize=(10, 6), dpi=150)
sns.set_theme(style="whitegrid")
ax = sns.barplot(data=df, x="category", y="revenue", palette="Blues_d")
ax.set_title("Q3 Revenue by Product Category (in USD)", fontsize=14, fontweight="bold", pad=15)
ax.set_xlabel("Product Category", fontsize=12)
ax.set_ylabel("Revenue ($)", fontsize=12)
ax.yaxis.set_major_formatter("${x:,.0f}")
plt.xticks(rotation=20, ha="right")
plt.tight_layout()
plt.savefig("revenue_by_category.png")
```
Design standards:
- Clear axis labels and human-readable number formatting (units like `$`, `%`, `k`, `M`).
- High-contrast colors; avoid default rainbow palettes.
- Include a descriptive title and subtitle or caption explaining the takeaway.

### 6. Deliver to the Person
Deliver all 4 components in chat:
1. **Executive findings in chat text:** State key numbers with units and denominators (e.g. *"Enterprise tier accounted for $2.4M (68% of total revenue), growing +32% YoY from $1.8M"*).
2. **Chart image:** Attach using `attach_file` (`path: "/home/cua/workspace/revenue_by_category.png"`).
3. **Cleaned dataset:** Attach using `attach_file` (`path: "/home/cua/workspace/cleaned_data.csv"` or `.xlsx`).
4. **Code:** Attach or share the cleaning and analysis script for full reproducibility.

---

## OCR for Scanned PDFs and Documents

When working with scanned paper tables or image-only documents in the VM:
```bash
# 1. Convert PDF pages to 300 DPI PNGs
pdftoppm -png -r 300 document.pdf page

# 2. Run OCR with English and Indonesian dictionaries
tesseract -l eng+ind page-1.png page-1_ocr --psm 6

# 3. Clean and parse text into structured CSV with Python
python3 -c "
with open('page-1_ocr.txt') as f:
    lines = [line.strip().split() for line in f if line.strip()]
import csv
with open('parsed_ocr.csv', 'w') as out:
    writer = csv.writer(out)
    writer.writerows(lines)
"
```
