import loginIllustration from '../../assets/images/login-illustration.png';

/**
 * Connection page illustration — the login image from the core Unzer integration.
 *
 * The artwork is a BINARY asset the build inlines (`mc-scripts` handles `*.png`), like every other
 * image in `assets`. It used to be a 129 KB base64 string literal in a `.ts` file: a third larger than
 * the bytes it carried, parsed as JavaScript, uncacheable apart from the code, and in the way of every
 * search through `src`.
 */
const ConnectionIllustration = () => (
  <img
    src={loginIllustration}
    alt="Unzer payments"
    className="unzer-connect-illustration"
  />
);

export default ConnectionIllustration;
