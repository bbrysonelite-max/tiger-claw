# OpenClaw Accessibility Requirements

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. OVERVIEW

### 1.1 Scope

| Component | Accessibility Required | Priority |
|-----------|----------------------|----------|
| WebChat UI | Yes | P0 |
| Control UI (Dashboard) | Yes | P1 |
| CLI | Partial (screen reader compatible) | P1 |
| Canvas Outputs | Best effort | P2 |
| macOS App | Follow Apple guidelines | P2 |
| iOS/Android Apps | Follow platform guidelines | P2 |

### 1.2 Compliance Target

**WCAG 2.1 Level AA**

This is the widely accepted standard for web accessibility and covers:
- Level A: Basic accessibility
- Level AA: Addresses major barriers (our target)
- Level AAA: Enhanced accessibility (aspirational)

### 1.3 Key Principles (POUR)

| Principle | Description |
|-----------|-------------|
| **Perceivable** | Information must be presentable to users in ways they can perceive |
| **Operable** | Interface must be operable by all users |
| **Understandable** | Information and operation must be understandable |
| **Robust** | Content must be robust enough for diverse user agents |

---

## 2. VISUAL REQUIREMENTS

### 2.1 Color Contrast

| Element | Minimum Ratio (AA) | Enhanced Ratio (AAA) |
|---------|-------------------|---------------------|
| Normal text | 4.5:1 | 7:1 |
| Large text (18pt+) | 3:1 | 4.5:1 |
| UI components | 3:1 | 3:1 |
| Focus indicators | 3:1 | 3:1 |

**Implementation:**

```css
/* OpenClaw Color Palette - Accessible */
:root {
  /* Text colors */
  --text-primary: #1a1a1a;      /* On white: 16:1 */
  --text-secondary: #595959;    /* On white: 7:1 */
  --text-muted: #767676;        /* On white: 4.5:1 (minimum) */
  
  /* Background colors */
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-accent: #e8f4f8;
  
  /* Interactive colors */
  --interactive-primary: #0066cc;   /* On white: 4.5:1 */
  --interactive-hover: #004d99;     /* On white: 7:1 */
  --interactive-focus: #0066cc;
  
  /* Status colors - checked for contrast */
  --success: #0a7c42;           /* On white: 4.5:1 */
  --warning: #7a5a00;           /* On white: 4.5:1 */
  --error: #c41e3a;             /* On white: 4.5:1 */
  
  /* Dark mode equivalents */
  --dark-text-primary: #f0f0f0;
  --dark-text-secondary: #b0b0b0;
  --dark-bg-primary: #1a1a1a;
}
```

### 2.2 Color Independence

**Rule:** Never use color as the only means of conveying information.

```html
<!-- ❌ Bad: Only color indicates error -->
<input style="border-color: red;">

<!-- ✅ Good: Color + icon + text -->
<div class="input-wrapper error">
  <input aria-invalid="true" aria-describedby="error-msg">
  <span class="error-icon" aria-hidden="true">⚠️</span>
  <span id="error-msg" class="error-text">Invalid email format</span>
</div>
```

### 2.3 Text Sizing

| Requirement | Specification |
|-------------|---------------|
| Minimum body text | 16px |
| Minimum interactive text | 14px |
| Line height | 1.5 minimum |
| Paragraph spacing | 1.5× font size |
| Letter spacing | Not less than 0.12× font size |
| Word spacing | Not less than 0.16× font size |

**Implementation:**

```css
/* Base typography - accessible */
body {
  font-size: 16px;
  line-height: 1.5;
}

p {
  margin-bottom: 1.5em;
}

/* User can resize up to 200% without loss of functionality */
html {
  font-size: 100%; /* Respects user preferences */
}

/* Responsive text that scales with user settings */
.message-text {
  font-size: 1rem; /* 16px default, scales with user preference */
  line-height: 1.6;
}
```

### 2.4 Focus Indicators

