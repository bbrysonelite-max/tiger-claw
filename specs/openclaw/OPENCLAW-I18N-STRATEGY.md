# OpenClaw Internationalization (i18n) Strategy

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. OVERVIEW

### 1.1 Scope

| Component | i18n Required | Priority |
|-----------|---------------|----------|
| User-facing error messages | Yes | P0 |
| System notifications | Yes | P0 |
| CLI output | Yes | P1 |
| WebChat UI | Yes | P1 |
| Control UI | Yes | P2 |
| Documentation | Future | P3 |
| Log messages | No | - |

### 1.2 Target Languages (Phase 1)

| Language | Code | Region | Priority |
|----------|------|--------|----------|
| English | en | Global (default) | P0 |
| Thai | th | Thailand (LINE) | P1 |
| Spanish | es | LatAm, Spain | P1 |
| Chinese (Simplified) | zh-CN | China | P2 |
| Japanese | ja | Japan | P2 |
| Portuguese | pt-BR | Brazil | P2 |

### 1.3 Design Principles

1. **English as source**: All strings authored in English first
2. **Fallback chain**: Requested locale → Language → English
3. **Runtime resolution**: No restart required for language changes
4. **Externalized strings**: All user-facing text in resource files
5. **ICU MessageFormat**: For pluralization and interpolation

---

## 2. STRING EXTERNALIZATION

### 2.1 Resource File Structure

```
locales/
├── en/
│   ├── common.json          # Shared strings
│   ├── errors.json          # Error messages
│   ├── notifications.json   # System notifications
│   ├── cli.json            # CLI output
│   └── ui.json             # WebChat/Control UI
├── th/
│   ├── common.json
│   ├── errors.json
│   └── ...
├── es/
│   └── ...
└── index.ts                 # Loader
```

### 2.2 Resource File Format

```json
{
  "$schema": "openclaw-i18n.schema.json",
  "locale": "en",
  "namespace": "errors",
  "strings": {
    "NETWORK_TIMEOUT": {
      "message": "Request timed out after {seconds} seconds",
      "description": "Shown when a network request times out",
      "placeholders": {
        "seconds": {
          "type": "number",
          "example": "30"
        }
      }
    },
    "RATE_LIMITED": {
      "message": "Too many requests. Please wait {duration}.",
      "description": "Shown when rate limited",
      "placeholders": {
        "duration": {
          "type": "string",
          "example": "30 seconds"
        }
      }
    },
    "ITEMS_FOUND": {
      "message": "{count, plural, =0 {No items found} one {# item found} other {# items found}}",
      "description": "Search results count with pluralization"
    }
  }
}
```

### 2.3 String Key Convention

```
NAMESPACE.CATEGORY.SPECIFIC_KEY

Examples:
  errors.network.TIMEOUT
  errors.auth.INVALID_TOKEN
  notifications.session.STARTED
  ui.buttons.SEND
  cli.commands.HELP_TEXT
```

---

## 3. IMPLEMENTATION

### 3.1 i18n Library

```typescript
// Using ICU MessageFormat via @formatjs/intl
import { createIntl, createIntlCache } from '@formatjs/intl';

interface I18nConfig {
  defaultLocale: string;
  supportedLocales: string[];
  fallbackLocale: string;
  loadPath: string;
}

class I18nService {
  private cache = createIntlCache();
  private intl: Map<string, IntlShape> = new Map();
  private messages: Map<string, Record<string, string>> = new Map();
  
  constructor(private config: I18nConfig) {}
  
  async loadLocale(locale: string): Promise<void> {
    if (this.messages.has(locale)) return;
    
    const messages = await this.loadMessages(locale);
    this.messages.set(locale, messages);
    
    this.intl.set(locale, createIntl({
      locale,
      messages,
    }, this.cache));
  }
  
  t(key: string, values?: Record<string, unknown>, locale?: string): string {
    const resolvedLocale = this.resolveLocale(locale);
    const intl = this.intl.get(resolvedLocale);
    
    if (!intl) {
      return this.fallback(key, values);
    }
    
    try {
      return intl.formatMessage({ id: key }, values);
    } catch (e) {
      return this.fallback(key, values);
    }
  }
  
  private resolveLocale(requested?: string): string {
    if (requested && this.intl.has(requested)) {
      return requested;
    }
    
    // Try language without region (e.g., "en" from "en-US")
    if (requested) {
      const lang = requested.split('-')[0];
      if (this.intl.has(lang)) {
        return lang;
      }
    }
    
    return this.config.fallbackLocale;
  }
  
  private fallback(key: string, values?: Record<string, unknown>): string {
    // Return key with values for debugging
    const valueStr = values ? ` [${JSON.stringify(values)}]` : '';
    return `{{${key}${valueStr}}}`;
  }
}

// Singleton instance
export const i18n = new I18nService({
  defaultLocale: 'en',
  supportedLocales: ['en', 'th', 'es', 'zh-CN', 'ja', 'pt-BR'],
  fallbackLocale: 'en',
  loadPath: './locales',
});
```

