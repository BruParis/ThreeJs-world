/**
 * Interface for tab applications.
 * Each tab must implement these methods to be managed by TabManager.
 */
export interface TabApplication {
  /** Called when the tab becomes active */
  activate(): void;

  /** Called when the tab becomes inactive */
  deactivate(): void;

  /** Called every animation frame when active */
  update(): void;

  /** Called to clean up resources */
  dispose(): void;
}

/** Height of the tab bar in pixels */
export const TAB_BAR_HEIGHT = 40;

/**
 * Manages multiple tab applications, allowing switching between different Three.js visualizations.
 */
export class TabManager {
  private tabs: Map<string, TabApplication> = new Map();
  private activeTabId: string | null = null;
  private appContainer: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private contentArea: HTMLDivElement;
  private animationFrameId: number | null = null;

  constructor() {
    const { appContainer, tabBar, contentArea } = this.createLayout();
    this.appContainer = appContainer;
    this.tabBar = tabBar;
    this.contentArea = contentArea;
    this.startAnimationLoop();
  }

  /**
   * Creates the main layout structure with tab bar and content area.
   */
  private createLayout(): {
    appContainer: HTMLDivElement;
    tabBar: HTMLDivElement;
    contentArea: HTMLDivElement;
  } {
    // Main container that holds everything
    const appContainer = document.createElement('div');
    appContainer.id = 'app-container';
    appContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    // Tab bar at the top
    const tabBar = document.createElement('div');
    tabBar.id = 'tab-bar';
    tabBar.style.cssText = `
      height: ${TAB_BAR_HEIGHT}px;
      min-height: ${TAB_BAR_HEIGHT}px;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      padding: 0 10px;
      border-bottom: 1px solid #333;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 100;
    `;

    // Content area that fills the rest
    const contentArea = document.createElement('div');
    contentArea.id = 'content-area';
    contentArea.style.cssText = `
      flex: 1;
      position: relative;
      overflow: hidden;
    `;

    appContainer.appendChild(tabBar);
    appContainer.appendChild(contentArea);
    document.body.appendChild(appContainer);

    // Reset body styles
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';

    return { appContainer, tabBar, contentArea };
  }

  /**
   * Returns the content area element where tab content should be rendered.
   */
  public getContentArea(): HTMLDivElement {
    return this.contentArea;
  }

  /**
   * Creates a tab button element.
   */
  private createTabButton(id: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = `tab-btn-${id}`;
    button.textContent = label;
    button.style.cssText = `
      background: transparent;
      border: none;
      color: #888;
      padding: 10px 20px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s ease;
      border-bottom: 2px solid transparent;
      margin-right: 5px;
    `;

    button.addEventListener('mouseenter', () => {
      if (this.activeTabId !== id) {
        button.style.color = '#aaa';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (this.activeTabId !== id) {
        button.style.color = '#888';
      }
    });

    button.addEventListener('click', () => {
      this.switchTo(id);
    });

    return button;
  }

  /**
   * Updates the visual state of tab buttons.
   */
  private updateTabButtonStyles(): void {
    for (const [id] of this.tabs) {
      const button = document.getElementById(`tab-btn-${id}`) as HTMLButtonElement;
      if (button) {
        if (id === this.activeTabId) {
          button.style.color = '#fff';
          button.style.borderBottom = '2px solid #4a9eff';
        } else {
          button.style.color = '#888';
          button.style.borderBottom = '2px solid transparent';
        }
      }
    }
  }

  /**
   * Registers a new tab application.
   * @param id Unique identifier for the tab
   * @param label Display label for the tab button
   * @param app The application instance
   */
  public register(id: string, label: string, app: TabApplication): void {
    this.tabs.set(id, app);
    const button = this.createTabButton(id, label);
    this.tabBar.appendChild(button);

    // If this is the first tab, activate it
    if (this.tabs.size === 1) {
      this.switchTo(id);
    }
  }

  /**
   * Switches to a different tab.
   * @param id The tab identifier to switch to
   */
  public switchTo(id: string): void {
    if (id === this.activeTabId) {
      return;
    }

    const newApp = this.tabs.get(id);
    if (!newApp) {
      console.warn(`Tab "${id}" not found`);
      return;
    }

    // Deactivate current tab
    if (this.activeTabId) {
      const currentApp = this.tabs.get(this.activeTabId);
      if (currentApp) {
        currentApp.deactivate();
      }
    }

    // Activate new tab
    this.activeTabId = id;
    newApp.activate();

    this.updateTabButtonStyles();
  }

  /**
   * Returns the currently active tab ID.
   */
  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Starts the animation loop.
   */
  private startAnimationLoop(): void {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);

      if (this.activeTabId) {
        const app = this.tabs.get(this.activeTabId);
        if (app) {
          app.update();
        }
      }
    };

    animate();
  }

  /**
   * Disposes of all tabs and cleans up.
   */
  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    for (const app of this.tabs.values()) {
      app.dispose();
    }

    this.tabs.clear();
    this.appContainer.remove();
  }
}
