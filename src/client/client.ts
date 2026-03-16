import { TabManager, WorldApplication, ISEA3HApplication } from './tabs';

// Create tab manager
const tabManager = new TabManager();

// Register applications
tabManager.register('isea3h', 'ISEA3H', new ISEA3HApplication());
tabManager.register('world', 'World', new WorldApplication());
