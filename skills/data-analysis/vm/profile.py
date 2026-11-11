#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional, Tuple


def read_data_file(
    filepath: str, sheet_name: Optional[str] = None
) -> Tuple[Any, List[str], str]:
    if not os.path.isfile(filepath):
        print(f"Error: file not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    ext = os.path.splitext(filepath)[1].lower()

    # Try pandas if available
    try:
        import pandas as pd  # type: ignore

        if ext in (".xlsx", ".xls"):
            xl = pd.ExcelFile(filepath)
            sheet_names = xl.sheet_names
            target_sheet = sheet_name or sheet_names[0]
            if target_sheet not in sheet_names:
                try:
                    idx = int(target_sheet)
                    target_sheet = sheet_names[idx]
                except (ValueError, IndexError):
                    print(
                        f"Error: sheet '{target_sheet}' not found. Available sheets: {sheet_names}",
                        file=sys.stderr,
                    )
                    sys.exit(1)
            df = xl.parse(target_sheet)
            return df, sheet_names, f"Excel sheet: {target_sheet}"
        else:
            encodings = ["utf-8", "utf-8-sig", "latin-1"]
            df = None
            used_enc = ""
            for enc in encodings:
                try:
                    sep = "\t" if ext == ".tsv" else ","
                    df = pd.read_csv(filepath, sep=sep, encoding=enc, low_memory=False)
                    used_enc = enc
                    break
                except UnicodeDecodeError:
                    continue
                except Exception as ex:
                    print(f"Error reading CSV with {enc}: {ex}", file=sys.stderr)
                    sys.exit(1)

            if df is None:
                print(
                    f"Error: failed to decode {filepath} with utf-8, utf-8-sig, or latin-1",
                    file=sys.stderr,
                )
                sys.exit(1)
            return df, [], f"CSV (encoding: {used_enc})"
    except ImportError:
        pass

    # Standard library fallback for CSV
    import csv

    encodings = ["utf-8", "utf-8-sig", "latin-1"]
    rows = []
    headers = []
    used_enc = ""

    for enc in encodings:
        try:
            with open(filepath, "r", encoding=enc, errors="strict") as f:
                delimiter = "\t" if ext == ".tsv" else ","
                reader = csv.reader(f, delimiter=delimiter)
                headers = next(reader, [])
                rows = list(reader)
                used_enc = enc
                break
        except UnicodeDecodeError:
            continue
        except Exception as e:
            print(f"Error reading file with {enc}: {e}", file=sys.stderr)
            sys.exit(1)

    if not used_enc:
        print(f"Error: cannot decode {filepath}", file=sys.stderr)
        sys.exit(1)

    return (headers, rows), [], f"CSV stdlib (encoding: {used_enc})"


def profile_pandas(df: Any, available_sheets: List[str], source_desc: str) -> Dict[str, Any]:
    import numpy as np  # type: ignore
    import pandas as pd  # type: ignore

    n_rows, n_cols = df.shape
    columns_profile = []
    numeric_summaries = {}
    top_values = {}
    date_ranges = {}

    for col in df.columns:
        series = df[col]
        total = len(series)
        null_count = int(series.isna().sum())
        null_pct = (null_count / total * 100.0) if total > 0 else 0.0
        n_unique = int(series.nunique(dropna=True))
        dtype_str = str(series.dtype)

        is_numeric = pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)

        # Check for date / datetime
        is_date = False
        date_min, date_max = None, None
        if pd.api.types.is_datetime64_any_dtype(series):
            is_date = True
            valid_dates = series.dropna()
            if not valid_dates.empty:
                date_min = str(valid_dates.min())
                date_max = str(valid_dates.max())
        elif series.dtype == object and n_unique > 0:
            sample = series.dropna().head(50)
            try:
                parsed = pd.to_datetime(sample, errors="raise")
                full_parsed = pd.to_datetime(series, errors="coerce")
                if full_parsed.notna().sum() > (total * 0.7):
                    is_date = True
                    valid_dates = full_parsed.dropna()
                    if not valid_dates.empty:
                        date_min = str(valid_dates.min())
                        date_max = str(valid_dates.max())
            except Exception:
                pass

        if is_date and date_min:
            date_ranges[str(col)] = {
                "min": date_min,
                "max": date_max,
            }

        if is_numeric:
            valid_num = series.dropna()
            if not valid_num.empty:
                mean_val = float(valid_num.mean())
                std_val = float(valid_num.std()) if len(valid_num) > 1 else 0.0
                min_val = float(valid_num.min())
                q25_val = float(valid_num.quantile(0.25))
                median_val = float(valid_num.median())
                q75_val = float(valid_num.quantile(0.75))
                max_val = float(valid_num.max())
                numeric_summaries[str(col)] = {
                    "count": int(valid_num.count()),
                    "mean": None if math.isnan(mean_val) else round(mean_val, 4),
                    "std": None if math.isnan(std_val) else round(std_val, 4),
                    "min": None if math.isnan(min_val) else min_val,
                    "q25": None if math.isnan(q25_val) else q25_val,
                    "median": None if math.isnan(median_val) else median_val,
                    "q75": None if math.isnan(q75_val) else q75_val,
                    "max": None if math.isnan(max_val) else max_val,
                }
        else:
            val_counts = series.value_counts(dropna=True).head(5)
            top_values[str(col)] = [
                {"value": str(k), "count": int(v)} for k, v in val_counts.items()
            ]

        columns_profile.append({
            "name": str(col),
            "dtype": dtype_str,
            "null_count": null_count,
            "null_pct": round(null_pct, 2),
            "unique_count": n_unique,
            "is_numeric": is_numeric,
            "is_date": is_date,
        })

    return {
        "source": source_desc,
        "available_sheets": available_sheets,
        "rows": n_rows,
        "columns_count": n_cols,
        "columns": columns_profile,
        "numeric_summaries": numeric_summaries,
        "top_values": top_values,
        "date_ranges": date_ranges,
    }


