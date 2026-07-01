SELECT *,
  CAST(invoice_date AS DATE) AS day,
  CASE
    WHEN invoice IS NULL OR invoice = '' OR invoice_date IS NULL
      OR quantity IS NULL OR NOT isfinite(quantity) OR quantity != floor(quantity)
      OR unit_price IS NULL OR NOT isfinite(unit_price) OR unit_price <= 0
      OR quantity = 0 THEN 'invalid'
    WHEN sku IS NULL OR NOT regexp_full_match(sku, '[0-9]{5}[A-Z]{0,2}')
      THEN 'non_product'
    WHEN starts_with(invoice, 'C') AND quantity < 0 THEN 'cancellation'
    WHEN starts_with(invoice, 'C') THEN 'cancellation_mismatch'
    WHEN quantity < 0 THEN 'negative_adjustment'
    ELSE 'order'
  END AS row_type
FROM raw
