// The demo runs the backend's own parsing, matching and reply code in the browser.
export { parseCommand } from '../backend/src/modules/assistant/parser.js';
export { resolveLine, quantityFor } from '../backend/src/modules/bills/matching.js';
export { similarity } from '../backend/src/lib/text.js';
export { transliterate } from '../backend/src/lib/translit.js';
export { formatRupees, lineAmount } from '../backend/src/lib/money.js';
export { itemDisplayName, sizeLabel } from '../backend/src/lib/serialize.js';
export { financialYear, invoiceNumber, isValidGstin, isValidPan, panFromGstin, stateFromGstin } from '../backend/src/lib/gst.js';
export { normalizePhone, maskPhone } from '../backend/src/lib/phone.js';
export { reply, receiptMessage, reminderMessage } from '../backend/src/lib/replies.js';
