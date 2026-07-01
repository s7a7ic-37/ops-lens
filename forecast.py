"""Weekly rolling-origin checks for a seven-day orders forecast."""
from datetime import timedelta

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits

FEATURES = [
    "yesterday", "same_day_last_week", "lag_14", "lag_28",
    "mean_7", "mean_28", "std_7", "weekday", "month", "weekend",
]
MODEL = "hist_gradient_boosting"
BASELINE = "best_simple"
NAIVE = "seasonal_naive"
MEAN = "weekday_mean_4w"
METHODS = (MODEL, NAIVE, MEAN)
HORIZON = 7


def feature_row(history, day):
    values = np.asarray(history, dtype=float)
    if len(values) < 28 or not np.isfinite(values).all() or (values < 0).any():
        raise ValueError("Features need at least 28 finite, non-negative past observations.")
    return np.array([
        values[-1], values[-7], values[-14], values[-28],
        values[-7:].mean(), values[-28:].mean(), values[-7:].std(),
        day.weekday(), day.month, int(day.weekday() >= 5),
    ])


def training_data(values, dates):
    if len(values) != len(dates) or len(values) < 70:
        raise ValueError("Training needs matching daily dates and at least 70 observations.")
    features = np.vstack([feature_row(values[:i], dates[i]) for i in range(28, len(values))])
    return features, np.asarray(values[28:], dtype=float)


def forecast(values, dates, horizon=HORIZON, method=MODEL):
    if horizon < 1 or method not in METHODS:
        raise ValueError("Choose a positive horizon and a supported method.")
    history = list(np.asarray(values, dtype=float))
    if len(history) != len(dates) or len(history) < 28:
        raise ValueError("Forecast dates and past observations must match.")
    feature_row(history, dates[-1])
    estimator = None
    if method == MODEL and sum(history) > 0:
        x, y = training_data(history, dates)
        estimator = HistGradientBoostingRegressor(
            loss="poisson", max_iter=80, learning_rate=0.08,
            max_leaf_nodes=8, min_samples_leaf=12,
            l2_regularization=4, early_stopping=False, random_state=37,
        )
        with threadpool_limits(limits=1):
            estimator.fit(x, y)
    predicted = []
    for step in range(horizon):
        day = dates[-1] + timedelta(days=step + 1)
        if method == NAIVE:
            value = history[-7]
        elif method == MEAN:
            value = float(np.mean([history[-lag] for lag in (7, 14, 21, 28)]))
        elif estimator is None:
            value = 0.0
        else:
            with threadpool_limits(limits=1):
                value = float(estimator.predict(feature_row(history, day).reshape(1, -1))[0])
        value = max(0.0, float(value))
        if not np.isfinite(value):
            raise ValueError("The forecast produced a non-finite value.")
        predicted.append(value)
        history.append(value)
    return np.asarray(predicted)


def backtest(values, dates, start, end):
    if start < 70 or end > len(values) or start >= end:
        raise ValueError("Backtest bounds must leave at least 70 past observations.")
    results = {method: [] for method in METHODS}
    for origin in range(start, end, HORIZON):
        size = min(HORIZON, end - origin)
        for method in results:
            results[method].extend(
                forecast(values[:origin], dates[:origin], size, method).tolist()
            )
    return {key: np.asarray(value) for key, value in results.items()}


def score(actual, predicted):
    actual, predicted = np.asarray(actual, dtype=float), np.asarray(predicted, dtype=float)
    if actual.shape != predicted.shape or actual.size == 0:
        raise ValueError("Scoring needs matching non-empty arrays.")
    if not np.isfinite(actual).all() or not np.isfinite(predicted).all():
        raise ValueError("Scoring needs finite values.")
    error = np.abs(actual - predicted)
    total = float(actual.sum())
    return {
        "mae": round(float(error.mean()), 3),
        "wape": round(100 * float(error.sum()) / total, 2) if total > 0 else None,
    }


def product_report(sku, name, values, dates):
    validation_start, holdout_start = len(values) - 56, len(values) - 28
    validation = backtest(values, dates, validation_start, holdout_start)
    validation_actual = values[validation_start:holdout_start]
    validation_scores = {key: score(validation_actual, value) for key, value in validation.items()}
    baseline_method = min((NAIVE, MEAN), key=lambda method: validation_scores[method]["mae"])
    selected = MODEL if validation_scores[MODEL]["mae"] < validation_scores[baseline_method]["mae"] else baseline_method
    holdout = backtest(values, dates, holdout_start, len(values))
    actual = values[holdout_start:]
    future = {key: forecast(values, dates, method=key) for key in METHODS}
    radius = float(np.quantile(np.abs(validation_actual - validation[selected]), 0.8))
    coverage = 100 * float(np.mean(np.abs(actual - holdout[selected]) <= radius))
    return {
        "sku": str(sku), "name": str(name), "selected_method": selected,
        "baseline_method": baseline_method,
        "validation": validation_scores,
        "holdout": {key: score(actual, value) for key, value in holdout.items()},
        "validation_error_radius": round(radius, 2),
        "holdout_range_coverage": round(coverage, 1),
        "history": [
            {"date": day.date().isoformat(), "actual": float(value)}
            for day, value in zip(dates[-84:], values[-84:])
        ],
        "evaluation": [
            {
                "date": day.date().isoformat(), "actual": float(value),
                "model": round(float(holdout[MODEL][i]), 2),
                "baseline": round(float(holdout[baseline_method][i]), 2),
            }
            for i, (day, value) in enumerate(zip(dates[holdout_start:], actual))
        ],
        "forecast": [
            {
                "date": (dates[-1] + timedelta(days=i + 1)).date().isoformat(),
                "selected": round(float(future[selected][i]), 2),
                "model": round(float(future[MODEL][i]), 2),
                "baseline": round(float(future[baseline_method][i]), 2),
                "lower": round(max(0, float(future[selected][i]) - radius), 2),
                "upper": round(float(future[selected][i]) + radius, 2),
            }
            for i in range(HORIZON)
        ],
    }
