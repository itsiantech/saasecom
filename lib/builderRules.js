const RULE_TYPES = ["equals", "in", "includes", "lte", "gte", "sum-lte", "set-membership"];
const RULE_LEVELS = ["block", "warn"];
const SPEC_KEY_RE = /^[a-z0-9][a-z0-9_]{0,59}$/i;
const RULE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/i;
const MAX_RULES = 100;
const MAX_TERMS = 10;

const DEFAULT_MESSAGES = {
  block: {
    en: "This combination is not supported",
    bn: "এই কম্বিনেশনটি সাপোর্টেড নয়",
  },
  warn: {
    en: "This combination has a warning",
    bn: "এই কম্বিনেশনে একটি সতর্কতা আছে",
  },
};

class BuilderRuleError extends Error {
  constructor(message, code = "invalid_rule") {
    super(message);
    this.name = "BuilderRuleError";
    this.status = 400;
    this.code = code;
  }
}

function text(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * Rule authoring — normalize + validate. Admin writes rules as data;
 * anything the engine cannot interpret is rejected at save time.
 * ------------------------------------------------------------------ */

function cleanOperand(raw, slotKeys, where) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BuilderRuleError(`${where} operand lagbe`);
  }
  const slot = text(raw.slot, 60).toLowerCase();
  const spec = text(raw.spec, 60);
  if (!slot || !slotKeys.has(slot)) {
    throw new BuilderRuleError(`${where} slot pawa jayni: ${slot || "(khali)"}`);
  }
  if (!SPEC_KEY_RE.test(spec)) {
    throw new BuilderRuleError(`${where} spec key thik nei`);
  }
  return { slot, spec };
}

function cleanRule(raw, index, slotKeys) {
  if (!raw || typeof raw !== "object") {
    throw new BuilderRuleError(`Rule ${index + 1} thik nei`);
  }
  const type = RULE_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) throw new BuilderRuleError(`Rule ${index + 1}: type thik nei`);

  const level = RULE_LEVELS.includes(raw.level) ? raw.level : "block";
  let key = text(raw.key, 60);
  if (key && !RULE_KEY_RE.test(key)) throw new BuilderRuleError(`Rule ${index + 1}: key thik nei`);
  if (!key) key = `rule-${index + 1}`;

  const rule = {
    key,
    type,
    level,
    message: text(raw.message),
    messageBn: text(raw.messageBn),
  };

  if (type === "sum-lte") {
    const terms = Array.isArray(raw.terms) ? raw.terms.slice(0, MAX_TERMS) : [];
    if (!terms.length) throw new BuilderRuleError(`Rule ${key}: sum-lte e term lagbe`);
    rule.terms = terms.map((term, i) => {
      const slot = text(term && term.slot, 60).toLowerCase();
      const spec = text(term && term.spec, 60);
      if (!slot || !slotKeys.has(slot)) {
        throw new BuilderRuleError(`Rule ${key}: term ${i + 1} er slot pawa jayni`);
      }
      if (!SPEC_KEY_RE.test(spec)) throw new BuilderRuleError(`Rule ${key}: term ${i + 1} er spec thik nei`);
      const multiplier = term.multiplier === undefined ? 1 : finiteNumber(term.multiplier);
      if (multiplier === null || multiplier < 0.1 || multiplier > 20) {
        throw new BuilderRuleError(`Rule ${key}: term ${i + 1} er multiplier 0.1–20 er moddhe lagbe`);
      }
      return { slot, spec, multiplier };
    });
    const limit = finiteNumber(raw.limit);
    if (limit === null || limit < 0) throw new BuilderRuleError(`Rule ${key}: limit lagbe`);
    rule.limit = limit;
    return rule;
  }

  rule.left = cleanOperand(raw.left, slotKeys, `Rule ${key}: left`);

  const hasLiteral = raw.value !== undefined && raw.value !== null && raw.value !== "";
  const hasRight = raw.right && typeof raw.right === "object" && (raw.right.slot || raw.right.spec);
  if (!hasLiteral && !hasRight) throw new BuilderRuleError(`Rule ${key}: right side lagbe`);
  if (hasLiteral && hasRight) throw new BuilderRuleError(`Rule ${key}: right ar value duitai deya jabe na`);

  if (hasLiteral) {
    if (type === "lte" || type === "gte") {
      if (finiteNumber(raw.value) === null) throw new BuilderRuleError(`Rule ${key}: number value lagbe`);
    } else if ((type === "in" || type === "includes") && !Array.isArray(raw.value)) {
      throw new BuilderRuleError(`Rule ${key}: value list hote hobe`);
    }
    rule.value = raw.value;
  } else {
    rule.right = cleanOperand(raw.right, slotKeys, `Rule ${key}: right`);
  }

  return rule;
}

// slotKeys: Set<string>. Returns normalized copies (safe to store).
function cleanRules(rules, slotKeys) {
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) throw new BuilderRuleError("Rules list hote hobe");
  if (rules.length > MAX_RULES) throw new BuilderRuleError(`সর্বোচ্চ ${MAX_RULES}টি rule যাবে`);
  const seen = new Set();
  return rules.map((raw, index) => {
    const rule = cleanRule(raw, index, slotKeys);
    if (seen.has(rule.key)) throw new BuilderRuleError(`Rule key duibar ache: ${rule.key}`);
    seen.add(rule.key);
    return rule;
  });
}

