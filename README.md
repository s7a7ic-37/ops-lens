# OpsLens

A retail data workbench for investigating invoice exceptions and comparing forecasts of daily ordered units.

**[Workbench](https://opslens.artemislab.co.uk/)** · **[Model card](MODEL_CARD.md)**

## Features

- SQL classification of orders, cancellation proxies, adjustments and invalid rows.
- Product-level investigation, audit totals and CSV export.
- A hypothetical stock-cover scenario using one to seven days of the selected historical forecast; shows rounded forecast units, the modelled gap and first shortfall date. It does not place orders or represent live inventory.
- Eight-product forecast comparison using simple baselines and gradient boosting.
- Export all observed holdout units and model, baseline and selected predictions as CSV. Rows preserve the earlier validation choices; displayed predictions are rounded, so recomputed errors can differ slightly from full-precision scores.
- Order the product selector by the validation-selected method's holdout WAPE to inspect larger errors first.
- Share the selected product through its `?sku=` link; reloading keeps that investigation open.
- Time-based validation and holdout results, with numeric alternatives to charts.

Built with Python, DuckDB SQL, pandas and scikit-learn. The HTML/CSS/JavaScript dashboard reads a precomputed report; there are no accounts or uploads.

## Run the dashboard

Requires Python 3.12.

```sh
python -m http.server 5182 --bind 127.0.0.1 --directory web
```

Open [localhost:5182](http://127.0.0.1:5182). The checked-in `web/report.json` is sufficient; no dataset download or Python packages are needed to view it.

## Reproduce and test

Use Python 3.12 and Node.js 22.

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m unittest discover -s tests -v
node --test web/helpers.test.mjs
.venv/Scripts/python pipeline.py --download
```

On macOS/Linux, use `.venv/bin/python`. The workbook checksum is pinned. Raw source files are excluded from Git; CLI options include `--input`, `--country` and `--output`. Keep private transaction data out of published reports: product descriptions and aggregates remain in output.

## Results and limits

The report audits 541,909 source lines and evaluates eight product series. Methods are selected on validation data before holdout evaluation. Selected-policy holdout WAPE is 74.00%, compared with 93.31% for the validation-selected simple baselines. Both errors are large; WAPE measures error, not accuracy.

This is a historical study, not a live inventory or purchasing service. Cancellation proxies are not matched returns. See the [model card](MODEL_CARD.md) for exclusions, time splits and individual results.

## Data and licence

[Daqing Chen, Online Retail, UCI (2015)](https://doi.org/10.24432/C5BW33), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The data covers December 2010–December 2011. Reports classify, aggregate and derive forecasts from those records; customer identifiers and raw invoices are omitted.

Code is MIT licensed. The derived report retains the dataset attribution. The static dashboard is hosted on Cloudflare Workers.
