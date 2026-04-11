import { TabManager, WorldApplication, QuadTreeApplication, ShaderDemoApplication } from './tabs';

// Create tab manager
const tabManager = new TabManager();

// Register applications
tabManager.register('world', 'World', new WorldApplication());
tabManager.register('quadtree', 'QuadTree', new QuadTreeApplication());
tabManager.register('shaders', 'Shaders', new ShaderDemoApplication());
