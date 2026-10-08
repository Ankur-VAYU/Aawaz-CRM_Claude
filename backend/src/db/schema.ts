import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// All money is stored as integer paise (₹1 = 100) to avoid floating-point errors.
const money = (name: string) => bigint(name, { mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);

/* ---------- Accounts ---------- */

/** A shopkeeper who signs in with their (WhatsApp) phone number. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 16 }).notNull(), // E.164, e.g. +919876543210
    name: varchar('name', { length: 120 }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_phone_unique').on(t.phone)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 16 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_phone_idx').on(t.phone, t.createdAt)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 of the opaque token; the raw token is never stored.
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    // All tokens issued from one login share a family so reuse can revoke the whole chain.
    familyId: uuid('family_id').notNull(),
    deviceName: varchar('device_name', { length: 120 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_unique').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

/* ---------- Store (dukaan) ---------- */

export const gstScheme = pgEnum('gst_scheme', ['regular', 'composition']);
// hi = Hindi (Devanagari), hinglish = romanised Hindi, en = English
export const storeLanguage = pgEnum('store_language', ['hi', 'hinglish', 'en']);
export const replyStyle = pgEnum('reply_style', ['voice_text', 'text']);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }).notNull(),
    ownerName: varchar('owner_name', { length: 120 }).notNull(),
    city: varchar('city', { length: 80 }).notNull(),
    state: varchar('state', { length: 60 }),
    pincode: varchar('pincode', { length: 6 }),
    givesCredit: boolean('gives_credit').notNull().default(true),
    gstin: varchar('gstin', { length: 15 }),
    pan: varchar('pan', { length: 10 }),
    legalName: varchar('legal_name', { length: 160 }),
    // Printed on invoices.
    address: varchar('address', { length: 200 }),
    // regular -> tax invoices with CGST/SGST; composition -> "bill of supply" without tax.
    gstScheme: gstScheme('gst_scheme'),
    // Kirana prices are usually MRP, i.e. tax-inclusive.
    pricesIncludeTax: boolean('prices_include_tax').notNull().default(true),
    language: storeLanguage('language').notNull().default('hinglish'),
    replyStyle: replyStyle('reply_style').notNull().default('voice_text'),
    preferencesSetAt: timestamp('preferences_set_at', { withTimezone: true }),
    timezone: varchar('timezone', { length: 40 }).notNull().default('Asia/Kolkata'),
    // Local time (HH:MM) at which the daily summary is sent to the owner.
    summaryTime: varchar('summary_time', { length: 5 }).notNull().default('21:00'),
    lastSummaryDate: date('last_summary_date', { mode: 'string' }),
    // Shopkeeper allows sharing commands the app misunderstood, to improve voice understanding.
    voiceLogOptIn: boolean('voice_log_opt_in').notNull().default(false),
    // Invoice numbers restart every financial year (April–March), e.g. "2026-27/0001".
    billCounter: integer('bill_counter').notNull().default(0),
    billCounterFy: varchar('bill_counter_fy', { length: 7 }),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('stores_owner_unique').on(t.ownerId)],
);

/* ---------- Catalogue (saamaan) ---------- */

export const itemUnit = pgEnum('item_unit', ['kg', 'g', 'l', 'ml', 'pc']);

/**
 * One sellable variant, e.g. "Atta 5 kg" (a 5 kg bag) or "Sarson tel 500 ml".
 * Variants of the same product share `name`; `unitSize` + `unit` describe one pack.
 * `stock` counts packs.
 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    // Case-insensitive key for uniqueness and upserts.
    nameKey: varchar('name_key', { length: 80 }).generatedAlwaysAs(sql`lower(name)`),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    unit: itemUnit('unit').notNull().default('pc'),
    unitSize: qty('unit_size').notNull().default(1),
    price: money('price'), // paise per pack; null = not known yet
    hsnCode: varchar('hsn_code', { length: 8 }),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2, mode: 'number' }), // percent; null = not set
    stock: qty('stock').notNull().default(0),
    stockLabel: varchar('stock_label', { length: 20 }).notNull().default('pc'), // e.g. bag, pc
    lowStockThreshold: qty('low_stock_threshold').notNull().default(5),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('items_store_idx').on(t.storeId),
    uniqueIndex('items_store_variant_unique').on(t.storeId, t.nameKey, t.unit, t.unitSize),
    check('items_unit_size_positive', sql`${t.unitSize} > 0`),
    check('items_price_non_negative', sql`${t.price} is null or ${t.price} >= 0`),
  ],
);

/** Stock received ("maal aaya"), optionally from a named supplier. */
export const stockReceipts = pgTable(
  'stock_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    supplier: varchar('supplier', { length: 120 }),
    note: varchar('note', { length: 200 }),
    // Sum of quantity × cost price for lines with a cost price (paise).
    totalCost: money('total_cost').notNull().default(0),
    clientId: varchar('client_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('stock_receipts_store_idx').on(t.storeId, t.createdAt), uniqueIndex('stock_receipts_client_unique').on(t.storeId, t.clientId)],
);

export const stockReceiptItems = pgTable(
  'stock_receipt_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => stockReceipts.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    quantity: qty('quantity').notNull(),
    costPrice: money('cost_price'), // per pack, paise
  },
  (t) => [index('stock_receipt_items_receipt_idx').on(t.receiptId)],
);

