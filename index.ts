import { find, init } from './src/find';
export * from './src/find';
export * from './src/oceanUtils';

(window as any).GeoTZ = { find, init };
