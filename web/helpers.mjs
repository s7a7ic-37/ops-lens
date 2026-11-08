export const methodNames = {
  hist_gradient_boosting: "Gradient boosting",
  seasonal_naive: "Same weekday last week",
  weekday_mean_4w: "Four-week weekday mean",
};

export function cohortComparison(products) {
  return products.map((product) => {
    const selected = product.holdout[product.selected_method].wape;
    const baseline = product.holdout[product.baseline_method].wape;
    return {
      sku: product.sku,
      name: product.name,
      method: methodNames[product.selected_method],
      selected,
      baseline,
      change: selected === null || baseline === null ? null : selected - baseline,
    };
  });
}

export function sortProductsBySelectedError(products) {
  return [...products].sort((a, b) => {
    const aError = a.holdout[a.selected_method].wape;
    const bError = b.holdout[b.selected_method].wape;
    if (aError === null) return bError === null ? 0 : 1;
    if (bError === null) return -1;
    return bError - aError;
  });
}

export function forecastCsv(product) {
  if (
    !/^[A-Z0-9]+$/.test(product.sku) ||
    !Object.hasOwn(methodNames, product.selected_method)
  ) {
    throw new Error("Invalid forecast identity");
  }
  const rows = product.forecast.map((row) => {
    const day = Date.parse(row.date + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== row.date ||
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

export function holdoutCsv(products) {
  const rows = ["date,sku,selected_method,baseline_method,actual_units,selected_units,model_units,baseline_units"];
  for (const product of products) {
    if (!/^[A-Z0-9]+$/.test(product.sku) ||
        !Object.hasOwn(methodNames, product.selected_method) ||
        !["seasonal_naive", "weekday_mean_4w"].includes(product.baseline_method) ||
        (product.selected_method !== "hist_gradient_boosting" && product.selected_method !== product.baseline_method) ||
        !Array.isArray(product.evaluation) || !product.evaluation.length) {
      throw new Error("Invalid holdout identity");
    }
    for (const row of product.evaluation) {
      const day = Date.parse(row.date + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(day) ||
          new Date(day).toISOString().slice(0, 10) !== row.date ||
          ![row.actual, row.model, row.baseline].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error("Invalid holdout row");
      }
      rows.push([row.date, product.sku, product.selected_method, product.baseline_method, row.actual,
        product.selected_method === "hist_gradient_boosting" ? row.model : row.baseline,
        row.model, row.baseline].join(","));
    }
  }
  return rows.join("\r\n") + "\r\n";
}

export function stockCover(forecast, onHand, days) {
  if (!Number.isSafeInteger(onHand) || onHand < 0 ||
      !Number.isSafeInteger(days) || days < 1 || days > 7 ||
      !Array.isArray(forecast) || forecast.length < days) {
    throw new Error("Use whole, non-negative stock units and 1–7 available forecast days.");
  }
  let total = 0;
  let previousDay = null;
  let shortageDate = null;
  for (const row of forecast.slice(0, days)) {
    const day = Date.parse(row.date + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(day) ||
        new Date(day).toISOString().slice(0, 10) !== row.date ||
        (previousDay !== null && day - previousDay !== 86400000) ||
        !Number.isFinite(row.selected) || row.selected < 0) {
      throw new Error("The scenario needs consecutive daily forecasts with finite, non-negative units.");
    }
    total += row.selected;
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      throw new Error("Forecast units are too large for a reliable stock calculation.");
    }
    if (shortageDate === null && total > onHand) shortageDate = row.date;
    previousDay = day;
  }
  return {
    forecastUnits: Math.ceil(total),
    topUpUnits: Math.max(0, Math.ceil(total) - onHand),
    shortageDate,
    through: forecast[days - 1].date,
  };
}
