import { TabManager, WorldApplication, IcoTreeApplication } from './tabs';

// Create tab manager
const tabManager = new TabManager();

// Register applications
tabManager.register('icotree', 'IcoTree', new IcoTreeApplication());
tabManager.register('world', 'World', new WorldApplication());
