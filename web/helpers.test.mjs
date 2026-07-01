import test from "node:test";
import assert from "node:assert/strict";
import { forecastCsv } from "./helpers.mjs";

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
