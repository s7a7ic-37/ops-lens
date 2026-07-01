export const methodNames = {
  hist_gradient_boosting: "Gradient boosting",
  seasonal_naive: "Same weekday last week",
  weekday_mean_4w: "Four-week weekday mean",
};

export function forecastCsv(product) {
  if (
    !/^[A-Z0-9]+$/.test(product.sku) ||
    !Object.hasOwn(methodNames, product.selected_method)
  ) {
    throw new Error("Invalid forecast identity");
  }
  const rows = product.forecast.map((row) => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !["selected", "lower", "upper"].every(
        (key) => Number.isFinite(row[key]) && row[key] >= 0,
      )
    ) {
      throw new Error("Invalid forecast row");
    }
    return [
      row.date,
      product.sku,
      product.selected_method,
      row.selected,
      row.lower,
      row.upper,
    ].join(",");
  });
  return (
    ["date,sku,method,forecast_units,range_lower,range_upper", ...rows].join(
      "\r\n",
    ) + "\r\n"
  );
}
