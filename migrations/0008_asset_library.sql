-- 0008_asset_library.sql
-- Asset Library upgrade: add smart metadata columns to attachments and assets tables.
-- All changes are additive/nullable — no existing data is removed or broken.

-- ── attachments table (Document Hub / Asset Library records) ─────────────────

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS use_case       text,
  ADD COLUMN IF NOT EXISTS visibility     text NOT NULL DEFAULT 'customer_safe',
  ADD COLUMN IF NOT EXISTS asset_type     text,
  ADD COLUMN IF NOT EXISTS recommended_for text,
  ADD COLUMN IF NOT EXISTS is_favorite    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attached_at timestamp;

-- ── assets table (email picker / knowledge-base assets) ──────────────────────

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS use_case       text,
  ADD COLUMN IF NOT EXISTS visibility     text NOT NULL DEFAULT 'customer_safe',
  ADD COLUMN IF NOT EXISTS asset_type     text,
  ADD COLUMN IF NOT EXISTS recommended_for text,
  ADD COLUMN IF NOT EXISTS is_favorite    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attached_at timestamp;

-- ── Auto-classify attachments by use_case ────────────────────────────────────
-- Uses filename + existing category heuristics.
-- investor/financial/private docs → internal, visibility → investor_only.
-- All others default customer_safe.

UPDATE attachments SET use_case = CASE
  WHEN LOWER(original_name) ~ '(investor|use.of.proceeds|use_of_proceeds|financial|board|private|confidential)'
    THEN 'internal'
  WHEN LOWER(original_name) ~ '(quote|invoice|proposal|pro.forma|proforma)'
    OR category IN ('quote_proposal', 'invoice_billing')
    THEN 'quotes'
  WHEN LOWER(original_name) ~ '(pricing|price|cost|roi|comparison|onepager|one.pager|deck|marina.pitch|marina_pitch|sales|pitch|brochure)'
    THEN 'sales'
  WHEN LOWER(original_name) ~ '(pedestal|connector|spec|cut.sheet|cutsheet|install|installation|hardware|software|safety|compliance|certification|lab)'
    OR category IN ('drawing_spec', 'install_doc', 'certification', 'lab_report', 'procurement_po')
    THEN 'product'
  WHEN LOWER(original_name) ~ '(demo|photo|image|testimonial|news|case.study|case_study|thumbnail|deployment.photo|deployment_photo)'
    OR category = 'deployment_photo'
    THEN 'proof'
  WHEN LOWER(original_name) ~ '(logo|brand|social|email.thumbnail|email_thumbnail)'
    THEN 'brand'
  ELSE 'general'
END
WHERE use_case IS NULL;

UPDATE attachments SET visibility = CASE
  WHEN use_case = 'internal'
    OR LOWER(original_name) ~ '(investor|use.of.proceeds|use_of_proceeds|financial|board|private|confidential)'
    THEN 'investor_only'
  ELSE 'customer_safe'
END
WHERE visibility = 'customer_safe';

-- ── Auto-classify assets by use_case ─────────────────────────────────────────

UPDATE assets SET use_case = CASE
  WHEN LOWER(original_name) ~ '(investor|use.of.proceeds|use_of_proceeds|financial|board|private|confidential)'
    THEN 'internal'
  WHEN category = 'quotes'
    OR LOWER(original_name) ~ '(quote|invoice|proposal|pro.forma|proforma)'
    THEN 'quotes'
  WHEN LOWER(original_name) ~ '(pricing|price|cost|roi|comparison|onepager|one.pager|deck|marina.pitch|marina_pitch|sales|pitch|brochure)'
    THEN 'sales'
  WHEN LOWER(original_name) ~ '(pedestal|connector|spec|cut.sheet|cutsheet|install|installation|hardware|safety|compliance)'
    THEN 'product'
  WHEN LOWER(original_name) ~ '(demo|photo|testimonial|case.study|case_study|thumbnail)'
    THEN 'proof'
  WHEN LOWER(original_name) ~ '(logo|brand|social)'
    THEN 'brand'
  ELSE 'general'
END
WHERE use_case IS NULL;

UPDATE assets SET visibility = CASE
  WHEN use_case = 'internal'
    OR LOWER(original_name) ~ '(investor|use.of.proceeds|use_of_proceeds|financial|board|private|confidential)'
    THEN 'investor_only'
  ELSE 'customer_safe'
END
WHERE visibility = 'customer_safe';
