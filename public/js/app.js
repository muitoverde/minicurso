import { appController } from './controllers/appController.js';

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    appController.init();
  });
}

export { appController };
