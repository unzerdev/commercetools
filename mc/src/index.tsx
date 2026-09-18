/// <reference types="@commercetools-frontend/application-config/client" />

import { createRoot } from 'react-dom/client';
import EntryPoint from './components/entry-point';
import { applyUnzerTheme } from './theme';
import './styles/unzer.css';

// Re-theme the commercetools UI Kit primary ramp to Unzer's brand color before the first render, and
// load the Unzer control stylesheet (banner, tabs, buttons, toggles, radios) that the screens class on.
applyUnzerTheme();

const container = document.getElementById('app');
const root = createRoot(container as Element);
root.render(<EntryPoint />);
