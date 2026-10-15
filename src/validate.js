const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
];

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
// Indian mobile: 10 digits starting 6-9, optional +91 / 0 prefix
const normPhone = (v) => {
  const d = String(v || '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};
const isPincode = (v) => /^[1-9]\d{5}$/.test(v);

function validateAddress(a = {}) {
  const errors = {};
  const addr = {
    name: str(a.name, 80),
    phone: normPhone(a.phone),
    line1: str(a.line1, 150),
    line2: str(a.line2, 150),
    city: str(a.city, 60),
    state: str(a.state, 60),
    pincode: str(a.pincode, 6),
  };
  if (addr.name.length < 2) errors.name = 'Enter the full name';
  if (!addr.phone) errors.phone = 'Enter a valid 10-digit mobile number';
  if (addr.line1.length < 4) errors.line1 = 'Enter house / street details';
  if (addr.city.length < 2) errors.city = 'Enter the city';
  if (!STATES.includes(addr.state)) errors.state = 'Choose a state';
  if (!isPincode(addr.pincode)) errors.pincode = 'Enter a valid 6-digit PIN code';
  return { addr, errors, ok: Object.keys(errors).length === 0 };
}

module.exports = { STATES, str, isEmail, normPhone, isPincode, validateAddress };
