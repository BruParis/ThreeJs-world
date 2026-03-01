import { TabManager, WorldApplication, HexaTreeApplication } from './tabs';

// Create tab manager
const tabManager = new TabManager();

// Register applications
tabManager.register('hexatree', 'HexaTree', new HexaTreeApplication());
tabManager.register('world', 'World', new WorldApplication());
