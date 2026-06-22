const { chromium } = require('playwright');

class BrowserController {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cdpSession = null;
  }

   async launch() {
     try {
       console.log('Launching Chromium browser...');
       this.browser = await chromium.launch({ 
  headless: true,
  ignoreHTTPSErrors: true,
  args: [
    '--window-size=1280,800',
    '--ignore-certificate-errors'
  ]
});
       this.page = await this.browser.newPage();
       console.log('Browser launched successfully');
     } catch (error) {
       throw new Error(`Failed to launch browser: ${error.message}`);
     }
   }

  async screenshot() {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      console.log('Taking screenshot...');
      
      // Set viewport to standard size for consistency
      await this.page.setViewportSize({ width: 1280, height: 800 });
      
      const screenshotBuffer = await this.page.screenshot({ 
        type: 'jpeg',
        quality: 70,
        fullPage: false
      });
      
      const base64 = screenshotBuffer.toString('base64');
      console.log(`Screenshot taken: 1280x800 (compressed jpeg)`);
      return {
        base64,
        width: 1280,
        height: 800,
        mimeType: 'image/jpeg'
      };
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  async navigate(url) {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      console.log(`Navigating to ${url}...`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Extra wait for JavaScript heavy sites to render
      await this.page.waitForTimeout(2000);
      console.log(`Successfully navigated to ${url}`);
    } catch (error) {
      throw new Error(`Failed to navigate to ${url}: ${error.message}`);
    }
  }

  async click(x, y) {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      console.log(`Clicking at x:${x} y:${y}`);
      await this.page.mouse.click(x, y);
      console.log(`Clicked at x:${x} y:${y}`);
    } catch (error) {
      throw new Error(`Failed to click at x:${x} y:${y}: ${error.message}`);
    }
  }

  async type(text) {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      console.log(`Typing text: "${text}"`);
      await this.page.keyboard.type(text);
      console.log(`Text typed successfully`);
    } catch (error) {
      throw new Error(`Failed to type text: ${error.message}`);
    }
  }

  async scroll(direction) {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      const validDirections = ['up', 'down'];
      if (!validDirections.includes(direction.toLowerCase())) {
        throw new Error(`Invalid scroll direction: ${direction}. Use 'up' or 'down'.`);
      }
      console.log(`Scrolling ${direction}...`);
      const scrollAmount = direction.toLowerCase() === 'down' ? 3 : -3;
      await this.page.evaluate((amount) => {
        window.scrollBy(0, amount * 100);
      }, scrollAmount);
      console.log(`Scrolled ${direction} successfully`);
    } catch (error) {
      throw new Error(`Failed to scroll ${direction}: ${error.message}`);
    }
  }

  async waitForStable() {
    try {
      await this.page.waitForTimeout(1500);
      console.log('Page stabilized');
    } catch (error) {
      throw new Error(`Wait failed: ${error.message}`);
    }
  }

  async getPageInfo() {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      const url = this.page.url();
      const title = await this.page.title();
      console.log(`Page info - URL: ${url}, Title: ${title}`);
      return {
        url,
        title
      };
    } catch (error) {
      throw new Error(`Failed to get page info: ${error.message}`);
    }
  }

  async getPageContent() {
    try {
      if (!this.page) {
        throw new Error('Browser not launched. Call launch() first.');
      }
      
      // Wait for page to settle
      await this.page.waitForTimeout(2000);
      
      // Check if page has meaningful content
      const bodyText = await this.page.evaluate(() => {
        const body = document.body;
        if (!body) return '';
        return body.innerText.trim();
      });
      
      // Check if page is blank or just shows API response
      const isBlank = bodyText.length < 50 || 
                      bodyText.includes('200-OK') || 
                      bodyText.includes('200 OK') ||
                      bodyText === 'Pretty-print';
      
      console.log(`Page content check: ${isBlank ? 'BLANK/API response' : 'Has content'} (${bodyText.length} chars)`);
      
      return {
        hasContent: !isBlank,
        textLength: bodyText.length,
        preview: bodyText.substring(0, 100)
      };
    } catch (error) {
      throw new Error(`Failed to get page content: ${error.message}`);
    }
  }

  async focusWindow() {
    try {
      if (!this.page) return;
      await this.page.bringToFront();
      console.log('Browser window brought to front');
    } catch (error) {
      console.error('Failed to focus browser window:', error);
    }
  }

  async minimizeWindow() {
    try {
      if (!this.browser) return;
      const pages = this.browser.pages();
      // We can't truly minimize via Playwright, but we can 
      // move window behind by not focusing it
      console.log('Browser window focus released');
    } catch (error) {
      console.error('Failed to minimize browser window:', error);
    }
  }

  async startScreencast(onFrame) {
    try {
      if (!this.page) return;
      console.log('Starting browser screencast...');
      
      const cdp = await this.page.context().newCDPSession(this.page);
      this.cdpSession = cdp;
      
      cdp.on('Page.screencastFrame', async (event) => {
        try {
          // Acknowledge the frame so CDP keeps sending
          await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
          // Send the frame to callback
          if (onFrame) {
            onFrame(event.data, event.metadata);
          }
        } catch(e) {}
      });
      
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 2
      });
      
      console.log('Screencast started');
    } catch (error) {
      console.error('Failed to start screencast:', error);
    }
  }

  async stopScreencast() {
    try {
      if (this.cdpSession) {
        await this.cdpSession.send('Page.stopScreencast');
        await this.cdpSession.detach();
        this.cdpSession = null;
        console.log('Screencast stopped');
      }
    } catch (error) {
      console.error('Failed to stop screencast:', error);
    }
  }

  async close() {
    try {
      if (!this.browser) {
        throw new Error('Browser not launched.');
      }
      await this.stopScreencast();
      console.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.cdpSession = null;
      console.log('Browser closed successfully');
    } catch (error) {
      throw new Error(`Failed to close browser: ${error.message}`);
    }
  }
}

module.exports = BrowserController;


