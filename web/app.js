import { methodNames, forecastCsv } from "./helpers.mjs";

const $ = (id) => document.getElementById(id);
const number = (value) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
const percent = (value) =>
  value === null ? "N/A (zero observed units)" : `${number(value)}%`;
const date = (value) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
let report;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function table(target, headers, rows, caption) {
  const result = element("table");
  const title = element("caption", caption);
  title.style.cssText =
    "text-align:left;font-size:11px;color:#5a6f6c;margin:8px 0";
  result.append(title);
  const head = element("thead"),
    heading = element("tr");
  headers.forEach((name) => {
    const cell = element("th", name);
    cell.scope = "col";
    heading.append(cell);
  });
  head.append(heading);
  result.append(head);
  const body = element("tbody");
  rows.forEach((row) => {
    const tr = element("tr");
    row.forEach((value) => tr.append(element("td", String(value))));
    body.append(tr);
  });
  result.append(body);
  $(target).replaceChildren(result);
}

function chart(target, rows, series, title) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 1000 260");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title);
  const values = rows.flatMap((row) => series.map((line) => row[line.key]));
  if (
    rows.length < 2 ||
    !values.every((value) => Number.isFinite(value) && value >= 0)
  )
    throw new Error("Invalid chart data");
  const max = Math.max(1, ...values) * 1.12;
  const x = (index) => 60 + (index / (rows.length - 1)) * 920;
  const y = (value) => 218 - (value / max) * 190;
  function shape(tag, attrs, text) {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    if (text) node.textContent = text;
    svg.append(node);
  }
  for (let i = 0; i <= 4; i++) {
    const value = (max * i) / 4;
    shape("line", {
      x1: 60,
      x2: 980,
      y1: y(value),
      y2: y(value),
      stroke: "#e4eae2",
    });
    shape(
      "text",
      {
        x: 48,
        y: y(value) + 4,
        "text-anchor": "end",
        fill: "#61746e",
        "font-size": 11,
      },
      number(value),
    );
  }
  series.forEach((line) =>
    shape("path", {
      d: rows
        .map(
          (row, index) =>
            `${index ? "L" : "M"}${x(index).toFixed(1)},${y(row[line.key]).toFixed(1)}`,
        )
        .join(" "),
      fill: "none",
      stroke: line.colour,
      "stroke-width": line.key === "actual" ? 2.6 : 2,
      "stroke-dasharray": line.dash || "",
      "vector-effect": "non-scaling-stroke",
    }),
  );
  [0, Math.floor((rows.length - 1) / 2), rows.length - 1].forEach((index) =>
    shape(
      "text",
      {
        x: x(index),
        y: 248,
        "text-anchor":
          index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle",
        fill: "#61746e",
        "font-size": 12,
      },
      date(rows[index].date || rows[index].week),
    ),
  );
  const legend = element("div", undefined, "legend");
  series.forEach((line) => {
    const item = element("span", line.label);
    item.style.setProperty("--colour", line.colour);
    legend.append(item);
  });
  $(target).replaceChildren(svg, legend);
}

function renderForecast() {
  const product = report.products.find(
    (item) => item.sku === $("product").value,
  );
  const selectedName = methodNames[product.selected_method];
  $("sku").textContent = `SKU ${product.sku}`;
  $("product-name").textContent = product.name;
  $("selected-method").textContent = `Selected: ${selectedName}`;
  $("selection-note").textContent =
    `${selectedName} had the lower validation MAE compared with ${product.selected_method === "hist_gradient_boosting" ? methodNames[product.baseline_method] : "gradient boosting"}. That choice was frozen before the holdout. The later results below may tell a different story.`;
  chart(
    "evaluation-chart",
    product.evaluation,
    [
      { key: "actual", label: "Observed orders", colour: "#153e35" },
      { key: "model", label: "Gradient boosting", colour: "#7765b6" },
      {
        key: "baseline",
        label: methodNames[product.baseline_method],
        colour: "#c47332",
        dash: "5 4",
      },
    ],
    `28-day holdout comparison for ${product.name}. Numeric errors are in the following table.`,
  );
  table(
    "comparison",
    [
      "Method",
      "Validation MAE",
      "Validation WAPE",
      "Holdout MAE",
      "Holdout WAPE",
    ],
    Object.keys(methodNames).map((method) => [
      methodNames[method] +
        (method === product.selected_method ? " · selected" : ""),
      number(product.validation[method].mae),
      percent(product.validation[method].wape),
      number(product.holdout[method].mae),
      percent(product.holdout[method].wape),
    ]),
    "Validation selects the method; holdout measures later performance. Error units: units per day.",
  );
  table(
    "evaluation-table",
    [
      "Date (2011)",
      "Observed",
      "Gradient boosting",
      methodNames[product.baseline_method],
    ],
    product.evaluation.map((row) => [
      date(row.date),
      number(row.actual),
      number(row.model),
      number(row.baseline),
    ]),
    "Exact daily holdout chart values, in units.",
  );
  chart(
    "future-chart",
    product.forecast,
    [
      {
        key: "upper",
        label: "Empirical upper range",
        colour: "#a2bca3",
        dash: "3 4",
      },
      { key: "selected", label: selectedName, colour: "#126451" },
      {
        key: "lower",
        label: "Empirical lower range",
        colour: "#a2bca3",
        dash: "3 4",
      },
    ],
    `Seven-day historical forecast for ${product.name}. Values follow in the forecast table.`,
  );
  $("range-note").textContent =
    `Range: forecast ± ${number(product.validation_error_radius)} units (80th-percentile validation absolute error), clipped at zero. Actual holdout coverage: ${percent(product.holdout_range_coverage)}. This is an empirical error range, not a guaranteed confidence interval.`;
  table(
    "future-table",
    ["Date (2011)", "Forecast units", "Lower range", "Upper range"],
    product.forecast.map((row) => [
      date(row.date),
      number(row.selected),
      number(row.lower),
      number(row.upper),
    ]),
    "Selected method, refitted using all observations through 8 Dec 2011.",
  );
}

