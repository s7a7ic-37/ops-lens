import unittest

import numpy as np
import pandas as pd

from forecast import MEAN, MODEL, NAIVE, backtest, feature_row, forecast, score
from pipeline import build_report, classify, normalize


def transactions():
    return pd.DataFrame([
        ["100001", "85123A", "Item", 2, "2011-01-01", 4.0, "United Kingdom"],
        ["c100002", "85123A", "Item", -1, "2011-01-02", 4.0, "United Kingdom"],
        ["A100003", "85123A", "Item", -1, "2011-01-03", 4.0, "United Kingdom"],
        ["C100004", "85123A", "Item", 1, "2011-01-04", 4.0, "United Kingdom"],
        ["100005", "POST", "Postage", 1, "2011-01-05", 4.0, "United Kingdom"],
        ["100006", "85123A", "Item", 1.5, "2011-01-06", 4.0, "United Kingdom"],
        ["100007", "85123A", "Item", 1, "2011-01-07", 0.0, "United Kingdom"],
        ["100008", "85123A", "Item", 1, "bad-date", 4.0, "United Kingdom"],
    ], columns=["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice", "Country"])


class DataQualityTests(unittest.TestCase):
    def test_classification_separates_orders_cancellations_and_input_issues(self):
        frame = transactions()
        original = frame.copy(deep=True)
        actual = classify(frame)
        self.assertEqual(actual.row_type.tolist(), [
            "order", "cancellation", "negative_adjustment", "cancellation_mismatch",
            "non_product", "invalid", "invalid", "invalid",
        ])
        pd.testing.assert_frame_equal(frame, original)

    def test_missing_columns_and_non_finite_values_are_rejected_or_held(self):
        with self.assertRaisesRegex(ValueError, "Missing transaction columns"):
            normalize(pd.DataFrame({"Quantity": [1]}))
        frame = transactions().iloc[[0]].copy()
        frame["UnitPrice"] = np.inf
        self.assertEqual(classify(frame).iloc[0].row_type, "invalid")

    def test_audit_totals_balance_and_uncertain_duplicates_are_retained(self):
        days = pd.date_range("2024-01-01", periods=181, freq="D")
        frame = pd.DataFrame({
            "InvoiceNo": [str(100000 + i) for i in range(181)],
            "StockCode": "85123A", "Description": "Synthetic weekly item",
            "Quantity": [10 + day.weekday() * 3 for day in days],
            "InvoiceDate": days, "UnitPrice": 2.0, "Country": "United Kingdom",
        })
        frame = pd.concat([frame, frame.iloc[[0]]], ignore_index=True)
        report = build_report(frame)
        audit = report["quality"]
        self.assertEqual(audit["input_rows"], 182)
        self.assertEqual(audit["final_date_rows"], 1)
        self.assertEqual(audit["duplicate_candidates_retained"], 1)
        self.assertEqual(sum(audit["row_types"].values()), audit["scoped_rows"])
        self.assertEqual(audit["outside_country"] + audit["final_date_rows"] + audit["scoped_rows"], audit["input_rows"])
        self.assertNotEqual(report["products"][0]["selected_method"], MODEL)
        self.assertEqual(len(report["products"][0]["evaluation"]), 28)
        self.assertEqual(len(report["products"][0]["forecast"]), 7)


class ForecastTests(unittest.TestCase):
    def test_features_reference_only_earlier_values(self):
        history = np.arange(28, dtype=float)
        features = feature_row(history, pd.Timestamp("2024-01-29"))
        self.assertEqual(features[0], 27)
        self.assertEqual(features[1], 21)
        self.assertEqual(features[3], 0)
        self.assertEqual(features[4], np.mean(history[-7:]))

    def test_changing_future_observations_cannot_change_an_earlier_forecast(self):
        dates = pd.date_range("2024-01-01", periods=130, freq="D")
        values = np.array([20 + day.weekday() * 3 for day in dates], dtype=float)
        changed = values.copy()
        changed[100:] = 100000
        original = backtest(values, dates, 100, 107)
        altered = backtest(changed, dates, 100, 107)
        for method in original:
            np.testing.assert_allclose(original[method], altered[method])

    def test_simple_baselines_reproduce_their_past_weekday_values(self):
        dates = pd.date_range("2024-01-01", periods=28, freq="D")
        values = np.arange(28, dtype=float)
        np.testing.assert_allclose(forecast(values, dates, method=NAIVE), values[-7:])
        np.testing.assert_allclose(forecast(values, dates, method=MEAN), values.reshape(4, 7).mean(axis=0))

    def test_metrics_handle_zero_demand_and_invalid_inputs(self):
        self.assertEqual(score([0, 0], [2, 2]), {"mae": 2.0, "wape": None})
        with self.assertRaises(ValueError):
            score([1, 2], [1])
        with self.assertRaises(ValueError):
            feature_row([float("nan")] * 28, pd.Timestamp("2024-01-29"))


if __name__ == "__main__":
    unittest.main()