/* ---------- Customers (grahak) & khata ---------- */

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 16 }),
    // Other ways this name was heard ("raam" for Ram Kumar), learned from the shopkeeper's corrections.
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    // Outstanding udhaar in paise (positive = customer owes the store). Kept in sync with ledger_entries.
    balance: money('balance').notNull().default(0),
    totalPurchases: money('total_purchases').notNull().default(0),
    totalPaid: money('total_paid').notNull().default(0),
    lastPurchaseAt: timestamp('last_purchase_at', { withTimezone: true }),
    // Unguessable token for the customer's read-only khata link.
    shareToken: varchar('share_token', { length: 64 }).notNull(),
    // Customer's GSTIN for B2B tax invoices.
    gstin: varchar('gstin', { length: 15 }),
    // WhatsApp messages are only sent after consent is recorded (and not opted out since).
    messagingConsentAt: timestamp('messaging_consent_at', { withTimezone: true }),
    messagingConsentSource: varchar('messaging_consent_source', { length: 30 }),
    messagesOptedOutAt: timestamp('messages_opted_out_at', { withTimezone: true }),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customers_store_idx').on(t.storeId),
    uniqueIndex('customers_store_phone_unique').on(t.storeId, t.phone),
    uniqueIndex('customers_share_token_unique').on(t.shareToken),
  ],
);

export const billStatus = pgEnum('bill_status', ['draft', 'confirmed', 'cancelled']);
export const paymentMode = pgEnum('payment_mode', ['cash', 'upi', 'udhaar']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'upi']);
export const billSource = pgEnum('bill_source', ['voice', 'text', 'manual']);

export type DocumentType = (typeof documentType.enumValues)[number];
export type BillIssueKind =
  | 'choose_variant' // product known, size not ("Kaunsa size?")
  | 'unclear' // not heard clearly / sounds like several products
  | 'not_found' // no such product in the catalogue
  | 'price_missing' // product has no price yet
  | 'customer_unknown' // spoken name doesn't match any customer
  | 'customer_ambiguous' // several customers match
  | 'customer_required'; // udhaar bill without a customer

export interface BillIssueOption {
  itemId?: string;
  customerId?: string;
  label: string;
  quantity?: number;
  unitPrice?: number | null;
  amount?: number | null;
}

export interface BillIssue {
  id: string;
  kind: BillIssueKind;
  raw?: string;
  name?: string;
  itemId?: string;
  quantity?: number;
  options: BillIssueOption[];
  /** The item was added to the inventory automatically from this bill (removed again if dropped). */
  autoAdded?: boolean;
  /** The words as heard ("m l", "pyaaz"), used to learn from the shopkeeper's correction. */
  spoken?: string;
}

export const documentType = pgEnum('document_type', ['tax_invoice', 'bill_of_supply', 'bill']);