### 3.2 Usage Patterns

```typescript
// Simple translation
const msg = i18n.t('errors.network.TIMEOUT', { seconds: 30 });
// → "Request timed out after 30 seconds"

// With pluralization
const msg = i18n.t('errors.ITEMS_FOUND', { count: 5 });
// → "5 items found"

// With locale override
const msg = i18n.t('errors.network.TIMEOUT', { seconds: 30 }, 'th');
// → "คำขอหมดเวลาหลังจาก 30 วินาที"

// In component
function ErrorMessage({ error, locale }: Props) {
  return <p>{i18n.t(`errors.${error.code}`, error.params, locale)}</p>;
}
```

### 3.3 Locale Resolution

```typescript
function resolveUserLocale(context: Context): string {
  // Priority order:
  // 1. User preference (stored in session)
  if (context.session?.locale) {
    return context.session.locale;
  }
  
  // 2. Channel-provided locale
  if (context.message?.locale) {
    return context.message.locale;
  }
  
  // 3. Config default
  if (context.config?.defaultLocale) {
    return context.config.defaultLocale;
  }
  
  // 4. System default
  return 'en';
}
```

---

## 4. DATE/TIME/NUMBER FORMATTING

### 4.1 Date Formatting

```typescript
// Use Intl.DateTimeFormat with locale-aware formatting
function formatDate(date: Date, locale: string, style: 'short' | 'long' = 'short'): string {
  const options: Intl.DateTimeFormatOptions = {
    short: { dateStyle: 'short', timeStyle: 'short' },
    long: { dateStyle: 'full', timeStyle: 'long' },
  }[style];
  
  return new Intl.DateTimeFormat(locale, options).format(date);
}

// Examples:
formatDate(new Date(), 'en-US', 'short');  // "2/26/26, 1:30 PM"
formatDate(new Date(), 'th', 'short');     // "26/2/69 13:30"
formatDate(new Date(), 'ja', 'short');     // "2026/02/26 13:30"
```

### 4.2 Relative Time

```typescript
// Use Intl.RelativeTimeFormat for "5 minutes ago"
function formatRelativeTime(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  return rtf.format(diffDay, 'day');
}

// Examples:
formatRelativeTime(fiveMinutesAgo, 'en');  // "5 minutes ago"
formatRelativeTime(fiveMinutesAgo, 'th');  // "5 นาทีที่ผ่านมา"
```

### 4.3 Number Formatting

```typescript
// Use Intl.NumberFormat for locale-aware numbers
function formatNumber(num: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(num);
}

// Currency
function formatCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

// Examples:
formatNumber(1234567.89, 'en-US');        // "1,234,567.89"
formatNumber(1234567.89, 'th');           // "1,234,567.89"
formatNumber(1234567.89, 'de');           // "1.234.567,89"
formatCurrency(99.99, 'USD', 'en-US');    // "$99.99"
formatCurrency(99.99, 'THB', 'th');       // "฿99.99"
```

### 4.4 Duration Formatting

```typescript
// Format durations in locale-aware way
function formatDuration(ms: number, locale: string): string {
  const units = [
    { unit: 'hour', ms: 3600000 },
    { unit: 'minute', ms: 60000 },
    { unit: 'second', ms: 1000 },
  ];
  
  const parts: string[] = [];
  let remaining = ms;
  
  for (const { unit, ms: unitMs } of units) {
    const value = Math.floor(remaining / unitMs);
    if (value > 0) {
      parts.push(new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'long',
      }).format(value));
      remaining %= unitMs;
    }
  }
  
  return parts.join(', ') || formatNumber(0, locale) + ' seconds';
}

// Examples:
formatDuration(3661000, 'en');  // "1 hour, 1 minute, 1 second"
formatDuration(3661000, 'th');  // "1 ชั่วโมง, 1 นาที, 1 วินาที"
```

---

