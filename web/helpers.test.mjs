import test from "node:test";
import assert from "node:assert/strict";
import { forecastCsv, cohortComparison } from "./helpers.mjs";

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
