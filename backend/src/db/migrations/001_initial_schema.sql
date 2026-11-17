-- =====================================================================
-- 001 - Initial schema for the Complete Stock Management System
-- PostgreSQL 13+ (uses gen_random_uuid()).
-- Conventions:
--   * All timestamps are timestamptz stored in UTC.
--   * Business dates (transaction/delivery dates) are `date` values on the
--     Africa/Nairobi calendar.
--   * Quantities are whole numbers of BOX (integer).
--   * Money is KES numeric(14,2).
--   * Every foreign key is DEFERRABLE so a restore can load tables in any order.
--   * stock_movements (ledger) and audit_log_corrections are append-only
--     (enforced by triggers).
-- =====================================================================

-- ---------------------------------------------------------------- Admin
CREATE TABLE admins (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username             text NOT NULL,
    normalized_username  text NOT NULL UNIQUE,
    password_hash        text NOT NULL,
    security_stamp       uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash           text NOT NULL UNIQUE,
    admin_id             uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    security_stamp       uuid NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    last_seen_at         timestamptz NOT NULL DEFAULT now(),
    expires_at           timestamptz NOT NULL,
    absolute_expires_at  timestamptz NOT NULL,
    revoked_at           timestamptz,
    ip_address           text,
    user_agent           text
);
CREATE INDEX ix_admin_sessions_admin ON admin_sessions(admin_id);