**Rule:** All interactive elements must have visible focus indicators.

```css
/* Focus styles - highly visible */
:focus {
  outline: 3px solid var(--interactive-focus);
  outline-offset: 2px;
}

/* Remove default only if custom focus is better */
:focus:not(:focus-visible) {
  outline: none;
}

:focus-visible {
  outline: 3px solid var(--interactive-focus);
  outline-offset: 2px;
  box-shadow: 0 0 0 6px rgba(0, 102, 204, 0.25);
}

/* Ensure focus is visible on all backgrounds */
.dark-bg :focus-visible {
  outline-color: #ffffff;
}
```

---

## 3. KEYBOARD NAVIGATION

### 3.1 Requirements

| Requirement | WCAG Criterion |
|-------------|----------------|
| All functionality keyboard accessible | 2.1.1 |
| No keyboard traps | 2.1.2 |
| Logical focus order | 2.4.3 |
| Focus visible | 2.4.7 |
| Skip links | 2.4.1 |

### 3.2 Focus Management

```typescript
// Focus management utilities
class FocusManager {
  private focusHistory: HTMLElement[] = [];
  
  // Save focus before opening modal
  saveFocus(): void {
    const active = document.activeElement as HTMLElement;
    if (active) {
      this.focusHistory.push(active);
    }
  }
  
  // Restore focus when modal closes
  restoreFocus(): void {
    const previous = this.focusHistory.pop();
    if (previous && document.contains(previous)) {
      previous.focus();
    }
  }
  
  // Trap focus within container (for modals)
  trapFocus(container: HTMLElement): () => void {
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    
    container.addEventListener('keydown', handleKeydown);
    first?.focus();
    
    return () => container.removeEventListener('keydown', handleKeydown);
  }
}
```

### 3.3 Keyboard Shortcuts

```typescript
// Keyboard shortcuts with accessibility considerations
const SHORTCUTS = {
  // Navigation
  'Alt+1': { action: 'focusChat', description: 'Focus chat input' },
  'Alt+2': { action: 'focusSidebar', description: 'Focus sidebar' },
  
  // Actions
  'Ctrl+Enter': { action: 'send', description: 'Send message' },
  'Escape': { action: 'cancel', description: 'Cancel/close' },
  
  // Accessibility
  'Alt+0': { action: 'showShortcuts', description: 'Show keyboard shortcuts' },
};

// Shortcuts must be:
// 1. Discoverable (documented, shown in UI)
// 2. Not conflicting with browser/screen reader shortcuts
// 3. Customizable if possible
```

### 3.4 Skip Links

```html
<!-- Skip links for keyboard users -->
<body>
  <a href="#main-content" class="skip-link">
    Skip to main content
  </a>
  <a href="#chat-input" class="skip-link">
    Skip to chat input
  </a>
  
  <nav aria-label="Main navigation">
    <!-- Navigation content -->
  </nav>
  
  <main id="main-content" tabindex="-1">
    <!-- Main content -->
    
    <div id="chat-input" tabindex="-1">
      <!-- Chat input -->
    </div>
  </main>
</body>

<style>
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px 16px;
  background: var(--interactive-primary);
  color: white;
  z-index: 1000;
}

.skip-link:focus {
  top: 0;
}
</style>
```

---

## 4. SCREEN READER SUPPORT

### 4.1 Semantic HTML

```html
<!-- ✅ Good: Semantic structure -->
<main>
  <article class="chat-message" aria-labelledby="msg-1-sender">
    <header>
      <h3 id="msg-1-sender">Birdie</h3>
      <time datetime="2026-02-26T13:00:00">1:00 PM</time>
    </header>
    <p>Hello! How can I help you today?</p>
  </article>
</main>

<!-- ❌ Bad: Div soup -->
<div class="main">
  <div class="chat-message">
    <div class="header">
      <div class="sender">Birdie</div>
      <div class="time">1:00 PM</div>
    </div>
    <div class="content">Hello! How can I help you today?</div>
  </div>
</div>
```