def profile_stdlib(data: Tuple[List[str], List[List[str]]], source_desc: str) -> Dict[str, Any]:
    headers, rows = data
    n_rows = len(rows)
    n_cols = len(headers)

    columns_profile = []
    numeric_summaries = {}
    top_values = {}

    for j, col_name in enumerate(headers):
        vals = [r[j] if j < len(r) else "" for r in rows]
        non_empty = [v.strip() for v in vals if v.strip()]
        null_count = n_rows - len(non_empty)
        null_pct = (null_count / n_rows * 100.0) if n_rows > 0 else 0.0

        num_vals = []
        for v in non_empty:
            try:
                num_vals.append(float(v))
            except ValueError:
                pass

        is_numeric = len(num_vals) > (len(non_empty) * 0.8) if non_empty else False
        unique_vals = set(non_empty)

        columns_profile.append({
            "name": col_name,
            "dtype": "float/int" if is_numeric else "string",
            "null_count": null_count,
            "null_pct": round(null_pct, 2),
            "unique_count": len(unique_vals),
            "is_numeric": is_numeric,
            "is_date": False,
        })

        if is_numeric and num_vals:
            num_vals.sort()
            count = len(num_vals)
            mean_val = sum(num_vals) / count
            min_val = num_vals[0]
            max_val = num_vals[-1]
            med_val = num_vals[count // 2]
            numeric_summaries[col_name] = {
                "count": count,
                "mean": round(mean_val, 4),
                "min": min_val,
                "median": med_val,
                "max": max_val,
            }
        elif non_empty:
            freq: Dict[str, int] = {}
            for v in non_empty:
                freq[v] = freq.get(v, 0) + 1
            sorted_f = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:5]
            top_values[col_name] = [{"value": k, "count": v} for k, v in sorted_f]

    return {
        "source": source_desc,
        "available_sheets": [],
        "rows": n_rows,
        "columns_count": n_cols,
        "columns": columns_profile,
        "numeric_summaries": numeric_summaries,
        "top_values": top_values,
        "date_ranges": {},
    }


def print_text_report(profile: Dict[str, Any]):
    print("=" * 80)
    print(f"DATASET PROFILE: {profile['source']}")
    print(f"Shape: {profile['rows']:,} rows × {profile['columns_count']} columns")
    if profile.get("available_sheets"):
        print(f"Sheets in workbook: {', '.join(profile['available_sheets'])}")
    print("=" * 80)

    # Column table
    print("\nCOLUMNS OVERVIEW:")
    header = f"{'#':<4} {'Column Name':<28} {'Dtype':<14} {'Missing':<16} {'Unique':<10}"
    print(header)
    print("-" * len(header))
    for i, col in enumerate(profile["columns"], start=1):
        miss_str = f"{col['null_count']:,} ({col['null_pct']}%)"
        print(
            f"{i:<4} {col['name'][:26]:<28} {col['dtype'][:12]:<14} {miss_str:<16} {col['unique_count']:<10,}"
        )

    # Numeric summaries
    if profile["numeric_summaries"]:
        print("\nNUMERIC DISTRIBUTIONS:")
        num_header = f"{'Column':<24} {'Min':<12} {'25%':<12} {'Median':<12} {'Mean':<12} {'75%':<12} {'Max':<12} {'Std':<12}"
        print(num_header)
        print("-" * len(num_header))
        for col_name, stats in profile["numeric_summaries"].items():
            print(
                f"{col_name[:22]:<24} "
                f"{str(stats.get('min', ''))[:10]:<12} "
                f"{str(stats.get('q25', ''))[:10]:<12} "
                f"{str(stats.get('median', ''))[:10]:<12} "
                f"{str(stats.get('mean', ''))[:10]:<12} "
                f"{str(stats.get('q75', ''))[:10]:<12} "
                f"{str(stats.get('max', ''))[:10]:<12} "
                f"{str(stats.get('std', ''))[:10]:<12}"
            )

    # Date ranges
    if profile["date_ranges"]:
        print("\nDATE / TIME RANGES:")
        for col_name, d_range in profile["date_ranges"].items():
            print(f"  • {col_name}: from {d_range['min']} to {d_range['max']}")

    # Top categorical values
    if profile["top_values"]:
        print("\nTOP CATEGORICAL VALUES:")
        for col_name, vals in profile["top_values"].items():
            val_strs = [f"'{v['value']}': {v['count']:,}" for v in vals[:5]]
            print(f"  • {col_name}: {', '.join(val_strs)}")

    print("\n" + "=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="Profile a CSV or Excel dataset: dimensions, missing rates, data types, numeric stats, top categories, and date ranges."
    )
    parser.add_argument("filepath", help="Path to CSV or XLSX file")
    parser.add_argument(
        "--sheet",
        "-s",
        help="Sheet name or index for Excel files (default: first sheet)",
        default=None,
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON instead of formatted text report",
    )
    args = parser.parse_args()

    data_obj, sheets, source_desc = read_data_file(args.filepath, sheet_name=args.sheet)

    if isinstance(data_obj, tuple):
        profile = profile_stdlib(data_obj, source_desc)
    else:
        profile = profile_pandas(data_obj, sheets, source_desc)

    if args.json:
        print(json.dumps(profile, indent=2))
    else:
        print_text_report(profile)


if __name__ == "__main__":
    main()
