import test from "node:test";
import assert from "node:assert/strict";
import { forecastCsv, cohortComparison, stockCover } from "./helpers.mjs";

test("cohort comparison keeps the validation choice even when ML loses on holdout", () => {
  const product = {
    sku: "DEMO", name: "Example",
    selected_method: "hist_gradient_boosting", baseline_method: "seasonal_naive",
    holdout: { hist_gradient_boosting: { wape: 80 }, seasonal_naive: { wape: 60 } },
  };
  assert.deepEqual(cohortComparison([product])[0], {
    sku: "DEMO", name: "Example", method: "Gradient boosting", selected: 80, baseline: 60, change: 20,
  });
  assert.equal(cohortComparison([{ ...product, selected_method: "seasonal_naive" }])[0].change, 0);
  assert.equal(cohortComparison([{ ...product, holdout: { ...product.holdout, seasonal_naive: { wape: null } } }])[0].change, null);
});

test("export preserves forecast values and excludes product descriptions", () => {
  const csv = forecastCsv({
    sku: "85099B",
    name: "=DANGEROUS()",
    selected_method: "seasonal_naive",
    forecast: [{ date: "2011-12-09", selected: 12.5, lower: 0, upper: 24 }],
  });
  assert.ok(csv.includes("2011-12-09,85099B,seasonal_naive,12.5,0,24\r\n"));
  assert.ok(!csv.includes("DANGEROUS"));
});
test("export rejects spreadsheet formulas and non-finite numbers", () => {
  const product = {
    sku: "23166",
    selected_method: "seasonal_naive",
    forecast: [{ date: "2011-12-09", selected: NaN, lower: 0, upper: 24 }],
  };
  assert.throws(() => forecastCsv(product), /Invalid forecast row/);
  assert.throws(
    () => forecastCsv({ ...product, sku: "=cmd()" }),
    /Invalid forecast identity/,
  );
});

test("stock cover accumulates unrounded daily forecasts and finds the first shortfall", () => {
  const forecast = [{date: "2011-12-09", selected: 2.25}, {date: "2011-12-10", selected: 1.25}];
  assert.deepEqual(stockCover(forecast, 3, 2), {
    forecastUnits: 4, topUpUnits: 1, shortageDate: "2011-12-10", through: "2011-12-10",
  });
  assert.deepEqual(stockCover(forecast, 4, 2), {
    forecastUnits: 4, topUpUnits: 0, shortageDate: null, through: "2011-12-10",
  });
  assert.equal(stockCover(forecast, 3, 1).topUpUnits, 0);
  assert.equal(stockCover(forecast.map(row => ({...row, selected: 0.4})), 0, 2).forecastUnits, 1);
  assert.equal(stockCover(forecast.map(row => ({...row, selected: 0})), 0, 2).shortageDate, null);
});

test("stock cover rejects invalid stock, horizons and incomplete or invalid daily data", () => {
  const rows = [{date: "2011-12-09", selected: 2}, {date: "2011-12-10", selected: 3}];
  for (const stock of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => stockCover(rows, stock, 2), /whole/);
  }
  for (const days of [0, -1, 1.5, NaN, 3, 8]) assert.throws(() => stockCover(rows, 0, days), /forecast days/);
  for (const date of ["2011-02-30", "2011-12-12", "2011-12-09", "bad"])
    assert.throws(() => stockCover([rows[0], {...rows[1], date}], 0, 2), /consecutive/);
  for (const selected of [NaN, Infinity, -1])
    assert.throws(() => stockCover([{...rows[0], selected}], 0, 1), /finite/);
  assert.throws(() => stockCover(rows.map(row => ({...row, selected: Number.MAX_SAFE_INTEGER})), 0, 2), /too large/);
});