### 4.2 ARIA Labels

```html
<!-- Interactive elements need accessible names -->
<button aria-label="Send message">
  <svg aria-hidden="true"><!-- Send icon --></svg>
</button>

<!-- Form inputs need labels -->
<label for="chat-input" class="visually-hidden">
  Type your message
</label>
<textarea 
  id="chat-input" 
  aria-describedby="input-instructions"
  placeholder="Type your message..."
></textarea>
<div id="input-instructions" class="visually-hidden">
  Press Enter to send, Shift+Enter for new line
</div>

<!-- Live regions for dynamic content -->
<div 
  id="message-list" 
  role="log" 
  aria-live="polite" 
  aria-relevant="additions"
>
  <!-- Messages appear here -->
</div>

<!-- Status announcements -->
<div 
  id="status" 
  role="status" 
  aria-live="polite" 
  class="visually-hidden"
>
  <!-- "Message sent", "Typing...", etc. -->
</div>
```

### 4.3 Live Regions

```typescript
// Announce status changes to screen readers
class ScreenReaderAnnouncer {
  private statusRegion: HTMLElement;
  private alertRegion: HTMLElement;
  
  constructor() {
    this.statusRegion = this.createRegion('polite');
    this.alertRegion = this.createRegion('assertive');
  }
  
  // Polite announcements (non-urgent)
  announce(message: string): void {
    this.statusRegion.textContent = '';
    // Small delay ensures announcement is read
    setTimeout(() => {
      this.statusRegion.textContent = message;
    }, 100);
  }
  
  // Assertive announcements (urgent)
  alert(message: string): void {
    this.alertRegion.textContent = '';
    setTimeout(() => {
      this.alertRegion.textContent = message;
    }, 100);
  }
  
  private createRegion(politeness: 'polite' | 'assertive'): HTMLElement {
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', politeness);
    region.classList.add('visually-hidden');
    document.body.appendChild(region);
    return region;
  }
}

// Usage
const announcer = new ScreenReaderAnnouncer();
announcer.announce('Message sent'); // Non-urgent
announcer.alert('Error: Failed to send message'); // Urgent
```

### 4.4 Visually Hidden Utility