## 5. RIGHT-TO-LEFT (RTL) SUPPORT

### 5.1 RTL Languages

| Language | Code | Direction |
|----------|------|-----------|
| Arabic | ar | RTL |
| Hebrew | he | RTL |
| Persian | fa | RTL |
| Urdu | ur | RTL |

**Note:** RTL languages are not in Phase 1 but architecture should support them.

### 5.2 RTL Implementation

```typescript
// Detect RTL locale
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

function isRTL(locale: string): boolean {
  const lang = locale.split('-')[0];
  return RTL_LOCALES.has(lang);
}

// CSS approach
function getDirectionStyles(locale: string): CSSProperties {
  return {
    direction: isRTL(locale) ? 'rtl' : 'ltr',
    textAlign: isRTL(locale) ? 'right' : 'left',
  };
}
```

### 5.3 Bidirectional Text

```typescript
// Use Unicode bidi markers for mixed content
const LTR_MARK = '\u200E';
const RTL_MARK = '\u200F';

function wrapWithDirection(text: string, direction: 'ltr' | 'rtl'): string {
  const mark = direction === 'rtl' ? RTL_MARK : LTR_MARK;
  return `${mark}${text}${mark}`;
}
```

---

## 6. TRANSLATION WORKFLOW

### 6.1 Process

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TRANSLATION WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. AUTHOR (Developer)                                              │
│     └── Add English string to locales/en/*.json                     │
│     └── Include description and placeholders                        │
│     └── Run: openclaw i18n validate                                 │
│                                                                     │
│  2. EXTRACT                                                         │
│     └── CI extracts new/changed strings                             │
│     └── Generate translation request file                           │
│     └── Upload to translation platform (Crowdin/Lokalise)           │
│                                                                     │
│  3. TRANSLATE                                                       │
│     └── Professional translators translate                          │
│     └── Native speakers review                                      │
│     └── Mark as approved                                            │
│                                                                     │
│  4. SYNC                                                            │
│     └── Download approved translations                              │
│     └── Run: openclaw i18n compile                                  │
│     └── Create PR with updated locales                              │
│                                                                     │
│  5. VERIFY                                                          │
│     └── Automated tests for missing strings                         │
│     └── Visual review for truncation/layout                        │
│     └── Merge PR                                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 String Change Guidelines

**Adding new strings:**
1. Add to English locale first
2. Include description for translators
3. Mark as `"status": "new"` for extraction

**Modifying strings:**
1. Keep same key if meaning unchanged
2. Create new key if meaning changes
3. Mark as `"status": "modified"` for re-translation

**Removing strings:**
1. Mark as `"status": "deprecated"` first
2. Remove after one release cycle
3. Update all locale files

### 6.3 Translation Memory

```json
{
  "translation_memory": {
    "common_phrases": {
      "Try again": {
        "en": "Try again",
        "th": "ลองอีกครั้ง",
        "es": "Intentar de nuevo"
      },
      "Please wait": {
        "en": "Please wait",
        "th": "กรุณารอ",
        "es": "Por favor espere"
      }
    }
  }
}
```

---

## 7. CHANNEL-SPECIFIC CONSIDERATIONS

### 7.1 Telegram

```typescript
// Telegram provides user's language_code
function getTelegramLocale(ctx: TelegramContext): string {
  return ctx.from?.language_code || 'en';
}

// Telegram supports Unicode fully
// No special handling needed
```

### 7.2 WhatsApp

```typescript
// WhatsApp doesn't provide user locale
// Use session preference or config default
function getWhatsAppLocale(session: Session): string {
  return session.preferences?.locale || 'en';
}
```

### 7.3 LINE (Thailand)

```typescript
// LINE is primary channel for Thailand
// Default to Thai for LINE users
function getLineLocale(ctx: LineContext): string {
  return ctx.event?.source?.userId 
    ? (userPreferences.get(ctx.event.source.userId)?.locale || 'th')
    : 'th';
}
```

### 7.4 Discord

```typescript
// Discord provides locale per user and guild
function getDiscordLocale(interaction: Interaction): string {
  return interaction.locale || interaction.guildLocale || 'en';
}
```

---

## 8. TESTING

### 8.1 i18n Test Cases

```typescript
describe('i18n', () => {
  describe('translation coverage', () => {
    it('should have all keys in all locales', () => {
      const enKeys = Object.keys(loadLocale('en'));
      
      for (const locale of SUPPORTED_LOCALES) {
        if (locale === 'en') continue;
        const localeKeys = Object.keys(loadLocale(locale));
        const missing = enKeys.filter(k => !localeKeys.includes(k));
        expect(missing).toHaveLength(0, 
          `Missing keys in ${locale}: ${missing.join(', ')}`
        );
      }
    });
  });
  
  describe('placeholder consistency', () => {
    it('should have same placeholders in all translations', () => {
      const enStrings = loadLocale('en');
      
      for (const [key, enValue] of Object.entries(enStrings)) {
        const enPlaceholders = extractPlaceholders(enValue);
        
        for (const locale of SUPPORTED_LOCALES) {
          if (locale === 'en') continue;
          const localeValue = loadLocale(locale)[key];
          const localePlaceholders = extractPlaceholders(localeValue);
          
          expect(localePlaceholders).toEqual(enPlaceholders,
            `Placeholder mismatch for ${key} in ${locale}`
          );
        }
      }
    });
  });
  
  describe('pluralization', () => {
    it('should handle plural forms correctly', () => {
      expect(i18n.t('items.count', { count: 0 }, 'en')).toBe('No items');
      expect(i18n.t('items.count', { count: 1 }, 'en')).toBe('1 item');
      expect(i18n.t('items.count', { count: 5 }, 'en')).toBe('5 items');
    });
  });
  
  describe('fallback', () => {
    it('should fallback to English for missing translations', () => {
      const result = i18n.t('errors.NETWORK_TIMEOUT', { seconds: 30 }, 'xx');
      expect(result).toBe('Request timed out after 30 seconds');
    });
  });
});
```

### 8.2 Visual Testing

```typescript
// Pseudo-localization for catching hardcoded strings
function pseudoLocalize(text: string): string {
  const map: Record<string, string> = {
    'a': 'α', 'b': 'β', 'c': 'ç', 'd': 'δ', 'e': 'ε',
    'f': 'ƒ', 'g': 'ğ', 'h': 'ħ', 'i': 'ι', 'j': 'ĵ',
    // ... more mappings
  };
  
  return text
    .split('')
    .map(c => map[c.toLowerCase()] || c)
    .join('');
}

// Use pseudo-locale "qps-ploc" for testing
// "Hello World" → "[Ħεℓℓο Ŵοřℓδ!!!]"
```

---

## 9. CONFIGURATION

### 9.1 Config Schema

```json5
{
  "i18n": {
    // Default locale for the system
    "defaultLocale": "en",
    
    // Supported locales (others fall back to default)
    "supportedLocales": ["en", "th", "es", "zh-CN", "ja", "pt-BR"],
    
    // Locale detection order
    "localeDetection": ["session", "channel", "config"],
    
    // Per-channel default locale
    "channelLocales": {
      "line": "th",
      "zalo": "vi"
    },
    
    // Date/time format preferences
    "dateFormat": {
      "style": "short",  // short | long | full
      "hour12": null     // null = locale default, true/false = override
    },
    
    // Number format preferences
    "numberFormat": {
      "useGrouping": true
    }
  }
}
```

### 9.2 CLI Commands

```bash
# Validate locale files
openclaw i18n validate

# Check translation coverage
openclaw i18n coverage

# Extract new strings
openclaw i18n extract --output translations-needed.json

# Compile locale files (optimize for production)
openclaw i18n compile

# Add new locale
openclaw i18n add-locale pt-BR

# Test with pseudo-localization
openclaw gateway --locale pseudo
```

---

## 10. ROLLOUT PLAN

### Phase 1: Infrastructure (Week 1-2)
- [ ] Implement i18n service
- [ ] Set up locale file structure
- [ ] Create extraction tooling
- [ ] Add English locale files

### Phase 2: Core Strings (Week 3-4)
- [ ] Extract all error messages
- [ ] Extract all notifications
- [ ] Extract CLI output
- [ ] Code review for hardcoded strings

### Phase 3: Thai Translation (Week 5-6)
- [ ] Professional Thai translation
- [ ] Native speaker review
- [ ] Integration testing
- [ ] LINE channel testing

### Phase 4: Additional Languages (Week 7-8)
- [ ] Spanish translation
- [ ] Chinese (Simplified) translation
- [ ] Testing and refinement

### Phase 5: Ongoing
- [ ] Translation workflow automation
- [ ] Community contribution process
- [ ] Continuous coverage monitoring

---

*This i18n strategy enables OpenClaw to serve users in their preferred language.*
