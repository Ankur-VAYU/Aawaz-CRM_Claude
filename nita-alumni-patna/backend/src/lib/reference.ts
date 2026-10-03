// Allowed values for the join form, imports and admin tools. Keep in one place so the form,
// the API and the CSV importer always agree.
//
// BRANCHES and DEGREES are a starting list. Check them against the institute's official list of
// programmes and edit here before launch; existing rows are not changed by editing this file.

export const DEGREES = ['B.Tech', 'M.Tech', 'MBA', 'M.Sc', 'MCA', 'Ph.D'] as const;

export const BRANCHES = [
  'Civil Engineering',
  'Mechanical Engineering',
  'Electrical Engineering',
  'Electronics & Communication',
  'Computer Science & Engineering',
  'Chemical Engineering',
  'Production Engineering',
  'Electronics & Instrumentation',
  'Bio Engineering',
  'Physics',
  'Chemistry',
  'Mathematics',
  'Management (MBA)',
  'Computer Applications (MCA)',
] as const;

// The 38 districts of Bihar.
export const BIHAR_DISTRICTS = [
  'Araria', 'Arwal', 'Aurangabad', 'Banka', 'Begusarai', 'Bhagalpur', 'Bhojpur', 'Buxar',
  'Darbhanga', 'East Champaran', 'Gaya', 'Gopalganj', 'Jamui', 'Jehanabad', 'Kaimur', 'Katihar',
  'Khagaria', 'Kishanganj', 'Lakhisarai', 'Madhepura', 'Madhubani', 'Munger', 'Muzaffarpur',
  'Nalanda', 'Nawada', 'Patna', 'Purnia', 'Rohtas', 'Saharsa', 'Samastipur', 'Saran', 'Sheikhpura',
  'Sheohar', 'Sitamarhi', 'Siwan', 'Supaul', 'Vaishali', 'West Champaran',
] as const;

// Indian states and union territories, plus "Outside India".
export const WORK_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry', 'Outside India',
] as const;

export const TITLES = ['President', 'Secretary', 'Treasurer', 'Joint Secretary', 'Committee member'] as const;

export const VISIBILITY = ['members', 'batch', 'admins'] as const;

// Earliest passing year accepted. Lower it if the chapter has members from older batches.
export const FIRST_BATCH_YEAR = 1969;

/** Case- and spacing-insensitive lookup that returns the canonical spelling, or null. */
export function matchOption<T extends string>(list: readonly T[], value: string): T | null {
  const key = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const k = key(value);
  return list.find((o) => key(o) === k) ?? null;
}
