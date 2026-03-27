import { TabManager, WorldApplication, QuadTreeApplication } from './tabs';

// Create tab manager
const tabManager = new TabManager();

// Register applications
tabManager.register('quadtree', 'QuadTree', new QuadTreeApplication());
tabManager.register('world', 'World', new WorldApplication());
