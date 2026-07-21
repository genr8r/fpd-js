// Empty stub for modules Sash never uses, swapped in via webpack.sash.config.js
// resolve.alias. A class (not a plain object) so it satisfies both `new X(...)`
// call sites (PricingRules, Facebook/Instagram/PixabayImages are all instantiated
// with `new`) and silently ignores whatever constructor args are passed.
export default class {};