CREATE TABLE admin_preferences (
    admin_id     uuid PRIMARY KEY REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    theme        text NOT NULL DEFAULT 'System' CHECK (theme IN ('Light', 'Dark', 'System')),
    row_version  integer NOT NULL DEFAULT 1,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Files / settings
CREATE TABLE stored_files (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind           text NOT NULL CHECK (kind IN ('Logo')),
    original_name  text,
    content_type   text NOT NULL,
    size_bytes     integer NOT NULL CHECK (size_bytes > 0),
    sha256         text NOT NULL,
    storage_key    text NOT NULL UNIQUE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    detached_at    timestamptz            -- set when no longer the current logo
);

CREATE TABLE company_settings (
    id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    company_name   text NOT NULL DEFAULT 'My Company',
    phone          text,
    email          text,
    address        text,
    logo_file_id   uuid REFERENCES stored_files(id) DEFERRABLE INITIALLY IMMEDIATE,
    row_version    integer NOT NULL DEFAULT 1,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);

-- ---------------------------------------------------------------- Numbering
CREATE TABLE document_counters (
    prefix      text PRIMARY KEY,
    last_value  bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);
INSERT INTO document_counters(prefix) VALUES
  ('SIN'), ('SOUT'), ('ORD'), ('RET'), ('ADJ'), ('TRF'), ('REC');

-- ---------------------------------------------------------------- Products
CREATE TABLE products (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL CHECK (length(btrim(name)) > 0),
    name_normalized  text NOT NULL UNIQUE,         -- lower(btrim(name)); unique incl. inactive
    minimum_stock    integer NOT NULL CHECK (minimum_stock >= 0),
    selling_price    numeric(14,2) CHECK (selling_price IS NULL OR selling_price >= 0),
    status           text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    opening_stock    integer NOT NULL CHECK (opening_stock >= 0),   -- original value
    row_version      integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);

-- Cached balances (source of truth = stock_movements ledger)
CREATE TABLE product_balances (
    product_id   uuid PRIMARY KEY REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    available    integer NOT NULL DEFAULT 0 CHECK (available >= 0),
    damaged      integer NOT NULL DEFAULT 0 CHECK (damaged >= 0),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_edit_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    old_values  jsonb NOT NULL,
    new_values  jsonb NOT NULL,
    reason      text NOT NULL,
    admin_id    uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_product_edit_history_product ON product_edit_history(product_id, created_at);

CREATE TABLE product_price_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    old_price   numeric(14,2),
    new_price   numeric(14,2),
    reason      text NOT NULL,
    admin_id    uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_product_price_history_product ON product_price_history(product_id, created_at);

CREATE TABLE opening_stock_corrections (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id           uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    previous_effective   integer NOT NULL,
    new_effective        integer NOT NULL CHECK (new_effective >= 0),
    delta                integer NOT NULL CHECK (delta <> 0),
    reason               text NOT NULL,
    admin_id             uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Customers
CREATE TABLE customers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name    text NOT NULL CHECK (length(btrim(full_name)) > 0),
    phone        text,
    email        text,
    location     text,
    notes        text,
    row_version  integer NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX ix_customers_name ON customers(lower(full_name));

CREATE TABLE customer_edit_history (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  uuid NOT NULL REFERENCES customers(id) DEFERRABLE INITIALLY IMMEDIATE,
    old_values   jsonb NOT NULL,
    new_values   jsonb NOT NULL,
    reason       text,
    admin_id     uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Receipts
CREATE TABLE receipts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number    text NOT NULL UNIQUE,
    receipt_type      text NOT NULL CHECK (receipt_type IN
                        ('StockIn', 'SampleGift', 'WarehouseTransfer', 'Return', 'Adjustment', 'DamagedStockAction', 'CustomerOrder')),
    source_type       text NOT NULL,
    source_id         uuid NOT NULL,
    source_number     text NOT NULL,
    source_version    integer NOT NULL DEFAULT 1,
    status            text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Superseded')),
    superseded_by_id  uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    company_snapshot  jsonb NOT NULL,
    logo_file_id      uuid REFERENCES stored_files(id) DEFERRABLE INITIALLY IMMEDIATE,
    payload           jsonb NOT NULL,
    business_date     date NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX ix_receipts_source ON receipts(source_type, source_id);

-- ---------------------------------------------------------------- Stock In
CREATE TABLE stock_ins (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number             text NOT NULL,
    version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    status             text NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Superseded')),
    supersedes_id      uuid REFERENCES stock_ins(id) DEFERRABLE INITIALLY IMMEDIATE,
    superseded_by_id   uuid REFERENCES stock_ins(id) DEFERRABLE INITIALLY IMMEDIATE,
    stock_in_type      text NOT NULL CHECK (stock_in_type IN ('NewStock', 'WarehouseTransferIn')),
    source_warehouse   text,
    business_date      date NOT NULL,
    correction_reason  text,
    receipt_id         uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (number, version),
    CHECK (stock_in_type <> 'WarehouseTransferIn' OR length(btrim(coalesce(source_warehouse, ''))) > 0)
);
CREATE UNIQUE INDEX ux_stock_ins_current ON stock_ins(number) WHERE status = 'Posted';
CREATE INDEX ix_stock_ins_date ON stock_ins(business_date);

CREATE TABLE stock_in_lines (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_in_id            uuid NOT NULL REFERENCES stock_ins(id) DEFERRABLE INITIALLY IMMEDIATE,
    line_no                integer NOT NULL,
    product_id             uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_name_snapshot  text NOT NULL,
    quantity               integer NOT NULL CHECK (quantity > 0),
    UNIQUE (stock_in_id, product_id)
);

-- ---------------------------------------------------------------- Orders
CREATE TABLE orders (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number                  text NOT NULL UNIQUE,
    customer_id             uuid NOT NULL REFERENCES customers(id) DEFERRABLE INITIALLY IMMEDIATE,
    customer_name_snapshot  text NOT NULL,
    order_date              date NOT NULL,
    status                  text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'PartiallyCompleted', 'Completed')),
    completed_at            timestamptz,
    receipt_id              uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    row_version             integer NOT NULL DEFAULT 1,
    created_at              timestamptz NOT NULL DEFAULT now(),
    created_by              uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    updated_by              uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX ix_orders_customer ON orders(customer_id);
CREATE INDEX ix_orders_date ON orders(order_date);

CREATE TABLE order_lines (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id               uuid NOT NULL REFERENCES orders(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_id             uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_name_snapshot  text NOT NULL,
    ordered_quantity       integer NOT NULL CHECK (ordered_quantity > 0),
    delivered_quantity     integer NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    created_at             timestamptz NOT NULL DEFAULT now(),
    CHECK (delivered_quantity <= ordered_quantity),
    UNIQUE (order_id, product_id)
);

CREATE TABLE order_edit_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    uuid NOT NULL REFERENCES orders(id) DEFERRABLE INITIALLY IMMEDIATE,
    old_values  jsonb NOT NULL,
    new_values  jsonb NOT NULL,
    reason      text,
    admin_id    uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Stock Out
CREATE TABLE stock_outs (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number                 text NOT NULL,
    version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    status                 text NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Superseded')),
    supersedes_id          uuid REFERENCES stock_outs(id) DEFERRABLE INITIALLY IMMEDIATE,
    superseded_by_id       uuid REFERENCES stock_outs(id) DEFERRABLE INITIALLY IMMEDIATE,
    out_type               text NOT NULL CHECK (out_type IN ('CustomerDelivery', 'Sample', 'Gift', 'WarehouseTransfer')),
    recipient_name         text,
    destination_warehouse  text,
    transfer_number        text,
    order_id               uuid REFERENCES orders(id) DEFERRABLE INITIALLY IMMEDIATE,
    business_date          date NOT NULL,
    correction_reason      text,
    receipt_id             uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at             timestamptz NOT NULL DEFAULT now(),
    created_by             uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (number, version),
    CHECK (out_type NOT IN ('Sample', 'Gift') OR length(btrim(coalesce(recipient_name, ''))) > 0),
    CHECK (out_type <> 'WarehouseTransfer' OR (length(btrim(coalesce(destination_warehouse, ''))) > 0 AND transfer_number IS NOT NULL)),
    CHECK (out_type <> 'CustomerDelivery' OR order_id IS NOT NULL)
);
CREATE UNIQUE INDEX ux_stock_outs_current ON stock_outs(number) WHERE status = 'Posted';
CREATE INDEX ix_stock_outs_date ON stock_outs(business_date);
CREATE INDEX ix_stock_outs_transfer ON stock_outs(transfer_number) WHERE transfer_number IS NOT NULL;

CREATE TABLE stock_out_lines (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_out_id           uuid NOT NULL REFERENCES stock_outs(id) DEFERRABLE INITIALLY IMMEDIATE,
    line_no                integer NOT NULL,
    product_id             uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_name_snapshot  text NOT NULL,
    quantity               integer NOT NULL CHECK (quantity > 0),
    UNIQUE (stock_out_id, product_id)
);

-- ---------------------------------------------------------------- Deliveries
CREATE TABLE deliveries (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       uuid NOT NULL REFERENCES orders(id) DEFERRABLE INITIALLY IMMEDIATE,
    stock_out_id   uuid NOT NULL UNIQUE REFERENCES stock_outs(id) DEFERRABLE INITIALLY IMMEDIATE,
    delivery_date  date NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX ix_deliveries_order ON deliveries(order_id);

CREATE TABLE delivery_lines (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id    uuid NOT NULL REFERENCES deliveries(id) DEFERRABLE INITIALLY IMMEDIATE,
    order_line_id  uuid NOT NULL REFERENCES order_lines(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_id     uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    quantity       integer NOT NULL CHECK (quantity > 0),
    UNIQUE (delivery_id, order_line_id)
);

-- ---------------------------------------------------------------- Returns
CREATE TABLE returns (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number                  text NOT NULL,
    version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    status                  text NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Superseded')),
    supersedes_id           uuid REFERENCES returns(id) DEFERRABLE INITIALLY IMMEDIATE,
    superseded_by_id        uuid REFERENCES returns(id) DEFERRABLE INITIALLY IMMEDIATE,
    return_mode             text NOT NULL CHECK (return_mode IN ('AgainstOrder', 'Direct')),
    customer_id             uuid NOT NULL REFERENCES customers(id) DEFERRABLE INITIALLY IMMEDIATE,
    customer_name_snapshot  text NOT NULL,
    order_id                uuid REFERENCES orders(id) DEFERRABLE INITIALLY IMMEDIATE,
    order_number_snapshot   text,
    reason                  text NOT NULL CHECK (length(btrim(reason)) > 0),
    business_date           date NOT NULL,
    correction_reason       text,
    receipt_id              uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at              timestamptz NOT NULL DEFAULT now(),
    created_by              uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (number, version),
    CHECK (return_mode <> 'AgainstOrder' OR order_id IS NOT NULL)
);
CREATE UNIQUE INDEX ux_returns_current ON returns(number) WHERE status = 'Posted';
CREATE INDEX ix_returns_order ON returns(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ix_returns_date ON returns(business_date);

CREATE TABLE return_lines (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id              uuid NOT NULL REFERENCES returns(id) DEFERRABLE INITIALLY IMMEDIATE,
    line_no                integer NOT NULL,
    product_id             uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_name_snapshot  text NOT NULL,
    quantity               integer NOT NULL CHECK (quantity > 0),
    condition              text NOT NULL CHECK (condition IN ('Good', 'Damaged')),
    UNIQUE (return_id, product_id, condition)
);

-- ---------------------------------------------------------------- Adjustments
CREATE TABLE adjustments (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number                 text NOT NULL,
    version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    status                 text NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Superseded')),
    supersedes_id          uuid REFERENCES adjustments(id) DEFERRABLE INITIALLY IMMEDIATE,
    superseded_by_id       uuid REFERENCES adjustments(id) DEFERRABLE INITIALLY IMMEDIATE,
    direction              text NOT NULL CHECK (direction IN ('Increase', 'Decrease')),
    product_id             uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_name_snapshot  text NOT NULL,
    quantity               integer NOT NULL CHECK (quantity > 0),
    reason                 text NOT NULL CHECK (length(btrim(reason)) > 0),
    available_before       integer NOT NULL,
    available_after        integer NOT NULL CHECK (available_after >= 0),
    business_date          date NOT NULL,
    correction_reason      text,
    receipt_id             uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at             timestamptz NOT NULL DEFAULT now(),
    created_by             uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (number, version)
);
CREATE UNIQUE INDEX ux_adjustments_current ON adjustments(number) WHERE status = 'Posted';
CREATE INDEX ix_adjustments_date ON adjustments(business_date);

-- ---------------------------------------------------------------- Damaged stock actions
CREATE TABLE damaged_stock_actions (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type            text NOT NULL CHECK (action_type IN ('MarkAsGood', 'RemoveFromDamaged')),
    product_id             uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    product_name_snapshot  text NOT NULL,
    quantity               integer NOT NULL CHECK (quantity > 0),
    reason                 text NOT NULL CHECK (length(btrim(reason)) > 0),
    damaged_before         integer NOT NULL,
    damaged_after          integer NOT NULL CHECK (damaged_after >= 0),
    available_before       integer NOT NULL,
    available_after        integer NOT NULL CHECK (available_after >= 0),
    business_date          date NOT NULL,
    receipt_id             uuid REFERENCES receipts(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at             timestamptz NOT NULL DEFAULT now(),
    created_by             uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX ix_damaged_actions_product ON damaged_stock_actions(product_id);
CREATE INDEX ix_damaged_actions_date ON damaged_stock_actions(business_date);

-- ---------------------------------------------------------------- Ledger (append-only)
CREATE TABLE stock_movements (
    id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    product_id       uuid NOT NULL REFERENCES products(id) DEFERRABLE INITIALLY IMMEDIATE,
    movement_type    text NOT NULL CHECK (movement_type IN (
                        'OpeningStock', 'OpeningStockCorrection',
                        'StockInNew', 'StockInTransfer',
                        'GoodReturn', 'DamagedReturn',
                        'AdjustmentIn', 'AdjustmentOut',
                        'StockOutDelivery', 'StockOutSample', 'StockOutGift', 'StockOutTransfer',
                        'MarkAsGood', 'RemoveFromDamaged')),
    available_delta  integer NOT NULL DEFAULT 0,
    damaged_delta    integer NOT NULL DEFAULT 0,
    is_reversal      boolean NOT NULL DEFAULT false,
    source_type      text NOT NULL,
    source_id        uuid NOT NULL,
    source_number    text,
    source_version   integer NOT NULL DEFAULT 1,
    business_date    date NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    admin_id         uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    CHECK (available_delta <> 0 OR damaged_delta <> 0)
);
CREATE INDEX ix_stock_movements_product ON stock_movements(product_id, id);
CREATE INDEX ix_stock_movements_source ON stock_movements(source_type, source_id);
CREATE INDEX ix_stock_movements_date ON stock_movements(business_date);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- Audit
CREATE TABLE audit_logs (
    id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    admin_id      uuid REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    actor         text NOT NULL,                -- username or 'system'
    action        text NOT NULL,
    entity_type   text NOT NULL,
    entity_id     text,
    request_id    text,
    ip_address    text,
    description   text,
    note          text,
    old_data      jsonb,
    new_data      jsonb,
    is_deleted    boolean NOT NULL DEFAULT false,
    deleted_at    timestamptz,
    edited_at     timestamptz
);
CREATE INDEX ix_audit_logs_time ON audit_logs(occurred_at DESC);
CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Immutable correction trail for audit-log edits/deletions
CREATE TABLE audit_log_corrections (
    id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    audit_log_id  bigint NOT NULL REFERENCES audit_logs(id) DEFERRABLE INITIALLY IMMEDIATE,
    operation     text NOT NULL CHECK (operation IN ('Edit', 'Delete')),
    old_values    jsonb NOT NULL,
    new_values    jsonb NOT NULL,
    reason        text NOT NULL CHECK (length(btrim(reason)) > 0),
    admin_id      uuid NOT NULL REFERENCES admins(id) DEFERRABLE INITIALLY IMMEDIATE,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_audit_log_corrections_append_only
  BEFORE UPDATE OR DELETE ON audit_log_corrections
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Audit rows may be soft-deleted / annotated but never physically deleted
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- Idempotency
CREATE TABLE idempotency_records (
    admin_id         uuid NOT NULL,
    idempotency_key  text NOT NULL,
    method           text NOT NULL,
    path             text NOT NULL,
    request_hash     text NOT NULL,
    state            text NOT NULL CHECK (state IN ('Processing', 'Completed')),
    response_status  integer,
    response_body    jsonb,
    location         text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    PRIMARY KEY (admin_id, idempotency_key)
);
CREATE INDEX ix_idempotency_expires ON idempotency_records(expires_at);

-- ---------------------------------------------------------------- Backups / reconciliation
CREATE TABLE backup_logs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation         text NOT NULL CHECK (operation IN ('Backup', 'Restore')),
    trigger_type      text NOT NULL CHECK (trigger_type IN ('Manual', 'Automatic', 'PreRestore', 'Restore')),
    status            text NOT NULL CHECK (status IN ('Running', 'Succeeded', 'Failed')),
    started_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    error             text,
    actor_admin_id    uuid,
    actor             text NOT NULL,
    storage_provider  text,
    storage_key       text,
    size_bytes        bigint,
    sha256            text,
    schema_version    text,
    source_backup_id  uuid,     -- for Restore: the backup that was restored
    details           jsonb
);
CREATE INDEX ix_backup_logs_started ON backup_logs(started_at DESC);

CREATE TABLE reconciliation_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at          timestamptz NOT NULL DEFAULT now(),
    trigger_type    text NOT NULL,
    products_checked integer NOT NULL,
    mismatch_count  integer NOT NULL,
    mismatches      jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX ix_reconciliation_runs_time ON reconciliation_runs(run_at DESC);