function renderReport() {
  const { dataset: d, quality: q, summary: s } = report;
  $("period").textContent = `${date(d.from)} 2010 – ${date(d.through)} 2011`;
  const metrics = [
    [
      "Gross ordered units",
      number(s.ordered_units),
      `${number(s.active_products)} product SKUs`,
    ],
    [
      "Cancellation proxy units",
      number(s.cancelled_units),
      `${percent((100 * s.cancelled_units) / s.ordered_units)} of gross ordered units`,
    ],
    [
      "Gross order value",
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(s.gross_order_value),
      "Not net revenue or profit",
    ],
    [
      "ML selected",
      `${s.ml_selected_products} / ${s.forecast_products}`,
      "Remaining products use a simple baseline",
    ],
  ];
  $("metrics").replaceChildren(
    ...metrics.map(([label, value, note]) => {
      const node = element("div", undefined, "metric");
      node.append(
        element("span", label),
        element("strong", value),
        element("small", note),
      );
      return node;
    }),
  );
  chart(
    "weekly-chart",
    report.weekly,
    [
      { key: "ordered", label: "Gross ordered units", colour: "#126451" },
      {
        key: "cancelled",
        label: "Cancellation proxy units",
        colour: "#c47332",
      },
    ],
    "Weekly UK product orders and cancellation proxies. Exact values are available in the expandable table.",
  );
  table(
    "weekly-table",
    ["Week starting", "Ordered units", "Cancellation units"],
    report.weekly.map((row) => [
      row.week,
      number(row.ordered),
      number(row.cancelled),
    ]),
    "Calendar weeks, with partial boundary weeks.",
  );
  table(
    "watchlist",
    ["SKU", "Product", "Ordered units", "Cancellation units", "Ratio"],
    report.watchlist.map((row) => [
      row.sku,
      row.name,
      number(row.ordered),
      number(row.cancelled),
      percent(row.cancellation_ratio),
    ]),
    "Investigation candidates, not verified return rates.",
  );
  $("product").replaceChildren(
    ...report.products.map((product) => {
      const option = element("option", `${product.sku} · ${product.name}`);
      option.value = product.sku;
      return option;
    }),
  );
  table(
    "audit-table",
    ["Classification", "Invoice lines"],
    [
      ["Source workbook", number(q.input_rows)],
      ["Outside UK", number(q.outside_country)],
      ["Excluded final extract day", number(q.final_date_rows)],
      ...Object.entries(q.row_types).map(([key, value]) => [
        key.replaceAll("_", " "),
        number(value),
      ]),
      ["UK lines classified", number(q.scoped_rows)],
    ],
    "Source = outside UK + final extract day + all six classified row types.",
  );
  $("duplicates").textContent =
    `${number(q.duplicate_candidates_retained)} identical-line candidates retained: without unique line IDs, deleting them would assume they are errors. Final extract date ${d.excluded_final_date} is excluded as potentially incomplete.`;
  $("finding").textContent =
    `Validation selected gradient boosting for ${s.ml_selected_products} products and a simple method for ${s.forecast_products - s.ml_selected_products}. Across the holdout, the selected policy's WAPE was ${percent(s.holdout.selected.wape)}, versus ${percent(s.holdout.best_simple.wape)} for validation-chosen simple baselines. These large errors make this an investigation aid, not a production ordering system.`;
  $("provenance").replaceChildren(
    document.createTextNode(
      "Data: Daqing Chen (2015), UCI Online Retail, CC BY 4.0. Source is filtered and aggregated; forecasts are derived. ",
    ),
  );
  const source = element("a", "Dataset & licence");
  source.href = report.source.url;
  $("provenance").append(source);
  renderForecast();
}

async function load() {
  $("loading").hidden = false;
  $("error").hidden = true;
  $("report").hidden = true;
  try {
    const response = await fetch("report.json");
    if (!response.ok) throw new Error("Report unavailable");
    report = await response.json();
    if (
      !Array.isArray(report.products) ||
      report.products.length === 0 ||
      report.source?.license !== "CC BY 4.0"
    )
      throw new Error("Invalid public report");
    renderReport();
    $("report").hidden = false;
  } catch {
    $("error").hidden = false;
  } finally {
    $("loading").hidden = true;
  }
}
$("product").addEventListener("change", renderForecast);
$("retry").addEventListener("click", load);
$("download").addEventListener("click", () => {
  const product = report.products.find(
    (item) => item.sku === $("product").value,
  );
  const url = URL.createObjectURL(
    new Blob([forecastCsv(product)], { type: "text/csv;charset=utf-8" }),
  );
  const link = element("a");
  link.href = url;
  link.download = `opslens-${product.sku}-historical-forecast.csv`;
  link.click();
  URL.revokeObjectURL(url);
});
load();
