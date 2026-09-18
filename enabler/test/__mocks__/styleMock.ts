/**
 * Stub for `*.module.scss` imports. Any accessed class name resolves to its own key (identity) so
 * components can build their template strings — and toggle classes on live elements, which rejects
 * an empty token — without a real SCSS toolchain in the test run.
 */
const styleProxy = new Proxy(
  {},
  {
    get: (_target, prop) => String(prop),
  },
);

export default styleProxy;
