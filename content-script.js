// Inject a custom download icon button next to Like and Share buttons on YouTube watch pages.
// Downloads happen instantly without redirecting to any external page.

console.log("[YT Downloader] Content script loaded");

function createDownloadIcon() {
  // Create SVG download icon
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.innerHTML = `
    <path d="M12 15.577l-3.539-3.538.708-.719L11.5 13.65V3h1v10.65l2.331-2.33.708.719L12 15.577z" fill="currentColor"/>
    <path d="M19 12v6a1 1 0 01-1 1H6a1 1 0 01-1-1v-6H4v6a2 2 0 002 2h12a2 2 0 002-2v-6h-1z" fill="currentColor"/>
  `;
  svg.style.width = "24px";
  svg.style.height = "24px";
  svg.style.display = "block";
  return svg;
}

function createDownloadButton() {
  const existing = document.getElementById("ytvd-download-icon-btn");
  if (existing) return existing;

  const button = document.createElement("button");
  button.id = "ytvd-download-icon-btn";
  button.setAttribute("class", "yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading");
  button.setAttribute("aria-label", "Download video");
  button.setAttribute("title", "Download video");
  // Create icon first
  const icon = createDownloadIcon();
  icon.style.color = "#ffffff"; // White icon color
  button.appendChild(icon);

  // Set base styles with green background and white icon
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 8px;
    border: none;
    border-radius: 20px;
    background: #22c55e;
    color: #ffffff;
    cursor: pointer;
    transition: background-color 0.1s cubic-bezier(0.4, 0, 0.2, 1);
    margin-left: 4px;
    position: relative;
    vertical-align: middle;
  `;

  // Add hover effect - darker green on hover
  button.addEventListener("mouseenter", () => {
    button.style.backgroundColor = "#16a34a";
  });
  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = "#22c55e";
  });

  // Add active state - even darker green when clicked
  button.addEventListener("mousedown", () => {
    button.style.backgroundColor = "#15803d";
  });
  button.addEventListener("mouseup", () => {
    button.style.backgroundColor = "#16a34a";
  });

  // Icon color stays green regardless of theme

  button.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Visual feedback - darker green when clicked
    const originalBg = button.style.backgroundColor;
    button.style.backgroundColor = "#15803d";
    button.style.pointerEvents = "none";

    try {
      const url = window.location.href;
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_YT_VIDEO",
        videoUrl: url,
      });

      if (response && response.error) {
        console.error("Download error:", response.error);
        // Could show a toast notification here
      }
    } catch (error) {
      console.error("Failed to start download:", error);
    } finally {
      setTimeout(() => {
        button.style.backgroundColor = "#22c55e"; // Reset to default green
        button.style.pointerEvents = "auto";
      }, 500);
    }
  });

  return button;
}

function injectDownloadButton() {
  // Check if button already exists and is connected
  const existingBtn = document.getElementById("ytvd-download-icon-btn");
  if (existingBtn && existingBtn.isConnected) return;

  // Multiple strategies to find the Like/Share button area
  // Strategy 1: Find by menu-container or top-level-buttons-computed
  let buttonsContainer = document.querySelector("#menu-container #top-level-buttons");
  
  // Strategy 2: Find by ytd-menu-renderer
  if (!buttonsContainer) {
    const menuRenderer = document.querySelector("ytd-menu-renderer");
    if (menuRenderer) {
      buttonsContainer = menuRenderer.querySelector("#top-level-buttons") || 
                        menuRenderer.querySelector("#top-level-buttons-computed");
    }
  }
  
  // Strategy 3: Find by Like button and traverse up
  if (!buttonsContainer) {
    const likeButton = document.querySelector(
      "like-button-view-model button, " +
      "#segmented-like-button, " +
      "button[aria-label*='like' i]:not([aria-pressed='true']), " +
      "ytd-toggle-button-renderer button[aria-label*='like' i]"
    );
    
    if (likeButton) {
      // Try to find the container that holds multiple buttons
      let parent = likeButton.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        // Look for elements that typically contain multiple button-like children
        if (parent.id === "top-level-buttons" || 
            parent.id === "top-level-buttons-computed" ||
            parent.classList.contains("ytd-menu-renderer") ||
            (parent.children && Array.from(parent.children).some(child => 
              child.tagName === 'YTD-BUTTON-RENDERER' || 
              child.tagName === 'BUTTON' ||
              child.id?.includes('button')
            ))) {
          buttonsContainer = parent;
          break;
        }
        parent = parent.parentElement;
      }
    }
  }
  
  // Strategy 4: Find by Share button
  if (!buttonsContainer) {
    const shareButton = document.querySelector(
      "button[aria-label*='Share' i], " +
      "ytd-button-renderer button[aria-label*='Share' i], " +
      "ytd-menu-renderer button[aria-label*='Share' i]"
    );
    
    if (shareButton) {
      let parent = shareButton.closest("ytd-button-renderer") || shareButton.parentElement;
      if (parent && parent.parentElement) {
        buttonsContainer = parent.parentElement;
      }
    }
  }
  
  // Strategy 5: Find any container with multiple ytd-button-renderer children
  if (!buttonsContainer) {
    const allButtons = document.querySelectorAll("ytd-button-renderer, ytd-toggle-button-renderer");
    if (allButtons.length > 0) {
      const firstButton = allButtons[0];
      let parent = firstButton.parentElement;
      // Check if this parent has multiple button children
      if (parent && parent.children.length >= 2) {
        buttonsContainer = parent;
      }
    }
  }

  if (!buttonsContainer) {
    // Log for debugging
    console.log("[YT Downloader] Could not find button container, will retry");
    return;
  }
  
  console.log("[YT Downloader] Found button container, injecting download button");

  const downloadBtn = createDownloadButton();
  
  // Try to insert after Share button or at the end
  const shareButton = buttonsContainer.querySelector(
    "button[aria-label*='Share' i], " +
    "ytd-button-renderer button[aria-label*='Share' i]"
  );
  
  if (shareButton) {
    // Find the Share button's parent container (ytd-button-renderer)
    const shareParent = shareButton.closest("ytd-button-renderer");
    if (shareParent && shareParent.nextSibling) {
      // Insert after Share button
      shareParent.parentNode.insertBefore(downloadBtn, shareParent.nextSibling);
    } else if (shareParent && shareParent.parentNode) {
      // Append after Share button's parent
      shareParent.parentNode.appendChild(downloadBtn);
    } else {
      // Append to container
      buttonsContainer.appendChild(downloadBtn);
    }
  } else {
    // No Share button found, append to the end
    buttonsContainer.appendChild(downloadBtn);
  }
}

// Helper function to attempt injection with retries
function attemptInjection(retries = 10, delay = 200) {
  const tryInject = () => {
    const existingBtn = document.getElementById("ytvd-download-icon-btn");
    if (existingBtn && existingBtn.isConnected) {
      return; // Button already exists
    }
    
    injectDownloadButton();
    
    // Check if injection was successful
    const checkBtn = document.getElementById("ytvd-download-icon-btn");
    if (!checkBtn || !checkBtn.isConnected) {
      // Injection failed, retry if we have retries left
      if (retries > 0) {
        setTimeout(tryInject, delay);
      }
    }
  };
  
  tryInject();
}

// Observe for dynamic navigation on YouTube (SPA behavior)
const observer = new MutationObserver(() => {
  // Debounce to avoid excessive calls
  clearTimeout(window.ytvdInjectTimeout);
  window.ytvdInjectTimeout = setTimeout(() => {
    const existingBtn = document.getElementById("ytvd-download-icon-btn");
    if (!existingBtn || !existingBtn.isConnected) {
      attemptInjection(3, 150); // Quick retry on mutations
    }
  }, 150);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Attempt injection immediately and with retries
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    attemptInjection(10, 200);
  });
} else {
  // Page already loaded, try immediately with retries
  attemptInjection(10, 200);
}

// Also listen for YouTube's navigation events (yt-navigate-finish)
window.addEventListener("yt-navigate-finish", () => {
  setTimeout(() => attemptInjection(5, 300), 500);
});

// Listen for any hash changes (YouTube SPA navigation)
window.addEventListener("hashchange", () => {
  setTimeout(() => attemptInjection(5, 300), 500);
});


