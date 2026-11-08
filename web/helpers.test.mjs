import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  forecastCsv,
  holdoutCsv,
  cohortComparison,
  sortProductsBySelectedError,
  stockCover,
} from "./helpers.mjs";

test("committed holdout export reconciles with product and cohort scores", () => {
  const report = JSON.parse(readFileSync(new URL("./report.json", import.meta.url), "utf8"));
  const rows = holdoutCsv(report.products).trim().split("\r\n").slice(1).map(line => {
    const [date, sku, selectedMethod, baselineMethod, ...values] = line.split(",");
    return {date, sku, selectedMethod, baselineMethod, values: values.map(Number)};
  });
  assert.equal(new Set(report.products.map(product => product.sku)).size, report.products.length);
  for (const product of report.products) {
    const daily = rows.filter(row => row.sku === product.sku);
    assert.equal(daily.length, 28);
    assert.equal(daily[0].date, report.dataset.holdout_from);
    assert.equal(daily.at(-1).date, report.dataset.holdout_through);
    const baseline = ["seasonal_naive", "weekday_mean_4w"].sort((a, b) => product.validation[a].mae - product.validation[b].mae)[0];
    const selected = product.validation.hist_gradient_boosting.mae < product.validation[baseline].mae ? "hist_gradient_boosting" : baseline;
    assert.equal(product.baseline_method, baseline);
    assert.equal(product.selected_method, selected);
    const actual = daily.reduce((sum, row) => sum + row.values[0], 0);
    for (let i = 0; i < daily.length; i++) {
      assert.equal(daily[i].selectedMethod, selected);
      assert.equal(daily[i].baselineMethod, baseline);
      assert.equal(daily[i].values[1], daily[i].values[selected === "hist_gradient_boosting" ? 2 : 3]);
      if (i) assert.equal(Date.parse(daily[i].date) - Date.parse(daily[i - 1].date), 86400000);
    }
    for (const [method, column] of [["hist_gradient_boosting", 2], [baseline, 3]]) {
      const error = daily.reduce((sum, row) => sum + Math.abs(row.values[0] - row.values[column]), 0);
      // Export rounds daily predictions to two decimals; product scores use full precision.
      assert.ok(Math.abs(error / daily.length - product.holdout[method].mae) <= 0.0056);
      assert.ok(Math.abs(100 * error / actual - product.holdout[method].wape) <= 100 * 0.005 * daily.length / actual + 0.0051);
    }
  }
  const actual = rows.reduce((sum, row) => sum + row.values[0], 0);
  for (const [method, column] of [["selected", 1], ["hist_gradient_boosting", 2], ["best_simple", 3]]) {
    const error = rows.reduce((sum, row) => sum + Math.abs(row.values[0] - row.values[column]), 0);
    assert.equal(Number((error / rows.length).toFixed(3)), report.summary.holdout[method].mae);
    assert.equal(Number((100 * error / actual).toFixed(2)), report.summary.holdout[method].wape);
  }
});

test("holdout CSV retains every product and its validation-selected method", () => {
  const product = {sku: "23166", selected_method: "hist_gradient_boosting", baseline_method: "seasonal_naive",
    evaluation: [{date: "2011-11-11", actual: 10, model: 12.5, baseline: 9}]};
  const simple = {...product, sku: "85123A", selected_method: "seasonal_naive"};
  const csv = holdoutCsv([product, simple]);
  assert.equal(csv, [
    "date,sku,selected_method,baseline_method,actual_units,selected_units,model_units,baseline_units",
    "2011-11-11,23166,hist_gradient_boosting,seasonal_naive,10,12.5,12.5,9",
    "2011-11-11,85123A,seasonal_naive,seasonal_naive,10,9,12.5,9", "",
  ].join("\r\n"));
  assert.equal(product.evaluation[0].actual, 10);
});

test("holdout CSV rejects unsafe identities, wrong choices and malformed numeric/date rows", () => {
  const product = {sku: "23166", selected_method: "seasonal_naive", baseline_method: "seasonal_naive",
    evaluation: [{date: "2011-11-11", actual: 10, model: 12.5, baseline: 9}]};
  for (const fields of [{sku: "=cmd()"}, {selected_method: "unknown"}, {baseline_method: "hist_gradient_boosting"},
    {selected_method: "weekday_mean_4w"}, {evaluation: []}]) {
    assert.throws(() => holdoutCsv([{...product, ...fields}]), /Invalid holdout identity/);
  }
  for (const fields of [{date: "2011-02-30"}, {date: "=cmd()"}, {actual: NaN}, {model: Infinity}, {baseline: -1}, {actual: "10"}]) {
    assert.throws(() => holdoutCsv([{...product, evaluation: [{...product.evaluation[0], ...fields}]}]), /Invalid holdout row/);
  }
});

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

test("product picker can put the largest selected-method holdout errors first", () => {
  const products = [
    {sku: "A", selected_method: "hist_gradient_boosting", holdout: {hist_gradient_boosting: {wape: 60}, seasonal_naive: {wape: 10}}},
    {sku: "B", selected_method: "seasonal_naive", holdout: {hist_gradient_boosting: {wape: 0}, seasonal_naive: {wape: 60}}},
    {sku: "C", selected_method: "weekday_mean_4w", holdout: {weekday_mean_4w: {wape: 90}}},
    {sku: "D", selected_method: "seasonal_naive", holdout: {seasonal_naive: {wape: null}}},
  ];
  assert.deepEqual(sortProductsBySelectedError(products).map(({sku}) => sku), ["C", "A", "B", "D"]);
  assert.deepEqual(products.map(({sku}) => sku), ["A", "B", "C", "D"]);
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

test("forecast CSV rejects impossible calendar dates and accepts a real leap day", () => {
  const product = {sku: "23166", selected_method: "seasonal_naive",
    forecast: [{date: "2024-02-29", selected: 2, lower: 0, upper: 4}]};
  assert.ok(forecastCsv(product).includes("2024-02-29,23166,"));
  for (const date of ["2011-02-29", "2011-02-30", "2011-04-31", "2011-13-01"]) {
    assert.throws(() => forecastCsv({...product, forecast: [{...product.forecast[0], date}]}), /Invalid forecast row/);
  }
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