```css
/* Hide visually but keep accessible to screen readers */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Allow element to be focusable when hidden */
.visually-hidden-focusable:focus {
  position: static;
  width: auto;
  height: auto;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

---

## 5. MOTION AND ANIMATION

### 5.1 Reduced Motion

```css
/* Respect user's motion preferences */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Safe animations that don't trigger vestibular issues */
.message-appear {
  animation: fadeIn 200ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Avoid these patterns */
/* ❌ Parallax scrolling */
/* ❌ Zoom animations */
/* ❌ Spinning/rotating */
/* ❌ Auto-playing videos/animations */
```

### 5.2 Animation Guidelines

| Do | Don't |
|-----|-------|
| Use subtle fade transitions | Use flashing content (>3 times/sec) |
| Keep animations under 500ms | Use parallax effects |
| Provide pause controls | Auto-play long animations |
| Use opacity/transform only | Use motion as only feedback |

---

## 6. FORMS AND INPUTS

### 6.1 Form Accessibility

```html
<!-- Accessible form structure -->
<form aria-labelledby="form-title">
  <h2 id="form-title">Settings</h2>
  
  <!-- Group related fields -->
  <fieldset>
    <legend>Notification Preferences</legend>
    
    <div class="form-field">
      <label for="email-notifications">
        Email notifications
      </label>
      <select id="email-notifications" aria-describedby="email-help">
        <option value="all">All notifications</option>
        <option value="important">Important only</option>
        <option value="none">None</option>
      </select>
      <p id="email-help" class="help-text">
        Choose how often you receive email notifications
      </p>
    </div>
  </fieldset>
  
  <!-- Error handling -->
  <div class="form-field" aria-invalid="true">
    <label for="api-key">
      API Key <span aria-hidden="true">*</span>
      <span class="visually-hidden">(required)</span>
    </label>
    <input 
      id="api-key" 
      type="text" 
      required
      aria-describedby="api-key-error"
    >
    <p id="api-key-error" class="error-text" role="alert">
      API key is required
    </p>
  </div>
  
  <button type="submit">Save Settings</button>
</form>
```

### 6.2 Error Handling

```typescript
// Accessible error handling
function handleFormErrors(errors: FormError[]): void {
  // 1. Announce errors to screen readers
  const errorCount = errors.length;
  announcer.alert(
    errorCount === 1 
      ? 'There is 1 error in the form' 
      : `There are ${errorCount} errors in the form`
  );
  
  // 2. Show error summary at top
  const summary = document.getElementById('error-summary');
  summary.innerHTML = `
    <h3>Please fix the following errors:</h3>
    <ul>
      ${errors.map(e => `
        <li><a href="#${e.fieldId}">${e.message}</a></li>
      `).join('')}
    </ul>
  `;
  
  // 3. Focus error summary
  summary.focus();
  
  // 4. Mark invalid fields
  errors.forEach(error => {
    const field = document.getElementById(error.fieldId);
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', `${error.fieldId}-error`);
  });
}
```

---

## 7. IMAGES AND MEDIA

### 7.1 Image Requirements

```html
<!-- Informative images need alt text -->
<img 
  src="diagram.png" 
  alt="Architecture diagram showing Gateway, Channels, and Agent components"
>

<!-- Decorative images should be hidden -->
<img src="decoration.png" alt="" role="presentation">

<!-- Complex images need long descriptions -->
<figure>
  <img 
    src="chart.png" 
    alt="Monthly usage chart" 
    aria-describedby="chart-description"
  >
  <figcaption id="chart-description">
    Bar chart showing message volume from January to December 2026.
    January: 1,200 messages. February: 1,500 messages...
  </figcaption>
</figure>

<!-- SVG icons -->
<button>
  <svg aria-hidden="true" focusable="false">
    <use href="#icon-send"></use>
  </svg>
  <span class="visually-hidden">Send message</span>
</button>
```

### 7.2 Audio/Video

```html
<!-- Video with captions -->
<video controls>
  <source src="tutorial.mp4" type="video/mp4">
  <track 
    kind="captions" 
    src="tutorial-captions.vtt" 
    srclang="en" 
    label="English"
    default
  >
  <track 
    kind="descriptions" 
    src="tutorial-descriptions.vtt" 
    srclang="en" 
    label="Audio descriptions"
  >
  <!-- Fallback content -->
  <p>Your browser doesn't support video. 
     <a href="tutorial.mp4">Download the video</a>.
  </p>
</video>

<!-- Audio with transcript -->
<audio controls aria-describedby="audio-transcript">
  <source src="message.mp3" type="audio/mpeg">
</audio>
<details id="audio-transcript">
  <summary>Show transcript</summary>
  <p>Transcribed text of the audio message...</p>
</details>
```

---

## 8. TESTING

### 8.1 Automated Testing

```typescript
// Using axe-core for automated accessibility testing
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('WebChat accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(<WebChat />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
  
  it('should have proper heading hierarchy', async () => {
    const { container } = render(<WebChat />);
    const results = await axe(container, {
      rules: {
        'heading-order': { enabled: true }
      }
    });
    expect(results).toHaveNoViolations();
  });
});
```

### 8.2 Manual Testing Checklist

```markdown
## Accessibility Manual Test Checklist

### Keyboard Navigation
- [ ] Can reach all interactive elements with Tab
- [ ] Tab order is logical (left-to-right, top-to-bottom)
- [ ] Focus indicator is always visible
- [ ] Can activate buttons/links with Enter/Space
- [ ] Can escape modals/dropdowns with Escape
- [ ] No keyboard traps

