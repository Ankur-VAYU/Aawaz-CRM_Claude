// Shapes returned by the Aawaz backend (see backend/README.md). Money is integer paise.

export type Lang = 'hinglish' | 'hi' | 'en';
export type PaymentMode = 'cash' | 'upi' | 'udhaar';
export type Unit = 'kg' | 'g' | 'l' | 'ml' | 'pc';

export interface User {
  id: string;
  phone: string;
  name: string | null;
}

export interface Store {
  id: string;
  name: string;
  ownerName: string;
  city: string;
  state: string | null;
  pincode: string | null;
  address: string | null;
  givesCredit: boolean;
  gstin: string | null;
  pan: string | null;
  legalName: string | null;
  gstScheme: 'regular' | 'composition' | null;
  pricesIncludeTax: boolean;
  language: Lang;
  replyStyle: 'voice_text' | 'text';
  summaryTime: string;
  voiceLogOptIn: boolean;
  onboardedAt: string | null;
}

export interface Item {
  id: string;
  name: string;
  displayName: string;
  aliases: string[];
  unit: Unit;
  unitSize: number;
  price: number | null;
  gstRate: number | null;
  hsnCode: string | null;
  stock: number;
  stockLabel: string | null;
  lowStockThreshold: number;
}

export interface Customer {
  id: string;
  name: string;
  initials: string;
  phone: string | null;
  gstin: string | null;
  balance: number;
  totalPurchases: number;
  totalPaid: number;
  lastPurchaseAt: string | null;
  messagingConsent: boolean;
  messagesOptedOut: boolean;
  canMessage: boolean;
  deletionRequestedAt: string | null;
  createdAt: string;
  inactive?: boolean;
}

export type IssueKind =
  | 'choose_variant'
  | 'unclear'
  | 'not_found'
  | 'price_missing'
  | 'customer_unknown'
  | 'customer_ambiguous'
  | 'customer_required';

export interface IssueOption {
  itemId?: string;
  customerId?: string;
  label: string;
  quantity?: number;
  unitPrice?: number | null;
  amount?: number | null;
}

export interface BillIssue {
  id: string;
  kind: IssueKind;
  raw?: string;
  name?: string;
  itemId?: string;
  quantity?: number;
  options: IssueOption[];
  autoAdded?: boolean;
  spoken?: string;
}

export interface BillLine {
  id: string;
  itemId: string | null;
  name: string;
  sizeLabel: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Bill {
  id: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  paymentMode: PaymentMode;
  billNumber: number | null;
  invoiceNumber: string | null;
  documentType: 'tax_invoice' | 'bill_of_supply' | 'bill' | null;
  total: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  upfrontAmount: number;
  upfrontMethod: 'cash' | 'upi' | null;
  paidCash: number;
  paidUpi: number;
  creditAmount: number;
  customer: { id: string; name: string; phone: string | null; balance: number } | null;
  items: BillLine[];
  itemCount: number;
  issues: BillIssue[];
  canConfirm: boolean;
  receiptLink: string;
  createdAt: string;
}

export interface Learned {
  type: 'item' | 'customer';
  heard: string;
  name: string;
}

export interface ConfirmResult {
  bill: Bill;
  effects: {
    stockReduced: number;
    khata: { before: number; after: number } | null;
    receiptQueued: boolean;
    customerLink: string | null;
  };
  reply: { title: string; lines: string[] };
}

export interface StockInPreview {
  supplier: string | null;
  matched: { itemId: string; displayName: string; quantity: number; stock: number }[];
  unmatched: {
    raw: string;
    options: { itemId?: string; label: string; quantity?: number }[];
    newItem: { name: string; unit: 'kg' | 'l' | 'pc'; quantity: number } | null;
  }[];
}

export interface LedgerEntry {
  id: string;
  type: 'bill' | 'payment' | 'bill_cancelled' | 'payment_reversed';
  amount: number;
  balanceAfter: number;
  billId: string | null;
  method: 'cash' | 'upi' | null;
  note: string | null;
  reversesEntryId: string | null;
  createdAt: string;
  billNumber?: number | null;
  invoiceNumber?: string | null;
  itemCount?: number | null;
}

export interface DailySummary {
  date: string;
  sales: { total: number; bills: number; voiceBills: number; cashAndUpi: number; cash: number; upi: number; udhaarGiven: number };
  udhaarRecovered: number;
  newCustomers: number;
  lowStock: { id: string; name: string; stock: number; stockLabel: string | null; lowStockThreshold: number }[];
  topDues: { id: string; name: string; balance: number }[];
}

export interface AssistantResponse {
  intent: string;
  reply: { text: string; speak: boolean };
  bill?: Bill;
  customer?: Customer;
  recentEntries?: LedgerEntry[];
  entry?: LedgerEntry;
  customers?: Customer[];
  total?: number;
  totalDues?: number;
  summary?: DailySummary;
  items?: Item[];
  stockIn?: StockInPreview;
  needsInput?: { kind: string; name?: string; options?: Customer[] };
}
