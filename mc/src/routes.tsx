import ConfigApp from './components/config-app';
import DataLocaleMessages from './components/data-locale-messages';

/**
 * What the ApplicationShell router mounts. The Connection / Payment-methods tabs are NOT here: they are
 * gated on a loaded store config, so they live below the store selector, inside `config-app`. No outer
 * inset either - `ConfigApp` owns its layout, so the banner runs full-bleed.
 */
const ApplicationRoutes = () => (
  <DataLocaleMessages>
    <ConfigApp />
  </DataLocaleMessages>
);
ApplicationRoutes.displayName = 'ApplicationRoutes';

export default ApplicationRoutes;