/* ------------------------------------------------------------------ *
 * Evaluation. Missing spec values are silent: a product that does not
 * declare a spec never blocks the build and never produces a warning.
 * ------------------------------------------------------------------ */

const MISSING = { missing: true };

function readOperand(operand, ctx) {
  if (!operand) return MISSING;
  if (operand.value !== undefined && operand.value !== null) return operand.value;
  const product = ctx.products[operand.slot];
  if (!product) return MISSING;
  const raw = product.specs ? product.specs[operand.spec] : undefined;
  if (raw === undefined || raw === null || raw === "") return MISSING;
  if (Array.isArray(raw) && raw.length === 0) return MISSING;
  return raw;
}

function normalize(value) {
  if (typeof value === "number") return value;
  const s = String(value).trim();
  if (s === "") return s;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return s.toLowerCase();
}

function same(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return typeof x === typeof y && x === y;
}

function slotsOf(rule) {
  if (rule.type === "sum-lte") return [...new Set((rule.terms || []).map((term) => term.slot))];
  const slots = [rule.left && rule.left.slot];
  if (rule.right && rule.right.slot) slots.push(rule.right.slot);
  return [...new Set(slots.filter(Boolean))];
}

function violationOf(rule) {
  const fallback = DEFAULT_MESSAGES[rule.level] || DEFAULT_MESSAGES.block;
  return {
    rule: rule.key,
    type: rule.type,
    level: rule.level || "block",
    message: rule.message || fallback.en,
    messageBn: rule.messageBn || fallback.bn,
    slots: slotsOf(rule),
  };
}

function resolveRight(rule, ctx) {
  if (rule.value !== undefined && rule.value !== null) return rule.value;
  return readOperand(rule.right, ctx);
}

function ruleFails(rule, ctx) {
  if (rule.type === "sum-lte") {
    let total = 0;
    for (const term of rule.terms || []) {
      const product = ctx.products[term.slot];
      if (!product) return false;
      const raw = product.specs ? product.specs[term.spec] : undefined;
      const value = finiteNumber(raw);
      if (value === null) return false; // missing spec → silent
      total += value * (Number(term.multiplier) || 1);
    }
    const limit = finiteNumber(rule.limit);
    if (limit === null) return false;
    return total > limit;
  }

  const left = readOperand(rule.left, ctx);
  if (left === MISSING) return false;

  const right = resolveRight(rule, ctx);
  if (right === MISSING) return false;

  if (rule.type === "equals") return !same(left, right);
  if (rule.type === "set-membership" || rule.type === "in") {
    const list = Array.isArray(right) ? right : null;
    if (!list) return false; // non-list spec → cannot judge, stay silent
    if (Array.isArray(left)) return false;
    return !list.some((item) => same(left, item));
  }
  if (rule.type === "includes") {
    const list = Array.isArray(left) ? left : null;
    if (!list) return false;
    if (Array.isArray(right)) return false;
    return !list.some((item) => same(item, right));
  }
  // lte / gte
  const a = finiteNumber(left);
  const b = finiteNumber(right);
  if (a === null || b === null) return false;
  return rule.type === "lte" ? a > b : a < b;
}

// ctx = { products: { slotKey: productDoc }, quantities: { slotKey: number } }
function evaluateRules(rules, ctx) {
  const violations = [];
  for (const rule of rules || []) {
    let failed = false;
    try {
      failed = ruleFails(rule, ctx);
    } catch {
      failed = false; // a malformed/legacy rule must never crash the storefront
    }
    if (failed) violations.push(violationOf(rule));
  }
  return violations;
}

/* ------------------------------------------------------------------ *
 * Slot candidate filtering: would adding this product to `slotKey`
 * break a block-level rule that involves the slot? Warms are reported
 * but stay selectable.
 * ------------------------------------------------------------------ */

function withProduct(ctx, slotKey, product, quantity = 1) {
  return {
    products: { ...(ctx.products || {}), [slotKey]: product },
    quantities: { ...(ctx.quantities || {}), [slotKey]: quantity },
  };
}

function judgeProduct(ruleList, slotKey, product, ctx, quantity = 1) {
  const next = withProduct(ctx, slotKey, product, quantity);
  const violations = evaluateRules(ruleList, next).filter((v) => v.slots.includes(slotKey));
  const blocks = violations.filter((v) => v.level === "block");
  const warns = violations.filter((v) => v.level === "warn");
  return {
    compatible: blocks.length === 0,
    reasons: blocks.map((v) => v.message),
    reasonsBn: blocks.map((v) => v.messageBn),
    warnings: warns,
  };
}

function filterCandidates(ruleList, slotKey, products, ctx) {
  return (products || []).map((product) => {
    const verdict = judgeProduct(ruleList, slotKey, product, ctx);
    return { product, ...verdict };
  });
}

module.exports = {
  RULE_TYPES,
  RULE_LEVELS,
  MAX_RULES,
  BuilderRuleError,
  cleanRules,
  evaluateRules,
  filterCandidates,
  judgeProduct,
  withProduct,
  slotsOf,
  normalize,
};
