"""Build the public OpsLens report from an invoice-line extract."""
import argparse
import hashlib
import io
import json
import platform
import urllib.request
import zipfile
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from forecast import BASELINE, FEATURES, MODEL, product_report, score

ROOT = Path(__file__).resolve().parent
DATA_URL = "https://archive.ics.uci.edu/static/public/352/online%2Bretail.zip"
DATA_PAGE = "https://archive.ics.uci.edu/dataset/352/online+retail"
DATA_SHA256 = "43465a06f2ccf7c8b5bd2892bc7defb52f97487934fe93b16ae4c3936424676d"
REQUIRED = ["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice", "Country"]
ROW_TYPES = [
    "order", "cancellation", "negative_adjustment",
    "cancellation_mismatch", "non_product", "invalid",
]


def download_dataset(destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == DATA_SHA256:
        return
    with urllib.request.urlopen(DATA_URL, timeout=90) as response:
        archive = response.read()
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        content = package.read("Online Retail.xlsx")
    if hashlib.sha256(content).hexdigest() != DATA_SHA256:
        raise ValueError("The source workbook changed; review its provenance before rebuilding.")
    destination.write_bytes(content)


def normalize(frame):
    missing = sorted(set(REQUIRED) - set(frame.columns))
    if missing:
        raise ValueError("Missing transaction columns: " + ", ".join(missing))
    result = pd.DataFrame({
        "invoice": frame["InvoiceNo"].astype("string").str.strip().str.upper(),
        "sku": frame["StockCode"].astype("string").str.strip().str.upper(),
        "description": frame["Description"].astype("string").fillna(frame["StockCode"].astype("string")),
        "quantity": pd.to_numeric(frame["Quantity"], errors="coerce"),
        "unit_price": pd.to_numeric(frame["UnitPrice"], errors="coerce"),
        "invoice_date": pd.to_datetime(frame["InvoiceDate"], errors="coerce", utc=True).dt.tz_convert(None),
        "country": frame["Country"].astype("string").str.strip(),
    })
    return result


def classify(frame):
    raw = normalize(frame)
    with duckdb.connect() as connection:
        connection.register("raw", raw)
        return connection.execute((ROOT / "sql/classify_transactions.sql").read_text()).df()


def build_report(frame, country="United Kingdom"):
    classified = classify(frame)
    final_date = classified["day"].max()
    if pd.isna(final_date):
        raise ValueError("No valid transaction dates were found.")
    local = classified[classified["country"].eq(country)].copy()
    scoped = local[local["day"].ne(final_date)].copy()
    orders = scoped[scoped["row_type"].eq("order")]
    if orders.empty:
        raise ValueError("No valid product orders remain in the selected country.")
    start, end = orders["day"].min(), final_date - pd.Timedelta(days=1)
    dates = pd.date_range(start, end, freq="D")
    if not 180 <= len(dates) <= 1830:
        raise ValueError("This workbench needs between 180 days and five years of order history.")
    validation_start, holdout_start = len(dates) - 56, len(dates) - 28
    counts = scoped["row_type"].value_counts()

    with duckdb.connect() as connection:
        connection.register("scoped", scoped)
        totals = connection.execute(
            "SELECT SUM(CASE WHEN row_type='order' THEN quantity ELSE 0 END), "
            "SUM(CASE WHEN row_type='cancellation' THEN -quantity ELSE 0 END), "
            "SUM(CASE WHEN row_type='order' THEN quantity::BIGINT * unit_price::DECIMAL(18,4) ELSE 0 END), "
            "SUM(CASE WHEN row_type='cancellation' THEN -quantity::BIGINT * unit_price::DECIMAL(18,4) ELSE 0 END) "
            "FROM scoped WHERE row_type IN ('order', 'cancellation')"
        ).fetchone()
        cohort = connection.execute(
            "SELECT sku, arg_max(description, day) AS name, SUM(quantity) AS units "
            "FROM scoped WHERE row_type='order' AND day < ? GROUP BY sku "
            "HAVING COUNT(DISTINCT day) >= 60 ORDER BY units DESC, sku LIMIT 8",
            [dates[validation_start].date()],
        ).fetchall()
        weekly = connection.execute(
            "SELECT date_trunc('week', day) AS week, "
            "SUM(CASE WHEN row_type='order' THEN quantity ELSE 0 END) AS orders, "
            "SUM(CASE WHEN row_type='cancellation' THEN -quantity ELSE 0 END) AS cancellations "
            "FROM scoped WHERE row_type IN ('order', 'cancellation') "
            "GROUP BY week ORDER BY week"
        ).fetchall()
        watchlist = connection.execute(
            "SELECT sku, arg_max(description, day) AS name, "
            "SUM(CASE WHEN row_type='order' THEN quantity ELSE 0 END) AS orders, "
            "SUM(CASE WHEN row_type='cancellation' THEN -quantity ELSE 0 END) AS cancelled "
            "FROM scoped WHERE row_type IN ('order', 'cancellation') GROUP BY sku "
            "HAVING orders >= 500 AND cancelled > 0 "
            "ORDER BY cancelled / orders DESC, cancelled DESC, sku LIMIT 10"
        ).fetchall()
    if not cohort:
        raise ValueError("No product has at least 60 selling days before the validation cutoff.")

    daily = orders.groupby(["sku", "day"])["quantity"].sum()
    products = []
    for sku, name, _ in cohort:
        values = daily.loc[sku].reindex(dates, fill_value=0).to_numpy(dtype=float)
        products.append(product_report(sku, name, values, dates))

    actual = np.array([row["actual"] for product in products for row in product["evaluation"]])
    methods = {}
    for method, key in [(MODEL, "model"), (BASELINE, "baseline"), ("selected", None)]:
        predictions = np.array([
            row[key or ("model" if product["selected_method"] == MODEL else "baseline")]
            for product in products for row in product["evaluation"]
        ])
        methods[method] = score(actual, predictions)
    duplicate_count = int(scoped.duplicated(subset=list(normalize(frame).columns)).sum())

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "country": country, "currency": "GBP",
            "from": dates[0].date().isoformat(), "through": dates[-1].date().isoformat(),
            "excluded_final_date": final_date.date().isoformat(),
            "cohort_selection_through": dates[validation_start - 1].date().isoformat(),
            "validation_from": dates[validation_start].date().isoformat(),
            "validation_through": dates[holdout_start - 1].date().isoformat(),
            "holdout_from": dates[holdout_start].date().isoformat(),
            "holdout_through": dates[-1].date().isoformat(),
        },
        "quality": {
            "input_rows": int(len(frame)),
            "outside_country": int(len(classified) - len(local)),
            "final_date_rows": int(len(local) - len(scoped)),
            "scoped_rows": int(len(scoped)),
            "row_types": {key: int(counts.get(key, 0)) for key in ROW_TYPES},
            "duplicate_candidates_retained": duplicate_count,
        },
        "summary": {
            "ordered_units": int(totals[0] or 0),
            "cancelled_units": int(totals[1] or 0),
            "gross_order_value": round(float(totals[2] or 0), 2),
            "cancellation_value": round(float(totals[3] or 0), 2),
            "active_products": int(orders["sku"].nunique()),
            "forecast_products": len(products),
            "ml_selected_products": sum(product["selected_method"] == MODEL for product in products),
            "holdout": methods,
        },
        "weekly": [
            {"week": day.date().isoformat(), "ordered": int(units), "cancelled": int(cancelled)}
            for day, units, cancelled in weekly
        ],
        "watchlist": [
            {
                "sku": str(sku), "name": str(name),
                "ordered": int(units), "cancelled": int(cancelled),
                "cancellation_ratio": round(100 * float(cancelled) / float(units), 1),
            }
            for sku, name, units, cancelled in watchlist
        ],
        "products": products,
        "methodology": {
            "horizon_days": 7, "features": FEATURES,
            "selection": "Top eight products by units before validation, with at least 60 selling days.",
            "evaluation": "Four weekly forecast origins in validation, then four in untouched holdout. Each origin uses only earlier observations.",
            "range": "The selected model's 80th-percentile absolute validation error. This is an empirical range, not a guaranteed confidence interval.",
            "limitations": [
                "These are observed orders, not unconstrained demand; stockouts and opening hours are unknown.",
                "C-prefixed negative invoice lines are cancellation proxies, not verified physical returns.",
                "Identical invoice lines are retained because no unique line identifier proves they are duplicates.",
                "The final extract date is excluded conservatively because it may be incomplete.",
                "This historical retailer supplies some wholesale customers; bulk orders and seasonal changes can defeat either forecast.",
            ],
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/raw/Online Retail.xlsx")
    parser.add_argument("--output", type=Path, default=ROOT / "web/report.json")
    parser.add_argument("--country", default="United Kingdom")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download:
        download_dataset(args.input)
    if not args.input.is_file():
        parser.error("Input not found. Use --download for the public dataset or supply --input.")
    source_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    if args.input.suffix.lower() == ".csv":
        frame = pd.read_csv(args.input, dtype={"InvoiceNo": str, "StockCode": str})
    else:
        frame = pd.read_excel(args.input, dtype={"InvoiceNo": str, "StockCode": str}, engine="openpyxl")
    report = build_report(frame, args.country)
    report["source"] = {
        "label": "UCI Online Retail — Daqing Chen (2015)" if source_hash == DATA_SHA256 else "Custom transaction extract",
        "url": DATA_PAGE if source_hash == DATA_SHA256 else None,
        "doi": "10.24432/C5BW33" if source_hash == DATA_SHA256 else None,
        "license": "CC BY 4.0" if source_hash == DATA_SHA256 else None,
        "sha256": source_hash,
    }
    report["runtime"] = {
        "python": platform.python_version(),
        **{package: version(package) for package in ["duckdb", "numpy", "pandas", "scikit-learn"]},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"output": str(args.output), "summary": report["summary"]}, indent=2))


if __name__ == "__main__":
    main()
