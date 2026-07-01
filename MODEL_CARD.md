# Model card — observed-order forecasting

## Intended use

An educational, historical comparison for operations investigation. It helps a reviewer inspect data quality, baseline selection and failure cases. It does not recommend real purchases, staffing levels or financial commitments. There are no deployed live predictions.

## Data and exclusions

UCI Online Retail, Daqing Chen (2015), DOI 10.24432/C5BW33, CC BY 4.0. The source workbook hash and package versions appear in web/report.json. The public dashboard uses United Kingdom lines only, 1 December 2010–8 December 2011. The final extract day, 9 December, is excluded conservatively because it may be incomplete. Dates are treated as recorded dates; the source does not specify a timezone.

Positive, whole-quantity, positive-price product lines count as orders. C-prefixed negative invoice lines count as cancellation proxies. Other negative adjustments, cancellation mismatches, invalid lines and non-product charges are held separately. Five-digit stock codes with up to two letter suffixes define a conservative product scope. This can exclude legitimate unusual codes; the audit exposes the excluded count. Repeated identical lines are retained because there is no reliable line ID.

Cancellation / order ratios are not matched return rates. A cancellation may relate to an order outside the extract, so ratios can exceed 100%. No causal explanation or customer behaviour is inferred. CustomerID is not used or retained. The extract contains bulk wholesale orders and extreme corrections; these are not silently trimmed to improve metrics.

## Cohort and time split

The top eight products by ordered units through **13 October 2011**, each with at least 60 selling days before validation, form the fixed cohort. Missing calendar days are zero observed orders. This assumes no observed purchase on those days, not that underlying demand was zero.

| Stage | Dates | Use |
| --- | --- | --- |
| Initial training | 1 Dec 2010–13 Oct 2011 | Fit the first validation forecast |
| Validation | 14 Oct–10 Nov 2011 | Choose a simple baseline and then a method for each product |
| Holdout | 11 Nov–8 Dec 2011 | Measure the frozen choice on later observations |
| Historical future | 9–15 Dec 2011 | Refit on available history and produce seven illustrative days |

Validation and holdout each contain four non-overlapping weekly origins. At each origin the model sees only earlier observations. Refit during holdout is permitted because each prior week's actuals would be available by the next forecast date. No hyperparameter search or holdout-driven revision is performed. This is one historical split, not evidence of generalization to other retailers or years.

## Candidate methods

1. Seasonal naive: repeat the same weekday from the previous week.
2. Four-week weekday mean: average the four preceding matching weekdays.
3. Histogram gradient boosting: scikit-learn HistGradientBoostingRegressor with Poisson loss, 80 iterations, learning rate 0.08, maximum eight leaves, minimum 12 samples per leaf, L2 regularization 4, no internal random early-stopping split, random seed 37.

Features use lags 1, 7, 14 and 28, past rolling 7/28-day means, 7-day standard deviation, weekday, month and weekend flag. Multi-day predictions are recursive: yesterday's actual is unavailable for later days in the same forecast, so earlier predictions feed subsequent features. There are no promotions, prices, stock levels, holidays or external signals.

Choose the better simple method by validation MAE, then compare it with gradient boosting on that same validation period. Ties retain the simple method. Freeze the choice before holdout. This selection is deliberately small; choosing among more models on the same short validation window would increase overfitting risk.

## Evaluation

MAE is mean absolute error in daily units. WAPE is sum of absolute errors divided by sum of observed units; it is undefined for an all-zero actual period. Aggregate WAPE is volume weighted across product-days and can be dominated by high-volume items. Product-level figures are visible in the dashboard.

On the checked-in report, five products selected ML and three selected simple methods. Aggregate holdout WAPE: selected policy **74.00%**, validation-chosen simple baselines **93.31%**, all gradient boosting **71.26%**. The selected policy lost to all-ML on holdout, even though it made a reasonable validation choice. These are substantial errors, not an accuracy or savings claim.

The displayed range uses the selected method's 80th-percentile absolute validation residual, clipped at zero. Holdout coverage is reported per product. It is a rough empirical range, not a calibrated probabilistic interval; residuals are dependent and the distribution can change. Summing daily bounds is not a reliable interval for a weekly total.

## What would change before real use

Confirm SKU and invoice semantics with the business; match corrections to originating orders; obtain stockouts, opening calendars, prices and promotions; compare multiple seasonal periods and forecast horizons; test a fuller baseline family; monitor input drift and error by SKU; agree a cost-based purchasing rule with a human operator. The current study lacks those inputs and safeguards.
