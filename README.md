# OpsLens

A retail investigation workbench: classify invoice lines in SQL, follow cancellation exceptions, and test whether a machine-learning forecast improves on simple weekly patterns.

**[Open the workbench](https://opslens.artemislab.co.uk)** · [Portfolio](https://portfolio.artemislab.co.uk) · [Model card](MODEL_CARD.md)

This is a portfolio study using openly licensed historical data, not a live inventory service. The browser reads a precomputed aggregate report; there are no accounts, uploads, API keys or paid model calls.

## Why this project

An operations question comes before a model: which product lines need investigation, and how much trust should an ordering forecast earn? The workbench separates gross orders from cancellation proxies, accounts for excluded rows, and shows validation and holdout errors. A model is allowed to lose.

Python handles the extract, DuckDB SQL makes classification rules explicit, and scikit-learn supplies one small gradient-boosting model. The interface uses HTML, CSS and JavaScript. A static report keeps the public demo inexpensive and inspectable.

## Reproduce

Use Python 3.12 and Node.js 22 for the browser export checks.

    python -m venv .venv
    .venv/Scripts/python -m pip install -r requirements.txt
    .venv/Scripts/python -m unittest discover -s tests -v
    node --test web/helpers.test.mjs
    .venv/Scripts/python pipeline.py --download
    .venv/Scripts/python -m http.server 5182 --bind 127.0.0.1 --directory web

On macOS/Linux, replace .venv/Scripts/python with .venv/bin/python. Open http://127.0.0.1:5182. Downloading and reading the workbook takes longer than the synthetic test suite. The workbook SHA-256 is pinned; a changed source requires review. Raw source files are excluded from Git.

The checked-in web/report.json is sufficient to run the demo without Python packages or a download. To inspect a different local extract, the CLI accepts --input, --country and --output. Do not publish private transaction data: descriptions and aggregate product figures remain in output even though customer identifiers are dropped. The public web interface intentionally accepts only the licensed demonstration report.

## What the report shows

- 541,909 source lines, of which 494,026 UK lines remain after country and final-day exclusions.
- 482,528 positive product-order lines and 7,357 cancellation-proxy lines; adjustments, non-product lines and invalid rows are separate categories.
- 5,171 identical-line candidates retained because there is no unique line ID to prove duplication.
- Eight product series chosen before validation; seven-day forecasts from four weekly validation origins followed by four untouched holdout origins.
- Validation chose gradient boosting for five products and simple methods for three. Selected-policy holdout WAPE was 74.00%; validation-chosen simple baselines scored 93.31%. Both error levels are large. These results do not establish production readiness or business savings.

WAPE is an error ratio, not model accuracy. The all-ML holdout result happened to outperform the selected policy, but the policy was not changed after seeing that result. See the model card for dates, caveats and individual evaluation rules.

The forecast lab includes all eight products in a side-by-side cohort table: validation-selected method, simple-baseline holdout WAPE, selected-method holdout WAPE and the difference in percentage points. A positive difference means more error. This view exposes individual losses without changing any selection after seeing the holdout. Tables and full-size charts remain scrollable and keyboard accessible on phones.

## Project map

| File | Purpose |
| --- | --- |
| pipeline.py | Load, normalize, audit and aggregate the extract; write the report atomically |
| sql/classify_transactions.sql | Reviewable classification rules |
| forecast.py | Past-only features, rolling-origin evaluation and validation-based selection |
| tests/test_pipeline.py | Data boundaries, audit balancing, leakage and baseline checks |
| web/ | Accessible static dashboard, numeric chart alternatives and safe CSV export |

GitHub Actions runs the synthetic pipeline and CSV-export tests and checks the published report's audit totals. It does not download the workbook on each push or deploy automatically. Deployment uses the owner's Cloudflare account via wrangler.jsonc.

## Data credit and licence

Source: Daqing Chen (2015), **Online Retail**, UCI Machine Learning Repository, [DOI 10.24432/C5BW33](https://doi.org/10.24432/C5BW33), [dataset page](https://archive.ics.uci.edu/dataset/352/online+retail). Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data covers a UK online retailer, including wholesale customers, from December 2010 to December 2011.

The report filters country and the final extraction day, classifies and aggregates invoice lines, and adds derived forecasts. It omits customer identifiers and raw invoice records. These transformations are this project's work; the underlying data is credited to its creator. Code is MIT licensed; the derived report retains the dataset's CC BY 4.0 attribution.

The custom hostname is verified. The owner-account fallback is https://opslens.mpasiecki.workers.dev. CI also scans the public web directory for credentials with a pinned, offline Gitleaks container and redacted output.