export const bills = pgTable(
  'bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    // Assigned on confirmation so the invoice series has no gaps from abandoned drafts.
    billNumber: integer('bill_number'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    status: billStatus('status').notNull().default('draft'),
    paymentMode: paymentMode('payment_mode').notNull().default('cash'),
    total: money('total').notNull().default(0),
    // Part payment on an udhaar bill ("500 abhi diye, baaki udhaar").
    upfrontAmount: money('upfront_amount').notNull().default(0),
    upfrontMethod: paymentMethod('upfront_method'),
    // Set on confirm: how the total was settled (paid_cash + paid_upi + credit_amount = total).
    paidCash: money('paid_cash').notNull().default(0),
    paidUpi: money('paid_upi').notNull().default(0),
    creditAmount: money('credit_amount').notNull().default(0),
    // Tax totals (zero unless a tax invoice).
    taxableTotal: money('taxable_total').notNull().default(0),
    cgstTotal: money('cgst_total').notNull().default(0),
    sgstTotal: money('sgst_total').notNull().default(0),
    igstTotal: money('igst_total').notNull().default(0),
    documentType: documentType('document_type'),
    invoiceNumber: varchar('invoice_number', { length: 16 }),
    placeOfSupply: varchar('place_of_supply', { length: 60 }),
    source: billSource('source').notNull().default('manual'),
    transcript: text('transcript'),
    // Customer name as spoken, kept while it is not yet matched to a customer.
    spokenCustomerName: varchar('spoken_customer_name', { length: 120 }),
    // Things the shopkeeper still has to clarify before the bill can be confirmed (see BillIssue).
    issues: jsonb('issues').$type<BillIssue[]>().notNull().default([]),
    // Idempotency key from the app, so bills queued offline are not created twice.
    clientId: varchar('client_id', { length: 64 }),
    receiptToken: varchar('receipt_token', { length: 64 }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('bills_store_status_idx').on(t.storeId, t.status, t.confirmedAt),
    index('bills_customer_idx').on(t.customerId),
    uniqueIndex('bills_store_invoice_unique').on(t.storeId, t.invoiceNumber),
    uniqueIndex('bills_store_client_unique').on(t.storeId, t.clientId),
    uniqueIndex('bills_receipt_token_unique').on(t.receiptToken),
  ],
);

export const billItems = pgTable(
  'bill_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    // Snapshot of the item at billing time so later catalogue edits don't change old bills.
    name: varchar('name', { length: 80 }).notNull(),
    sizeLabel: varchar('size_label', { length: 20 }),
    quantity: qty('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    hsnCode: varchar('hsn_code', { length: 8 }),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2, mode: 'number' }),
    // What the customer pays for this line, and its tax split (paise).
    amount: money('amount').notNull(),
    taxableValue: money('taxable_value').notNull().default(0),
    cgst: money('cgst').notNull().default(0),
    sgst: money('sgst').notNull().default(0),
    igst: money('igst').notNull().default(0),
  },
  (t) => [index('bill_items_bill_idx').on(t.billId)],
);

export const ledgerType = pgEnum('ledger_type', ['bill', 'payment', 'bill_cancelled', 'payment_reversed']);

/** The khata: append-only history of what each customer owes. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    type: ledgerType('type').notNull(),
    // Signed paise: + increases what the customer owes (udhaar bill), − decreases it (payment).
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    billId: uuid('bill_id').references(() => bills.id, { onDelete: 'set null' }),
    method: paymentMethod('method'),
    note: varchar('note', { length: 200 }),
    // Idempotency key from the app, so a retried payment isn't recorded twice.
    clientId: varchar('client_id', { length: 64 }),
    // For 'payment_reversed': the payment entry it undoes (each payment can be reversed once).
    reversesEntryId: uuid('reverses_entry_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_reverses_unique').on(t.reversesEntryId),
    uniqueIndex('ledger_store_client_unique').on(t.storeId, t.clientId),
    index('ledger_customer_idx').on(t.customerId, t.createdAt),
    index('ledger_store_idx').on(t.storeId, t.createdAt),
  ],
);


/* ---------- Voice improvement ---------- */

export const voiceOutcome = pgEnum('voice_outcome', ['not_understood', 'needs_input', 'corrected']);

/**
 * Commands the app didn't fully understand, and the corrections the shopkeeper made. Kept only for
 * shops that opted in, and deleted after the retention period. Reviewed by the team to improve the
 * parser.
 */
export const voiceEvents = pgTable(
  'voice_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    source: varchar('source', { length: 10 }),
    language: varchar('language', { length: 10 }),
    intent: varchar('intent', { length: 30 }),
    outcome: voiceOutcome('outcome').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('voice_events_store_idx').on(t.storeId, t.createdAt), index('voice_events_created_idx').on(t.createdAt)],
);

/* ---------- Outbound messages (receipts, reminders, summaries) ---------- */

export const messageType = pgEnum('message_type', ['receipt', 'reminder', 'daily_summary']);
export const messageStatus = pgEnum('message_status', ['pending', 'sent', 'failed']);

export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    toPhone: varchar('to_phone', { length: 16 }).notNull(),
    type: messageType('type').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: messageStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sendAfter: timestamp('send_after', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('outbound_pending_idx').on(t.status, t.sendAfter)],
);

export const stockReceiptsRelations = relations(stockReceipts, ({ many }) => ({ items: many(stockReceiptItems) }));
export const stockReceiptItemsRelations = relations(stockReceiptItems, ({ one }) => ({
  receipt: one(stockReceipts, { fields: [stockReceiptItems.receiptId], references: [stockReceipts.id] }),
  item: one(items, { fields: [stockReceiptItems.itemId], references: [items.id] }),
}));

export const billsRelations = relations(bills, ({ many, one }) => ({
  items: many(billItems),
  customer: one(customers, { fields: [bills.customerId], references: [customers.id] }),
}));
export const billItemsRelations = relations(billItems, ({ one }) => ({
  bill: one(bills, { fields: [billItems.billId], references: [bills.id] }),
}));
export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  bill: one(bills, { fields: [ledgerEntries.billId], references: [bills.id] }),
  customer: one(customers, { fields: [ledgerEntries.customerId], references: [customers.id] }),
}));

export type User = typeof users.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Bill = typeof bills.$inferSelect;
export type BillItem = typeof billItems.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
