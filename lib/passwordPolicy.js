// Minimum policy for any password the app stores: long enough, never only
// digits, and within bcrypt's 72-byte input limit.
function passwordIssue(value) {
  const password = String(value == null ? "" : value);
  if (password.length < 8) return "Password kompokkhe 8 character hote hobe";
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Password 72 byte er beshi hote parbe na";
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password e letter ar number dutai thakte hobe";
  }
  return "";
}

function assertPassword(value) {
  const issue = passwordIssue(value);
  if (issue) throw new Error(issue);
  return String(value);
}

module.exports = { passwordIssue, assertPassword };