### Screen Reader (VoiceOver/NVDA)
- [ ] Page title is announced
- [ ] Headings are properly structured (h1 > h2 > h3)
- [ ] Images have appropriate alt text
- [ ] Form fields have labels
- [ ] Error messages are announced
- [ ] Live regions announce dynamic content
- [ ] Links/buttons have accessible names

### Visual
- [ ] Text contrast meets 4.5:1 minimum
- [ ] UI works at 200% zoom
- [ ] Information not conveyed by color alone
- [ ] Focus indicators visible
- [ ] Text resizable without loss of functionality

### Motion
- [ ] Animations respect prefers-reduced-motion
- [ ] No content flashes more than 3 times per second
- [ ] Auto-playing media can be paused

### Forms
- [ ] All inputs have visible labels
- [ ] Required fields are indicated
- [ ] Errors are clearly communicated
- [ ] Error messages linked to fields
```

### 8.3 Screen Reader Testing Matrix

| Screen Reader | Browser | OS | Priority |
|---------------|---------|-----|----------|
| VoiceOver | Safari | macOS | P0 |
| VoiceOver | Safari | iOS | P1 |
| NVDA | Firefox | Windows | P0 |
| NVDA | Chrome | Windows | P1 |
| JAWS | Chrome | Windows | P2 |
| TalkBack | Chrome | Android | P1 |

---

## 9. CLI ACCESSIBILITY

### 9.1 Requirements

```typescript
// CLI output should be screen reader friendly

// ❌ Bad: Visual-only formatting
console.log('████████░░ 80%');

// ✅ Good: Text-based with visual
console.log('Progress: 80% [████████░░]');

// ❌ Bad: Color-only status
console.log(chalk.red('●') + ' Error');

// ✅ Good: Text + color
console.log(chalk.red('✗ Error:') + ' Connection failed');

// ❌ Bad: Table with box drawing only
console.log('┌────┬────┐');

// ✅ Good: Alternative plain text format
console.log('Status | Channel');
console.log('-------|--------');
console.log('OK     | Telegram');
```

### 9.2 Progress Indicators

```typescript
// Accessible progress for CLI
function printProgress(current: number, total: number): void {
  const percent = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(percent / 5)) + 
              '░'.repeat(20 - Math.floor(percent / 5));
  
  // Clear line and print
  process.stdout.write(`\rProgress: ${percent}% [${bar}] ${current}/${total}`);
  
  // Announce milestones
  if (percent % 25 === 0 && percent > 0) {
    // This will be read by screen readers
    console.log(`\n${percent}% complete`);
  }
}
```

---

## 10. DOCUMENTATION

### 10.1 Accessibility Statement

```markdown
# Accessibility Statement

OpenClaw is committed to ensuring digital accessibility for people with 
disabilities. We continually improve the user experience and apply 
relevant accessibility standards.

## Conformance Status

OpenClaw WebChat and Control UI aim to conform to WCAG 2.1 Level AA.

## Feedback

We welcome your feedback on accessibility. Please contact us at:
- Email: accessibility@openclaw.ai
- GitHub: github.com/openclaw/openclaw/issues

## Known Issues

- [Issue description and workaround]
- [Issue description and workaround]

Last updated: February 2026
```

### 10.2 Keyboard Shortcuts Documentation

```markdown
# Keyboard Shortcuts

## Global
| Shortcut | Action |
|----------|--------|
| Alt + 0 | Show this help |
| Alt + 1 | Focus chat input |
| Alt + 2 | Focus message list |

## Chat Input
| Shortcut | Action |
|----------|--------|
| Enter | Send message |
| Shift + Enter | New line |
| Escape | Clear input |

## Navigation
| Shortcut | Action |
|----------|--------|
| Tab | Next element |
| Shift + Tab | Previous element |
| Arrow keys | Navigate within components |
```

---

*This accessibility specification ensures OpenClaw is usable by people with disabilities.*
